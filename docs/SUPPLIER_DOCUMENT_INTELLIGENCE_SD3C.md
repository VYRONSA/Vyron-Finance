# Supplier Document Intelligence — SD-3C: supplier statements (PDF-first)

**Status:**
- Implemented on `security/sd0-supplier-capture-hardening`, on top of `e977d8b` (SD-3B).
- **Not pushed, not deployed, and not applied to production**, which remains at 0109.
- Production order when instructed: 0109 → 0110 → 0111 → 0112 → 0113 → **0114**.

**Scope.** Receiving, reading, validating and reviewing supplier statements, up to **Ready for
reconciliation**:
- **No** reconciliation engine (SD-3D).
- **No** statement AI boundary (SD-3F).
- **No** UI pages (SD-3E). This slice delivers the database, services and API.
- **No** accounting change.

## Owner decisions applied (SD-3A §16)

| Decision | How it is applied |
|---|---|
| **PDF is primary** | PDF is the primary path; the reader was designed around positioned PDF text. JPEG/PNG are for scans. CSV/XLSX are secondary and go through the **same** reader (laid out as a grid). There is no CSV-first design. |
| **Scanned statements** | Go to **manual entry** in SD-3C: there is no OCR and live AI is off. The model is provider-agnostic (`StatementExtraction`), so OCR or vision can produce it later without redesign. |
| **Scanned invoices are NOT manual-only** | Unchanged and documented in `extraction-provider.ts` (SD-3B). |
| **Asynchronous extraction** | The upload stores the original, creates a **Queued** statement and returns (≈0.9 s on the local stack, regardless of size). The file is read **after** the response by Next.js `after()`. A statement left Queued, or stuck in Processing for more than 10 minutes, can be requeued. |
| **Never guess** | An ambiguous or unreadable amount or date is left **unresolved**, with its raw text kept and the field listed in `unresolved_fields`. The statement is **Incomplete** until a reviewer corrects it, and the database refuses Ready while any unread value remains. |
| **Arithmetic validation** | In integer cents: V1–V8 and V10. V9 (AI row count) arrives with SD-3F. Nothing is ever corrected automatically, and the debit/credit convention is only *proposed*. |
| **Supplier confirmation mandatory** | Matching only **proposes**. This covers VAT, registration, supplier code, **our account number**, name and learned matches. The database refuses Ready without an explicit confirmation, which is stamped with the session user. Changing the supplier clears the confirmation. A supplier is never created. |
| **`ae_suppliers.our_account_number`** | Nullable and matched verbatim (leading zeros kept). Saving it from a statement is an explicit, **audited supplier edit** (`permission_audit_log`). |
| **Foreign currency** | Flagged *Unsupported currency — manual review required*. The database refuses Ready. No exchange rates are used, nothing is converted, and no adjustments are made. |
| **Originals** | Retained as evidence (cannot be deleted or altered, including through Storage). They are viewed only through the **SD-3B audited viewer**, with every view and download recorded and the viewer failing closed. The generic download route refuses them. |
| **Explicit grants** | Every new object explicitly revokes and grants per role. This is verified on a real Supabase stack with legacy auto-grants **on**: the grants stay exactly as declared. |

## Migration 0114 — `0114_supplier_statements.sql` (+ rollback)

| Object | Purpose |
|---|---|
| `ae_suppliers.our_account_number` | Nullable; 1–60 characters. |
| `supplier_statements` | One per original. Fields: source type, method, status and status reason; supplier **proposal** plus **confirmation**; extracted identifiers; header values; sign convention; validation status and findings; immutable `extraction_snapshot`; warnings. |
| `supplier_statement_lines` | `reference_text` **exactly as printed**; debit and credit; `amount` **generated** (debit − credit); running balance; `raw_text`; `unresolved_fields`; page and row provenance; excluded rows with their reason. |
| `supplier_statement_events` | Immutable audit (no update, delete or truncate, even for the owner). |
| `fn_supplier_statement_record_event` | User writer: the actor comes from the session, with per-event permission and state checks. |
| `fn_supplier_statement_record_system_event` | System writer: service role only. |
| `fn_supplier_statement_guard`, `fn_supplier_statement_line_guard` | For signed-in users: frozen identity and provenance; system-only columns; status transitions with permissions; same-company supplier, document and statement; corrections reset validation; confirmation stamping. |
| `fn_supplier_statement_mark_unvalidated` | Line edits reset the statement's validation. |
| `fn_supplier_statement_currency_supported` | Base currency only; an unknown base currency means not supported. |
| Retention and audit | `fn_document_is_statement_original`; the 0113 audited-original predicates extended to statements; the documents retention trigger and Storage delete policy cover statements; the access-audit writer accepts statements (FK added). |

**Status flow.** Owner-run processing statuses are set by the server; user transitions are enforced by the
database:
- `Queued → Processing → NeedsReview | ManualEntry | Failed`;
- a `Duplicate` is never processed;
- `Queued` or `Failed` → `ManualEntry` (Edit);
- `ManualEntry → NeedsReview` (submit, Edit);
- `NeedsReview → Ready` (Edit; requires validation Pass/Review, a confirmed supplier, base currency and nothing unread);
- `Ready → NeedsReview` (reopen);
- any → `Rejected` (Reject, reason recorded; terminal).

