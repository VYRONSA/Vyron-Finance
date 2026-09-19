# Phase 5K — VYRON COST AI / Hubdoc architecture recovery

Research and architecture review. **No implementation.** Nothing in VYRON COST
was modified; nothing in VYRON Finance was implemented. No AI provider was
called. No migration was applied anywhere.

---

## 1. COST source located

| | |
| --- | --- |
| Path | `C:\Users\gerha\vyron-cost-web` |
| Branch | `main` |
| Commit | `af4792d` (2026-09-16) |
| Size | 3.2 GB, Next.js 16 App Router, `runtime = "nodejs"` |

The feature is **merged and shipped**, not a prototype: `4be3520` (Architecture
Certified, 2026-08-01) → `61cbff2` (V1.0 Production) → `e01160a` (V2 behind a
flag) → `c87dbc2` (V2 released) → later fixes through 2026-09.

The branch `feat/supplier-invoice-intelligence-v1.0` (`4be3520`, 2026-08-01) is
**superseded by main** and should not be used as the reference.

Other candidates ruled out: `vyron-invcost` (36 KB, empty), and ~40
`vyron-cost-*` batch archives under `Documents/GVS Client Data/Downloads` which
are delivery bundles, not the working tree.

COST's own documentation is unusually candid and is the single most valuable
artefact recovered:

- `docs/SUPPLIER-INVOICE-EXTRACTION-ARCHITECTURE.md` (224 lines)
- `docs/SUPPLIER-IMPORT-AND-INVOICE-INTELLIGENCE-ARCHITECTURE.md` (865)
- `docs/EXTRACTION-ENGINE-CERTIFICATION.md` (453)
- `docs/SUPPLIER-INVOICE-PRODUCT-BACKLOG.md` (120)

---

## 2. Relevant COST files

**Engines**
- `src/lib/vyron-document-extraction.ts` (2,282) — engine v1: whole-document call, 3-pass retry, normalisation, validators, persistence
- `src/lib/vyron-invoice-extraction-v2.ts` (663) — engine v2: page image + cropped table, 2 calls per page, no retries. **Default.**
- `src/lib/document-intelligence-v2/supplier-invoice-extractor.ts` — a third extractor, OpenAI SDK + strict `json_schema`, developer-only
- `src/lib/vyron-invoice-table-vision.ts` — locate-then-read table vision
- `src/lib/vyron-document-page-images.ts` — classification + embedded page-image recovery
- `src/lib/vyron-image-raster.ts` — pure-JS JPEG decode/crop/upscale/PNG encode (replaced `sharp`, which failed on Vercel)

**Validation and quality**
- `src/lib/vyron-extraction-quality.ts` — deterministic classification, authoritative over model confidence
- `src/lib/vyron-invoice-reconciliation.ts` — totals reconciliation, inclusive/exclusive basis inference
- `src/lib/vyron-invoice-line-math.ts` — derive-only-what-is-missing line maths
- `src/lib/vyron-duplicate-invoice-detection.ts` — 4-layer deterministic duplicate detection
- `src/lib/document-intelligence-v2/invoice-boundary.ts` — multi-invoice (batch scan) refusal

**Matching and learning**
- `src/lib/vyron-supplier-resolution.ts` — 5-tier supplier resolver (**orphaned**, see §6)
- `src/lib/vyron-supplier-line-learning.ts` — per-supplier line mapping + learning
- `src/lib/vyron-line-match-search.ts`, `src/lib/vyron-review-draft-hydrate.ts`

**Routes**
- `src/app/api/documents/upload/route.ts`, `[id]/extract/route.ts`, `bulk-extract`, `[id]/review/{route,corrections,validate,approve,create-entity}`, `bulk-approve`, `bulk-archive`, `bulk-delete`, `[id]/rollback-cost`, `next-review`, `queue` (stats only)
- `src/app/api/document-intelligence/{extract,health}/route.ts`
- `src/app/api/developer/{document-intelligence-v2,extraction-diagnostics}/route.ts`

**UI**
- `src/components/DocumentHubdocClient.tsx` (1,048) — inbox, upload, bulk actions
- `src/components/DocumentReviewWorkspace.tsx` (1,705) — the review screen
- `src/components/DocumentIntelligenceDashboard.tsx` (354), `ExtractionQualityPanel.tsx`, `InvoiceReviewTotalsFooter.tsx`, `SupplierLearningClient.tsx`
- `src/components/DocumentIntelligenceClient.tsx` — **dead code**, a mock returning hard-coded "Chicken Fillet"; imported nowhere

---

## 3. Actual COST workflow

Traced, not assumed. **There is no queue and no background worker.**
`/api/documents/queue` is a statistics endpoint. Extraction is orchestrated by
the browser.

```
human drag/drop ("Capture Document")
      │  per file, sequentially
      ▼
POST /api/documents/upload          status: uploading → uploaded
      │  MIME allow-list, SHA-256 computed, identical-file lookup
      │  duplicate warning returned — AND DISCARDED BY THE UI
      ▼
POST /api/documents/[id]/extract    status: extracting        (client-initiated)
      │  AI allowance gate (402) → engine v1/v2 → model call(s)
      │  deterministic validators → persist → status: extracted
      │  duplicate detection runs AFTER persistence, advisory only
      ▼
router.push(/document-intelligence/[id])   (single-file uploads only)
      ▼
HUMAN REVIEW — DocumentReviewWorkspace
      │  edit header + lines, confirm item mappings
      ▼
POST .../review/corrections         status: reviewed          (Save Draft)
      │  field-level diff audit + supplier learning written
      ▼
POST .../review/validate → POST .../review/approve
      │  policy gate (blockable) → cost writes → audit → status: archived
      ▼
costing masters + price history + inventory movement + Xero queue row
```

Status lifecycle: `uploading → uploaded → extracting → extracted → reviewed →
archived`, with `upload_failed` / `extraction_failed` branches and a soft-delete
(`deleted_at`). A failed extraction releases the lock back to `uploaded`.
`"approved"` survives only as a legacy value; no code writes it.

