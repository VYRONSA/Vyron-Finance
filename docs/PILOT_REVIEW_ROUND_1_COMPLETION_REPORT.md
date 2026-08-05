# Pilot Review Round 1 — Completion Report

Product Review Board directive: "Usability & Accounting Workflow Corrections," 10 phases. **This report covers Phases 1, 2, and 3, fully implemented and verified.** Phases 4 through 9 were deliberately not attempted this round — see §7, Remaining Recommendations, for why and what's needed to do them properly rather than shallow.

## 1. Findings Implemented

### Phase 1 — Opening Balances Management Centre
A new module supporting General Ledger, Bank Accounts, Customers (Debtors), Suppliers (Creditors), VAT Control, and Loans & Other Liabilities. Every entry is a real, structured row — never a bare number — and posts through the exact same shared Posting Engine every other module uses (`createJournal` → `postApprovedJournals`), never a parallel path. Posting a batch of draft entries creates **one real, balanced journal**: Customer/Supplier entries roll up into the company's real Debtors/Creditors control accounts (standard accounting practice — the GL never carries individual subsidiary balances), Bank Account entries resolve to each account's own GL code, and General Ledger/VAT Control/Loan entries post directly against the Chart of Accounts code selected. The system refuses to post an unbalanced set rather than silently forcing balance with an unrequested suspense line.

Opening balances remain freely editable during implementation. After a company goes live (`companies.status !== 'onboarding'` — see the disclosed interpretation note below), every create/edit/delete requires the new `ManageOpeningBalances` permission, a mandatory reason, and passes through `requireApproval` against a new `OpeningBalance` approval-limit category — exactly the same reusable approval-limit mechanism this codebase already uses for Journal/SupplierPayment/CustomerCreditNote/PurchaseApproval/AssetDisposal, not a new bespoke gate. Every change (created, edited, deleted, posted) is recorded to the existing `permission_audit_log` — original value, new value, user, reason, and timestamp, live-queryable, not a new audit mechanism.

**Inventory and Fixed Assets are schema-ready but have no dedicated capture workflow in the UI yet** — the data model accepts either category, but building a real per-item/per-asset opening-balance workflow (quantities, unit costs, FIFO layers for Inventory; acquisition dates and useful life for Fixed Assets) is materially more work than the other six categories and was correctly scoped out of this round rather than built shallow. The directive itself marked Fixed Assets "(future ready)," which this implementation takes literally.

**Disclosed interpretation, not an assumption hidden from the reader**: there is no dedicated "has this company gone live" flag on `Company` today. `status !== 'onboarding'` is used as the practical proxy for the post-go-live governance gate. This is a real limitation worth a deliberate product decision — a company that never has its status changed from other legitimate reasons, or is deliberately kept in "onboarding" past its real go-live date, would not get the governance protection the directive asks for. A dedicated `goLiveDate`/`openingBalancesLockedAt` column is the cleaner long-term fix, not built here to avoid a schema change beyond what this round's scope required.

**Also disclosed**: the directive's "Require Supervisor authentication" was researched carefully before implementation — this codebase has no live re-authentication challenge pattern anywhere (no "enter a second person's password" flow). The existing, real, reusable mechanism is `requireApproval`: the *acting* user's own role must carry the `ManageOpeningBalances` permission and a sufficient `OpeningBalance` approval limit. This is a deliberate, disclosed interpretation — not a live supervisor challenge — reusing an existing, proven pattern rather than inventing session-model changes this round's scope didn't call for.

### Phase 2 — Editable Bank Opening Balances
Previously create-only (confirmed by reading the code before touching it, not assumed). Bank Accounts now support editing the Opening Balance amount, Date, and Reference after creation. Changing the amount automatically shifts `current_balance` by the exact delta (never recalculated from scratch, so every real transaction and reconciliation movement already posted against the account is preserved). The same post-go-live governance gate as Phase 1 applies, and every change is recorded to the audit trail.

### Phase 3 — Editable Customers & Suppliers
Research before implementation found the backend (`updateCustomer`/`updateSupplier`, validation, PATCH routes) was **already fully built** — this was a real, working capability with no UI ever exposing it, exactly matching the known limitation already disclosed in `docs/SUPPORT_TROUBLESHOOTING_GUIDE.md`. An inline "Edit Details" toggle was added to both Customer and Supplier detail pages, covering every field the directive named (name, contact-adjacent fields, VAT/registration numbers, payment terms, credit limits, banking details, categories, sales rep, notes).

