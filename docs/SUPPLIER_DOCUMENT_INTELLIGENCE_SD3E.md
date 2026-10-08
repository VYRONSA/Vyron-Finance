# Supplier Document Intelligence — SD-3E: Supplier Statements user interface

**Status:**
- Implemented on `security/sd0-supplier-capture-hardening`, on top of `68d9623` (SD-3D).
- **No migration. Not pushed, not deployed.** Production remains at 0109.

**Scope.** The complete Supplier Statements interface on top of the SD-3C and SD-3D APIs. The end-to-end
flow is:

**Upload → process → review / correct → confirm supplier → mark ready → reconcile → review differences →
explain / link / withdraw → reconcile again.**

**Out of scope:** statement AI (SD-3F), email intake, and the Xero source marker.

## Screens

| Route | What it does |
|---|---|
| **Supplier Documents → Statements** `/company/[id]/supplier-documents/statements` | **Inbox by stage:** Inbox, To enter, Needs review, Ready, Reconciled, Duplicates & rejected. **PDF-first upload** (JPG/PNG scans, CSV/XLSX secondary; 25 MB). It refreshes while statements are being read after upload. Search; stage counts. |
| `/company/[id]/supplier-documents/statements/[statementId]` | **Review:** the original (audited viewer, jump to a line's page) beside the next-step card; arithmetic findings and reading warnings; supplier proposal → **explicit confirmation** (with an optional, audited "save our account number on the supplier"); statement details form; lines editor (unread values shown with the raw text, correct / add / remove / exclude). **Reconciliation:** S, P, D, Explained, Unexplained; classifications grouped by category with effects, PRECISIA records and *suggestions (not matches)*; explain / link / withdraw (reason required); a stale-run warning; run history with *Verify* (exact replay). **History:** the audit trail. |

The nav item "Statements" sits under **Supplier Documents**, next to Invoice Capture.

## Rules carried into the interface

- **Accounting safety.**
  - No screen posts, adjusts, allocates or "fixes" anything; a test checks that no such button exists.
  - Unexplained is shown as it is ("never adjusted away").
  - Explanations and links take effect only when the statement is reconciled again.
- **Hiding is not the guard.**
  - Controls follow the user's Purchasing permissions and the statement's state, so nobody is offered a button that would be refused.
  - The API and database enforce every rule again: a view-only user who forces a reconciliation from the browser receives **403**.
- **Supplier confirmation.**
  - A proposed supplier (even by VAT number) is labelled **NOT confirmed**, and "Mark ready" stays disabled until a person confirms it.
  - The confirmer is the session user.
- **Unsupported currency** is stated as "Unsupported currency — manual review required".
- **The original** is viewed only through the SD-3B audited route; every view is recorded.
- **Decisions are append-only.** "Withdraw" records a revocation with a reason; the original decision stays visible as withdrawn. Decisions can only be made on the **latest** run; earlier runs are read-only.

## Changes outside the new screens

| File | Change |
|---|---|
| `original-document-viewer.tsx` | Optional `originalUrl` and `page`, so statements reuse the SD-2 viewer. Capture behaviour is unchanged. |
| `workspace-nav.ts` | The **Statements** child. |
| `supplier-statement-service.ts` | `documentId` on summaries; `extractedHeader` (as read), for "Corrected" marks. |
| `supplier-statement-repository.ts` | `listDocumentFilenames`, under the caller's session. |

## Defect found by the real-browser run, and fixed

**The supplier choice did not follow a proposal that arrived after the page was opened.** If a statement was
opened while it was still being read, "Confirm supplier" stayed disabled once the proposal arrived. The choice now
follows the stored supplier, and a regression test covers it.

## Tests and results

| Check | Result |
|---|---|
| Component tests (`supplier-statements.test.tsx`) | 22: inbox stages and upload; permissions; unconfirmed supplier blocks ready; confirm payload; unread values with raw text; currency; audited viewer; S/P/D/E/U; classifications; no posting or adjusting control; explain / withdraw payloads; stale run; view-only; earlier run read-only; jest-axe |
| `statement-stages.test.ts` | Stages, readiness blockers, explanation targets, link eligibility |
| Full app test suite | **5,921 passed, 0 failed, 0 timeouts, 50 skipped** (the same 50 as before) |
| Typecheck, lint, `next build` | 0 errors; 0 lint errors (the 3 pre-existing warnings); build exit 0 |
| **Real-browser workflow** (production build, local Supabase stack, Edge) | **All 13 required steps pass**, plus permissions, isolation and responsive checks (details below) |

The real-browser run covered:
1. **Upload** through the inbox's file control.
2. **Processing** after the response, to Needs review.
3. **Review:**
   - the original shown through the audited viewer, and the view recorded;
   - references exactly as printed;
   - supplier proposed but not confirmed, and "Mark ready" blocked.
4. **Correct** a line in the lines editor: saved, marked corrected, audited and re-checked (Pass).
5. **Confirm supplier**, stamped with the session user.
6. **Mark ready.**
7. **Reconcile:** run 1, statement Reconciled.
8. **Inspect:**
   - on screen and in the database: S 7,752.55, P 7,590.15, D 162.40, Explained 112.40, Unexplained 50.00;
   - Opening Balance Difference, Missing in PRECISIA (*Imported — not posted*), Missing on Statement, Matched, Credit Note and Payment all shown.
9. **Explain** the opening difference: recorded with the session user and flagged stale.
10. **Rerun:** run 2, Unexplained 0.00, 50.00 explained by a reviewer.
11. **Withdraw:** a new revoke row; the original decision is kept.
12. **Rerun:** run 3, Unexplained 50.00; runs 1–2 unchanged; run 1 verified in the browser as reproducing exactly.
13. **Accounting unchanged:** the fingerprint over journals, GL, bills, payments, allocations, bank transactions, opening balances and suppliers is identical, and no posting or adjusting control exists.

Also checked:
- **Permissions:** view-only sees the result with no actions, and a forced run returns 403.
- **Isolation:** another company cannot open the statement.
- **Responsive:** no horizontal overflow at 390 px (inbox, review and reconciliation) or at 768 px.

Steps 9 and the view-only check first failed on test timing: the page was read before its refresh finished. With
settled waits they passed against the same statement, and the script now waits properly.
