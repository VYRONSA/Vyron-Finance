# Supplier Document Intelligence — SD-3B: permanent view/download audit of supplier originals

**Status:**
- Implemented locally on `security/sd0-supplier-capture-hardening`, on top of `26e506e`.
- **Uncommitted. Not pushed, not deployed, and not applied to production**, which remains at 0109.
- Production order when instructed: 0109 → 0110 → 0111 → 0112 → **0113**.

## What it does

Every view and every download of a supplier document's **original** is recorded permanently **before** the
file is sent. If the record cannot be written, **nothing is sent** (fail closed).

This covers the originals behind invoice captures now, and supplier statement originals from SD-3C. The
statement path is in place, but the database refuses it until 0114 creates statements.

Recorded per access:
- company;
- document id;
- capture id *or* statement id (exactly one);
- `view` | `download`;
- the actor's auth id and label (session email, else id);
- the time.

**The actor always comes from the authenticated session.** It cannot be supplied or spoofed:
- the writer has no actor parameter;
- a BEFORE INSERT trigger re-stamps the actor and time from the session, even on a privileged insert.

## Two gaps found and closed

An audit written only by the viewer would not have been a complete record. Two other paths reached the
same files without it:

1. **Storage API (pre-existing, since 0027).** Any *member* of a company could download every object in
   the company's folder directly from Supabase Storage, with **no Purchasing permission** and no record.
   - 0113 excludes supplier originals from the storage **read** policy for signed-in clients.
   - Every other document keeps the 0027 rule unchanged.
   - The app now reads originals server-side, with the service-role key, **only after** the permission check,
     the RLS-scoped lookup and the audit write.
2. **Generic signed-URL route** `GET /api/companies/[companyId]/documents/[documentId]/download`. It
   refuses supplier originals with a 409 that points to Supplier Documents, and issues no URL. It checks
   permission first, so a refusal does not reveal anything.

The extraction runner's file read (`scheduler-service.readCaptureDocumentBytes`) now uses the same
server-side reader, so a "Run now" under a user's session still works with the new storage policy.
Scheduled runs already used the service role.

## Migration 0113 — `0113_supplier_document_access_audit.sql`

It is idempotent and has a rollback at `supabase/rollbacks/0113_…_down.sql`. The rollback warns that it
destroys the audit history, and that the app must be rolled back first.

| Object | Kind | Notes |
|---|---|---|
| `supplier_document_access_events` | table | `document_id` → documents (NO ACTION). `capture_id` → captures. `statement_id` (FK added by 0114). CHECK `action in (view, download)`. CHECK `num_nonnulls(capture_id, statement_id) = 1`. RLS on. |
| `fn_record_supplier_document_access(company, document, capture, statement, action)` | SECURITY DEFINER, pinned search_path | Requires a session user and `Purchasing:View` in the company. The document must be the original of that capture **in that company**. Statement subjects are refused until 0114. Refusals raise, so nothing is recorded. |
| `fn_supplier_document_access_events_stamp()` | trigger | Sets the actor id, label and `occurred_at` from the session. Refuses an insert with no session. |
| `fn_supplier_document_access_events_immutable()` | trigger | No UPDATE, DELETE or TRUNCATE, except an FK cascade from deleting a whole company. |
| `fn_document_is_audited_original(bigint)`, `fn_storage_object_is_audited_original(text)` | SECURITY DEFINER | "Is this a supplier original": captures now, statements from 0114. |
| storage policy `read own-company documents in storage` | replaced | 0027's rule **AND NOT** an audited original. |
| `documents_storage_path_idx`, `supplier_invoice_captures_document_idx` | indexes | The read policy now runs its lookup on each object read. |

### Explicit grants (no reliance on Supabase defaults)

| Object | anon | authenticated | service_role |
|---|---|---|---|
| `supplier_document_access_events` | nothing | SELECT (RLS: `Purchasing:View` in the company) | SELECT only (cannot write directly) |
| `fn_record_supplier_document_access` | no | EXECUTE | **no** (it has no user to record) |
| stamp / immutable trigger functions | no | no | no |
| `fn_document_is_audited_original`, `fn_storage_object_is_audited_original` | no | EXECUTE | EXECUTE |

## Application

| File | Change |
|---|---|
| `src/server/repositories/supplier-document-access-repository.ts` | New: `recordSupplierDocumentAccess` (RPC under the user session; no actor), `isAuditedSupplierOriginal`, `readSupplierOriginalBytes` (server-side read). |
| `src/server/documents/supplier-original-response.ts` | New: **the shared viewer** used by captures now and statements from SD-3C. Order: read → decide (inline PDF/JPEG/PNG from the bytes, or `?download=1`) → **audit** → serve. A 415 records nothing, because nothing was shown. An audit failure gives a 503 `text/plain` explanation and no bytes. Only ids and the error code are logged. |
| `…/invoice-capture/[captureId]/original/route.ts` | Uses the shared viewer. Permission is still checked before any lookup. |
| `…/documents/[documentId]/download/route.ts` | Refuses supplier originals (409). |
| `src/server/services/scheduler-service.ts` | Runner reads originals through the server-side reader. |
| `original-document-viewer.tsx` | States "views and downloads are recorded". The image-failure message explains the fail-closed rule. A PDF frame or new tab shows the server's plain-text explanation as is. |
| `extraction-provider.ts` | Comment only: **scanned invoices are not manual-only** (owner decision). |

No accounting, posting, supplier-balance, capture-workflow or AI behaviour changed. Live AI stays OFF.

## Tests

| Suite | Result |
|---|---|
| `supabase/tests/supplier_document_access_audit.test.sql` | **57/57**: grants (G), writer (W), actor spoofing (A), permissions and cross-company (P), refused write records nothing (F), RLS (R), immutability (I), statement foundation (T), storage (S), accounting untouched (H) |
| All SQL suites on the sandbox at 0113 | **791/791** (11 suites) |
| Rollback then re-apply of 0113 | Clean |
| Vitest, new and updated | Route (13), shared viewer and statement foundation (3), repository (9), generic download route (3) |
| Full vitest | 5636 passed. Run-to-run 5 s timeouts in unrelated DOM tests under host load (66 containers running); every failing file passes in isolation. |
| Typecheck | 0 errors |
| Lint | 0 errors; 3 pre-existing warnings in unrelated files |
| `next build` | Exit 0 |
| **End to end, local Supabase stack** (real Storage + PostgREST + production build) | **38/38**. Includes: the original is not downloadable from Storage even with Purchasing:View; no actor can be supplied through the API; view vs download recorded; cross-company 403/404 with nothing recorded; **live fail-closed** (execute revoked → 503, no bytes, no record, clear message in the review screen; restored → served); review screen records the reviewer's view. |

## Notes for review

- **One opening can record two views.** Chromium's PDF viewer fetches the document twice for one frame
  (observed 15 ms apart). Each fetch really delivered the file, so both records are true. A future report
  can group near-identical rows; the audit itself should not drop them.
- **Service-role key required at runtime** to serve originals (`SUPABASE_SERVICE_ROLE_KEY`; already
  required for capture processing and invites). If it is missing, nothing is served.
- **Order of deployment:** apply 0113 together with an app build containing SD-3B.
  - A 0113 database with an older app makes the old viewer's user-session storage read fail. That is
    fail-closed, but every original is refused.
  - An SD-3B app without 0113 refuses every original, because the writer is missing.
