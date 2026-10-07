# Supplier Document Intelligence — SD-3A: Supplier Statement Reconciliation (Discovery & Design)

**Status:** design only, awaiting owner review.
- Nothing is implemented, committed or migrated.
- Built on `26e506e` (SD-2).
- Production remains at 0109. The production migration order stays 0109 → 0110 → 0111 → 0112 → the SD-3
  migrations below, only on explicit instruction.
- Live AI stays **OFF**.

**Design principles** (owner requirements):
- **PDF-first.**
- Originals always retained.
- Arithmetic is checked by code, never by AI.
- No guessed supplier.
- No amount-only automatic matching.
- No accounting writes.
- No change to supplier-balance behaviour. The credit-note balance/ageing issue stays out of scope.
- Explicit database grants on every new object.
- Every reviewer action is audited.

---

## 1. What exists and is reused (discovery)

| Existing | Where | How SD-3 uses it |
|---|---|---|
| Document platform: private `documents` bucket, versioning, `content_sha256`, category **`Statement`** already allowed for `entity_type = 'Supplier'` (Purchasing) | `0027`, `0070`, `0108`, `src/server/documents/types.ts` | The original statement is stored as `Supplier` / `Statement`. **No documents migration** is needed. |
| Retention of evidence | `0112` (`fn_document_is_capture_evidence`, `documents_retain_capture_evidence`, storage delete policy) | Extended so statement originals are retained too. |
| Secure same-origin viewer | SD-2 `…/invoice-capture/[captureId]/original/route.ts`, `inline-file-type.ts` | The serving body is extracted into one shared helper used by captures **and** statements. No second storage or download mechanism. |
| pdfjs-dist text extraction (lazy, Vercel-safe loader, encrypted/scanned detection) | `src/server/import-centre/pdf-text-extraction.ts` | Its loader and worker setup are reused. A **new** layout function returns positioned text; the existing `extractPdfText` is untouched (FNB parsers depend on its exact output). |
| Statement arithmetic helpers: `reconcileStatementBalances`, `validateRunningBalances`, `validateTransactionCount` (liability mode, 0.01 tolerance) | `src/server/import-centre/pdf-statement-validation.ts` | Reused or extended for supplier statements (a liability, seen from the company's side). |
| Supplier matching (vat → registration → supplier-code → exact-name → normalised-name → learned; fuzzy matches are proposals only) | `supplier-resolution.ts` | Reused as is, plus one new tier: the supplier account number. |
| `normaliseInvoiceNumber` (upper-case, strip punctuation, **keeps leading zeros**) | `validation.ts` | The tier-2 matching key only. The printed text is stored verbatim. |
| **Party ledger** (pure): `buildSupplierLedger`, `balancesAt`, `supplierOpenItems`, `isPostedBill` | `src/server/report-centre/party-ledger.ts` | The **authoritative PRECISIA side**: opening balances, posted bills and credit notes (signed by `document_type`), posted supplier payments, posted bank `S` rows, as at a date. Called, not modified. |
| AI safety layer: scope budgets, `fn_ai_reserve_request` / `_release`, `ai_provider_circuit_state` (by scope), certification runs; provider error classification, `sanitizeProviderMessage`, the certification switch pattern | `0107`, `0099`, `0109`, `extraction-provider.ts`, `provider-selection.ts`, `redaction.ts` | Reused. Statement-specific gate, recorder and attempts table are added (the existing ones hard-require a capture id). |
| SD-0/SD-1 security patterns: permission RLS, guard triggers, immutable event tables, user/system event writers, explicit revoke/grant | `0111`, `0112` | Copied for every new table and function. |

Gaps found that the design must not paper over:

| Gap | Design response |
|---|---|
| **No OCR exists.** A PDF with no text layer is rejected today. | Scanned statements go to AI (OFF) or manual entry; see §3.4. |
| No reusable SA amount parser handles `1 234,56`, `(500.00)`, `500.00 CR/DR` and `500.00-` together. | A new pure parser (§3.3). |
| **No link between `supplier_payments` and bank `S` rows.** A payment recorded both ways is counted twice, including in the GL. | Flagged as a Potential Duplicate, never netted (§6). |
| Bills and payments are journalled on the **approval date**; the party ledger uses **document dates**. | The reconciliation basis is the party ledger (document dates), stated on the report (§8). |
| Xero-migrated bills are `Draft` with no journal. Import Centre bills have no journal. | Classified as "captured, not posted" (§7). |
| No "our account number at the supplier" field. | A new nullable column (§4). |

## 2. Data model (new tables)

Common rules for **all** tables below:
- `company_id uuid not null references companies on delete cascade`;
- RLS enabled, with a policy per operation;
- **explicit grants** (§10);
- `pg_notify('pgrst','reload schema')` at the end of each migration.

### 2.1 `supplier_statements` — one per statement document

| Column | Type | Notes |
|---|---|---|
| id | bigint identity PK | |
| document_id | bigint not null **unique** → documents (on delete **no action**) | the retained original |
| content_sha256 | text not null | copied at intake, for duplicate checks |
| source_type | text CHECK (`pdf-text`, `pdf-scanned`, `image`, `csv`, `xlsx`, `manual`) | what the file *is* (from its bytes / text layer) |
| extraction_method | text CHECK (`layout`, `ai`, `tabular`, `manual`) null | how lines were obtained |
| status | text CHECK (`Received`, `Extracting`, `ManualEntry`, `NeedsReview`, `Ready`, `Reconciled`, `Duplicate`, `Failed`, `Rejected`) | see §9 |
| supplier_id | bigint → ae_suppliers null | **set only by a deterministic tier or a reviewer** |
| supplier_match_tier | text null | vat / registration / supplier-code / account-number / exact-name / normalised-name / learned / manual |
| supplier_candidates | jsonb not null default `[]` | proposals only |
| supplier_confirmed_by / _at | text / timestamptz null | **required before reconciliation** (§5) |
| supplier_name_extracted, supplier_vat_extracted, supplier_registration_extracted | text null | as printed |
| account_number_extracted | text null | our account at the supplier, **verbatim** |
| statement_date | date null | the as-at date |
| period_from, period_to | date null | when printed |
| currency_code | text null | non-base currency → reconciliation refused (no FX) |
| opening_balance, closing_balance | numeric(14,2) null | as printed (reviewer-correctable) |
| printed_total_debits, printed_total_credits | numeric(14,2) null | when the statement prints totals |
| printed_ageing | jsonb null | `{current,d30,d60,d90,d120plus}` as printed |
| sign_convention | text CHECK (`debit-increases-owed`, `credit-increases-owed`) default `debit-increases-owed` | reviewer-confirmable (§4.1) |
| page_count | int null | |
| validation_status | text CHECK (`Pending`, `Pass`, `Review`, `Incomplete`) | §4 |
| validation_findings | jsonb not null default `[]` | |
| validated_at | timestamptz null | |
| extraction_attempts | int not null default 0 | |
| last_error_category / last_error_message (≤300) | text null | sanitised |
| extraction_snapshot | jsonb null | **immutable** as-extracted header + lines + provenance + warnings |
| warnings | jsonb not null default `[]` | extraction warnings (non-arithmetic) |
| manual_entry | bool not null default false | |
| uploaded_by, created_at, updated_at | | `uploaded_by` from the session (guard) |

### 2.2 `supplier_statement_lines`

| Column | Type | Notes |
|---|---|---|
| id | bigint identity PK | |
| statement_id | bigint not null → supplier_statements on delete cascade | |
| line_order | int not null | unique (statement_id, line_order) |
| page_number, row_on_page | int null | provenance; the viewer opens `#page=N` |
| transaction_date | date null | |
| reference_text | text null | **exactly as printed**: leading zeros, spaces and punctuation preserved |
| description | text null | wrapped lines joined |
| transaction_type | text CHECK (`invoice`, `credit-note`, `debit-note`, `payment`, `opening`, `interest`, `adjustment`, `other`, `unknown`) | |
| type_source | text CHECK (`printed`, `inferred`, `reviewer`) | how the type was decided |
| debit, credit | numeric(14,2) null | as printed, in the statement's own columns |
| amount | numeric(14,2) **generated** = `coalesce(debit,0) - coalesce(credit,0)` | owed-direction amount under `debit-increases-owed`; flipped by `sign_convention` in code |
| running_balance | numeric(14,2) null | as printed |
| raw_text | text null | the source row's text, for the reviewer |
| is_excluded | bool not null default false | sub-totals, page totals, B/F and C/F rows |
| corrected | bool not null default false | set by the guard when a reviewer edits |
| created_at, updated_at | | |

There is no normalised-reference column. The matching key is derived in code from `reference_text`, so
the stored text is never altered.

### 2.3 `supplier_statement_events` — immutable audit of statement lifecycle and reviewer actions

The same shape as `supplier_invoice_capture_events`:
- `event_type` CHECK: Uploaded, Queued, ExtractionStarted, Extracted, ExtractionFailed, ValidationEvaluated, SupplierConfirmed, FieldCorrected, LineCorrected, LineAdded, LineRemoved, ManualEntryStarted, SubmittedForReview, ReconciliationRun, ResolutionRecorded, ResolutionRevoked, Rejected, DuplicateEvaluated.
- `detail jsonb` carries no document content.
- `performed_by`, `occurred_at`.
- Writes go only through the user writer (actor from the session) and the system writer (service_role).
- The 0111 immutability trigger applies: no UPDATE, DELETE or TRUNCATE, except an FK cascade.

### 2.4 `supplier_statement_reconciliations` — one immutable row per run

| Column | Notes |
|---|---|
| id, statement_id | |
| run_number | int; unique (statement_id, run_number) |
| engine_version | text; changes when the algorithm changes |
| basis | text: `party-ledger-document-date` |
| as_at_date | the statement date |
| window_from, window_to | the matching window |
| statement_opening, statement_closing | |
| precisia_balance_before_window, precisia_balance_at | from `balancesAt` |
| difference | statement_closing − precisia_balance_at |
| explained_amount, unexplained_amount | §8 |
| category_summary | jsonb `{category: {count, amount}}` |
| input_fingerprint | sha-256 over the statement lines + PRECISIA records + active resolutions used, so a run is reproducible |
| created_by, created_at | |

Runs are never updated. A rerun creates a new run.

### 2.5 `supplier_statement_reconciliation_items` — the result rows of a run (immutable)

| Column | Notes |
|---|---|
| id, reconciliation_id | |
| statement_line_id | null (null for Missing-on-Statement items) |
| category / sub_status | §7 |
| match_tier | manual / exact / normalised / payment-evidence / suggestion / none |
| confidence | `exact` / `strong` / `suggested` |
| precisia_ref_type / precisia_ref_id | bill, credit-note, supplier-payment, bank-transaction, capture, opening-balance |
| related_refs | jsonb; all records involved (duplicates, double-recorded payment) |
| statement_amount, precisia_amount, difference, vat_difference_hint | |
| effect_on_difference | the signed amount this item explains (§8) |
| explained_by_resolution_id | null |

### 2.6 `supplier_statement_resolutions` — reviewer decisions (append-only; carried into reruns)

| Column | Notes |
|---|---|
| id, statement_id | |
| statement_line_id | null |
| precisia_ref_type / precisia_ref_id | null |
| action | CHECK `manual-link`, `explained`, `revoke` |
| revokes_resolution_id | null |
| reason | text, **not null, non-blank** (CHECK) |
| performed_by | from the session, via the writer function; no actor parameter |
| created_at | |

A link or explanation is withdrawn by a `revoke` row, never by deleting or editing. The engine reads the
**active** set (not revoked).

### 2.7 `supplier_document_access_events` — the required view/download audit (generic across supplier documents)

| Column | Notes |
|---|---|
| id, company_id, document_id | |
| capture_id null, statement_id null | CHECK: exactly one is set |
| action | CHECK `view`, `download` |
| actor_label | session email, else uid |
| actor_user_id | uuid, `auth.uid()` |
| occurred_at | |

Rules:
- Written **only** by `fn_record_supplier_document_access(company, document, capture, statement, action)`,
  which is security definer.
- The function derives the actor from the session, requires `Purchasing:View`, and verifies the document
  belongs to the company **and** to that capture or statement.
- Immutability trigger applies.
- **The viewer route fails closed:** if the audit row cannot be written, the original is not served.

### 2.8 AI boundary objects (statement-specific; OFF)

- `ai_statement_extraction_attempts`: the `ai_extraction_attempts` shape, with `statement_id` NOT NULL FK.
- `fn_ai_statement_extraction_gate`, `fn_ai_statement_extraction_record_attempt`: they reuse
  `fn_ai_reserve_request` / `_release` and the shared scope-keyed circuit. The circuit rules go into a new
  helper rather than a third copy; the existing 0107 and 0108 functions are **not** modified.
- `ai_provider_scope_budgets` row `supplier-statement-extraction` (proposed 50/day). Scopes then sum to
  350, below the 500 `__provider__` fuse.
- No task-type change until AI is actually enabled. Text-PDF extraction is deterministic and runs without
  the scheduler.

## 3. Extraction architecture (PDF-first)

All extraction paths produce one shape, `StatementExtraction`:
- header;
- lines, each with provenance: page, row and raw text;
- warnings;
- the method used.

The same validation (§4), review (§9) and reconciliation (§6) apply whatever the source.

```
Upload (PDF | JPG/PNG | CSV/XLSX) ─► bytes sniffed, hash, retained original
        │
        ├─ PDF ─► text-layer check PER PAGE
        │           ├─ all pages have text ─► 3.2 Layout extraction (deterministic)
        │           └─ any page image-only ─► 3.4 Scanned path (AI provider, OFF) │ Manual entry
        ├─ JPG/PNG ─────────────────────────► 3.4 Scanned path │ Manual entry
        └─ CSV/XLSX (secondary) ────────────► 3.5 Tabular mapping
                                  ▼
                StatementExtraction ─► §4 arithmetic validation ─► review ─► §6 reconciliation
```

### 3.1 Intake

- Accepted types: PDF, JPEG and PNG as the primary formats; CSV and XLSX as secondary. Detection is by
  bytes (`detectInlineFileType`, plus CSV/XLSX detection), never by the declared MIME type.
- Proposed limits: 25 MB (the document platform's limit) and 60 pages. Larger files are refused with a
  clear message.
- The same file hash as a live statement gives `Duplicate` (the SD-2 rule: rejected copies don't block
  but are flagged). The same supplier, statement date and closing balance as another statement gives a
  possible-duplicate warning.
- Stored as `documents` entity `Supplier`, category `Statement`, and retained (0112 extended).

### 3.2 Text PDFs — deterministic layout extraction, not supplier templates

- **A new `extractPdfLayout(buffer)`** uses the existing pdfjs loader. Per page it returns positioned tokens
  `{text, x, y, width, height, fontSize}`. It reports the text-layer density per page, encryption, and a
  page cap.
- **Rows.** Tokens are clustered into visual rows by baseline, with a tolerance scaled to font size. Each
  row becomes cells with x-ranges.
- **Table model by header vocabulary + geometry.**
  - A header row is recognised from synonyms: Date / Doc No / Reference / Invoice / Inv No / Our Ref / Your
    Ref / Description / Details / Debit / Dr / Charges / Invoices / Credit / Cr / Payments / Receipts /
    Amount / Balance / Running Balance.
  - Column x-bands are taken from the header cells.
  - **Tables that span pages:** a repeated header on the next page re-anchors the bands. A continuation page
    with no header inherits the previous bands, if its rows fit them.
- **Row classification.**
  - A transaction row has a parseable date in the date band (or in the first cell) and at least one amount.
  - A wrapped description line (no date, no amount) is appended to the previous row.
  - "Balance brought forward" / "Opening balance" rows become `opening`. "Closing balance" / "Balance
    carried forward" / "Amount due" / "Total due" rows become the closing candidates.
  - Page and sub-totals are kept but excluded.
  - Nothing unparseable is guessed. It becomes a warning, with the raw text kept for the reviewer.
- **Header fields** come from label proximity: "Account No/Acc No/Customer No/Debtor Code", "Statement
  Date/Date", "VAT Reg/VAT No", "Period". The supplier name comes from the letterhead (top block, largest
  font), always as a **proposal**.
- **The ageing block** (Current/30/60/90/120+) is parsed when present, for validation.
- **Type inference** is taken from printed type codes (INV/IN/CN/CRN/PMT/RCPT/JNL…) or the column
  (Debit vs Credit), recorded as `type_source = inferred`. The amount's sign alone **never** decides "credit
  note" vs "payment". It is `unknown` until the reviewer confirms, which avoids VOLORA's
  payments-as-credit-notes error.
- **Supplier-specific variation** is handled by vocabulary + geometry. When the generic model can't find a
  table it says so. **Future option (not SD-3):** a reviewer-confirmed per-supplier column mapping that is
  learned.

### 3.3 Number and date parsing (new pure module, shared)

**`parseStatementAmount`:**
- Handles `1 234,56`, `1,234.56`, `1 234.56`, `R 1 234.56`, `(500.00)`, `500.00-`, `-500.00`, `500.00 CR`
  and `500.00 DR`.
- An ambiguous value (for example `1.234` or `1,234` where the decimal style is unknown) gives **null plus
  a finding**. The decimal style is inferred once per statement, from the unambiguous values.
- Returns `{value, sign, raw}`.

**`parseStatementDate`:**
- Day-first (SA): `dd/mm/yyyy`, `dd-mm-yyyy`, `dd.mm.yyyy`, `31 Jan 2026`, `31-Jan-26`.
- A date without a year (`31 Jan`) takes its year from the statement date, including across Dec→Jan.
- Two-digit years have an explicit pivot rule.
- Anything impossible or ambiguous gives null plus a finding.

### 3.4 Scanned and image statements

- **There is no OCR in PRECISIA.** The design does not assume a text layer.
- **Path A — AI provider (OFF in production).**
  - A `StatementExtractionProvider` interface, with:
    - `UnavailableStatementProvider` (the default);
    - `GatewayStatementProvider`, behind its own switch `VYRON_AI_STATEMENT_EXTRACTION=certification` plus
      `AI_GATEWAY_API_KEY` (the SD-1 rule: literal word, key present, a second key lock before any network
      call).
  - The PDF or image is sent as a file or image part, batched **per page range** for long statements.
    Page provenance is kept, and per-page outputs are merged in page order.
  - The strict JSON schema requires references **verbatim** (leading zeros), values exactly as printed, and
    null when unreadable. It also requires the declared row count per page, and **no computation of any
    balance, total or sign**.
  - Each result goes through the same §4 validation. A failure means `NeedsReview` or a retry on
    deterministic failure only, never on model confidence.
  - It runs only on the automation runner, through the gate, budget and circuit (§2.8).
- **Path B — manual entry** (always available). The reviewer enters header and lines beside the viewer,
  using the SD-1/SD-2 manual-entry pattern.
- **Path C — a dedicated OCR engine** (tesseract.js or a cloud OCR service). **Owner decision**, for data
  residency and cost reasons. Not proposed for SD-3.

### 3.5 CSV and XLSX (secondary)

These are mapped into the same `StatementExtraction`, with header aliases (reusing the `csv-utils`
pattern), `exceljs` for XLSX, and the same parsers and validation. **They are not the architectural
base:** they are one more producer of the common shape.

## 4. Arithmetic validation (pure, deterministic, cents)

All arithmetic is in code, with each operation rounded to cents. **AI never computes.**

| Rule | Check | Failure → |
|---|---|---|
| V1 | Opening **and** closing balance present (or an explicit B/F line) | Incomplete |
| V2 | `opening + Σdebits − Σcredits = closing` (exact to the cent; the difference is reported) | **Incomplete** |
| V3 | Running balance: each printed balance = previous + debit − credit. **The first break is located** by line and page. | **Incomplete** |
| V4 | Printed column totals = column sums | Review |
| V5 | Printed ageing buckets sum to closing | Review |
| V6 | Page continuity: C/F on page *n* = B/F on page *n+1* | Incomplete |
| V7 | Each line has exactly one amount; its date is within the period (or ≤ statement date) | Review |
| V8 | Identical lines on the statement (same reference, date, amount) | Review (possible duplicate on the statement) |
| V9 | Declared row count (AI path) vs rows read | Incomplete |
| V10 | Sign convention: if V2 fails under `debit-increases-owed` but holds under the opposite convention, propose the flip as a finding. **The reviewer confirms; nothing is flipped silently.** | Review |

- **Result:** `Pass` (no findings), `Review` (non-arithmetic findings only) or `Incomplete` (any
  arithmetic failure).
- **Reconciliation requires `Pass` or `Review`.** It is impossible on `Incomplete`.
- **Amounts are never "fixed".** A reviewer corrects the line or balance against the original. Corrections
  are audited, the snapshot keeps what was extracted, and any correction resets validation to `Pending`
  (the SD-1 guard pattern).

## 5. Supplier identification

- `resolveSupplier` is reused as is.
- One new deterministic tier, **account-number**: `account_number_extracted` must equal the supplier's new
  `ae_suppliers.our_account_number` (verbatim after trimming; leading zeros kept).
- A fuzzy match is a proposal only. A match on several suppliers is ambiguous and goes to the reviewer.
- **Suppliers are never created.**
- **A statement is never reconciled against an unconfirmed supplier.** Even a VAT-number match is shown
  for confirmation. `supplier_confirmed_by/_at` is set only by the reviewer action `SupplierConfirmed`
  (audited), and the guard refuses reconciliation without it.
- When a reviewer confirms a supplier, PRECISIA offers to save the extracted account number to that
  supplier. This is explicit, audited, and needs Purchasing:Edit.

## 6. Reconciliation engine (pure, deterministic, no writes)

`reconcileStatement(input) → { items[], balances, summary }` is a pure function. The server loads the
inputs and persists the immutable run. **It never posts, adjusts, allocates or creates anything.**

**Inputs, all for the confirmed supplier:**
- **Authoritative posted records:** the `party-ledger` entries (opening balances, posted bills, credit
  notes and debit notes, posted supplier payments, posted bank `S` rows), as at the statement date.
- **"Known but not posted" records, kept separate and never in the balance:**
  - Purchasing bills in Draft, Submitted, or Approved with no GL posting;
  - Xero/Import bills with no journal;
  - captures in Queued, ManualEntry, NeedsReview or Duplicate state that carry this supplier and a number.
- The statement's validated lines.
- **Active reviewer resolutions.**

**Window:** `[period_from or the earliest line date, statement_date]`. Everything before it is carried in
`precisia_balance_before_window`, which is compared with the statement's opening balance.

### 6.1 Matching hierarchy (strongest first; each PRECISIA record matches at most one line)

| Tier | Rule | Automatic? |
|---|---|---|
| T0 Manual link | Reviewer-recorded link (with reason) | Yes, highest |
| T1 Exact reference | `reference_text` (trimmed) **equals** the PRECISIA document number, and the type is compatible (invoice ↔ Bill/Debit Note, credit note ↔ Credit Note) | Yes |
| T2 Normalised reference | `normaliseInvoiceNumber` keys are equal (punctuation and case only; **leading zeros kept**), exactly **one** candidate, compatible type | Yes, shown as "normalised" |
| P1 Payment with evidence | Payment line: **amount exact**, date within ±7 days, **and** reference evidence (payment number, reference or bank reference shares a token ≥ 4 characters) | Yes |
| S1 Reference containment | One reference's digits are contained in the other's with identical digits (e.g. `INV-0010041` vs `0010041`) | **Suggestion only** |
| S2 Amount + date | Amount exact and date within ±3 days, with no reference evidence | **Suggestion only, never automatic** |

- An **amount-only match is never automatic**, for invoices or payments.
- Two or more candidates in one tier is **ambiguous**: it becomes a Potential Duplicate, not a choice.
- Tie-breaks are deterministic (date, then id) and are only used to *order suggestions*.

### 6.2 Amount comparison

Comparison is exact to the cent.

| Difference | Classified as |
|---|---|
| 0.00 | Matched |
| Anything else | Amount Difference, with hints |

Hints on an Amount Difference:
- **VAT difference:** the difference equals the bill's VAT, or 15/115 of either amount.
- **Partial:** the statement amount equals an allocation or outstanding portion.
- **Credit-note difference.**

## 7. Exception classifications

| Category | Sub-status | Meaning |
|---|---|---|
| **Matched** | exact / normalised / manual | Reference matched, amounts equal |
| **Amount Difference** | vat-hint / partial-hint / — | Reference matched, amounts differ |
| **Missing in PRECISIA** | **not-captured** | No record and no capture anywhere |
| | **captured-not-posted** | Matches a known-but-not-posted record: draft, submitted or approved-unposted bill; Xero/Import bill without journal; or a capture in workflow (which one is named) |
| **Missing on Statement** | in-period / timing (dated ≤ 7 days before the statement date) | Posted PRECISIA record in the window with no statement line |
| **Potential Duplicate** | statement-repeat / multiple-precisia / **double-recorded-payment** | Repeated line on the statement; one line matches 2+ records; one payment exists as both a supplier payment and a bank `S` row (no link exists between them — flagged, never netted) |
| **Credit Note** | matched / amount-difference / missing-in-precisia / missing-on-statement | Credit notes reported as their own category, with amounts compared (unlike VOLORA) |
| **Payment** | matched / suggested / unmatched / timing | Payment lines, with timing differences shown |
| **Unclassified** | interest / adjustment / unknown | Lines that are neither documents nor payments, or have unknown type |
| *(header)* **Opening Balance Difference** | — | Statement opening ≠ PRECISIA balance before the window |

## 8. Reconciliation balances (no balancing adjustment is ever created)

| Figure | Definition |
|---|---|
| **S** | The statement closing balance (validated) |
| **P** | The PRECISIA balance at the statement date: `balancesAt(buildSupplierLedger(...), statement_date)` for the supplier. **Unchanged party-ledger semantics** (document dates; posted bills/credit notes/payments/bank `S` rows; opening balances). |
| **D** | `S − P` |
| **Explained** | Σ `effect_on_difference` of the run's items (below) |
| **Unexplained** | `D − Explained`, **shown as-is** |

Each item's `effect_on_difference`:
- Missing in PRECISIA: `+statement amount`.
- Missing on Statement: `−precisia amount`.
- Amount Difference: `statement − precisia`.
- Opening Balance Difference: `statement opening − precisia before window`.
- Duplicates: the extra record's amount.
- A reviewer "explained" resolution moves an item's effect into an **explained by reviewer** subtotal, with
  its reason.

**Identity tested on every run:** `D = Explained + Unexplained`. A non-zero Unexplained is a finding, not
something to cover up. For example, records outside the window, or a bank-settled payment posted only
through the legacy unflagged path.

The report also shows the **GL control check** (party ledger vs GL 2000 as at the date, via the existing
`controlAccountCheck`) for information only. GL dates are approval dates, so the two can differ legitimately.

## 9. Review workflow

| Stage | Detail |
|---|---|
| **Statement states** | `Received → Extracting → NeedsReview → Ready → Reconciled`. Also `ManualEntry` (from Received or Failed), `Duplicate`, `Failed`, `Rejected`. |
| **Ready** | `validation_status ∈ {Pass, Review}` **and** supplier confirmed |
| **Reconciled** | At least one run exists. Reruns are always allowed (new run). |

Reviewer actions, each audited (an event, plus a resolution row where relevant):

| Action | Permission |
|---|---|
| Inspect the original (viewer + `#page=N` jump to a line's page) | View |
| Inspect extracted lines, side by side with the snapshot | View |
| Inspect the PRECISIA record of any item (links to bill/payment/bank/capture) | View |
| Confirm supplier | Edit |
| Correct header or lines; add or remove lines (resets validation) | Edit |
| Manual entry; submit for review | Edit |
| **Manually link** a line to a record (**reason required**) | Edit |
| **Mark an exception explained** (**reason required**) | Edit |
| Revoke a link or explanation (reason required) | Edit |
| **Rerun reconciliation** | Edit |
| Reject statement | Reject |
| *(optional)* Sign off a run as reviewed | Approve |

## 10. Security: RLS, permissions and **explicit grants**

- **RLS** on every table, by `user_has_permission(company_id, 'Purchasing:<Action>')`:
  - View to read;
  - Create to upload;
  - Edit to change;
  - Reject to reject.
- **Guard triggers** (SD-1 pattern). For signed-in users they enforce:
  - frozen identity columns;
  - system-owned result columns (extraction, validation, `extraction_snapshot`);
  - permission per state transition;
  - same-company checks for supplier, document, statement↔line, and resolution ↔ referenced record (which
    must also belong to the statement's supplier);
  - any reviewer edit resets validation.
  
  Service-role server paths pass the trigger.
- **API routes:** `requireSession`, then `requirePermission` **before** any lookup, as in SD-2. The engine
  runs server-side, and runs are written with the service role after the permission check, plus a system
  event carrying the session actor.

**Explicit grants (no reliance on Supabase defaults).** These are written into each migration, including
`service_role`, because newer Supabase no longer auto-grants even to it.

| Object | Grants |
|---|---|
| `supplier_statements` | `revoke all … from public, anon;` `grant select, insert, update on … to authenticated;` `grant select, insert, update, delete on … to service_role;` |
| `supplier_statement_lines` | `revoke all … from public, anon;` `grant select, insert, update, delete … to authenticated;` (RLS + guard limit them) `grant all … to service_role;` |
| `supplier_statement_events`, `supplier_document_access_events` | `revoke all … from public, anon, authenticated;` `grant select … to authenticated;` `grant select, insert … to service_role;` (writes via functions) |
| `supplier_statement_reconciliations`, `…_items` | `revoke all … from public, anon, authenticated;` `grant select … to authenticated;` `grant select, insert … to service_role;` |
| `supplier_statement_resolutions` | `revoke all … from public, anon, authenticated;` `grant select … to authenticated;` `grant select, insert … to service_role;` (user inserts via definer writer) |
| `ai_statement_extraction_attempts` | `revoke all … from public, anon, authenticated;` `grant select … to authenticated;` (RLS View) `grant select, insert … to service_role` |
| User writer functions (`fn_supplier_statement_record_event`, `fn_supplier_statement_record_resolution`, `fn_record_supplier_document_access`) | `revoke execute … from public, anon;` `grant execute … to authenticated;` |
| System and AI functions (system event writer, `fn_ai_statement_extraction_gate`, `_record_attempt`, circuit helper) | `revoke execute … from public, anon, authenticated;` `grant execute … to service_role;` |
| Trigger functions | `revoke execute … from public, anon, authenticated;` |
| Identity columns | No sequence grant needed: identity sequences aren't permission-checked on insert. Tests verify this. |

Each SD-3 SQL suite asserts the full `has_table_privilege` / `has_function_privilege` matrix. The
migrations are tested on a stack **without** legacy auto-expose (the new Supabase default) to prove the
grants are sufficient on their own. They are also tested on a production-like stack.

## 11. Audit model (summary)

- **Lifecycle and reviewer actions:** `supplier_statement_events`, immutable, with the actor from the
  session.
- **Decisions that change reconciliation outcomes:** `supplier_statement_resolutions`, append-only, with a
  mandatory reason; revocation is a new row.
- **Runs:** immutable, with an `input_fingerprint`, so the result of any run can be reproduced.
- **Original view/download** (captures **and** statements): `supplier_document_access_events`. This is the
  carried-forward SD-2 requirement, and the viewer fails closed.

## 12. AI boundary

| Element | Decision |
|---|---|
| Live AI | **Off.** Default provider is `UnavailableStatementProvider`. |
| Switch | Separate `VYRON_AI_STATEMENT_EXTRACTION` (literal `certification`) **and** `AI_GATEWAY_API_KEY`; a second key lock before any network call. |
| What AI may do | Transcribe printed text, including references verbatim, into the strict schema. |
| What AI may never do | Compute balances or totals, infer signs, choose suppliers, match records, or decide categories. All of that is deterministic code. |
| Safety | Scope budget `supplier-statement-extraction`, shared scope circuit, attempts log, certification runs (0109) reusable; retry only on deterministic validation failure. |
| Data | `sanitizeProviderMessage` for every stored provider message; no raw responses persisted outside the immutable snapshot. |

## 13. Migration plan (local only; each with rollback + SQL suite)

| # | Migration | Contents |
|---|---|---|
| 0113 | `supplier_document_access_audit` | Access events table, writer, immutability, grants. The SD-2 capture viewer starts logging (fail-closed). Independent and small. |
| 0114 | `supplier_statements` | Statements, lines, events, guards, RLS, grants. `ae_suppliers.our_account_number` (nullable). Retention predicate extended to statement originals. |
| 0115 | `supplier_statement_reconciliation` | Runs, items, resolutions, writers, RLS, grants |
| 0116 | `supplier_statement_ai_boundary` | Budget row, attempts table, gate, recorder, circuit helper. Everything service-role only; OFF. |

Production stays 0109. When instructed, the order is 0110 → 0111 → 0112 → 0113 → 0114 → 0115 → 0116.

**Proposed delivery slices after approval:**

| Slice | Contents |
|---|---|
| **SD-3B** | 0113, plus the shared viewer helper and capture-viewer logging |
| **SD-3C** | 0114, layout extractor, parsers, validation, manual entry, CSV/XLSX mapping |
| **SD-3D** | Engine, 0115, runs and resolutions |
| **SD-3E** | UI (Statements area) |
| **SD-3F** | 0116 AI boundary (off), plus a statement certification corpus |

## 14. Test strategy

- **Statement corpus.** Hand-authored synthetic statements with **independent answer keys**, built and
  countersigned the way 5O was. Layouts cover:
  - separate Debit/Credit columns;
  - a single Amount column with CR/DR suffixes or parentheses;
  - with and without running balance;
  - multi-page, with repeated headers **and** header-less continuation pages;
  - wrapped descriptions;
  - B/F and C/F rows;
  - an ageing block;
  - **leading-zero references**;
  - SA number formats;
  - a scanned image-only PDF, JPG and PNG;
  - an encrypted PDF;
  - a 60+ page file.
- **Pure unit tests:**
  - parsers, including every ambiguous case returning null;
  - every validation rule, including locating the first running-balance break;
  - the engine, table-driven per category and sub-status: leading zeros, duplicates, double-recorded
    payment, timing, opening difference, suggestions never auto-matched;
  - **property tests**: random ledger → statement generated from it reconciles 100% Matched with
    Unexplained = 0; `D = Explained + Unexplained` holds for any input.
- **Golden extraction tests** run the layout extractor over the corpus PDFs against their answer keys.
- **SQL suites:**
  - RLS, isolation and the permission matrix;
  - **explicit grant matrix**;
  - immutability of events, runs, items and resolutions;
  - retention of statement originals;
  - access-audit actor not spoofable and fail-closed;
  - AI functions service-role only;
  - **accounting fingerprint unchanged**: no journal, bill, payment, allocation or bank row is written by any
    statement path.
- **Route security tests** for every route: permission before lookup, wrong company, forged actions.
- **Browser tests** in the UI slice, as in SD-2: production build, local stack, synthetic data.

## 15. Risks and decisions for the owner

1. **Scanned statements without OCR.** With AI off, image-only statements can only be entered by hand.
   Decide later between AI multimodal (once enabled), a dedicated OCR engine, or manual entry only.
2. **Reconciliation basis.** Proposed: the party ledger (document dates) as P, with the GL control check
   shown for information. Confirm.
3. **Xero-migrated / Import Centre bills** (no journal) are classified "captured, not posted". For migrated
   companies this may produce many items. Confirm, or treat them as a separate "imported, never posted"
   sub-status.
4. **Double-recorded payments** (supplier payment + bank `S` row, unlinked) are flagged only. Fixing the
   lack of a link is accounting work, out of scope.
5. **Legacy unflagged bank postings** (`posted_flag` false with a posted journal) can be missing from the
   party ledger. They will surface as Unexplained or Missing-in-PRECISIA. Out of scope to change.
6. **`ae_suppliers.our_account_number`** is a new nullable supplier column. Approve.
7. **The viewer audit fails closed**, so an original is not shown if the audit write fails. Approve, or
   choose fail-open with an alert.
8. **Supplier confirmation always required**, even after a VAT match. Approve.
9. **Limits:** 25 MB and 60 pages, text extraction in-request. Larger files would need a background job.
10. **Currency:** non-base-currency statements cannot be reconciled (no FX). The same rule as captures.
11. **Supabase default-grant change** (the CLI field is removed 2026-10-30). The explicit grants make SD-3
    independent of it. Existing tables still rely on production's legacy grants, which should be noted for
    any future project migration.

---

## 16. Owner review (2026-10-07): APPROVED with decisions and amendments

These decisions are binding on SD-3B…SD-3F. Where they differ from the sections above, the decisions here
take precedence.

### 16.1 Scanned INVOICES are not manual-only (critical)

PRECISIA distinguishes Supplier Invoices/Credit Notes from Supplier Statements.

**Invoices and credit notes** stay eligible for **automatic extraction** whatever the source: a text PDF,
a scanned PDF with no text layer, JPEG or PNG. The intended workflow is:

1. automatic extraction;
2. validation;
3. duplicate detection;
4. supplier confirmation;
5. reviewer correction;
6. approval;
7. a Draft Bill or Draft Credit Note.

The invoice provider boundary sends the document itself to an OCR/vision-capable provider. **It must never
be changed to require a text layer, or to route scanned invoices to manual entry.**

Live AI stays OFF. Deterministic code stays the authority for arithmetic, VAT, duplicates, approval limits,
validation, conversion and posting. This is also documented at the top of
`src/server/supplier-invoice-capture/extraction-provider.ts`.

**Statements:** in SD-3 only, scanned statements and images start with manual entry, because there is no
statement OCR. This **must not become a permanent manual-only architecture.** The statement model and
extraction interface stay provider-agnostic (§3.4 Path A), so OCR or vision extraction can be added later
without redesign. No dedicated OCR engine is to be added unless the owner approves it.

### 16.2 Statement formats

| Format | Status |
|---|---|
| PDF | **PRIMARY** (hard requirement) |
| JPEG, PNG | Supported, for scanned statements |
| CSV, XLSX | Secondary convenience formats only; never the architectural foundation. Not VOLORA's CSV-first approach. |

### 16.3 Amendments to the design

| § | Amendment |
|---|---|
| §8 | **P** is the existing supplier ledger, `balancesAt`. GL creditors are shown for information only. No change to supplier balances, ageing, credit-note allocation or as-at logic; the credit-note issue stays out of scope. |
| §7 | "Missing in PRECISIA" sub-statuses are **Not Captured**, **Captured — Draft** (the capture or draft bill is named) and **Imported — Not Posted** (Xero / Import Centre with no journal; never called "captured"). The report distinguishes Not Captured / Captured — Draft / Imported — Not Posted / Posted. |
| §7 | **Duplicate payments** (a supplier payment plus a bank transaction) are **flagged only**: never netted, allocated, re-linked or modified. |
| §15.5 | Legacy unflagged bank postings stay **unexplained**. Historical behaviour is unchanged. |
| §5 | `ae_suppliers.our_account_number` (nullable) is **approved**, as a matching signal only. It never creates a supplier. |
| §5 | Explicit reviewer **confirmation of the supplier is mandatory for every statement**, even after a VAT, registration, code, account-number or name match. |
| §2.7 | The view/download audit **fails closed**: the event is written **before** the original is shown or downloaded. If the write fails, nothing is served and a clear error is shown. The actor comes from the session and cannot be supplied. It applies to capture **and** statement originals and reuses the SD-2 viewer. |
| §3.1 | Limits are 25 MB and 60 pages. **Extraction is asynchronous**: upload, retain the original, create a Received/Queued statement and return. Extraction then runs in the background (Processing), then validation, then NeedsReview or Ready. **No heavy extraction inside the upload request.** |
| §2.1 | A foreign-currency statement is refused for reconciliation and marked **Unsupported Currency / Manual Review Required**. No invented rates, no conversion, no balancing adjustments. |
| §10 | Every SD-3 table and function **explicitly** grants and revokes per role. Nothing relies on Supabase defaults or CLI behaviour. The grant matrix is SQL-tested. |
| §14 | The **statement certification corpus with independent answers comes before** the engine depends on extraction. It covers every case in the owner's list, including ambiguous values and unreadable rows: raw text kept, value unresolved, a warning, and review required. Never a silent guess. |
| §13 | Slices stay separate: SD-3B (0113), SD-3C (0114), SD-3D (0115), SD-3E (UI), SD-3F (0116). Production order is 0109 → 0110 → 0111 → 0112 → 0113 → 0114 → 0115 → 0116, and nothing is applied yet. |
