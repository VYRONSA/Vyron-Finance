# Supplier Document Intelligence — SD-1: Invoice Capture Review Workflow

**Status:** reviewed and approved by the owner (2026-10-07). Committed on branch
`security/sd0-supplier-capture-hardening`, on top of the SD-0 commit `434495e`.
- Not pushed or deployed. Nothing has been applied to production.
- The supplier credit-note balance/ageing/allocation issue below is **explicitly out of scope** for
  this project (owner decision); it will be handled as a separate accounting project.
- Live AI is still off: provider selection, the gateway adapter, the scheduler and `vercel.json`
  are unchanged.
- Production is at 0109. It must move **0109 → 0110 → 0111 → 0112**, in that order, and only on
  explicit instruction.

SD-1 completes and hardens the existing invoice-capture foundation.
- Accounting posting behaviour, supplier balances and bill approval are unchanged.
- Conversion still produces only a **Draft** purchase document through `createPurchaseBill`.
- Only the existing Submit → Approve → Post workflow posts it.

## A. Retention of captured supplier documents

**Found:**
- Deleting a captured invoice's document cascaded the capture and its whole audit history away.
- `document-repository.deleteDocument` removed the **stored file before the database row**, so
  even a refused row deletion lost the original.
- The storage delete policy checked company membership only. Any member could delete the file
  directly through the storage API.
- The `documents` UPDATE policy has no `WITH CHECK`, so a captured document's path or hash could
  be rewritten.

**Changed (0112 and app):**
- Captures reference their document with `ON DELETE NO ACTION` instead of `CASCADE`.
- A trigger on `documents` refuses, for **every role** including the service role and the owner:
  - deleting a document that a capture references;
  - changing its content columns: path, hash, filename, type, size, company, owning entity and
    uploader.

  Two operations are still allowed:
  - Versioning (`is_current`) still works.
  - A whole-company deletion (foreign-key cascade) still works.
- The storage delete policy additionally requires that the object is not capture evidence, via
  `fn_storage_object_is_capture_evidence`. That function answers only within the caller's own
  companies.
- The app deletes the **row first and the file only afterwards**. It keeps the file if no row was
  deleted.
- `deleteDocument` refuses evidence up front with `RetainedDocumentError` (HTTP 409).
  `purgeRetentionDue` skips evidence.

## B. Approval amount

**Found:** the convert route checked the approval limit against the **extracted header total**.
- A reviewer could not correct it.
- When it was missing it became `0` and passed every limit.

**Changed:**
- `prepareConversion` runs every conversion check first.
- The amount is the total the **purchase-bill engine itself computes** from the reviewed lines,
  via `previewPurchaseBillTotals`, which reuses `summarizeBillLines` with no writes.
- That amount is raised to the reviewed printed total when the printed total is larger
  (`conversionApprovalAmount`).
- If no total can be computed, conversion is refused. It never falls back to 0.
- The route checks the limit against that amount and passes it to `convertCaptureToBill`. That
  function refuses if the document now converts to *more* (it was edited in between).
- If a Draft is created but cannot be linked, it is cancelled through the ordinary bill workflow
  (Draft → Cancelled, no journal exists), rather than left orphaned.

## C. Corrections and re-validation

- Reviewers with `Purchasing:Edit` can correct the following while the capture is `NeedsReview`
  or `ManualEntry`:
  - header: supplier, number, dates, order reference, **document type, currency, subtotal,
    discount, VAT, total**;
  - lines: description, SKU, quantity, UOM, unit price, discount, VAT rate, VAT amount, line total
    and the GL/VAT confirmations. Reviewers can also **add and remove lines**.
- **Every reviewer change resets validation to `Pending`.** This is enforced by the capture guard
  and by a line trigger.
- **Conversion requires a `Pass` or `Review` verdict**, enforced by both the database guard and
  `assessConversion`.
- After each correction the service re-runs duplicate detection and **re-validates the reviewed
  values** (`revalidateCapture`, `review-validation.ts`), using the same deterministic
  `validateExtraction`.
  - The verdict is written only if the capture has not changed since it was read (compare-and-set
    on `updated_at`), so a verdict always describes the values it judged.
  - A `revalidate` action re-runs it on demand.
- What was extracted is preserved in **`extraction_snapshot`** (header, lines, invoice numbers
  seen, declared line count). It is written once by the server and is immutable to reviewers.
  Corrections live in the capture's columns, and every correction is a `FieldCorrected` event with
  the actor taken from the session.
- Facts about the *page* come from the snapshot and can't be changed by correcting:
  - the invoice numbers it prints (a multi-invoice file stays refused);
  - its declared line count. Excluding a line is not mistaken for a truncated read.

## D. Manual entry

- New state `ManualEntry`. `Queued` or `Failed` → `ManualEntry` requires `Purchasing:Edit`, and
  `manual_entry` is set.
- The reviewer enters the header and lines from the original document, which stays attached.
- `ManualEntry` → `NeedsReview` ("submit for review") runs duplicate detection and validation like
  any extraction.
- A manual entry cannot be converted until it is submitted and validated, and it cannot write
  "extracted" values.