`"Captured"` in the UI is **cosmetic** — it is `confidence >= 75` changing a
badge. It grants nothing.

---

## 4. AI provider / model

**OpenAI only.** No Anthropic, Gemini or Mistral call site exists; those appear
only as empty enum placeholders in the usage-metering layer.

| Item | Value |
| --- | --- |
| Models | `gpt-4o` primary (`OPENAI_DOCUMENT_MODEL`), `gpt-4o-mini` fallback (`OPENAI_DOCUMENT_FALLBACK_MODEL`) |
| API | OpenAI **Responses API**, `https://api.openai.com/v1/responses` |
| SDK | `openai@^6.46.0` — used by the certification extractor **only**. Both production engines hand-roll `fetch`. |
| Structured output | **None in production.** Prompt-and-parse with fence-stripping + brace-matching. Only the developer-only certification extractor uses `json_schema` with `strict: true`. |
| Temperature | `0` everywhere |
| max_output_tokens | 16,000 (1,200 for the locate pass) |
| Timeout | **None.** No `AbortController`, no `signal`. Only Vercel's `maxDuration` (120 s; 300 s for bulk). |
| Retries | v1: up to 3 passes (primary → primary reinforced → fallback model). v2: none. **No transport retry, no backoff, no jitter, no `Retry-After` handling.** |
| Concurrency | None — strictly serial everywhere |
| Circuit breaker | **None** |
| Usage fuse | Yes — monthly allowance per company, HTTP 402. **`bulk-extract` bypasses it entirely.** |

**Error handling** is genuinely good where it exists: `vyron-ai-service-errors.ts`
classifies 429 (rate-limit vs quota via body signals), 402, 5xx and quota-on-400
into a typed `AiServiceUnavailableError` → HTTP 503 with operator-readable text.
401/403 are **not** classified and fall through to a generic error. Every failure
path releases the `extracting` lock — added after a real incident where a
document stayed locked after a quota failure.

**Known risk, stated in COST's own code:** worst-case measured at 119.7 s against
a 120 s ceiling — "almost no margin".

---

## 5. Extraction schema

Field-by-field. "Validated" means a deterministic code check, not a model opinion.

| Field | Extracted | Validated | Confidence | Editable | Persisted | Used downstream |
| --- | --- | --- | --- | --- | --- | --- |
| supplier | ✅ | name-only `ilike` | ✅ per-field | ✅ free text | `supplier_name` | learning, price history, duplicates |
| supplierVatNo | ✅ | ❌ | ✅ | ✅ | `supplier_vat_number` | **stored, never used for matching** |
| registration number | ❌ | — | — | — | — | — |
| invoiceNo | ✅ | ✅ duplicates | ✅ | ✅ | ✅ | duplicate layer 1 |
| invoiceDate | ✅ | ✅ 7-day window | ✅ | ✅ | ✅ | duplicate layer 3 |
| dueDate | ❌ | — | — | — | — | — |
| PO number (`orderNo`) | ✅ | ✅ optional rule | ✅ | ✅ | ✅ | 3-way match |
| currency | ✅ | ❌ | ❌ | ❌ | ✅ | display only |
| subtotal / vat / total | ✅ | ✅ reconciliation | ✅ | ✅ | ✅ | approval gate |
| customerName / customerVatNo | ✅ | ❌ | ✅ | ✅ | ✅ | — |
| accountNumber, customerReference, salesRepresentative | ✅ | ❌ | ✅ | ✅/partial | ✅ | — |
| line description | ✅ | ✅ arithmetic | ✅ per-field | ✅ | ✅ | item matching, learning |
| quantity, unitPrice, lineTotal | ✅ | ✅ arithmetic | ✅ | ✅ | ✅ | costing |
| unit (UOM) | ✅ raw string | ❌ | ✅ | ✅ | ✅ | ±8 confidence nudge only |
| vatAmount (line) | ✅ | ✅ vs header | ✅ | ✅ | ✅ | reconciliation |
| discount | ❌ | — | — | — | — | — |
| VAT rate | ❌ | — | — | — | — | — |
| product/SKU code | ✅ | ❌ | ✅ | ✅ | ✅ | item matching (exact) |
| **GL account / tax code / expense category** | ❌ | — | — | — | — | **does not exist** |
| `documentType` | ✅ | ✅ | — | ❌ | ✅ | classification |
| `invoiceNumbersSeen` | ✅ (cert schema) | ✅ boundary | — | ❌ | — | batch-scan refusal |
| `validation.duplicateRisk` | ✅ (model) | — | — | ❌ | — | **explicitly distrusted** |

Two sentinel conventions: v1 writes the string `"Needs Review"` into missing
fields (including numeric ones); v2 writes `"UNKNOWN"` and its strict normaliser
treats it as absent. **A magic string in a money field is a real typing hazard
and must not be carried over.**

---

## 6. Supplier matching

**COST has an excellent supplier resolver, and Document Intelligence does not
use it.**

`src/lib/vyron-supplier-resolution.ts` implements a deterministic 5-tier ladder:

```
Tier 1  VAT NUMBER        exact on normalised VAT
Tier 2  EXACT NAME        case-insensitive trimmed
Tier 3  NORMALISED NAME   legal suffixes/punctuation stripped
Tier 4  FUZZY             Levenshtein similarity >= 0.86 — PROPOSAL ONLY
Tier 5  CREATE            with recorded provenance
```

`TIER 4 NEVER MERGES AUTOMATICALLY` — the matcher returns `row: null` in the
fuzzy branch by construction and hands back up to 5 ranked candidates.

Its **only callers are the CSV import paths.** Nothing under
`src/app/api/documents/**` imports it.

What Document Intelligence actually does:

```ts
.eq("company_id", document.tenant_id)
.ilike("supplier_name", document.supplier_name || "")
.maybeSingle()
```

