# Sales posting integrity and credit-note allocation (migration 0121)

Released to production 2026-10-21. Code: `ae3aa60` (branch `fix/credit-note-posting-allocation`, parent `b48e92e`).

## What changed

1. **Credit-note signs.** PRECISIA stores every sales and purchase document — credit notes included — as positive figures; the document type sets the direction (posting rule, VAT201, statements, approval limit). The Xero importer stored Xero's negative credit-note figures verbatim, so they were negated twice and posted backwards.
   - `xero-import-service.ts::normaliseCreditNoteSign` stores sales and bill credit notes as positive figures.
   - `sales-invoice-service.ts::salesJournalAmounts` refuses to approve a sales document stored with negative figures.
   - 0121 `sales_invoices_sign_guard`: no new or changed sales document with a negative total, net or VAT.
2. **Duplicate posting.** Two overlapping approvals of one invoice could both create, link and post a journal.
   - 0121 `ae_journals_sales_invoice_single_live`: one live journal per sales document, serialised by an advisory lock (reversed / rejected / cancelled journals do not count).
   - 0121 `sales_invoices_journal_link_guard`: a document cannot be re-linked away from a live journal.
   - `approveInvoice` is a conditional write; an interrupted approval's matching journal is completed rather than duplicated; a journal created for a document changed mid-approval is withdrawn; a lost race answers 409.
3. **Credit-note allocation.** `fn_allocate_sales_credit_note` applies a Posted credit note to a Posted invoice / debit note of the same company and customer in one transaction (row locks, no over-allocation, audit entry `SalesCreditNoteAllocated`, idempotent request key, Sales:Edit + Sales:Approve). No journal. UI: "Apply credit" on a posted credit note; API: PATCH action `allocate-credit-note`.

There is no undo for an allocation in the application; a wrong allocation is corrected by an approved repair from its audit entry, and the 0121 rollback refuses to run while allocations exist.

## Release record (2026-10-21, UTC)

| Step | Result |
|---|---|
| 10:13:21 migration 0121 | applied; history 0121; 3 triggers, 6 functions, allocation table; `anon` has no execute grant |
| 10:14 deployment | `dpl_9LEeyoFuUpq8vCTwdoUoJpm7hwMP`, aliased www.precisia.co.za; 2,189 / 2,191 deployed files byte-identical to `ae3aa60` (the two `.gitignore` files are never uploaded); rollback target `dpl_77qH5Am7xEXFPqAFVrshVrwTkCVH` (`b48e92e`) |
| 10:17:40 correction `METANOIA-CORR-2026-10` | one company; 21 journals in one posting batch (11 mirror reversals + 10 correct credit-note journals), 13 audit entries; independent verification 33/33 — see `supabase/repairs/metanoia-corr-2026-10/README.md` |

Release scripts as executed: `supabase/releases/0121/` (precheck, dry run, apply, postcheck, freeze verification, rollback with history). Rollback: application first, then `rollback-0121-with-history.sql` (refuses while any allocation exists).

## Tests at release

Unit 6,364 passed / 50 skipped / 37 failed (the same 37 fail on `b48e92e`: supplier-invoice certification and PDF rendering, environment-related); TypeScript 0; lint 0 errors; production build passed; SQL `supabase/tests/sales_posting_integrity.test.sql` 56/56; concurrency `sales_posting_integrity.concurrency.sh` 4/4; correction kit 43/43 on a disposable replica.

## Open after release

- Allocations for the corrected company are pending a signed-in user with Sales:Edit and Sales:Approve.
- Supplier-bill approval has no negative-amount guard (importer fixed; existing negative bills corrected).
- `postApprovedJournals` still posts every Approved journal of a company (pre-existing behaviour).
- Statements work on other branches that rebuilds as-at positions must add credit-note allocations dated after the as-at date.