- New events: `ManualEntryStarted` and `SubmittedForReview`, each requiring the matching permission
  and state, with the actor taken from the session.
- Routes: `manual-entry`, `submit-for-review`, `revalidate`, and `correct-lines` with `add` and
  `remove`. All require `Purchasing:Edit`. A database guard refusal returns 403.

## E. Duplicate handling

**Found:**
- The upload-time file check (`.limit(1).maybeSingle()`, no ordering) could return the **uploaded
  document itself** and miss the real earlier copy.
- It also blocked every re-upload of a rejected capture's file.
- Duplicate candidates were read **under the user's session**, so a narrower role could miss the
  record that should block it, and only the first 500 unordered rows were compared.

**Changed:**
- `assessFileHashMatches` considers every *other* document with the same bytes, in a fixed order:

  | The same file is... | Result |
  |---|---|
  | A capture in the workflow, a failed capture, or a converted capture | **Blocked** |
  | Stored with no capture (for example attached to a hand-entered bill) | **Blocked** |
  | Only on rejected captures | Allowed, but flagged **Possible** ("same file as rejected capture #N") |

- A `Failed` capture now counts as live, because it can be entered by hand. This tightens
  protection.
- Candidates are read with the service role, targeted (same supplier, same file) and paged.
- The database backstop `unique(company_id, supplier_name, invoice_number)` is unchanged.

## F. Credit notes

**Verified before enabling** (new `purchase-bill-credit-note.test.ts`), with no change to the
existing path:
- A credit note is stored with positive amounts and `document_type = 'Credit Note'`.
- It is approved only after Submit, through the same approval limits.
- Approval resolves the seeded **"Supplier Credit Note"** rule: DR Creditors 2000 (gross),
  CR expense (net), CR VAT Input 2100 (vat). This is the exact mirror of the same document approved
  as a Bill, and never "Inventory Bill".
- The VAT return signs it as a reversal (existing `vat-201-engine` test).

**Changed:**
- An Invoice (or unstated type) converts to a Draft **"Bill"**. A **Credit Note converts to a Draft
  "Credit Note"**, with amounts carried as magnitudes. Debit notes and "Other" are still refused.
- The database guard links a capture only to the Draft created for it: same company, supplier,
  number and document type, `origin = 'Purchasing'`, `posting_status = 'Draft'`. A credit-note
  capture can never be linked to a Bill.
- Validation of credit notes:

  | Situation | Result |
  |---|---|
  | `not-an-invoice` on a credit note | Review: a person confirms the type |
  | `multiple-invoices` where the page shows exactly its own number plus the one invoice it credits (certification case `credit-note`, Run #47) | Review |
  | Any other `multiple-invoices` case | Blocking |
  | Negative amounts | No finding |
  | Lines with mixed signs | New blocking finding, `credit-note-mixed-signs` |

  Finding **codes** are unchanged, so the countersigned certification corpus and
  `expectations-v2.json` are untouched (byte-verified).

**Pre-existing and NOT changed (needs an owner decision):** the supplier sub-ledger views treat a
credit note's positive `outstanding` like a bill's.
- `buildSupplierFinancialSummary.outstandingBalance` adds it as owed.
- Per-supplier ageing (`computeAgingBuckets`) buckets it as owed.
- `allocatePayment` would allocate a payment *to* a credit note, and there is no way to set a
  credit note off against a bill.

This already applies to every credit note entered by hand. GL and VAT are correct. Fixing it
changes supplier-balance behaviour, which is excluded from this project.

## Not in SD-1 (by design)

- **UI.** SD-1 is the foundation; the screens are SD-2 (Supplier Documents pages, document viewer,
  review screen).
  - The existing Purchasing tab only gained a label and badge for `ManualEntry`.
  - Its "View original" still shows raw JSON (SD-2).
- **Supplier statements.** These are SD-3+. Your requirement is recorded: **PDF-first** (images
  supported, CSV/XLSX secondary), extracted and mathematically validated before reconciliation,
  original always retained and viewable.
- **Live AI** remains off.

## Verification

All on a fresh `supabase/postgres:17.6.1.155` sandbox, built 0001 → 0112 as `postgres` with one
transaction per migration.

| Check | Result |
|---|---|
| New `supabase/tests/supplier_capture_review_workflow.test.sql` | **50 / 50** |
| `supplier_capture_security_hardening.test.sql` (SD-0, updated where 0112 deliberately changed rules) | **174 / 174** |
| The 8 other SQL suites | 510 / 510 (identical to baseline) |
| **All SQL** | **734 / 734** |
| 0112 rollback → re-apply → re-apply | restores 0111 shape; idempotent; suites pass after |
| New unit tests: `sd1-review-workflow` (27), `supplier-invoice-capture-service.sd1` (19), `purchase-bill-credit-note` (7), `document-retention.sd1` (4), route security (+6) | pass |
| Full application suite | **5,573 passed, 0 failed**, 50 skipped (pre-existing) |
| Typecheck | clean |
| Lint | 0 errors (3 pre-existing warnings in untouched files) |
| `next build` | exit 0 |