- **One match** → id stamped on price history/risk alerts. No confirmation.
- **Several match** → `.maybeSingle()` errors, the error is never destructured,
  so it silently degrades to `supplier_id: null`.
- **No match** → `supplier?.id || null`; approval proceeds. No supplier is ever
  created from an invoice.

There is **no `supplier_id` column on `vyron_documents`.** Supplier is free text.
Learning, price history and duplicate detection are all keyed on that string, so
`"ACME Foods"` and `"Acme Foods (Pty) Ltd"` fragment a supplier's entire history.

The review UI offers a **plain text input** for supplier — no picker, no
candidate list, no confirmation step.

---

## 7. Product / item matching

Invoice lines match to **ingredients, packaging and products** — master data for
recipe costing, not stock SKUs.

`findBestSupplierLineMatch`: supplier-specific SKU exact (conf 90) → description
exact (88) → token-overlap similarity **≥ 0.55** (`score × 85`). Unit is used
**only as a ±8 confidence nudge, never as a filter**. No price signal, no
category signal.

Candidate mappings are loaded by **exact string equality on supplier name**, with
a 500-row cap and a linear scan per line.

**Matches ≥ 0.55 are auto-applied into the editable draft** and become
authoritative the moment the operator saves or approves — a badge
("Remembered / Exact / Similar / Manual") is the only tell.

### Pack size / UOM — the concrete answer: **none of it exists**

Searched exhaustively. There is no `12 x 1L` parser anywhere — no `[x×]`
quantity-pattern regex in the codebase at all. `unit` is stored verbatim
(`trim()` only). The UOM register has no conversion factors and is never read by
extraction.

Given `"12 x 1L Coca Cola" @ R180.00`, COST stores the description as printed and
`unit_price = 180.00`. It cannot derive pack quantity 12, unit size 1 L, or a
per-litre cost of R15.00. On approval it writes:

```ts
purchase_cost: newPrice,
true_unit_cost: newPrice,     // <- the CASE price, undivided
```

**The field named "true unit cost" receives the case price.** This is a genuine
costing defect in COST and it poisons every downstream analytic built on
`vyron_supplier_price_history`.

---

## 8. Duplicate detection

Three mechanisms. **None of them blocks anything.**

**(a) Upload-time content hash** — SHA-256 over the file bytes, matched against
prior uploads for the tenant. Returns `duplicateWarning`. **The UI never reads
the field**, so the warning is computed and silently discarded.

**(b) Post-extraction deterministic detection** — genuinely well designed,
`vyron-duplicate-invoice-detection.ts`, and explicit that the model's opinion is
worthless: *"`validation.duplicateRisk` … is filled in by the language model … It
is an impression, not a finding."*

| Layer | Signal | Computed action |
| --- | --- | --- |
| 2 | identical file hash (supplier-independent) | `block` |
| 1 | same supplier + normalised invoice number | `block` |
| 3 | same supplier + total (±½c) + dates within 7 days | `warn` |
| 4 | same supplier + total, different number | `review` |

Filename is deliberately not a signal. **But nothing consumes `action`.** The
result is written as a risk-alert row, surfaced as a red "Duplicate Risk" badge
and a banner — and `validateDocumentApproval` never consults it.

**(c) Approval-time check** — queries for a duplicate and raises an alert
**after** the cost writes have already happened. A duplicate is approved, costed,
and then flagged.

Note the contradiction with COST's own architecture doc, which stated duplicate
protection was "demo fiction". That was true of the *risk-alert rows the UI
reads*; a real detector was subsequently built. It is correct, and it is inert.

---

## 9. VAT / accounting suggestions

**There are none.** No GL account, no tax code, no VAT treatment, no expense
category is extracted, suggested, stored or exported anywhere in COST. The Xero
payload is `{ supplierName, invoiceNumber, invoiceDate, total }` — no account
code.

The only "suggestion" is the learned item mapping (§7), which is deterministic
string matching, not AI.

### The arithmetic boundary — COST's best idea

The model is **forbidden from calculating**:

> Copy the characters exactly as printed. Do NOT calculate, infer, derive,
> estimate or convert anything. Do not compute VAT from a rate. Do not derive a
> line total from a quantity and a price. If a cell cannot be read, return
> "UNKNOWN" — never a plausible substitute.

The header `subtotal`/`vat`/`total` stored are the **extracted (or human-edited)**
values. The system computes its own sums **for comparison only** and never
overwrites. `reconcileInvoiceTotals` infers whether the line-total column is
VAT-inclusive or exclusive rather than assuming, and the *same* function is used
by the engine, the quality panel, the review screen and the approve route — so
"approval cannot disagree with the panel the operator approved from."

**This separation — extract literally, reconcile independently, never
recalculate silently — is the single most important idea to carry into Finance.**

---

## 10. Human review

`DocumentReviewWorkspace.tsx` (1,705 lines). Editable: supplier (free text),
invoice number, invoice date, account number, order number, customer name, both
VAT numbers, subtotal, VAT, total; and per line: code, description, qty, unit,
unit price, line total, VAT, type (Ingredient/Packaging/Product/Ignore), mapped
entity, skip. Lines can be added by hand.

Confidence is surfaced per header field (badge + red tint below 70) and per line
(row-number cell, colour + tooltip). The **Extraction Quality panel** states the
doctrine plainly:

> AI confidence 92% — informative only. Review state is decided by the checks above.

Warnings shown: extraction quality (Verified / Needs Review / Incomplete), totals
mismatch banner with Δ Excl / Δ VAT / Δ Incl, a required reconciliation note above
R1.00 difference, procurement risk (including duplicate), and supervisor-override
audit.

**Not settable here:** GL account, cost category, VAT treatment — they do not
exist.

### What must be approved — and three ways around it

The single-document path is properly gated: `validateDocumentApproval` can block
on extraction incompleteness, unreconciled totals, column-mapping failure,
missing required fields, unmatched lines, header confidence and variance.