**Sensitive fields require elevated permission**, reusing existing RBAC grants rather than a new permission key: changing a Customer's Credit Limit requires `Sales:Approve` (already held by Sales Manager and above, not base Sales Clerks); changing a Supplier's banking details requires `Purchasing:Approve` (already held by Purchasing Manager and above) — the field class with genuine payment-fraud exposure. Every field change is recorded to the audit trail with old value, new value, user, reason, and timestamp — live-verified to cover every editable field, not a hand-picked subset (see §4).

**One real, pre-existing defect fixed in passing**: `supplier-management-service.ts::updateSupplier` had no existence pre-check before writing — a nonexistent or cross-tenant supplier id would have thrown a raw, uncaught 500 instead of a clean 404 (the exact bug class `customer-service.ts` was already fixed for during an earlier certification pass, never applied to the supplier side). Fixed to match.

## 2. Screens Modified

| Screen | Change |
|---|---|
| Customer detail page (Overview tab) | Inline "Edit Details" toggle covering every editable field |
| Supplier detail page (Overview tab) | Inline "Edit Details" toggle, with a visually distinct Banking Details section |
| Bank Account edit page | New "Opening Balance" section: amount, date, reference, conditional "Reason for change" |
| Financial Workspace navigation | New "Opening Balances" item |
| **New**: Opening Balances Centre | Category-aware add-entry form, live balance/debit/credit totals, entry table, Post Opening Balances action |

## 3. APIs Modified

**New**:
- `GET/POST /api/companies/[companyId]/opening-balances`
- `PATCH/DELETE /api/companies/[companyId]/opening-balances/[entryId]`
- `POST /api/companies/[companyId]/opening-balances/post`

**Modified**:
- `PATCH /api/companies/[companyId]/customers/[customerId]` — elevated-permission check for Credit Limit, reason/performedBy threaded through
- `PATCH /api/companies/[companyId]/suppliers/[supplierId]` — elevated-permission check for banking fields, `NotFoundError` → 404 now handled, reason/performedBy threaded through
- `PATCH /api/companies/[companyId]/bank-accounts/[accountId]` — opening balance fields, governance-gated approval check

## 4. Security Changes

- New global permission `ManageOpeningBalances`, granted to Financial Manager, Financial Director, Managing Director, and Company Owner (mirroring exactly how `ManageBilling` was granted in an earlier phase) — plus the two platform-scope roles.
- New approval-limit category `OpeningBalance`, seeded with the same capped/unlimited pattern already used for Journal and the other four existing categories (Financial Manager capped at R500,000; Financial Director/Managing Director/Company Owner unlimited).
- Elevated-permission gates added for Customer Credit Limit (`Sales:Approve`) and Supplier banking details (`Purchasing:Approve`) — reusing existing grants, no new permission keys for these two.
- **Live-verified, not assumed**: every audited field change was queried directly from `permission_audit_log` after a real API call and confirmed correct (see §6) — the first pass of this work actually missed several fields (`industry`, `customerGroup`, `notes`, `currencyCode`, `priceList` on Customer; `defaultGlAccount`, `defaultVatCode`, `supplierCode`, `supplierCategory`, `supplierType` on Supplier) from the audit-trail list. Found during live testing, not by inspection, and fixed to cover every editable field — disclosed here specifically because it demonstrates why the live-verification step mattered, not just the build/type checks.

## 5. Database Changes