**Grants.**

| Object | anon | authenticated | service_role |
|---|---|---|---|
| `supplier_statements` | none | select, insert, update (no delete) | select, insert, update (no delete) |
| `supplier_statement_lines` | none | select, insert, update, delete | select, insert, update, delete |
| `supplier_statement_events` | none | select | select (writes via functions only) |
| User writer, `mark_unvalidated` | no | execute | no |
| System writer | no | no | execute |
| Guards, immutability trigger | no | no | no |

TRUNCATE is granted to nobody.

## Application

| File | Role |
|---|---|
| `src/server/supplier-statements/amounts.ts` | SA amounts (`1 234,56`, `(500.00)`, `500.00 CR/DR`, `500.00-`, `R`) and day-first dates. Ambiguous values return **unresolved**; the decimal style is inferred per statement. |
| `…/layout.ts` | Rebuilds rows and columns from positioned PDF text. Handles: heading vocabulary; repeated or inherited headings; wrapped descriptions; brought/carried forward; page totals and sub-totals; closing balance; ageing; header labels; letterhead name (proposal). The type comes from printed codes or words, **never from the sign**. |
| `…/tabular.ts` | CSV (delimiter detected) and XLSX grids, read by the same layout reader. |
| `…/read-statement.ts` | Routes to the right reader: text PDF → layout; scanned or image → manual entry; encrypted, corrupt or over 60 pages → failed with a reason; CSV/XLSX → tabular. |
| `…/validation.ts` | V1–V8, V10; currency; possible duplicate statement. |
| `…/supplier-match.ts` | Capture resolution plus our account number; conflicts are ambiguous. |
| `…/file-type.ts` | The file kind from its **bytes**. |
| `src/server/import-centre/pdf-text-extraction.ts` | Adds `extractPdfLayout`. `extractPdfText` (used by the FNB parsers) is untouched. |
| `src/server/services/supplier-statement-service.ts` | Upload registration (file-hash duplicate, rejected-copy rule); asynchronous `processStatement`; `revalidateStatement` (written only if unchanged); reviewer actions. |
| `src/server/repositories/supplier-statement-repository.ts` | User (RLS) and system (service-role) access, kept apart. |
| `supplier-management-service.setSupplierOurAccountNumber` | Audited supplier edit. |
| API: `purchasing/supplier-statements` | `GET` list, `POST` upload. |
| API: `…/[statementId]` | `GET` detail; `PATCH` actions, each with its own permission checked before any lookup. |
| API: `…/[statementId]/original` | The shared audited viewer. |
| Document deletion | Also refuses statement originals with a clear 409. |

Invoice-capture behaviour, accounting, supplier balances and ageing are **unchanged**.

## Certification corpus

`statement-corpus/` (see its README): 15 documents with **hand-typed answer keys**, hash-pinned. The
corpus test runs the production read path:
- 50/50 checks pass;
- a mutation check proves it catches a wrong reference.

## Tests and results

| Check | Result |
|---|---|
| `supabase/tests/supplier_statements.test.sql` | **102/102**: grants, upload rules, system-only columns, transitions, supplier confirmation, lines and unread values, events, RLS, retention, statement access audit, account number, accounting untouched |
| All SQL suites (sandbox at 0114) | **893/893**, 12 suites (0113 T2 updated: statements are now accepted only for the statement's own original) |
| 0114 rollback, then re-apply | Clean |
| Statement unit and corpus tests | 158 (parsers 76, validation, supplier match, file type, CSV, corpus 50) |
| Service tests | 17 (boundaries: imports no accounting or AI module; touches only its own tables) |
| Route tests | 24 |
| **Full app test suite** (clean run) | **5,842 passed, 0 failed, 0 timeouts, 50 skipped** (the same 50 as before) |
| Typecheck | 0 errors |
| Lint | 0 errors (3 pre-existing warnings in unrelated files) |
| `next build` | Exit 0 |
| **End to end on the local Supabase stack** (production build, real Storage and API) | **37/37**. Covers: upload returns Queued; processing after the response; references exact; supplier proposed but not confirmed; Ready refused until confirmation; view-only refused; confirmation stamped with the session user; account number saved and audited; Ready; audited original view; generic download 409; delete 409; direct Storage refused; forged system fields refused; scanned → manual entry → typed → validated; encrypted → failed → manual entry; duplicate never processed; PNG → manual entry; CSV read; HTML refused; cross-company refused; **accounting fingerprint unchanged**. |

## Notes for review

1. **Processing runs in `after()`**, on the request's own function after the response. If the platform
   stops that function early, the statement stays **Queued** (or **Processing**), and the `requeue`
   action resumes it (after 10 minutes for Processing). A scheduler sweep could be added later. It was
   not added here, because SD-3C has no automation-task change in scope.
2. **No UI yet** (SD-3E). Every reviewer action is available through the API and enforced by the database.
3. **Layout reader limits.**
   - It needs a recognisable column heading row on the first page of the table.
   - A statement whose table cannot be found extracts nothing and says so, and is then entered by hand.
   - Real-world supplier PDFs beyond the synthetic corpus should be added to the corpus as they arrive.
4. **Local Supabase CLI note.** A restarted local stack does not apply new migrations; 0114 was applied by
   psql, the same way production will receive it.