1. **Bulk approve bypasses all of it.** The client hard-codes `force: true`,
   which maps server-side to `force + forceTotalsMismatch`, and the validator
   computes `blocked = errors.length > 0 && !hasSupervisorOverride &&
   !forceApproval`. With `force: true`, **`blocked` is unconditionally false.**
   Selecting rows in the inbox and clicking "Approve (n)" writes cost updates,
   price history, inventory movements and Xero queue rows, archives the
   documents, and bypasses every quality rule — behind one generic
   `window.confirm`, with no supervisor PIN and without anyone opening a review
   screen.
2. **Supervisor override** — a single shared PIN defaulting to the literal
   `"vyron-supervisor"`, which the settings page **prints on screen**.
3. **Auto-applied learned mappings** (§7) become authoritative without being
   looked at.

---

## 11. Supplier learning

Real, persistent, tenant-scoped and audited. Written on Save Draft (confidence
85), Approve (95), and Create-entity (85), into
`vyron_supplier_line_item_mappings`, keyed
`(tenant_id, supplier_name, source_description_normalized)`.

Stored: normalised description and SKU, unit, matched entity, `last_approved_price`,
`usage_count`, `match_source`, `approved_by/at`, `last_document_id`, `disabled`.
Every change also writes an immutable row to
`vyron_supplier_line_item_mapping_history`. Operators can re-point or disable a
mapping from a Supplier Learning admin page.

Weaknesses:
- **SKU is not part of the conflict key** — two SKUs sharing a normalised
  description collapse into one mapping, last write wins.
- Keyed on the supplier **name string**, so a spelling variant starts a fresh
  namespace.
- Upsert failures are swallowed with `console.warn` — learning can fail silently
  while approval reports success.
- `vyron_supplier_invoice_learning.supplier_name_variations` is overwritten with
  a **single-element array on every save**, so the one alias field in the schema
  can never accumulate aliases.
- Invoice-number patterns, date-format hints and field corrections are recorded
  but **never fed back into extraction** — the loop is not closed.

No GL, VAT or account mappings are learned, because none exist.

---

## 12. Document storage

Supabase Storage, single private bucket `vyron-documents`, 50 MB bucket-level
limit, MIME allow-list (PDF/PNG/JPEG/WEBP). Path is tenant-scoped:

```ts
`${tenantId}/${documentId}/${sanitizeStorageFileName(fileName)}`
```

SHA-256 content hash computed and stored (`content_sha256`, plus `file_hash` at
extraction). Signed URLs used for previews and for diagnostic crops (600 s TTL).

**But the object policies are wide open:**

```sql
create policy "demo read vyron documents storage"
  on storage.objects for select using (bucket_id = 'vyron-documents');
-- identical insert / update / delete policies
```

No owner check, no role restriction, no `(storage.foldername(name))[1]` tenant
check. Membership of the bucket is the entire test. `public = false` only
disables the CDN path — `anon`/`authenticated` retain full CRUD over every
tenant's invoices. A private bucket with these policies is a public bucket with
an extra step.

Diagnostic crops are written to `diagnostics/<documentId>/` — **not**
tenant-scoped, `upsert: true`, and never deleted.

**No upload size cap in the application** (sibling attachment routes have 20 MB).
**No retention policy, no purge job.** Deletion is two-stage (soft then hard) and
**incomplete**: the first delete removes the file but keeps every extracted field
and line item; diagnostic crops are never removed; price history, learned
mappings and learning-history rows survive by `on delete set null`; server logs
retain hashes, base64 prefixes and full provider responses independently. There
is no "delete this supplier's invoice data" path and no POPIA/GDPR erasure story
— and the data includes customer names, VAT numbers and sales-rep names.

---

## 13. Database architecture

Schema lives mostly as **loose hand-run scripts** (`supabase/document-ai-v2-*.sql`)
rather than migrations, across **two separate migration directories**
(`supabase/migrations/` and `src/supabase/migrations/`) with non-overlapping
content — an ordering hazard in itself.

| Table | Purpose | Tenant col | RLS |
| --- | --- | --- | --- |
| `vyron_documents` | document/invoice header, status, extracted fields, hashes | `tenant_id` | `using (true)` |
| `vyron_document_line_items` | extracted lines + matched entity | **none** | `using (true)` |
| `vyron_document_extraction_logs` | stage/status log + evidence `jsonb` | **none** | `using (true)` |
| `vyron_supplier_line_item_mappings` | learned line mappings | `tenant_id` | `using (true)` |
| `vyron_supplier_line_item_mapping_history` | immutable mapping history | `tenant_id` | **RLS never enabled** |
| `vyron_supplier_invoice_learning` | per-supplier profile/patterns | `tenant_id` | `using (true)` |
| `vyron_supplier_price_history` | price movement on approval | `tenant_id` | `using (true)` |
| `vyron_procurement_risk_alerts` | duplicate/price/PO risk | `tenant_id` | `using (true)` |
| `vyron_document_field_corrections` | per-field edit diff | **none** | `using (true)` |
| `vyron_document_approval_audit` | approval snapshot | `tenant_id` | `using (true)` |
| `vyron_document_cost_audit` | per-line cost change | `tenant_id` | `using (true)` |
| `vyron_document_cost_rollback_audit` | reversal | `tenant_id` | `using (true)` |
| `vyron_document_approval_override_audit` | supervisor override | `tenant_id` | `using (true)` |
| `vyron_document_approval_rules` | per-tenant approval policy | `tenant_id` | `using (true)` |

No enums and **no CHECK constraints** on any status/type/severity column — status
drift is already visible (`approved` vs `archived`), leaving a partial index that
can never match.

---

## 14. API / service architecture