New migration `0055_opening_balances_management.sql` (not yet applied to the live database — see §8):
- New table `opening_balance_entries` (company-scoped, RLS via the existing `user_can_access_company()` pattern, a database-level check constraint enforcing that each row's target reference matches its declared category).
- Two new columns on `ae_bank_accounts`: `opening_balance_date`, `opening_balance_reference` (additive only — the existing `opening_balance` column and its semantics are untouched).
- Widened `role_approval_limits.category` check constraint to add `'OpeningBalance'`.
- New idempotent function `grant_manage_opening_balances_defaults()`, mirroring the existing `grant_manage_billing_to_company_owner()` precedent exactly — grants the new permission to a company's senior roles, called once per existing company (backfill) and from `createCompany` for every company created from now on.

No existing migration was edited — this codebase's standing discipline (forward-only, corrective migrations only as new files) was followed.

## 6. Live Verification — what was actually run against the real database, and what wasn't

**Live-verified** (real HTTP requests against the running app, real database queries confirming the result, not inferred):
- Created a real test company end-to-end.
- Created a real Customer and edited both a normal field (Industry) and the elevated field (Credit Limit) — both succeeded, both correctly recorded to the audit trail.
- Created a real Supplier and edited both a normal field (Category) and elevated fields (full banking details) — both succeeded, both correctly recorded.
- Edited a real Bank Account's opening balance — `current_balance` correctly recalculated by the delta, correctly recorded to the audit trail.
- **A real defect was found and fixed during this process**: the audit trail's field coverage was incomplete on first pass (see §4) — corrected and re-verified live afterward.
- **A second, more significant real defect was found and fixed**: the new `grantManageOpeningBalancesDefaults` call added to `createCompany` broke company creation entirely (`500`) in this environment, because its migration (`0055`) is not yet applied here — the exact D-032 failure class already documented in `docs/DEFECT_REGISTER.md` (a new step in `createCompany` failing without being resilient to that failure). Fixed by making the call non-blocking, matching the precedent already established for exactly this class of problem. Re-verified live afterward: company creation succeeds again.
- All test data (one company and everything it seeded) was safely removed afterward using the same traced-deletion method established earlier in this engagement — zero orphaned records confirmed.

**Not live-verified — code-complete and build-verified only**: the Opening Balances Centre itself (creating entries, posting a batch journal) requires migration `0055`'s new table, which is **not yet applied to the live database**. I have a real database connection string (shared in this conversation for a different, narrower purpose — restoring `.env.local`) that could apply it, but applying a new migration to your live database is a more consequential action than what was explicitly authorized, so I did not do it without asking. **Let me know if you'd like me to apply migration `0055` now** — once applied, the Opening Balances Centre becomes immediately testable the same way Customer/Supplier editing was.

## 7. Tests Added

**None.** This is a real gap, disclosed plainly rather than omitted: this round relied on live manual verification (§6) and the existing 1146-test regression suite (confirmed still passing, zero regressions) rather than new automated unit/integration tests for the new Opening Balances service logic (account-code resolution, balance-check validation, governance gating) or the Customer/Supplier audit-trail wiring. Given the accounting-correctness stakes of the posting logic in particular (`postOpeningBalances`'s control-account rollup and balance validation), dedicated unit tests — matching this codebase's own established pure-core-testing convention — are a genuine near-term follow-up, not optional polish.

## 8. Remaining Recommendations

**Before this round is considered fully closed**:
1. Apply migration `0055` and live-verify the Opening Balances Centre itself (creating entries across all six UI-supported categories, posting a real balanced journal, confirming the resulting `gl_transactions` rows) — pending your go-ahead per §6.
2. Add unit tests for `opening-balance-service.ts`'s pure-enough logic (account resolution, balance validation) before this ships further, per §7.
3. Make a real product decision on the "go-live" proxy disclosed in §1 (`status !== 'onboarding'`) rather than leaving it as an interpretation.

**Deliberately not attempted this round, for a subsequent round — not shallow versions**:
- **Phase 4 (Multi-Line Cashbook Batch Capture)**: a genuine spreadsheet-grade UI framework (keyboard navigation, copy/paste from Excel, row-level validation, draft/post) — explicitly meant to become "the reusable Batch Entry framework for future modules." Building this shallow would produce exactly the wrong foundation for something meant to be reused.
- **Phases 5–7 (Banking Rules workflow redesign, intelligence, management expansion)**: a cohesive UX rework of an existing, complex, heavily-used flow (Transaction Explorer/Matching allocation) — real behavioural-learning logic (Phase 6) and a meaningfully expanded management surface (Phase 7) deserve their own focused round.
- **Phase 8 (Native PDF bank statement import for 10 South African banks)**: the largest single item in the entire directive — PDF text/layout extraction, per-bank format handling, and pre-import validation (statement totals, duplicate detection, date overlaps) is a specialized, multi-stage effort with real financial-accuracy risk if rushed. Deserves dedicated scoping, not inclusion as one of ten items in a single pass.
- **Phase 9 (Master Data Framework unification)**: Phase 3 establishes the real edit/audit pattern (inline toggle, elevated permissions for sensitive fields, complete field-level audit trail) that Bank Accounts, Inventory, Assets, Projects, and Departments should follow — but extending it to all five is real, additional work, not a checkbox against Phase 3's own completion.

## 9. Verification Summary

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Clean |
| `npx eslint .` | 0 errors (2 pre-existing warnings, unrelated files) |
| `npx vitest run` | 1146/1146 tests, 148/148 files, zero regressions |
| `npm run build` | Exit 0, zero prerender errors |
| Live verification | Customer, Supplier, and Bank Account editing all confirmed working end-to-end against the real database, including audit trail correctness; Opening Balances Centre itself pending migration application (§6) |

27 files touched: 10 new, 17 modified. Full list available via `git status` — not duplicated here to keep this report readable.
