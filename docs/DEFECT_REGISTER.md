# VYRON FINANCE 1.0 — Defect Register

LR1 Phase 6. Every issue below was found during LR1 Phase 1's page-by-page audit (7 independent agent passes, each cross-checking the actual current code against `docs/MIGRATION_ROADMAP.md`'s own claims, not assuming the documentation is current). Categorised Critical/High/Medium/Low/Nice-to-have. Each entry has root cause, proposed fix, impact, priority, and an estimated effort — deliberately not all fixed; this register is for prioritisation, not a mandate to fix everything.

This document is populated incrementally as each audit pass reports back; see `docs/PRODUCT_AUDIT_MATRIX.md` for the full Complete/Partial/Missing/Broken/Placeholder/Production Ready rating per page/control.

---

## Company/Banking/Import/Transactions/Supplier Reconciliation (audit pass 1)

### D-001 — No module has a real `*:View` permission check anywhere in the codebase
- **Category**: High
- **Root cause**: The RBAC permission catalog defines a `View` action per module (`Sales:View`, `Banking:View`, etc.) and the Roles & Permissions admin UI lets an operator toggle it per role, but no route in the audited modules (and, per the pattern, likely no route anywhere) calls `requirePermission(companyId, "<Module>:View")` — every GET route is gated on `requireSession()` alone.
- **Impact**: Any authenticated member of the owning organisation can read every bank account, transaction, and supplier-reconciliation report regardless of what their role's permission matrix says. The View toggle in the admin UI is cosmetic — configuring it has zero effect. Not a cross-tenant leak (RLS still scopes by company), but a real intra-company least-privilege gap (e.g. a Read Only role's "View" grants mean nothing if every role already sees everything).
- **Proposed fix**: Either (a) wire real `*:View` checks onto every GET route across all modules — large, mechanical, touches ~180 routes — or (b) if intra-company view-restriction was never actually a real product requirement, remove the non-functional `View` toggle from the admin UI and document that view access is company-wide by design. Needs a product decision before an engineering fix, not just a code change.
- **Priority**: High — this is a real gap between what the product configuration UI implies and what actually happens, discoverable by any customer's admin who tries to restrict a role's read access and finds it doesn't work.
- **Estimated effort**: Decision: none (product call). Fix (option a): Large (multi-day, touches every module's GET routes). Fix (option b): Small (UI + doc change only).

### D-002 — Bank Account detail page lost its "View Transactions"/"View Matching" quick actions
- **Category**: Medium
- **Root cause**: `docs/MIGRATION_ROADMAP.md` documents these as real (if Preview-Mode-disabled) quick-action buttons on the Bank Account detail page; the current code has no such buttons at all. Reason for the drift not determinable from static code alone (no git history in this checkout).
- **Impact**: A user viewing one bank account's detail page has no one-click path to that account's transactions in Transaction Explorer, even though the underlying filter (`bankAccountId`) exists and works when reached directly from Transaction Explorer.
- **Proposed fix**: Re-add the two quick-action links, pointing at Transaction Explorer/Matching pre-filtered by this account.
- **Priority**: Medium — a real, if minor, navigation regression on a frequently-visited page.
- **Estimated effort**: Small (a couple of hours — the filter plumbing already exists elsewhere).

### D-003 — Transaction Explorer grid's "Customer" column always shows "Not available," even for transactions with a real assigned customer
- **Category**: Medium
- **Root cause**: The grid column is a hardcoded display stub with a tooltip claiming "no Customer concept exists" — a claim that predates Customer Management being built. "Assign Customer" is a real, working bulk action that writes `matched_customer_id`, and the Detail Panel correctly shows it — but the list query never selects a customer name, so even fixing the grid cell requires a query-shape change, not just a UI tweak.
- **Impact**: A user who bulk-assigns a customer to transactions sees no confirmation in the grid itself — only by opening each transaction's Detail Panel individually. Misleading, not data-destructive.
- **Proposed fix**: Add `matchedCustomerName` (a join) to the Transaction Explorer list query, then render it in place of the hardcoded stub.
- **Priority**: Medium — cosmetic-but-real confusion on a heavily-used bulk workflow.
- **Estimated effort**: Small-Medium (a repository query change + one grid column).

### D-004 — Bulk actions (Generate Journal, Apply Rule) silently discard per-item skip/failure detail
- **Category**: Medium
- **Root cause**: `generateJournalFromTransactions`/`applyRulesToTransactions` both return per-transaction outcome detail (which ones were skipped and why), but the calling UI (`transaction-explorer.tsx::runBulkAction`) only surfaces a generic error or a silent success/grid-refresh — the per-item detail is computed and thrown away.
- **Impact**: A user selects 10 transactions, clicks "Generate Journal," 3 are skipped (e.g. "No GL account assigned") — they're never told which 3 or why, only that the selection cleared.
- **Proposed fix**: Surface the `skipped`/per-item `results` array in a toast or inline summary after a bulk action completes.
- **Priority**: Medium — a real usability gap on a core, frequently-used workflow; worth checking whether the same pattern exists in other modules' bulk actions before scoping the fix.
- **Estimated effort**: Small-Medium.

### D-005 — `supplier-reconciliation-service.ts::syncWorkQueue` bypasses the repository layer, contradicting its own file's documented architecture
- **Category**: Low
- **Root cause**: The service file's own docstring states it "talks only to the repository layer, never to Supabase directly," but `syncWorkQueue` imports `createClient` and runs raw Supabase calls directly, even though an equivalent repository function already exists.
- **Impact**: No user-visible defect (same RLS-scoped client either way) — a maintainability/architecture-consistency issue, and a precedent risk if copied elsewhere.
- **Proposed fix**: Route `syncWorkQueue` through the existing repository function.
- **Priority**: Low.
- **Estimated effort**: Small (under an hour).

### D-006 — Report Viewer's default-active tab doesn't auto-fetch on first page load
- **Category**: Low
- **Root cause**: The "Supplier Allocation" tab renders as visually active on mount, but its data cache is empty until the user clicks it — the click handler is the only fetch trigger.
- **Impact**: First-time page load shows an already-"active"-looking tab with "Select a report." — momentary, self-correcting once clicked, but a real first-impression inconsistency.
- **Proposed fix**: Fetch the default tab's data on mount, not only on click.
- **Priority**: Low.
- **Estimated effort**: Small.

### D-007 — VAT rate-history endpoint is fully built but has no UI entry point anywhere
- **Category**: Low
- **Root cause**: Backend (`rate-history` route + service function) is real and complete; Tax Configuration tab never calls it.
- **Impact**: A real, working capability (viewing a VAT treatment's rate-change history) is invisible to every user.
- **Proposed fix**: Add a "Rate History" link/expand affordance to the Tax Configuration tab.
- **Priority**: Low — no functional harm, just an undersurfaced feature.
- **Estimated effort**: Small.

### D-008 — Bank Account/Transaction detail routes may not gracefully handle a malformed (non-numeric) ID
- **Category**: Low (unconfirmed — flagged for live verification, not asserted as a live bug)
- **Root cause**: Several routes call `Number(accountId)`/`Number(transactionId)` directly on the URL param without an `isNaN` guard before querying.
- **Impact**: Unknown without live testing — likely resolves to a clean "not found" via Supabase's own query behaviour on `NaN`, but not confirmed.
- **Proposed fix**: Add an explicit `Number.isFinite()` guard returning a clean 400 before any repository call, removing the ambiguity regardless of Supabase's actual behaviour.
- **Priority**: Low.
- **Estimated effort**: Small (defensive, cheap insurance).

---

## General Ledger/Customers/Suppliers/Sales/Purchasing (audit pass 2)

### D-009 — Financial Period "Lock Date"/"Reopen" is a fully-built, fully-tested, completely unreachable feature
- **Category**: High
- **Root cause**: `financial-period-service.ts::setLockDate`/`reopenFinancialYear` and their API route (`ManageFinancialYears`-gated) are real and correctly consumed by the Posting Engine's own period-validation check — but no UI anywhere calls this route. The only Financial Years UI wires a *different* route (`set-current`/`close`).
- **Impact**: A business that needs a soft pre-close lock (allow the current period to stay open while blocking postings on/before a cutoff date) has no way to set one, even though the Posting Engine already actively checks for it.
- **Proposed fix**: Add Lock Date/Reopen controls to the Financial Years settings tab, wired to the existing route.
- **Priority**: High — real accounting-control capability, silently unreachable.
- **Estimated effort**: Small-Medium (backend fully done; UI form + wiring only).

### D-010 — No UI to edit a Customer or Supplier master record after creation (systemic, both modules)
- **Category**: Medium
- **Root cause**: `updateCustomer`/`updateSupplier` and their PATCH routes are real and support full field updates, but no component anywhere renders an edit form — only Create and Active/Inactive toggle exist in the UI. Both detail pages' Overview tabs are read-only.
- **Impact**: Once created, a customer's credit limit/VAT number/payment terms, or a supplier's **banking details** (payment-relevant), can never be corrected from the UI. For Suppliers specifically this is a materially worse gap since banking-detail errors affect real payments.
- **Proposed fix**: Add an Edit form to both detail pages' Overview tabs, reusing the existing PATCH routes.
- **Priority**: Medium-High for Suppliers (banking details), Medium for Customers.
- **Estimated effort**: Small-Medium per module (backend done, UI form only) — do Suppliers first given the payment-data risk.

### D-011 — Journal number shown as plain text (not linked) in GL Inquiry, Sales Invoices, and Purchase Bills tabs
- **Category**: Low
- **Root cause**: `account-activity-view.tsx` deep-links a journal number to the Journals tab; `gl-inquiry-tab.tsx`, `invoices-tab.tsx`, and `bills-tab.tsx` all render the equivalent figure as plain text.
- **Impact**: Inconsistent drill-through — a user can trace a journal from Account Activity but not from GL Inquiry or the Sales/Purchasing document tabs where the same number is shown.
- **Proposed fix**: Wrap all three in the same `Link` pattern already proven in `account-activity-view.tsx`.
- **Priority**: Low.
- **Estimated effort**: Small (three near-identical one-line changes).

### D-012 — Test-coverage asymmetry: Purchasing and Supplier Management core services have no dedicated unit tests
- **Category**: Medium
- **Root cause**: Every Sales-side service (quotation/sales-order/delivery/sales-invoice) and `customer-service.ts` has a `.test.ts` sibling; the equivalent Purchasing services (requisition/PO/GRN/bill/payment) and `supplier-management-service.ts` do not — only the read-side summary/financial-aggregation services are tested.
- **Impact**: No regression risk today (the code was manually verified correct in this audit), but future changes to Purchasing/Supplier core logic have no automated safety net, unlike their Sales/Customer counterparts.
- **Proposed fix**: Port the existing Sales-side test patterns onto the Purchasing/Supplier services.
- **Priority**: Medium — a real coverage gap, not urgent pre-launch since the current logic is correct, but should be closed soon after.
- **Estimated effort**: Medium (several days — 5 services' worth of test-writing).

### D-013 — Stale UI copy on Customers page claims Sales module doesn't exist yet
- **Category**: Nice-to-have
- **Root cause**: Hero copy never updated after Sales shipped.
- **Impact**: Cosmetic only.
- **Proposed fix**: Update the copy.
- **Priority**: Nice-to-have.
- **Estimated effort**: Trivial.

---

## Inventory/Banking Automation/Automation Platform/VAT (audit pass 3)

### D-014 — `RuleEngineRun` automation tasks are never auto-created — contradicts the platform's own documentation
- **Category**: High
- **Root cause**: `scheduler-service.ts`'s dispatch branch for `RuleEngineRun` is real and correct, but no code anywhere (TS service or SQL seed) ever creates a task of that type for any company — only `RecurringTemplate`, `CommunicationQueue`, and now `SubscriptionLifecycleSweep` self-seed.
- **Impact**: `docs/MIGRATION_ROADMAP.md` explicitly claims the Rule Engine "can now run on a real schedule through the shared Scheduler" — this is false in practice. Banking/VAT rule automation only ever runs via each module's manual "Run ... Now" button, never unattended.
- **Proposed fix**: Either self-seed a `RuleEngineRun` task per company (mirroring `syncSubscriptionLifecycleTask`'s pattern) if unattended rule-running is a real requirement, or correct the documentation to stop claiming this is live.
- **Priority**: High — a customer-facing automation claim that isn't true today.
- **Estimated effort**: Small (seeding logic already has 2 working precedents to copy) if the feature is wanted; trivial (doc correction) if not.

### D-015 — `ReportRefresh` automation task type silently no-ops and reports false "Success"
- **Category**: Medium
- **Root cause**: `ReportRefresh` has been a legal `automation_tasks.task_type` since the module's first migration but has no dispatch branch in `runTask` — it falls through to the generic `{status: "Success", summary: {}}` default.
- **Impact**: Currently unreachable (nothing creates a `ReportRefresh` task), so latent, not live — but if this task type is ever used (future feature, or a manual insert), it will silently do nothing while falsely reporting success, with no error trail.
- **Proposed fix**: Either implement the real dispatch branch, or remove `ReportRefresh` from the legal task-type list until it's implemented, so an accidental use fails loudly instead of silently.
- **Priority**: Medium — currently dormant, but a real trap for future development.
- **Estimated effort**: Small (either direction).

### D-016 — Workflow Engine (approval-before-activation) has a fully-real backend and zero UI entry point
- **Category**: Medium
- **Root cause**: `workflow-service.ts` and its 3 API routes are complete and one real caller exists in the service layer (`requestActivationApproval`), but no component anywhere lets a user attach a workflow to a Recurring Template, view pending approvals, or approve/reject a workflow instance.
- **Impact**: A documented capability ("template activation requires approval") cannot actually be used by any customer today.
- **Proposed fix**: Build the missing UI (a "require approval" toggle on the New Template form, plus a pending-approvals screen) — real scoped feature work, not a bug fix, so lower urgency under the "no new capabilities" rule unless treated as completing an already-half-shipped feature.
- **Priority**: Medium.
- **Estimated effort**: Medium (a real UI feature, several days).

### D-017 — Warehouse Locations: real backend, zero UI entry point
- **Category**: Low
- **Root cause**: Same pattern as D-016 — `createWarehouseLocation`/`listWarehouseLocations` and their route are real; no component calls them.
- **Impact**: A warehouse's sub-locations can never be created or viewed from the UI.
- **Proposed fix**: Add a Locations sub-panel to the Warehouses tab.
- **Priority**: Low.
- **Estimated effort**: Small-Medium.

---

## Reporting/Auditor/Assets/Copilot (audit pass 4)

### D-018 — CRITICAL: Copilot's new usage-limit/feature-flag gate will 403 every company that existed before the Billing Platform shipped
- **Category**: Critical
- **Root cause**: `subscribeCompanyToPlan` (which links a company to a real subscription) is only ever called from `createCompany` — there is no backfill migration inserting a `subscription_companies` row for companies that already existed before this session's Billing Platform work. For any such company, `getEntitlementsForCompany` returns `null` → `getEntitlements` falls back to all-zero deny-by-default limits → `hasFeature(companyId, "ai_copilot")` returns `false` (empty grant set) → the Copilot Ask route returns a hard `403`.
- **Impact**: Every real, already-onboarded customer company loses access to a feature they always had, the moment this code reaches a database with pre-existing companies. This is the exact "blocks a legitimate request incorrectly" failure mode — a genuine regression, not a documentation gap.
- **Proposed fix**: A corrective migration that backfills a real subscription (`billing_accounts`/`subscriptions`/`subscription_companies` rows) for every company that doesn't already have one, defaulting to a plan tier that preserves full existing access (Enterprise-equivalent, since these companies had unrestricted access before billing existed) rather than silently downgrading them.
- **Priority**: Critical — this is a discovered production defect and, per the Product Review Board's own stated exception, is in scope to fix now despite the "no new capabilities" instruction.
- **Estimated effort**: Small (one corrective migration, following the existing backfill-loop pattern already used twice in this codebase's history for RBAC/communication seeding).
- **Status: FIXED** — `supabase/migrations/0054_billing_backfill_existing_companies.sql`, a `do $$ ... loop ... end $$` backfill mirroring the exact precedent in `0025`/`0050`. One `billing_accounts` + `subscriptions` (status `active`, provider `manual`, plan `enterprise`) row per organisation, linked to every company in it via `subscription_companies`, idempotent (only acts on companies with no existing link).
- **Live-verified during Final Production Re-Certification**: migration `0054` (and `0045`-`0053`) are now applied to the live database — confirmed by table existence, plan seeding, and a real live query showing every pre-existing company has a `subscription_companies` link. Further confirmed at the symptom level: the AI Copilot's `Ask` endpoint was called live against a real company and returned a real `200` answer, not a `403` — the exact regression this defect describes no longer reproduces.

### D-019 — Audit Engagement creation has no UI entry point — the entire Planning tab is a dead end for any company without a pre-existing engagement
- **Category**: High
- **Root cause**: `POST /api/companies/[companyId]/audit/engagements` and `createAuditEngagement` are fully real and functional, but the Planning tab only ever renders "No audit engagement exists yet." when none is found — no button or form calls the create route anywhere in the codebase.
- **Impact**: A brand-new company (or one whose only engagements are all completed) can never create a new Audit Engagement from the UI — the entire Planning tab (team assignments, risk register, programme steps) becomes permanently unreachable.
- **Proposed fix**: Add a "New Engagement" form/button to the empty state.
- **Priority**: High — a real, launch-relevant dead end in a flagship module.
- **Estimated effort**: Small (backend fully done).

### D-020 — Report Designer can create, edit, and delete report definitions but never run/render one
- **Category**: Medium
- **Root cause**: The designer manages report metadata (name, type, columns, calculated fields) and saves/deletes it, but no "Run"/"Preview" step exists anywhere to actually execute `evaluateCalculatedFields` against real data and display output.
- **Impact**: The feature only ever produces unused metadata — a user can never see what a designed report actually looks like.
- **Proposed fix**: Add a Run/Preview action rendering the saved definition against live data.
- **Priority**: Medium — the feature is currently non-functional for its stated purpose.
- **Estimated effort**: Medium.

### D-021 — Budget delete has a real backend route but no UI control
- **Category**: Low
- **Root cause**: `DELETE .../budgets/[budgetId]` is real and permission-gated; Management Reports tab has no delete button.
- **Impact**: A mistakenly-created budget can never be removed from the UI.
- **Proposed fix**: Add a delete control.
- **Priority**: Low.
- **Estimated effort**: Small.

### D-022 — Business Risk/Audit Readiness scores hardcode several risk inputs to 0 despite real detectors existing for them
- **Category**: Medium
- **Root cause**: `highRiskVatTransactionCount`, `overdueDebtorsCount`, `supplierConcentrationRiskCount`, and `failedAutomationTaskCount` are hardcoded to `0` in the score calculation even though real detectors for supplier concentration and automation failures already exist and are used elsewhere (Executive Alerts) in the same file.
- **Impact**: The displayed Business Risk/Audit Readiness percentages are computed from an incomplete signal set — understating real risk in a company with, e.g., genuine supplier-concentration exposure.
- **Proposed fix**: Wire the existing detector outputs into the score calculation, not just the alerts.
- **Priority**: Medium — affects the accuracy of a headline executive metric.
- **Estimated effort**: Small (the detectors already exist; this is wiring, not new logic).

### D-023 — Financial Statements print/export claim in documentation doesn't match reality
- **Category**: Low (documentation)
- **Root cause**: `docs/MIGRATION_ROADMAP.md` claims a `window.print()`-based export exists for Financial Statements/Reports; no such control exists anywhere in that module (the only real `window.print()` call in the codebase is in the unrelated Trial Balance tab).
- **Impact**: Documentation overclaims a capability. No functional impact, but a real doc-vs-code drift.
- **Proposed fix**: Correct the documentation, or build the claimed feature if it's actually wanted.
- **Priority**: Low.
- **Estimated effort**: Trivial (doc fix) or Small (real feature).

### D-024 — Asset Register has no search/filter control
- **Category**: Low
- **Root cause**: The register is a flat, unfiltered table.
- **Impact**: Usability gap for any company with more than a handful of assets.
- **Proposed fix**: Add search/status/class filters, matching the pattern already used elsewhere (e.g. Stock Items).
- **Priority**: Low.
- **Estimated effort**: Small.

### D-025 — Narratives/Scenarios/Briefing generation don't share Copilot Ask's usage-limit/feature-flag gates
- **Category**: Low (already partially disclosed in the roadmap as deliberate proof-of-contract scoping)
- **Root cause**: Only the Ask route was wired to `hasFeature`/`checkUsageLimit` in Sub-Phase 2 of the Billing Platform work; the other 3 AI Copilot sub-features were not.
- **Impact**: A company without the `ai_copilot` feature (or over its usage cap) can still generate unlimited Narratives/Scenarios/Briefings — inconsistent enforcement within one feature area.
- **Proposed fix**: Apply the same two-line gate to the other 3 routes.
- **Priority**: Low — not a security issue, just inconsistent licensing enforcement.
- **Estimated effort**: Small (mechanical, same pattern 3 times).

---

## Financial Statements/Cashbook/Matching/Document/Communication (audit pass 5)

### D-026 — CRITICAL: "Suggested Merge" in Duplicate Detection is always broken — every click fails silently
- **Category**: Critical
- **Root cause**: The finding data structure (`DuplicateFinding`) only carries one `relatedId` per finding — the real duplicate-group member IDs needed to identify a genuine merge target are discarded twice on the way from the detection engine to the UI. The "Suggested Merge" button therefore always submits `survivingId === mergedId`, which the merge service explicitly rejects (`"Cannot merge a record into itself"`, HTTP 400) — and the button's own handler only checks `if (res.ok)`, so the failure is completely silent to the user.
- **Impact**: A real, documented, customer-facing action ("Suggested Merge," claimed working in `docs/MIGRATION_ROADMAP.md`) can never succeed for any finding, ever, with zero error feedback — a user just sees nothing happen.
- **Proposed fix**: Thread the real duplicate-group member IDs through from `duplicate-party-engine.ts`'s `groupIds` to the UI (removing the two points where they're currently discarded), so the button can submit a genuine distinct survivor/merged pair. The standalone Merchant Matching tab's own working "Merge & Repoint" (which sources a real target from a dropdown) is a working reference implementation of the correct pattern.
- **Priority**: Critical — a real, always-broken, silently-failing feature reachable by any user today.
- **Estimated effort**: Medium (data-shape change through 3 layers: engine → wrapper → UI).
- **Status: FIXED** — `DuplicateFinding` now carries a real `groupIds: number[]`; `duplicate-detection-engine.ts` calls the shared `findDuplicateParties` engine directly for Customer/Supplier (not the Auditor-Workspace-shaped wrapper that discarded group membership) so all 3 merge-supported entity types (Customer/Supplier/Merchant) carry it; `duplicate-detection-tab.tsx::suggestedMerge()` now picks a real distinct target (`groupIds.find(id => id !== finding.relatedId)`) instead of submitting the same ID twice. New test file `duplicate-detection-engine.test.ts` (4 tests) locks in the fix. `tsc`/`eslint`/`vitest` all clean.

### D-027 — Save Commentary / Generate Reporting Package don't check for request failure — errors are silently swallowed
- **Category**: Medium
- **Root cause**: `statements-notes-tab.tsx` and `reporting-packages-tab.tsx`'s mutating actions call `fetch()` without checking `res.ok`, unlike almost every other mutating control in the codebase (Cashbook/Matching/Communications/Documents all correctly surface `data.error`).
- **Impact**: If either action fails (e.g. a permission change mid-session, a validation error), the user sees the button simply stop "Generating…"/"Saving…" with no explanation — a preparer's typed commentary can be silently discarded.
- **Proposed fix**: Add the same `res.ok` check + error surfacing already used everywhere else.
- **Priority**: Medium.
- **Estimated effort**: Small (two near-identical fixes).

### D-028 — Storage-limit deny-by-default risk for pre-billing companies (same root cause as D-018, different symptom)
- **Category**: Critical (tracked under D-018 — same fix resolves both)
- **Root cause**: Identical to D-018 — any company without a `subscription_companies` row hits the same all-zero deny-by-default entitlements path, which would also make `checkUsageLimit(companyId, "max_storage_mb", ...)` deny **every** document upload, not just Copilot requests.
- **Impact**: Confirms D-018's fix (a backfill migration) is even more urgent than the Copilot-only symptom suggested — document upload, not just AI access, would break for every pre-existing company.
- **Proposed fix**: Same as D-018.
- **Priority**: Critical.
- **Estimated effort**: Covered by D-018's fix.
- **Status: FIXED** — resolved by D-018's same migration (`0054`), live-verified in the same re-certification pass (see D-018's entry).

---

---

## Billing Platform / Platform Shell / Auth / Settings (audit pass 6)

### D-029 — CRITICAL: Internal Billing Console's "Add Support Note" always writes against the wrong billing account
- **Category**: Critical
- **Root cause**: `platform/billing/page.tsx` passes `billingAccountIds[0]` (always the first account in a platform-wide list) into the Support & Audit tab, regardless of which company/account the operator is actually viewing. There is no per-account selector or per-row "add note" action anywhere in the tab.
- **Impact**: A platform operator viewing Company B's subscription who adds a note about Company B has that note silently written against whichever company happens to be first in the list instead — no error, no indication anything went wrong. Makes the Support Notes feature effectively non-functional for every company except one.
- **Proposed fix**: Pass the specific billing account ID being viewed (e.g. a per-row "Add Note" action on the Subscriptions tab, or a real account selector on Support & Audit) instead of a fixed first-in-list ID.
- **Priority**: Critical — silently corrupts operational data with zero error signal.
- **Estimated effort**: Small-Medium (a real UI/data-flow fix, not a large rebuild).
- **Status: FIXED** — `ConsoleSupportAuditTab` now takes a real `billingAccountOptions` list (one real option per billing account, deduped, labeled by every company name on that account) and requires an explicit selection via a `<select>` before "Add Note" is enabled — no more silently-guessed target. `tsc`/`eslint` clean.

### D-030 — CRITICAL: Platform Overview page shows hardcoded, fabricated data in "Recent Activity" and "Notifications" even with a real database connected
- **Category**: Critical
- **Root cause**: `platform/page.tsx` renders `MOCK_ACTIVITY`/`MOCK_NOTIFICATIONS` unconditionally — not inside the `previewMode ? ... : ...` branch every other section of the same page correctly uses (confirmed: the adjacent `licences`/`seatsUsed` real-data logic on the same page branches correctly).
- **Impact**: A direct violation of this codebase's own core, otherwise-consistently-enforced discipline ("no fabricated data outside Preview Mode"). In a real production deployment, every user sees the exact same static fake activity feed and notification list regardless of what has actually happened in their account — this is the single most severe instance of fabricated data found anywhere in this entire audit, on the platform's own front page.
- **Proposed fix**: Wire these two panels to real data sources (recent `billing_events`/`system_events`/audit trail entries; real unread notifications) the same way the rest of the page already does, or — if no real data source exists yet for one of them — remove the panel rather than fabricate its contents.
- **Priority**: Critical.
- **Estimated effort**: Medium (Notifications has a real backing table already used elsewhere; Recent Activity may need a new cross-module query).
- **Status: FIXED** — "Notifications" now aggregates real unread `AppNotification`s across every company the user can access (`listNotifications(companyId, true, 5)`); "Recent Activity" is honestly re-labeled "Recent Billing Activity" and aggregates real `billing_events` across those same companies (the one real cross-company activity source that exists today — relabeled rather than overclaiming coverage of every module). Both branch on `previewMode` exactly like the rest of the page now does. `tsc`/`eslint` clean.

### D-031 — Three dead, no-op buttons on the Platform Overview page
- **Category**: High
- **Root cause**: "Invite User," "Edit Profile," and "Contact Support" buttons have no `href` and no `onClick` — they render as inert buttons that do nothing when clicked, in both Preview and live mode.
- **Impact**: A user clicking any of these three gets no feedback and no action — looks broken, not just incomplete.
- **Proposed fix**: Wire each to its real destination (Invite User → the real invite flow already built in Settings' Roles & Permissions tab; Edit Profile → `/platform/account`; Contact Support → a real support contact path).
- **Priority**: High — these are prominent, expected actions on the platform's landing page.
- **Estimated effort**: Small (all 3 destinations already exist elsewhere in the app).
- **Status: FIXED** — "Invite User" now links to the first accessible company's Settings page (honestly disabled with a tooltip if the user has no companies yet); "Edit Profile" relabeled "Change Password" (the only real capability `/platform/account` actually offers — not overclaiming a fuller profile editor that doesn't exist) and links there; "Contact Support" is now honestly `disabled` with a tooltip rather than a silent no-op, since no real support contact channel exists anywhere in this codebase to link to yet.

### D-032 — Non-atomic multi-step billing writes, no rollback on partial failure
- **Category**: High
- **Root cause**: Every mutating Billing Engine function (`subscribeCompanyToPlan`, `cancelSubscription`, `resumeSubscription`, `changeSubscriptionPlan`, `transitionSubscription`) performs 3-6 sequential, independently-awaited Supabase writes with no transaction and no compensating rollback. If a later step in the sequence throws (e.g. a transient network error), earlier steps have already committed, leaving genuinely inconsistent state (e.g. a subscription's status changed with no corresponding audit-history row or published event; a company created with no billing subscription at all).
- **Impact**: Low probability (requires a mid-sequence failure), but real and currently unhandled — the Billing page's own error copy ("that shouldn't happen — contact support") implicitly acknowledges this as an unhandled edge case.
- **Proposed fix**: Either wrap each multi-step sequence in a `security definer` RPC (the established pattern this codebase already uses elsewhere for atomicity, e.g. `bootstrap_organisation`), or add explicit compensating cleanup on failure.
- **Priority**: High — architectural risk on financially-significant operations, worth fixing before real payment volume exists, not necessarily before this specific launch gate.
- **Estimated effort**: Medium (touches 5 functions, but one established pattern to replicate).
- **Update — live-confirmed, not fixed**: this exact failure mode was directly observed during pilot administrator account verification. `POST /api/companies` was called three times (the first attempt, then two retries after 500 responses); all three succeeded through company creation, RBAC seeding, and the `company_owner` grant, and all three failed only at the final `subscribeCompanyToPlan` step (Billing Platform tables not yet applied to this database) — producing **three duplicate, fully-RBAC'd companies with no subscription**, exactly as this entry predicted, plus a previously-undocumented consequence: retrying after a mid-sequence failure is not idempotent and creates duplicates rather than completing the original attempt. A dedicated architecture review, `docs/ARCHITECTURE_REVIEW_COMPANY_BILLING.md`, recommends decoupling Billing Activation from Company Creation as the structural fix (rather than wrapping the existing sequence in an RPC). **The Product Review Board accepted this recommendation in principle but deferred it to Version 1.1 — see `docs/ADR_001_COMPANY_CREATION_BILLING_DECOUPLING.md`. Not implemented in RC1; the certified workflow is unchanged.** The three diagnostic companies this produced have been safely removed (see D-048's entry below for the related `/platform` crash this same gap caused).
- **Update — trigger condition resolved, defect remains open**: during Final Production Re-Certification, migrations `0045`-`0054` were confirmed applied to the live database. A fresh, real `POST /api/companies` call completed cleanly end-to-end on the first attempt (`201`, real trial subscription, real `TrialStarted` billing event) — the specific failure that produced the duplicate companies above no longer occurs, because its root cause (missing tables) is gone. **This is not a fix for D-032.** The multi-step write sequence in `createCompany`/the Billing Engine is unchanged and still has no transaction or compensating rollback — a different failure (a transient network error, a future regression) could still leave a company without a subscription, and a retry after such a failure would still not be idempotent. ADR-001's decoupling remains the correct structural fix and remains deferred to Version 1.1. The diagnostic company created for this re-certification test has been safely removed, zero orphaned records confirmed.

### D-033 — `forecasts`/`financial_statements` usage metrics are defined in the schema but never actually recorded, undisclosed
- **Category**: Medium
- **Root cause**: Both exist in the type system and the database CHECK constraint, but no code anywhere calls `recordUsageEvent` for either — unlike `api_requests`/`scheduled_jobs`, which are honestly disclosed as unwired gaps in `docs/LICENSING_ENGINE.md`.
- **Impact**: The Usage tab and Commercial Reporting would show these as permanently `0`, silently, with no documentation explaining why.
- **Proposed fix**: Either wire real recording calls into `forecast-service.ts`/`financial-statements-service.ts`'s generate actions, or disclose the gap in `LICENSING_ENGINE.md` alongside the other two.
- **Priority**: Medium.
- **Estimated effort**: Small (wiring) or trivial (disclosure).

### D-034 — Decorative, non-functional controls in the Financial Workspace shell
- **Category**: Low
- **Root cause**: The header search input and sidebar "Collapse" button render with no handlers; the Help icon is a non-interactive `<span>`.
- **Impact**: Minor — reads as obviously decorative rather than implying a broken real capability, but still a real gap against "every search" in the audit's own scope.
- **Proposed fix**: Wire a real global search, real sidebar collapse, and a real Help destination — or remove the controls if not planned for v1.
- **Priority**: Low.
- **Estimated effort**: Medium if built for real (global search is non-trivial); Small if removed.
- **Status: FIXED.** Sidebar Collapse now has real toggle behaviour (icon-only rail, tooltips, rotating chevron) — self-contained chrome state, no backend involved. Search and Help are now honestly disabled (`disabled`/non-interactive, with a tooltip explaining each is not available yet) instead of silently accepting input or implying a destination that doesn't exist. `src/components/financial/workspace-shell.tsx`. Verified `tsc`/`eslint` clean and live in the rendered HTML.

### D-035 — Internal Console's Subscriptions tab has no search/filter/sort/pagination
- **Category**: Medium
- **Root cause**: The table renders every subscription platform-wide with no controls.
- **Impact**: Unusable at scale (hundreds of companies) — not a launch blocker at current real customer volume, but will become one.
- **Proposed fix**: Add search/filter/sort, matching the pattern already used in Transaction Explorer.
- **Priority**: Medium — not urgent at launch, becomes urgent as the customer base grows.
- **Estimated effort**: Small-Medium.

### Note — RLS write-policy scope on new Billing tables matches a pre-existing platform-wide pattern, not a new regression
`subscriptions`/`billing_accounts`' RLS write policies gate on company/organisation membership, not the specific `ManageBilling` permission — meaning a raw client call (bypassing the API route's `requirePermission` check) could theoretically mutate these tables. This audit pass confirmed this is the **codebase's own established, pre-existing convention** (identical pattern in `0007_general_ledger.sql`'s `gl_transactions`/`posting_batches` policies), not something introduced by the Billing Platform specifically. Flagged for product-owner awareness as a platform-wide design characteristic, not filed as a new defect.

---

---

## Executive Dashboard + First-Day Customer Journey (audit pass 7 — final)

### D-036 — Dashboard's Financial Year chip is a hardcoded mock value, ungated by Preview Mode
- **Category**: Medium
- **Root cause**: One `MOCK_COMPANY.financialYear` reference in the Executive Hero was missed when the rest of the Dashboard's mock-leak fixes were made — it renders unconditionally instead of using the already-computed real `currentFinancialYear` (used correctly two lines away in the Executive Summary tile).
- **Impact**: Every production deployment's Dashboard header shows the same fake "FY2025/26" regardless of the company's real financial year.
- **Proposed fix**: Replace the hardcoded chip with the already-computed `currentFinancialYear` value.
- **Priority**: Medium — small fix, but a real, visible fabrication on the most-viewed page in the product.
- **Estimated effort**: Trivial (one-line fix).
- **Status: FIXED** — now renders `currentFinancialYear.yearLabel` (or an honest "Financial Year not set" when none exists), the exact same real value already used correctly elsewhere on the same page. `tsc`/`eslint` clean.

### D-037 — Unsafe double-cast on Copilot Briefing content could throw at render
- **Category**: Low
- **Root cause**: `copilot_briefings.content` is stored/typed as raw `Record<string, unknown>` JSON; the Dashboard casts it directly to `ExecutiveBriefing` with `as unknown as ExecutiveBriefing` and immediately calls `.slice()` on fields assumed to be arrays, with no runtime validation.
- **Impact**: If the briefing-generation shape ever drifts, or a legacy row exists in a different shape, this throws at render time, not compile time.
- **Proposed fix**: Add a runtime shape check (or a Zod-style parse) before using the cast value, falling back to "no briefing available" rather than crashing.
- **Priority**: Low — narrow, single-file fix.
- **Estimated effort**: Small.

### D-038 — Dashboard's "View All Insights" button is dead
- **Category**: Low
- **Root cause**: No `onClick`/`href`.
- **Impact**: Inert in both Preview and live mode.
- **Proposed fix**: Wire to a real destination (likely the AI Copilot page).
- **Priority**: Low.
- **Estimated effort**: Trivial.

### D-039 — Recovery Alerts lose their drill-through link outside Preview Mode
- **Category**: Low
- **Root cause**: `alert.href` is only ever populated on the mock data; the real `listExecutiveAlerts` call never sets it, so the button branch never renders in production — alerts silently degrade to unlinked text.
- **Impact**: A real usability regression specific to live mode (works in the demo, not in production).
- **Proposed fix**: Populate a real `href` per alert type in `listExecutiveAlerts`/its mapping layer.
- **Priority**: Low-Medium.
- **Estimated effort**: Small.

### D-040 — Company creation is now a long unbatched sequential write chain (regressed slightly by the Billing Platform work)
- **Category**: Medium
- **Root cause**: `createCompany` runs ~12+ sequential (not parallelized) writes, ending with the new `subscribeCompanyToPlan` call itself adding 4-5 more sequential writes. No progress feedback beyond a static "Creating…" button state.
- **Impact**: Noticeably more round-trips than before the billing work; not currently broken, but real latency and a real regression pattern this codebase has fixed elsewhere (e.g. the Dashboard's own documented batching fix).
- **Proposed fix**: Parallelize what's genuinely independent (e.g. RBAC seeding and communication-defaults seeding don't depend on each other); at minimum add incremental progress feedback to the UI.
- **Priority**: Medium.
- **Estimated effort**: Small-Medium.

### D-041 — A billing failure during company creation produces a misleading "check the dev server" error
- **Category**: Medium
- **Root cause**: `POST /api/companies` only catches `ValidationError`; any error from `subscribeCompanyToPlan` (e.g. the plan catalog not being seeded) propagates as an uncaught 500, and the client's generic catch-all shows "Couldn't reach the API. Check the dev server is running." regardless of the real cause.
- **Impact**: A real server-side configuration fault would be actively mis-diagnosed by the error message shown to the user.
- **Proposed fix**: Catch billing-specific errors in the route and surface their real message; make the client's fallback message generic ("Something went wrong — try again") rather than dev-server-specific.
- **Priority**: Medium.
- **Estimated effort**: Small.

### D-042 — Trial activation is real but completely silent — no in-app acknowledgment anywhere
- **Category**: Medium
- **Root cause**: A `TrialStarted` billing event is genuinely published on every company creation, but nothing renders it — no Dashboard banner, no notification, nothing. The only place a trial is visible is the Billing page, which a new user has no reason to visit.
- **Impact**: A first-time user has no idea a 14-day trial clock just started.
- **Proposed fix**: Surface a real "Your free trial has started — X days remaining" banner on first Dashboard visit, or ensure the `TrialStarted` event's existing Notification Centre subscriber entry is actually visible to a brand-new user (verify the notification bell surfaces it prominently on day one).
- **Priority**: Medium — directly affects trial-to-paid conversion awareness.
- **Estimated effort**: Small (the event and notification content already exist — this is a visibility/prominence fix, not new plumbing).

### D-043 — Decorative, non-functional Help/Search/Collapse controls present false affordances to a new user
- **Category**: Medium
- **Root cause**: Same root cause as D-034 — no handlers wired.
- **Impact**: Specifically worse for a first-time user than for an experienced one: a new user actively looking for help sees a Help icon and a Search box that both do nothing, which reads as broken rather than simply absent.
- **Proposed fix**: Same as D-034 — wire real functionality or remove the controls.
- **Priority**: Medium (elevated from D-034's Low rating specifically for its first-day-experience impact).
- **Estimated effort**: See D-034.
- **Status: FIXED** — resolved by D-034's fix (same root cause, same commit).

### D-044 — No guidance that a Financial Year must be set up before period-based reporting is meaningful
- **Category**: Medium
- **Root cause**: A Chart of Accounts and default VAT treatments are auto-seeded on company creation (good), but no Financial Year is, and nothing prompts the user to create one. Journal posting is not blocked by a missing Financial Year, so a user can post transactions for weeks before discovering the gap when a period-bounded report doesn't work as expected.
- **Impact**: A real "assumes prior knowledge the UI doesn't explain" gap — discoverable only through failure, not guidance.
- **Proposed fix**: A one-time prompt on an empty Dashboard ("Set up your first Financial Year") linking directly to Settings.
- **Priority**: Medium.
- **Estimated effort**: Small.

## Pre-Launch Blockers pass (pilot administrator account verification)

Found while creating and live-verifying the pilot administrator account (`info@vyronsoft.co.za`) against the real running application — not a static code trace, actual browser/session behaviour.

### D-045 — Login page full-bleed split-panel layout stretches to the viewport edge on wide monitors
- **Category**: Low
- **Root cause**: `src/app/(auth)/login/page.tsx`'s outer `grid-cols-1 lg:grid-cols-2` had no width cap at all, so on a wide monitor the branding pane and the form pane each stretched to half the full viewport — the login card ended up floating in a large expanse of white space rather than reading as a deliberately composed layout.
- **Impact**: Cosmetic, but directly contrary to the "premium feel" standard applied to the rest of the marketing/auth surface.
- **Proposed fix**: Constrain the two-pane grid to a reasonable max-width, centred, with the existing dark canvas background filling the remainder.
- **Priority**: Low.
- **Estimated effort**: Small.
- **Status: FIXED.** Wrapped the grid in an outer `bg-vf-canvas` container and capped it at `max-w-[1200px] mx-auto`. Same visual design, no redesign. Verified live in rendered HTML.

### D-046 — Platform sidebar nav: three pairs of differently-worded items resolve to the identical anchor
- **Category**: Medium
- **Root cause**: `src/components/platform/workspace-shell.tsx`'s `NAV_SECTIONS` had "My Companies"/"Active Clients" both pointing at `/platform#companies`, "Subscriptions & Licences"/"Billing" both at `/platform#subscription`, and "Profile"/"Platform Settings" both at `/platform#profile`.
- **Impact**: A Platform Super Administrator sees six distinctly-labelled nav promises for three real destinations — misleading, not merely redundant.
- **Proposed fix**: Consolidate each pair into one item, labelled to match the real destination's own on-page heading.
- **Priority**: Medium.
- **Estimated effort**: Small.
- **Status: FIXED.** Consolidated to "My Companies," "Subscription & Billing," and "Profile & Platform Settings" — each label now taken verbatim from the real `<CardTitle>` at its anchor (`src/app/platform/page.tsx` lines 195, 294, 334). Verified live: exactly one nav entry per real destination.

### D-047 — Financial Workspace header: company-name chevron implies a company switcher that does not exist
- **Category**: Medium
- **Root cause**: `src/components/financial/workspace-shell.tsx`'s header rendered the company name plus a dropdown-style chevron as a plain `<span>` with no handler and no dropdown anywhere in the codebase — a real Company Switcher component does not exist.
- **Impact**: A misleading affordance (styled exactly like a live control) rather than an honestly absent feature — worse than no chevron at all.
- **Proposed fix**: Either build a real switcher (out of scope — a feature addition, not a defect fix) or wire the existing element to a real, already-existing destination.
- **Priority**: Medium.
- **Estimated effort**: Small (a real destination already exists).
- **Status: FIXED.** Made the company name + chevron a real `<Link href="/platform">` — the actual, already-existing place a user manages/switches between companies. No new feature added; an existing dead control now does the closest correct real thing.

### D-048 — `/platform` Overview crashes with a Runtime Error for any Platform Super Administrator who owns a company
- **Category**: Critical
- **Root cause**: `src/app/platform/page.tsx` runs three per-company billing lookups (`getSubscriptionForCompany`, `getFullUsageSnapshot`, `listBillingEvents`) inside `Promise.all` calls with no error handling. Since the Billing Platform's tables are not yet applied to this database (the same gap tracked as a hard blocker elsewhere in this register), every one of these calls throws for every company the admin owns, and an uncaught rejection inside `Promise.all` fails the entire Server Component render.
- **Impact**: Directly observed live: the pilot administrator account, immediately after signing in (which redirects to `/platform`), hit a full Next.js "Runtime Error" overlay in the browser. This is the single most severe finding in this pass — it fully blocked the Product Review Board's own explicit acceptance criterion ("the application should load directly into the Executive Dashboard without errors") for the exact account this programme exists to verify, for any admin with at least one real company, not an edge case.
- **Proposed fix**: Wrap each per-company billing lookup in try/catch so one company's unavailable billing data degrades gracefully (shown as "—"/no data) instead of crashing the whole page.
- **Priority**: Critical — found and fixed in the same pass under the Product Review Board's own standing exception for a newly discovered production defect.
- **Estimated effort**: Small (three call sites, no schema or business-logic change).
- **Status: FIXED.** All three lookups now degrade per-company on failure; verified live post-fix — `/platform` returns 200 with real content for the pilot administrator account. Full test suite (1146/1146) green afterward.
- **Update — now confirmed exercising the real (not degraded) path**: with migrations `0045`-`0054` applied, the Platform Overview's per-company billing lookups now succeed rather than falling into the fallback this fix added — live-verified showing a real company's actual plan tier ("Free Trial") and lifecycle state ("Trial") rather than "—"/no data. The resilience fix itself remains correct and necessary (a future company-specific billing failure would still degrade gracefully instead of crashing the page), but it is no longer the path every company takes.

### Note — no guided month-end/period-close workflow exists
The Dashboard's "Recovery Health" checklist (Bank Statements Imported → Matching → Journals Generated → Journals Posted → VAT Exceptions Cleared) is a genuinely good, real guided-completion pattern, but doesn't extend to a true period-close ritual (no lock-the-period, run-depreciation, or generate-statements step). Judged **partly inherent** (professional accounting tools legitimately assume some Financial Period/Journal/Trial Balance literacy) and **partly a real, fixable gap** (the team already believes in guided completion elsewhere — extending the same pattern to month-end is consistent with the product's own existing design philosophy, not scope creep). Not filed as a numbered defect — a candidate for real, scoped feature work post-launch, not a pre-launch fix.

---

## Defect Register Summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 5 | D-018/D-028 (billing entitlement backfill — one fix, two symptoms), D-026 (Suggested Merge always broken), D-029 (Console note wrong account), D-030 (Platform Overview fabricated live data), D-048 (`/platform` crash for admins with real companies) |
| High | 6 | D-009 (Financial Period Lock/Reopen unreachable), D-014 (RuleEngineRun never auto-created), D-019 (no Audit Engagement creation UI), D-031 (3 dead Platform Overview buttons), D-032 (non-atomic billing writes — live-confirmed, still open) |
| Medium | 17 | D-010, D-012, D-015, D-016, D-020, D-022, D-027, D-033, D-035, D-036, D-040, D-041, D-042, D-043, D-044, D-046, D-047 |
| Low | 13 | D-011, D-013, D-017, D-021, D-023, D-024, D-025, D-034, D-037, D-038, D-039, D-008, D-045 |
| Nice-to-have | 1 | D-013's cosmetic-only portion |

Fixed in the LR1 audit pass (see `docs/MIGRATION_ROADMAP.md`'s LR1 section for evidence): **D-018/D-028, D-026, D-029, D-030** (Critical) plus **D-036** (Medium, a trivial one-line fix caught in the same pass), per the Product Review Board's own stated exception that a discovered production defect may be fixed even under the "no new capabilities" instruction. D-018/D-028's migration (`0054`) was code-complete at the time; **it is now confirmed applied and live-verified — see the Final Production Re-Certification update below.**

Fixed in the Pre-Launch Blockers pass (pilot administrator account verification, live browser/session testing): **D-048** (Critical), **D-034/D-043** (Low/Medium, same root cause, one fix), **D-045, D-046, D-047** (Low/Medium/Medium). All fixes across both passes verified `tsc`/`eslint` clean and the full test suite green (1146/1146, 148/148 files).

**D-032 was not fixed** — this pass supplied the first live confirmation that its predicted failure mode actually occurs (see D-032's own entry for the duplicate-company evidence), and produced a dedicated architecture review, `docs/ARCHITECTURE_REVIEW_COMPANY_BILLING.md`, recommending a structural fix. The Board accepted that recommendation in principle but deferred it to Version 1.1 (`docs/ADR_001_COMPANY_CREATION_BILLING_DECOUPLING.md`) — **do not treat D-032 as resolved; it remains open for RC1 and Version 1.0**, even though its live trigger condition is now gone (see below).

**Final Production Re-Certification** (migrations `0045`-`0054` confirmed applied to the live database): D-018/D-028 re-confirmed resolved with a real, current `200` from the AI Copilot's `Ask` endpoint, not just historical fix evidence. D-032's live trigger condition (missing tables) is resolved — a real company-creation test completed cleanly on the first attempt — but the underlying architectural finding is unchanged and D-032 stays open per ADR-001's own deferral. D-048's resilience fix is now confirmed exercising its intended happy path (real billing data renders on the Platform Overview) rather than only its fallback path. No new defects found during this pass.

**Zero Critical defects remain open.** All other findings (6 High, 17 Medium, 13 Low, 1 Nice-to-have) are deliberately left open per the "prioritise, don't fix everything" instruction — each has a clear proposed fix and effort estimate above for future work.