```
DocumentHubdocClient / DocumentReviewWorkspace       (client orchestration)
        │
        ▼
/api/documents/*  (~29 routes)                       thin; tenant check only
        │
        ▼
vyron-document-extraction.ts  /  vyron-invoice-extraction-v2.ts
        │         │
        │         ├── vyron-document-page-images.ts   (classify, recover images)
        │         ├── vyron-invoice-table-vision.ts   (locate → crop → read)
        │         └── vyron-image-raster.ts           (pure-JS raster)
        ▼
deterministic validators: assessLineArithmetic · assessExtractionCompleteness
                          reconcileInvoiceTotals · computeQuality · invoice-boundary
        ▼
persistExtractionToDocument                          (vyron_documents + line items)
        ▼
review GET (+ findBestSupplierLineMatch) → corrections → validate → approve
        ▼
cost masters · price history · inventory · risk alerts · audit · Xero queue
```

**Reusable service boundaries** (clean, dependency-light, portable): document
classification, page-image recovery, raster/crop, arithmetic validation, totals
reconciliation, quality classification, duplicate detection, invoice-boundary
detection, supplier resolution. **Not portable**: the route layer, the
persistence layer, the cost-update layer, and the UI.

---

## 15. Security

The application layer was recently hardened and is reasonable. **The database
layer provides no isolation at all.**

🔴 **Critical — must not be carried into Finance**

1. **`USING (true)` RLS on every feature table.** RLS is enabled, so it *looks*
   protected in the dashboard while providing nothing. The anon key is
   `NEXT_PUBLIC_*` — shipped to every browser. Anyone can read and write every
   tenant's invoices, line items, price history and audit trail directly through
   PostgREST, bypassing the API entirely. The authoring comment reads
   `-- RLS (demo-open; tighten for production)`. It never was.
2. **Storage object policies keyed only on `bucket_id`** — full CRUD for
   anon/authenticated over every tenant's documents.
3. **Cross-tenant cost write via unvalidated `matched_entity_id`** — accepted
   from the request body and acted on with `.eq("id", …)` and no `company_id`
   filter.
4. **Hardcoded shared supervisor PIN** defaulting to `"vyron-supervisor"`,
   displayed on the settings page, bypassing every approval control.
5. **Forgeable approver identity** — `approvedBy` is taken from the request body
   on an audited financial action.
6. **Audit tables writable and deletable by anyone** (consequence of 1).
7. **`document-intelligence/extract` is unauthenticated** and its metering is
   best-effort — if company context cannot be resolved, the provider call
   proceeds unmetered.
8. **Zero permission checks across ~30 document routes**, while the rest of the
   app uses `requireWorkspacePermission`. Approving an invoice rewrites inventory
   cost and queues a Xero bill.
9. **Cross-tenant company roster returned to every uploader** in a debug payload.
10. **`getSupabaseServer()` silently returns the service-role client** when the
    key is present; every route depends on it, so one missing `.eq("tenant_id")`
    is a full cross-tenant breach.

**PII:** the entire invoice is base64-inlined to OpenAI un-redacted — supplier and
customer legal names, both VAT numbers, account numbers, sales-rep names, every
line and price. `store: false` is **not** set on the production calls. Raw model
transcripts are persisted into a table with **no `tenant_id`** and `using (true)`
RLS; the first 100 bytes of the raw file and full provider error bodies are
written to stdout; page crops of the invoice go to un-tenant-scoped storage.

---

## 16. COST → Finance comparison

| Capability | VYRON COST | VYRON Finance today | Reuse | Adapt | Finance-specific |
| --- | --- | --- | --- | --- | --- |
| Upload | own route, no size cap, no virus scan | Document Platform, versioned, virus-scan hook, retention | — | — | ✅ use Finance's |
| Storage | `vyron-documents`, tenant path, open policies | `documents` bucket, signed URLs, RLS by permission module | — | path convention | ✅ use Finance's |
| Content hash | `content_sha256` + `file_hash` | **absent** | ✅ concept | — | add column |
| Classification (searchable/scanned/image) | `vyron-document-page-images.ts` | `pdf-text-extraction.ts` (pdfjs) exists | ✅ | ✅ | — |
| Page-image recovery / crop | pure-JS raster, no native deps | none | ✅ | ✅ | — |
| OCR | none — delegated to vision model | `OcrProvider` seam, honest no-op | ✅ approach | ✅ | implement provider |
| AI provider | OpenAI direct `fetch` | AI Gateway (`@ai-sdk/gateway`), typed errors, timeout | — | — | ✅ use Finance's |
| Structured output | prompt-and-parse | `response-validation.ts` + hallucination stripping | — | ✅ | ✅ add strict schema |
| Extraction prompts | mature, hard-won | none | ✅✅ | ✅ | — |
| Arithmetic validation | `assessLineArithmetic` | none | ✅✅ | ✅ | — |
| Totals reconciliation | `reconcileInvoiceTotals` (basis inference) | 5J invoice-totals (sales side) | ✅✅ | ✅ | — |
| Quality classification | deterministic, overrides confidence | none | ✅✅ | ✅ | — |
| Batch-scan refusal | `invoice-boundary.ts` | none | ✅✅ | — | — |
| Supplier matching | 5-tier resolver, **orphaned**; DI uses `ilike` | `ae_suppliers` with name, `alternative_names`, VAT, tax no., code, bank details, reg. no. | ✅ algorithm | ✅ | ✅ richer signals |
| Item matching | ingredients/products for recipe costing | bills are **GL-coded expense lines** | — | — | ✅ GL/VAT suggestion instead |
| Pack size / UOM | **none** | none | — | — | ✅ if wanted, new |
| VAT / GL suggestion | **none** | supplier defaults + allocation engine (`suggested` vs `matched`) | — | — | ✅ use Finance's |
| Duplicate detection | 4 layers, **inert** | DB `unique(company_id, supplier_name, invoice_number)` + idempotent import identity | ✅ layers | ✅ | ✅ enforce, don't warn |
| Review UI | rich, confidence-aware | PDF statement review panel precedent | ✅ patterns | ✅ | ✅ Finance-native |
| Approval | shared PIN, `force:true` bulk bypass | `requireApproval(perm, category, amount)` role limits | ❌ | — | ✅ use Finance's |
| Learning | per-supplier line mappings | supplier defaults, banking rules | ✅ concept | ✅ | ✅ simpler |
| Audit | rich but body-supplied actor | session-derived actor, audit log | ✅ fields | ✅ | ✅ use Finance's |
| Permissions | **none** | `Purchasing:Create/Edit/Approve` + RLS | ❌ | — | ✅ use Finance's |
| Tenant isolation | `using (true)` | real RLS policies | ❌❌ | — | ✅ use Finance's |
| Accounting posting | updates cost masters, queues Xero | `ae_imported_bills` → posting engine | ❌ | — | ✅ **conflict, see §18** |
| AI safety | usage fuse only | circuit breaker + fuse + queue + attempts | ❌ | — | ✅ use Finance's |

