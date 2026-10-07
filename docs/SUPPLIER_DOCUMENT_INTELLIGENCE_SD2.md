# Supplier Document Intelligence — SD-2: Supplier Documents UI (Invoice Capture)

**Status:** reviewed and approved by the owner (2026-10-07), including the 125/125 browser
verification. Committed on branch `security/sd0-supplier-capture-hardening`, on top of `0005c8f`.
- Not pushed or deployed. Nothing has been applied to production.
- No new migration and no accounting or posting change.
- Live AI is still off.
- Supplier statements are not part of SD-2; they remain SD-3, PDF-first.

## What was built

| Area | What |
|---|---|
| Navigation | New **Supplier Documents** group, next to Purchasing in the Executive section. Its child **Invoice Capture** lives at its own route segment (`supplier-documents/…`), so the Purchasing item does not also highlight. Statements join in SD-3. There is no "Soon" placeholder. |
| Invoice Capture page | `/company/[companyId]/supplier-documents/invoice-capture`. Hero, a stage summary bar, stage tabs (**Inbox, Processing, Needs Review, Approved, Posted, Rejected**; the stage is kept in the URL as `?stage=`), search, permission-aware upload, and a table with document, supplier (confirmed or not), number, date, total (credit notes marked CR), status (with the draft's own posting status) and checks. |
| Review page | `/company/[companyId]/supplier-documents/invoice-capture/[captureId]`. Deep-linkable, so it survives a refresh. The original document is on the left (sticky on wide screens) and the review is on the right. |
| Original document viewer | A new same-origin route, `GET /api/companies/[companyId]/purchasing/invoice-capture/[captureId]/original`. PDFs are shown inline in a frame and images inline as images, with "Open in new tab" and "Download original" (`?download=1`). Replaces the old link that showed a JSON body. |
| Extracted vs corrected | Each header field is marked *From the document*, *Corrected* (with "Read from the document: …") or *Entered by hand*. "As read from the document" shows the immutable extraction snapshot's lines. |
| Supplier confirmation | Shows what the document states (name, VAT and registration numbers), the matched supplier and how it was matched, "Did you mean" candidates, and a supplier picker. Suppliers are never created automatically. |
| Warnings | Duplicate (blocked or possible, with links to the other document or bill), validation findings (must fix, or check), "not checked since the last change", and extraction failure. |
| Header and lines | Editable only in Needs Review or Manual Entry and only with Purchasing:Edit. Only changed fields are sent. Lines can be corrected, added and removed, with GL/VAT pickers that show where each suggestion came from, include/exclude, and live totals computed the way the bill engine computes them, beside the document's own totals. |
| Manual entry | Waiting or failed documents get **Enter by hand**, then **Submit for review**. |
| Credit notes | Labelled throughout, with an explanation panel. Approval reads "create draft credit note", and amounts are shown as magnitudes with CR. |
| Actions | A "Next step" panel per state. **Approve — create draft bill / credit note** is confirmed first and states that nothing is posted and that the approval limit is checked. **Reject** is confirmed first and states that the original is kept. **Validate again** is offered when needed. Server refusals (including approval limits) are shown as returned. |
| History | The immutable audit trail: who, what and when. Summaries carry no document content. |
| Purchasing tab | The old "AI Invoice Capture" tab (the duplicate UI with the JSON-link bug) now points to the new workspace. Its component was removed. |

## Routes

**Added:**
- Page: `/company/[companyId]/supplier-documents/invoice-capture`, with `loading.tsx`.
- Page: `/company/[companyId]/supplier-documents/invoice-capture/[captureId]`, with `loading.tsx`.
- API: `GET /api/companies/[companyId]/purchasing/invoice-capture/[captureId]/original` (inline, or with `?download=1`).

**Unchanged and reused:** `POST …/invoice-capture` (upload) and `PATCH …/invoice-capture/[captureId]`
(correct-header, correct-lines, manual-entry, submit-for-review, revalidate, cancel, convert), all from
SD-1.

## Permissions

| Control | Shown when | Enforced again by |
|---|---|---|
| View pages and original | Purchasing:View; otherwise an "access" card is shown | page; `/original` checks Purchasing:View before any lookup; RLS |
| Upload | Purchasing:View + Create | POST route; RLS + guard |
| Edit details, lines, supplier; manual entry; submit; validate again | Purchasing:Edit, in an editable state | PATCH route; guard (0111/0112) |
| Reject | Purchasing:Reject | PATCH route; guard |
| Approve | Purchasing:Create + Approve, and nothing blocking | PATCH route + `requireApproval` (limit); guard |

The flags are computed server-side with the existing `hasPermission` (`supplier-document-access.ts`).
They only decide which controls are offered.

## Original document viewer: security

- **Same origin.** The original is never served from a signed storage URL.
- **Permission first.** `Purchasing:View` is checked **before** anything is looked up, so a 403 cannot be probed
  into a 404.
- **Session reads.** The capture and the document are read under the caller's session.
- **File type from the bytes.** The type is detected from the file's own signature (`detectInlineFileType`): PDF, JPEG or PNG
  only. The stored, client-declared MIME type is never echoed, so an uploaded HTML or SVG can't run as
  this app. Any other type gets 415 inline, and is only offered as a download (`application/octet-stream`).
- **Headers:**
  - `X-Content-Type-Options: nosniff`
  - `Cache-Control: private, no-store`
  - `Referrer-Policy: no-referrer`
  - `Content-Security-Policy: frame-ancestors 'self'`; images also get `default-src 'none'`
  - an RFC 6266 `Content-Disposition` header
- **The original never changes.** It is retained by 0112.

## Not changed

- No migration.
- No change to accounting posting, supplier balances, approval logic or the SD-1 API.
- No live AI.
- Dashboard and other screens untouched, apart from the Purchasing tab's pointer and the sidebar entry.

## Verification

### Automated

| Check | Result |
|---|---|
| New: `src/lib/supplier-documents/supplier-documents.test.ts` (stages, blockers, totals, change sets, inline-type detection) | 19 / 19 |
| New: `…/[captureId]/original/route.test.ts` (permission before lookup, bytes-not-MIME, 415, headers, download) | 7 / 7 |
| New: `components/financial/supplier-documents/supplier-documents.test.tsx` (mounted inbox and review, permission-aware controls, viewer, credit notes, manual entry, approve/reject through the API, refusals shown, edits survive a refresh, jest-axe) | 20 / 20 |
| Navigation test extended with Supplier Documents | pass |
| Full application suite | **5,622 passed, 0 failed**, 50 skipped (pre-existing) |
| Typecheck | clean |
| Lint | 0 errors (3 pre-existing warnings in untouched files) |
| `next build` | exit 0. Both new pages are in the route table. |

### Browser: **125 / 125 passed**

The production build ran (`next build` + `next start`) in Edge (`puppeteer-core`) against an isolated
local Supabase stack built from migrations 0001 → 0112, with production-style role grants and the 0111
lockdowns in force. The data was synthetic: certification-corpus documents and three users (a reviewer, a
view-only user, and an approver with a R500 limit).

Every state-changing flow is checked **browser → server → database row**, and after a page refresh.

- **Layout (60 checks).** The inbox and four review pages at 1440×900, 1024×768, 768×1024 and 390×844 each
  load (200), with **no horizontal page scroll** and no page errors.
- **Navigation and stages.** Supplier Documents › Invoice Capture is active and Purchasing is not
  highlighted. All six stages list the expected documents.
- **Viewer.**
  - A real PDF is served inline from the same-origin route (`application/pdf`, `nosniff`), with no link to
    the old JSON route.
  - Download is an attachment.
  - The PNG renders, decoding at 1440×2000.
  - The document can be hidden and shown on a phone.
- **Upload and duplicates.** An upload creates a Queued capture attributed to the session user. The same
  file again creates a Blocked Duplicate, and the user is told.
- **Enter by hand.**
  - Queued becomes ManualEntry (`manual_entry` set), with the event recorded under the session user.
  - The state persists after a refresh.
  - The chosen supplier is recorded as a manual match.
- **Save header.** The values reach the database exactly (`PNG-0001 | 2026-09-05 | 200.00 | 30.00 | 230.00`).
  The correction event is attributed, and the values persist after a refresh.
- **Save lines.** An added line is stored with its confirmed GL account 5000 and VAT code Standard Rated, and
  persists after a refresh.
- **Submit for review.** ManualEntry becomes NeedsReview and is validated as **Pass**; the event is attributed.
- **Corrected totals.**
  - Total 9999 is saved and validation gives **Review** (`totals-disagree`, shown after a refresh).
  - Correcting it back to 1150 gives **Pass**.
- **Line correction.**
  - Quantity 11 against a printed line total of 1000 makes the line incoherent. It is **Incomplete**,
    which blocks approval.
  - Restoring it gives **Pass**.
- **Validate again.** While Pending, Approve is disabled and Validate again is offered. Clicking it gives
  **Pass**.
- **Duplicates.** A blocked duplicate offers no Approve. A forced conversion through the API returns 400,
  and no bill is created.
- **Approval limit.** The R500 approver is refused on the R1,150 invoice: the refusal is shown and nothing
  is created.
- **Approve.**
  - The capture becomes Converted, linked to a **Draft Bill of 1 150.00 with no journal**, with
    `converted_by` set to the session user.
  - It is read-only after a refresh.
  - A second conversion returns 400, and editing through the API returns 400.
- **Credit note.**
  - Approving creates a **Draft supplier Credit Note, 575.00, positive, with no journal**.
  - Its lines are stored as magnitudes (`5 × 100`).
- **Reject.** The capture becomes Cancelled, the original document is kept, the event is attributed, and
  the capture is read-only after a refresh.
- **View-only user.**
  - No upload control, no actions and no editable inputs; the original is viewable (200).
  - Forged `correct-header`, `correct-lines`, `manual-entry`, `revalidate`, `cancel` and `convert` requests,
    and a forged upload, are **all refused with 403**. The capture is unchanged.
- **Accounting.** **No journals.** The only purchase documents created are the two Drafts.

### Defects found by the browser tests, and fixed

1. **An original was blocked by its own duplicate copy.**
   - A re-upload creates a `Duplicate` capture, and duplicate detection treated that copy as a live
     record. On the original's next correction, the original was marked Blocked.
   - Fix: `Duplicate`-status captures are not candidates. They can never convert, so protection is not
     weakened.
   - Regression test added.
2. **VAT on hand-entered lines was ignored by validation.**
   - Re-validation only read printed VAT amounts, so a typed line with a VAT code counted as 0% VAT. A
     correct 200 + 30 = 230 entry was therefore flagged.
   - Fix: in the review path only, a line with no printed VAT amount and no printed rate uses the confirmed
     VAT code's rate. That is the same arithmetic `createPurchaseBill` uses. Printed figures are never
     overridden.
   - Regression tests added.
3. **Unsaved edits were discarded by an unrelated refresh.** The drafts now reset only when the stored
   values actually change. A component test covers it.

Test-only corrections, not application changes: the seed's supplier default GL account (5100 does not
exist in the seeded chart; 5000 does), an organisation membership and a subscription for the synthetic
company, and the script's waits and input handling.