---

## 17. Proposed Finance workflow

```
Purchasing ▸ Supplier Invoices ▸ Capture
      │  upload (existing Document Platform: virus scan, versioning, retention)
      ▼
documents row  (entity_type = 'Supplier', + NEW content_sha256)
      │  file-hash duplicate check  → WARN, surfaced, never discarded
      ▼
queued as an automation task  (NOT in the request — see §23 Phase C)
      │
      ▼
classify → searchable-PDF text path | scanned/image vision path
      │
      ▼
AI extraction via the existing AI Gateway + safety gate
      │  strict schema + structural validation + hallucination stripping
      ▼
DETERMINISTIC VALIDATION  (never model confidence)
      │  line arithmetic · completeness · totals reconciliation · batch-scan refusal
      ▼
supplier resolution (5-tier: VAT → exact → normalised → fuzzy PROPOSAL → none)
      │  fuzzy NEVER auto-applied
      ▼
duplicate check: file hash · supplier+invoice no. · supplier+total+date window
      │  supplier+invoice no. → BLOCK (already a DB constraint)
      ▼
GL + VAT suggestion from supplier defaults / prior bills   (suggested, not applied)
      ▼
┌──────────── HUMAN REVIEW (mandatory) ────────────┐
│ header + lines editable, per-field confidence,   │
│ quality panel, totals delta, duplicate banner,   │
│ supplier candidates, GL/VAT pickers              │
└──────────────────────────────────────────────────┘
      ▼
createPurchaseBill + updateBillLines        → status Draft
      ▼
submitBill → requireApproval(Purchasing:Approve, category, amount)
      ▼
approveAndPostBill  →  EXISTING posting engine  →  ae_journals → gl_transactions
```

**The AI never posts.** It produces a Draft bill and nothing more. Every
accounting consequence flows through the existing, tested, permission-gated
purchase-bill lifecycle.

---

## 18. Finance accounting integration

The intended principle holds, and Finance is unusually well shaped for it:

`ae_purchase_bill_lines` already carries `description`, `gl_account`, `vat_code`,
`quantity`, `unit_cost`, `discount`, `net_amount`, `vat_amount`, `line_total`,
plus cost centre / project / department. `summarizeBillLines` already requires a
VAT code per line, computes via the shared `computeLineAmounts`, and rolls up to
the header — i.e. **the purchase side already does per-line VAT correctly**, the
thing Phase 5J had to fix on the sales side.

The clean seam already exists: `POST /purchasing/bills` dispatches on `orderId`
or `grnId`. A third branch — `documentId` → `createBillFromDocument` — matches the
established pattern exactly.

Required AI outputs are therefore dictated by the bill validator, not invented:
every line needs a **GL account**, a **VAT code**, and a positive net amount.
Those are precisely the fields a human must confirm.

### ⚠ The conflict, stated plainly

**COST's approval does not create an accounts-payable record.** It updates
costing master data (`purchase_cost`, `true_unit_cost`, `total_cost`), writes
price history and an inventory cost movement, and queues a Xero bill. Its own AP
table, `vyron_cost_supplier_invoices`, is populated only by manual entry and CSV
import — never from a document.

So COST's approval path is a **cost-master mutation**, not a ledger entry. Porting
it into Finance would create exactly the parallel accounting engine the brief
forbids. In Finance, approval must create a Draft `ae_imported_bills` row and
stop there.

Two consequences:
- COST's `approve/route.ts` is **not reusable** — it is the one file whose
  purpose is wrong for Finance.
- The costing/price-history/inventory behaviours are COST product features, not
  accounting ones. They are out of scope for Finance's supplier-invoice capture.

---

## 19. AI safety integration

Finance's existing layer is stronger than COST's and must be the one used:

| Control | Finance | COST |
| --- | --- | --- |
| Provider circuit breaker | `ai_provider_circuit_state`, keyed by **`scope`** | none |
| Daily fuse | `ai_provider_daily_usage`, DB-enforced cap | monthly allowance |
| Queue state | `ai_classification_queue_state` | none |
| Attempt tracking | `ai_classification_attempts` with typed outcomes | run logs |
| Error taxonomy | `AIProviderError` — auth/timeout/rate-limit/etc. | partial (401/403 unclassified) |
| Request timeout | yes | **none** |
| Retry-After | bounded honour | none |
| Response validation | structural + hallucination stripping | fence-strip parse |

Integration is mostly **configuration, not construction**:

- `ai_provider_circuit_state.scope` is a text primary key seeded with
  `'transaction-classification'`. Adding `'supplier-invoice-extraction'` is a
  **one-row insert — no schema change.**
- `safety-policy.ts`'s `AttemptSource` (`sweep | import | manual`) and the
  matching DB CHECK need a new value (e.g. `document`) — a small migration.
- `automation_tasks.task_type` CHECK needs a new value for a background
  extraction task.

🔴 **Capacity finding that must be decided before 5L.**
`AI_PROVIDER_DAILY_REQUEST_CAP = 100` is **per company, provider-wide, shared
across all scopes**. A worst-case scanned invoice costs 3–6 provider calls. So
roughly **16–33 invoices a day would exhaust the entire AI budget — including
transaction classification.** Either the fuse becomes per-scope, or the cap rises,
or invoice capture gets its own budget. This is a design decision, not an
implementation detail.

Also relevant: the AI Gateway circuit is currently **OPEN** following HTTP 402
(no credit), and automation task #6 is PAUSED. 5L cannot be validated end-to-end
against a live provider until that is resolved — and doing so is explicitly out
of scope here.

---

## 20. Pricing

**NO PRICING CHANGE.**

No Hubdoc fee, no AI usage billing, no document charges, no new subscription
products, no plan changes.

The feature fits inside the existing `document_platform` feature key (migration
0045, granted to Starter and above) — a database row, not a code change, and not
a commercial change. COST gates its equivalent at `professional` and meters AI
credits per tier; **neither is being carried over.**

---

## 21. Third-party dependencies

**Hubdoc is not integrated.** No dependency in `package.json`, no API URL, no
credentials. It appears three times: the component name `DocumentHubdocClient`,
its imports, and one line of UI copy — *"Your Hubdoc-style document inbox for
invoices, POs and supplier documents."* That copy names a competitor product in
the interface and **must not be carried over.**

**No third-party OCR service of any kind** — no Textract, Document AI, Form
Recognizer, Mindee, Veryfi, Klippa, Tesseract. OCR is delegated entirely to the
vision model.

Complete third-party surface: **OpenAI** (extraction), **Supabase** (storage +
Postgres), **pdfjs-dist** (text-layer counting, JPEG decode), **node:zlib** (PNG
encode). `sharp` was deliberately removed from the runtime path after failing on
Vercel.

Terminology for Finance: **VYRON AI Supplier Invoice Capture**. Hubdoc is the
reference workflow, not the technology.

---

## 22. Reusable COST components

| File | Purpose | Dependencies | Reuse risk | Finance adaptation |
| --- | --- | --- | --- | --- |
| `vyron-invoice-table-vision.ts` prompts | column-identity-first table read | none (text) | **Low** | port prompt text; re-tune per corpus |
| `vyron-invoice-extraction-v2.ts` `EXTRACTION_PROMPT` | "copy, never calculate" | none | **Low** | port near-verbatim |
| `vyron-document-extraction.ts::assessLineArithmetic` | constant-column, row coherence, line-vs-header VAT | pure | **Low** | port; keep thresholds, re-validate |
| `vyron-invoice-reconciliation.ts` | inclusive/exclusive basis inference | pure | **Low** | port; align tolerances with 5J `round2` |
| `vyron-extraction-quality.ts` | deterministic quality/classification | pure | **Low** | port; drop legacy 75 threshold |
| `document-intelligence-v2/invoice-boundary.ts` | batch-scan refusal | pure | **Low** | port |
| `vyron-duplicate-invoice-detection.ts` | 4-layer duplicate logic | supabase reads | **Medium** | port logic; **make `action` binding**; key on `supplier_id` |
| `vyron-supplier-resolution.ts` | 5-tier matcher, fuzzy = proposal | supabase reads | **Medium** | port algorithm; extend with bank/reg-no/alias |
| `vyron-document-page-images.ts` | classify + recover embedded images | pdfjs | **Medium** | port; Finance already has pdfjs |
| `vyron-image-raster.ts` | pure-JS crop/upscale/PNG | node:zlib | **Medium** | port as-is; avoids native deps |
| `document-intelligence-v2/types.ts` schema | strict JSON schema | none | **Medium** | port shape; **numbers as numbers**, no `"Needs Review"` sentinel |
| `vyron-supplier-line-learning.ts` | learned mappings | supabase | **High** | concept only — Finance learns GL/VAT, not items |
| `ExtractionQualityPanel.tsx` | operator-honest quality UI | React | **Low** | port wording/shape into Finance design system |
| `approve/route.ts` | approval + cost writes | everything | **Do not reuse** | wrong target (§18) |
| `DocumentHubdocClient.tsx` | inbox + bulk actions | React | **Do not reuse** | contains the `force:true` bypass and the Hubdoc copy |

---

## 23. Implementation plan (proposed, not authorised)

**Phase A — document foundation.** Add `content_sha256` to `documents`; upload
size cap; a `SupplierInvoiceDocument` category; file-hash duplicate warning
surfaced (never discarded). *Exit: a supplier invoice can be attached and an
identical re-upload is visible.*

**Phase B — schema.** `supplier_invoice_extractions` + `..._lines`, tenant-scoped,
real RLS from the first migration, CHECK constraints on status, FK to `documents`.
*Exit: extraction can be stored and read back under RLS.*

**Phase C — extraction, as a background task.** New `automation_tasks.task_type`;
new circuit scope; classification, vision path, strict schema, structural
validation. **Not in the request path** — this removes COST's 120 s cliff and uses
Finance's existing 300 s task runner. *Exit: a document yields a stored extraction
with no provider call in a user request.*

**Phase D — deterministic validation.** Arithmetic, completeness, reconciliation,
quality classification, batch-scan refusal. *Exit: a fabricated column is rejected
before a human sees it.*

**Phase E — supplier resolution.** 5-tier ladder over `ae_suppliers` extended with
`alternative_names`, `registration_number` and bank details. Fuzzy = proposal.
*Exit: a supplier is proposed with candidates, never silently chosen.*

**Phase F — duplicate enforcement.** Layers wired to real outcomes; the existing
`unique(company_id, supplier_name, invoice_number)` becomes a handled block, not a
500. *Exit: a duplicate cannot be approved.*

**Phase G — review UI.** Finance-native, following the PDF-statement review
precedent. Per-field confidence, quality panel, totals delta, duplicate banner,
GL/VAT pickers. *Exit: every extracted value is visible and editable before it
means anything.*