### Carried forward: required items for the next migration phase (owner decision, 2026-10-07)

1. **Audit of original-document access (REQUIRED; not dropped).** SD-2 serves originals without
   recording access, because recording it needs a migration. The next migration phase must add an
   **immutable** audit event for both:
   - **viewing** the original (inline);
   - **downloading** the original (`?download=1`);

   Each event must record:
   - the **actor**, from the session;
   - the **timestamp**;
   - the **company**;
   - the **document id and capture id**;
   - **whether the original was viewed or downloaded**.

   It must be written by the server, not insertable or editable by clients, and follow the 0111
   append-only pattern.
2. **Explicit grants in every SD-3 table migration (REQUIRED).** Each new table must establish its
   database-role grants explicitly (and revoke what must not be reachable). It must not rely on default
   privileges, which newer Supabase no longer applies (see below).
3. **Supplier statement reconciliation (SD-3) is PDF-FIRST.**
   - PDF is the primary statement format.
   - JPG/JPEG/PNG may be supported for scanned statements.
   - CSV/XLSX are secondary formats only.
   - The original statement is always retained and viewable.
   - The extracted statement is mathematically validated before it is reconciled.
4. **Live AI remains OFF.**
5. **No production migrations or deployment** without explicit owner instruction. The production order
   remains 0109 → 0110 → 0111 → 0112.

### Findings from building the local stack (not code changes)

- **Supabase CLI 2.110 no longer auto-grants new tables to the API roles** (`auto_expose_new_tables`,
  "matching the new cloud default"; the legacy option is removed on 2026-10-30).
  - Production predates this and has the legacy grants, which the app relies on.
  - **Any new table added in SD-3 should carry explicit GRANTs in its migration**, rather than rely on
    default privileges.
- The synthetic test company needed an organisation membership (company visibility) and a subscription.
  Without a subscription every plan limit is 0 and uploads are refused, correctly, with HTTP 402. This
  is expected behaviour for a company without a plan.