**Phase H — bill integration.** `createBillFromDocument` as a third dispatch
branch; Draft only; `requireApproval` for posting. *Exit: an approved capture is
an ordinary Draft bill.*

**Phase I — suggestion learning.** GL/VAT suggestions from supplier defaults and
prior bills. Suggested, never applied. *Exit: the second invoice from a supplier
needs less typing than the first.*

**Phase J — safety, corpus and certification.** Labelled corpus with
human-verified ground truth, regression runner, accuracy measurement. *Exit: an
accuracy number exists.*

COST's own certification is explicit that this last step was never completed:
*"Live certification has never been run, because it requires real documents and
billable calls."* Finance should not repeat that.

---

## 24. Testing strategy

**Document profiles:** searchable PDF · scanned PDF (200/300 DPI) · JPG · PNG ·
multi-page · poor-quality/skewed scan · rotated · password-protected ·
non-invoice (statement, delivery note, PO) · **batch scan of several invoices**
(must refuse) · empty/corrupt file · oversized file.

**Extraction correctness:** ground truth from a human read, accepted only once it
reconciles to the invoice's own printed totals — *"an answer key produced by the
extractor would certify its own mistakes."* Assert per-cell accuracy, not just row
counts. Include COST's exact failure case: a numeric non-money column (weight,
pack size, discount %) adjacent to money columns, asserting it never lands in
`unitPrice`/`vatAmount`/`lineTotal`.

**Accounting:** mixed VAT rates per line · zero-rated/exempt · discounts · VAT
missing · VAT-inclusive vs exclusive line totals · rounding at ±0.01 · line sum ≠
header (must surface, never silently adjust) · foreign currency.

**Matching:** exact/normalised/fuzzy supplier · two suppliers with near-identical
names (must propose, never auto-pick) · no supplier · supplier with same name in
another tenant (must not match).

**Duplicates:** identical file re-uploaded · same supplier + invoice number ·
same total, different number · same number across periods · near-duplicate within
the date window. Assert **blocked** where the layer says block.

**AI failure modes:** timeout · 429 with and without `Retry-After` · 402 quota ·
401/403 · 5xx · malformed JSON · truncated JSON mid-array · empty response ·
valid JSON with fabricated values at high confidence (**must be caught by
arithmetic validation, not confidence**) · provider returns fewer rows than
declared.

**Safety:** circuit opens on auth failure · daily fuse exhaustion · fuse shared
with classification · no provider call in a user request path · attempts recorded
with typed outcomes.

**Security:** cross-tenant document read/extract/approve · RLS enforced with the
anon key directly against PostgREST · storage path traversal · unauthenticated
access · `Purchasing:*` permission enforcement · approval limit enforcement ·
actor identity from session, never request body.

**The decisive test:** *no accounting record is created without human approval.*
Assert that no path — including any bulk action — can produce a posted journal
from an extraction. COST's `force: true` bulk approve is the specific mistake this
test exists to prevent.

---

## 25. Risks / unknowns

1. **Extraction accuracy is unmeasured.** COST has no labelled corpus and says so.
   Finance inherits that unknown. Blocks any confidence threshold.
2. **Shared AI daily fuse** (§19) — 16–33 invoices/day would exhaust the whole
   company AI budget. Needs a decision.
3. **AI Gateway circuit is OPEN** (HTTP 402, no credit). No live validation is
   possible until resolved.
4. **Vision cost and latency.** COST measured ~45,800 tokens and 98–120 s for a
   worst-case scanned invoice. Background execution mitigates latency, not cost.
5. **Model availability.** Finance's gateway defaults to `openai/gpt-4o-mini`;
   COST uses `gpt-4o` for vision. Accuracy at mini is unmeasured.
6. **PII to the provider.** Whole invoices, un-redacted, including customer names
   and VAT numbers. Finance needs an explicit, documented position (and should set
   `store: false`).
7. **Pack-size/UOM intelligence does not exist** in either product. If wanted, it
   is new work — and COST's `true_unit_cost` bug shows the cost of faking it.
8. **Scanned-PDF recovery is stream-carving**, not rasterising. A vector PDF with
   no text layer yields no image and no vision path.
9. **Finance bill lines have no UOM or item link** — GL-coded expense lines only.
   Any inventory-linked capture is a separate, larger design.

---

## 26. Exact recommendation

**Reuse COST's thinking, not COST's code.** Specifically: port the prompts, the
deterministic validators, the reconciliation, the quality classification, the
batch-scan refusal, the duplicate layers and the supplier-matching algorithm.
Take nothing from its routes, persistence, approval path, permissions, RLS or UI.

Three COST ideas are worth more than the rest of the feature combined:

1. **The model copies; it never calculates.**
2. **Retries fire on deterministic validation failure only — never on model
   confidence.** COST measured `confidenceScore: 95` on every fabricated row.
3. **Extraction is compared against independent arithmetic, never trusted.**

And three COST behaviours must never appear in Finance: `USING (true)` RLS, a
shared supervisor PIN, and a bulk action that hard-codes `force: true` past every
safety rule.

### READY FOR PHASE 5L IMPLEMENTATION

With two decisions required first, neither of which is an implementation detail:

1. **AI daily-fuse capacity** — per-scope budget, raised cap, or accepted
   contention (§19).
2. **PII position** — that whole supplier invoices, including customer names and
   VAT numbers, are sent to an external AI provider (§15, §25.6).

A third item is a prerequisite for *validating* 5L, not for starting it: the AI
Gateway circuit is OPEN on HTTP 402 and must be funded before live testing.

---

## Production safety

0 production changes · 0 production writes · 0 migrations applied · 0 tasks
resumed · 0 Rule Engine executions · 0 BankSync executions · 0 Import executions
· 0 AI executions. No external AI provider was called. The VYRON COST source was
read only and not modified. Nothing committed, pushed or deployed.
