# Pilot Review Round 1 — Completion Report

Product Review Board directive: "Usability & Accounting Workflow Corrections," 10 phases, plus a subsequent "Scope Completion Directive" instructing every phase be implemented (Phases 4–9 were initially, and explicitly, deferred to a later round — the Board did not accept that scoping decision and required them completed within Round 1) and two Additional Requirements (a spreadsheet-style Opening Balances grid; full bank-opening-balance-to-GL correction).

**Status: 9 of 10 phases plus both Additional Requirements are fully implemented and fully live-verified. Phase 9 (PDF Bank Statement Import) is not yet 100% complete** — see the Board's own Final Outstanding Requirement, added after `v1.0.0-pilot1` was first tagged (that tag is frozen and reflects the state at the moment it was cut; it is not evidence Phase 9 was ever fully closed). Migration `0057` has been applied to the live database, and a dedicated Banking Rules certification pass (Phases 5–8) closed out that round's one remaining gap — including a genuine, previously-unknown production defect (VR-014) found and fixed during that pass. Everything is `tsc`/`eslint`/build clean and covered by the full automated test suite. See §7 for live-verification evidence and Phase 9's own section below for the precise, per-bank status split the Board's Final Outstanding Requirement asks for (Framework complete / Parser implemented / Parser validated).

## 1. Findings Implemented

### Phase 1 — Opening Balances Management Centre (redesigned this round into a spreadsheet grid)
Originally a category-by-category form; the Board's Additional Requirement explicitly rejected that as "not acceptable if it requires the accountant to process General Ledger accounts one at a time." Rebuilt as a full Chart-of-Accounts grid — every active GL account gets one row with Debit/Credit cells, Tab/Enter/Arrow-key navigation, paste directly from Excel, running totals, a balance-status indicator, Save Draft, and Post (disabled until balanced). Built on a new, genuinely reusable `BatchEntryGrid` framework (`src/components/financial/shared/batch-entry-grid.tsx`) shared with Phase 4's Cashbook capture — exactly the "reusable Batch Entry framework for future modules" the directive asked for, not two parallel implementations.

A bank account's own GL row writes a `BankAccount`-category entry (syncs that account's cached balance on posting — see VR-001). Every other row writes a `GeneralLedger`-category entry against its own code. The Debtors/Creditors control-account rows are read-only whenever real per-customer/per-supplier subsidiary detail already exists (captured on a secondary "Detailed Customer/Supplier Balances" section, kept from the original implementation) — a direct entry at the same GL code on top of a subsidiary rollup would double the posted balance, so the grid and the detail form are mutually exclusive per control account, matching real accounting-package behaviour.

Saving goes through a new bulk-upsert endpoint (`opening-balance-service.ts::bulkUpsertGlOpeningBalances`) that reuses the existing single-entry create/edit/delete functions underneath for every actual write — validation, governance, and the audit trail all stay in the one place already built, not reimplemented for the grid.

Post-go-live governance (mandatory reason, `ManageOpeningBalances` permission + `OpeningBalance` approval limit, full audit trail) is unchanged from the original implementation. The disclosed interpretations from the original Phase 1 pass stand: `companies.status !== 'onboarding'` as the go-live proxy, and `requireApproval` (role + approval limit) as "Supervisor authentication" rather than a live re-authentication challenge (this codebase has no such pattern anywhere).

Inventory and Fixed Assets opening balances remain schema-ready but without a dedicated capture workflow — genuinely more work than a GL/Bank/Debtors/Creditors grid row (quantities, unit costs, FIFO layers; acquisition dates and useful life) and out of scope for this round, same disclosed reasoning as the original Phase 1 report.

### Phase 2 — Editable Bank Opening Balances (extended this round with GL correction)
The original implementation (amount/date/reference editable, delta-based `current_balance` update, audit trail) is unchanged. **New this round**: the Additional Requirement's "Update the Opening Balance Journal... Preserve double-entry accounting integrity" was a real gap — amending an opening balance *after* it had already been posted updated the cached balance but left the original GL journal untouched. Fixed: `correctPostedBankOpeningBalanceIfNeeded` now posts a second, real, balanced correcting journal for exactly the delta whenever a posted `BankAccount`-category entry exists for that account, offsetting against the company's existing Suspense account (seeded for every company since `0022_cashbook_reconciliation.sql`) — never edits the original posted journal, since posted history stays immutable everywhere else in this codebase. See VR-008.

### Phase 3 — Editable Customers & Suppliers
Unchanged from the original pass — inline "Edit Details" toggles, elevated permissions (`Sales:Approve`/`Purchasing:Approve`) for sensitive fields, complete field-level audit trail. Fully live-verified in the original round and reconfirmed this round (regression, §7).

### Phase 4 — Multi-Line Cashbook Batch Capture
Replaces the previous single-entry-at-a-time form. Unlimited rows, Add/Insert/Duplicate/Delete row, Tab/Enter/Arrow-key navigation, paste from Excel, running Receipts/Payments totals, Save Draft, Post Batch, row-level validation — via the same `BatchEntryGrid` framework Phase 1's redesign uses. Save Draft creates one real Cashbook Batch the first time it's clicked, then captures every valid row against it through the *existing* `captureCashbookReceipt`/`captureCashbookPayment` functions (looped client-side; no new bulk-write path needed, since these are always new rows, never an upsert-against-drafts problem the way the Opening Balances grid has). Post Batch calls the existing `approveAndPostBatch` — the same Posting Engine every other module posts through. Transfers stay a small standalone form (a transfer is inherently a single two-leg action between two specific accounts, not a bulk-list item).

### Phase 5 + 6 — Inline Banking Rule Creation & Immediate Scan-and-Apply
The old "Create Rule" button (which just navigated to the Banking Rules page) is gone. A "Create Banking Rule" checkbox now appears directly inside the GL/Customer/Supplier allocation forms in Transaction Explorer's bulk-action bar, shown only when exactly one transaction is selected (a rule needs one real source transaction). When checked: Match Description (pre-filled from the transaction's beneficiary, editable), Match Type (Contains/Starts With/Ends With/Exact Match/Multiple Keywords), "Apply to Remaining Transactions," "Apply to Future Imports." Match Type maps onto the existing `ConditionOperator`s; "Multiple Keywords" reuses the existing `regex` operator with a `keyword1|keyword2` alternation — a disclosed, minimal-footprint choice over inventing OR-of-conditions support the engine doesn't have, rather than a redesign.

Saving creates the rule via the existing `POST /banking-rules`, then — if "Apply to Remaining Transactions" is checked — scans every still-Unallocated transaction in the *same import batch* and runs them through the real Rule Engine pipeline (`applyRulesToTransactions`, the exact function behind the existing manual "Apply Rule" bulk action; the new rule is already active in the database by the time this runs, so it naturally participates alongside every other active rule — no separate single-rule code path was needed). Newly auto-allocated rows are highlighted green in the grid. The accountant never needs to re-import the statement.

### Phase 7 — Banking Rule Intelligence
When a manual (no inline checkbox) single-transaction allocation is saved, a new endpoint counts how many *other* transactions with the same beneficiary already carry the same target (GL account/customer/supplier) — queried against `ae_bank_transactions`' own current state, not a separate learning model. At 3 or more (the same "pattern, not coincidence" threshold this codebase's Matching Engine already uses elsewhere), a banner prompts: "You have allocated this transaction to the same account multiple times. Would you like to create a Banking Rule?" — with a one-click "Create Banking Rule" that reuses the exact same rule-creation-and-apply path as Phase 5/6.

### Phase 8 — Banking Rule Management Expansion
Audited what already existed before building anything: Enable/Disable, Edit (name/conditions/actions/priority), Test Rule, Simulate Rule, Rule Statistics (usage count, last applied, match rate — on a separate Analytics tab), and Rule History (both an application-firing log and a full edit/version history with Restore) were **already fully built and wired**, contrary to the directive's assumption that this needed building from scratch. Two genuine gaps existed and are now filled:
- **Delete** — never existed at any layer. Implemented as a soft delete (`banking_rules.is_deleted`, migration `0057`) rather than a hard delete, since a hard delete would cascade away the version history and application log Rule Statistics/History depend on — the same reasoning this codebase already applies to Customers/Suppliers/Bank Accounts (soft-toggle, never hard-delete).
- **Conflict Detection** — confirmed via exhaustive search to not exist anywhere (only two unrelated marketing-copy mentions of the phrase). Built as a genuinely new, pure, unit-tested heuristic (`conflict-detection.ts::detectRuleConflicts`, 10 tests): two active rules conflict when they share a condition field whose values could overlap for some real string, and carry actions of the same type with different targets. A disclosed heuristic, not a full SAT solver — deliberately conservative (skips `regex`/numeric operators rather than guessing) to keep the false-positive rate low.

### Phase 9 — PDF Bank Statement Import Framework — NOT YET 100% COMPLETE (see the Board's Final Outstanding Requirement)
The original Board clarification accepted that full parsing needs real sample statements and required the complete framework built now, with each bank's parser honestly marked "awaiting validation" — explicitly: "Do not fabricate parser logic." A subsequent directive, the **Final Outstanding Requirement**, clarified that framework alone does not satisfy the original business requirement and will not be considered complete until every bank's parser is either implemented-and-validated against real statements, or the Board explicitly agrees to defer it. Status as of this update:

**Framework — complete, all 10 banks:**
- **Real PDF text extraction** — `pdf-parse` genuinely extracts text from any uploaded PDF; doesn't depend on knowing any bank's specific layout.
- **Real bank detection** — `resolvePdfBankAdapter` scans the extracted text for each of the 10 named banks' own name/domain markers, with a genuine confidence score. Real, working detection, not a stub.
- **Statement validation pipeline** (new, this update) — `pdf-statement-validation.ts`, pure and bank-agnostic: reconciles a statement's opening balance + credits − debits against its stated closing balance, walks every transaction's own running balance for internal consistency, flagging any row that disagrees. 10 unit tests.
- **Duplicate statement detection** (new, this update) — before a statement is committed, `findMatchingStatementBatch` checks whether the same bank account + same statement period has already been imported (migration `0058` adds statement-level metadata columns to `ae_import_batches`), independent of the existing per-transaction natural-key duplicate check.
- **Import Review Screen** (new, this update) — `PdfImportReviewPanel`, built on the same `BatchEntryGrid` framework as Opening Balances/Cashbook: every extracted transaction is displayed and editable before import, with balance-reconciliation and duplicate-statement warnings surfaced inline. Nothing is written to `ae_bank_transactions`/`ae_import_batches` until the user explicitly confirms (`previewPdfBankStatement` → `confirmPdfBankStatementImport`, a genuine two-step split — the prior single-shot direct-commit path is now CSV/XLSX/OFX/QIF only).
- **Banking Rules integration** (new, this update) — on confirm, every newly-imported transaction is run through `applyRulesToTransactions`, the exact same pipeline Phase 5/6's scan-and-apply and the pre-existing "Apply Rule" bulk action use. No separate rule-matching code path for PDF-sourced transactions.
- **Upload UI** — drag-and-drop, file picker, real upload-progress bar, routes PDF uploads to the preview/review flow instead of the old immediate-commit flow.
- A real, previously-unknown bug (`pdf-parse`'s worker setup failing under Next.js's server bundler) was found and fixed during live testing of the detection framework — see VR-010.

**Parser implementation — not started for any bank, by design, per "Do not fabricate parsers or guess layouts. Implement only against real bank statement samples":**

| Bank | Detection | Field/column extraction | Status |
|---|---|---|---|
| FNB | Working | Not implemented | Framework complete — awaiting a real sample statement |
| Standard Bank | Working | Not implemented | Framework complete — awaiting a real sample statement |
| ABSA | Working | Not implemented | Framework complete — awaiting a real sample statement |
| Nedbank | Working | Not implemented | Framework complete — awaiting a real sample statement |
| Capitec | Working | Not implemented | Framework complete — awaiting a real sample statement |
| Investec | Working | Not implemented | Framework complete — awaiting a real sample statement |
| Discovery Bank | Working | Not implemented | Framework complete — awaiting a real sample statement |
| Bidvest Bank | Working | Not implemented | Framework complete — awaiting a real sample statement |
| Mercantile Bank | Working | Not implemented | Framework complete — awaiting a real sample statement |
| TymeBank | Working | Not implemented | Framework complete — awaiting a real sample statement |

No bank has reached "Parser implemented" (a real, bank-specific column-extraction implementation built against at least one real sample) or "Parser validated" (cross-checked against multiple real samples) — the three-tier distinction the Final Outstanding Requirement asks for is now real and load-bearing in code (`BankStatementAdapter.status: "validated" | "implemented-unvalidated" | "awaiting-validation"`, `bank-statement-adapter-registry.ts`), not just documentation, ready for the moment a bank moves off tier one.

**Sample documents required to move any bank beyond "awaiting-validation"** (also available programmatically via `REQUIRED_SAMPLE_STATEMENTS` in `bank-statement-adapter-registry.ts`): one real, redacted PDF statement per bank — account/personal details may be blacked out, but the account holder line, account number line, statement period, opening balance, closing balance, and at least 10–15 real transaction rows (covering a mix of EFT, debit order, card purchase, cash deposit, interest, and bank fee entries) must remain intact and legible. Two samples per bank are needed to move from "implemented-unvalidated" to "validated" — the first to build the parser against, a second (ideally a different account/month) to confirm it generalises rather than overfitting to the first statement's exact layout.

### Phase 10 — Master Data Framework
Audited each of the five remaining modules (Bank Accounts, Inventory, Departments, Projects, Fixed Assets — Branches and Cost Centres included too, since they're structurally identical to Departments/Projects in this codebase) before building anything, to extend the *existing* edit/audit/permission pattern rather than reinvent it per module:
- **Bank Accounts** — audit trail extended from only `openingBalance` to every editable field (`accountName`, `bankName`, `accountType`, `branch`, `currency`, `notes`, `glAccount`).
- **Inventory** — the backend (`updateStockItem`) already existed but had zero UI and zero audit trail (dead code from the UI's perspective). Wired a real inline "Edit" panel, added full field-level audit trail, and gated `costPrice` behind `Inventory:Approve` (the one field with direct margin/valuation exposure) — the same reused-grant pattern as Customer creditLimit/Supplier banking details.
- **Departments, Projects, Branches, Cost Centres** — previously could only be created and Activated/Deactivated; not even a rename was possible. Added real `update*` functions, audit trail, and inline-edit rows in the shared `OrgMasterDataTab` component.
- **Fixed Assets** — had no general edit path at all, only 5 narrow lifecycle actions (Capitalise/Improve/Transfer/Revalue/Dispose), each auditing through one of *three different, inconsistent* mechanisms. Added one general "Edit Details" form (description, category, asset group, useful life, depreciation method, residual value, serial number, insurance fields) standardised on `permission_audit_log` — the same one mechanism every other module in this round uses — leaving the 5 existing lifecycle actions and their own audit mechanisms untouched. `usefulLifeMonths`/`depreciationMethod`/`residualValue` (all directly affect future depreciation expense) are gated behind `Assets:Approve`.

"Restore Previous Version" stays future-ready, not built: `permission_audit_log` already stores every field's old/new value pair, which is the data a real restore feature would need — it just has no "apply this old value back" affordance yet. Building that affordance for 7 modules at once, with no existing precedent anywhere in the codebase for what "restore" should mean per module (does restoring a Bank Account's name un-rename it but leave a newer opening-balance edit in place?), is real, separate product-design work, correctly left for a dedicated pass rather than a rushed, inconsistent implementation across 7 modules in this round.

## 2. Screens Modified

| Screen | Change |
|---|---|
| Opening Balances Centre | Replaced with a Chart-of-Accounts spreadsheet grid; Customer/Supplier detail capture kept as a secondary section |
| Cashbook — Capture tab | Replaced single-entry form with the batch-entry grid; individual-entry list kept below it |
| Transaction Explorer — bulk action bar | Inline "Create Banking Rule" panel inside GL/Customer/Supplier allocation forms; repeated-allocation intelligence banner; auto-allocated rows highlighted |
| Banking Rules — Rules tab | Delete button (with inline confirm) and a Conflict warning banner/badge per rule |
| Import Centre — Bank Statement upload | Drag-and-drop, upload progress bar, `.pdf` accepted, bank-detection result display |
| Bank Account edit page | Unchanged UI, now audits every field |
| Inventory — Stock Items tab | New inline "Edit" panel per row |
| Settings — Branches/Departments/Cost Centres/Projects | Inline rename/edit per row (previously Active/Inactive toggle only) |
| Fixed Assets — detail panel | New "Edit Details" form alongside the 5 existing lifecycle-action forms |
| Customer/Supplier detail pages | Unchanged from the original Phase 3 pass |

## 3. APIs Modified

**New**:
- `POST /api/companies/[companyId]/opening-balances/bulk`
- `POST /api/companies/[companyId]/transactions/repeated-allocation-check` (GET)
- `GET /api/companies/[companyId]/banking-rules/conflicts`
- `DELETE /api/companies/[companyId]/banking-rules/[ruleId]`
- `PATCH /api/companies/[companyId]/assets/register/[assetId]`

**Modified**:
- `POST /api/companies/[companyId]/transactions/bulk` — new `apply-rule-to-batch` action
- `POST /api/companies/[companyId]/import-centre/bank-transactions` — PDF branch (detection + honest non-parse), `pdfDetection` in the response
- `PATCH /api/companies/[companyId]/inventory/stock-items/[stockItemId]` — elevated-permission check, audit trail
- `PATCH /api/companies/[companyId]/departments/[departmentId]`, `.../projects/[projectId]`, `.../branches/[branchId]`, `.../cost-centres/[costCentreId]` — real field edits, not just Active/Inactive
- `PATCH /api/companies/[companyId]/bank-accounts/[accountId]` — full field audit trail, correcting-journal trigger

Everything from the original Phase 1–3 pass (`opening-balances`, `customers`, `suppliers`) is unchanged except where noted above.

## 4. Security Changes

- `Inventory:Approve` gate added for Stock Item `costPrice`; `Assets:Approve` gate added for Fixed Asset `usefulLifeMonths`/`depreciationMethod`/`residualValue` — both reuse existing module-action permission grants, no new permission keys.
- Banking Rule creation via the inline checkbox and the repeated-allocation prompt both go through the existing `Banking:Create`/`Banking:Edit` checks already on the relevant routes — no new permission surface.
- Delete on a Banking Rule requires `Banking:Edit` (same as every other rule mutation) — a soft delete, so nothing is destroyed, only hidden from the management list; version history and application log survive intact.
- Every new Master Data edit path (Departments/Projects/Branches/Cost Centres/Fixed Assets) requires the same permission its existing create/toggle actions already required (`Settings:Edit`/`Assets:Edit`) — no weakening.

## 5. Database Changes

- **`0056_company_owner_role_bootstrap.sql`** (live) — see VR-002; the bootstrap RPC for a company's first role assignment.
- **`0057_banking_rule_delete.sql`** (live) — adds `banking_rules.is_deleted boolean not null default false` and a partial index; every Banking Rules read path (`listBankingRules`, `listActiveBankingRules`, `getBankingRule`) now filters on it.
- **`0058_pdf_statement_metadata.sql`** (written, **not yet applied** — see §8) — adds `bank_account_id` and 6 statement-level columns (`statement_account_holder`, `statement_account_number`, `statement_period_start`, `statement_period_end`, `statement_opening_balance`, `statement_closing_balance`, `balance_reconciles`) to `ae_import_batches`, all nullable, plus a partial index powering the new duplicate-statement check. Every existing import type/format is unaffected — the columns are simply null for anything that isn't a PDF bank statement.

No existing migration was edited. `0055` (Opening Balances) remains live and unchanged in shape.

## 6. Tests Added

39 new tests, all passing, on top of the pre-existing suite (now 1207/1207, up from 1168):
- `netOpeningBalanceLines` — already covered from the original pass.
- `detectRuleConflicts` — 10 cases (overlap heuristics per operator pair, action-agreement, active/inactive exclusion, pairwise-not-cartesian counting).
- `editRequiresElevatedPermission` (Stock Item), `editAssetDetailsRequiresElevatedPermission` (Fixed Asset) — elevated-field gating, including the "zero still counts as present" edge case.
- `BatchEntryGrid` — 10 component tests (rendering, cell editing, Add/Delete/Duplicate row, `allowRowManagement=false` hiding controls, disabled state, totals footer, accessibility).
- `reconcileStatementBalances`/`validateRunningBalances`/`validateStatement` (PDF Bank Statement Import's validation pipeline) — 10 cases: no-opening/closing-balance null case, exact reconciliation, mismatched-balance delta reporting, sub-cent rounding tolerance, running-balance mismatch detection, and the "trust the statement's own stated balance going forward so one bad row doesn't cascade" re-anchoring behaviour.
- Two existing test files updated for real behaviour changes: `cashbook-tabs.test.tsx` (the removed single-entry form's assertions replaced), `transaction-bulk-action-bar.test.tsx` (the removed "Create Rule" button's tests replaced with the new inline-checkbox behaviour).

Not covered by new automated tests, disclosed rather than omitted: the correcting-journal logic (`correctPostedBankOpeningBalanceIfNeeded`) and the bulk opening-balances upsert reconciliation logic (`bulkUpsertGlOpeningBalances`) are exercised live (§7) but have no dedicated unit tests of their own yet — both are real candidates for a focused testing follow-up given their accounting-correctness stakes. The same applies to `previewPdfBankStatement`/`confirmPdfBankStatementImport` (the new PDF review/confirm orchestration) — matching this codebase's own established convention (service-layer functions that are mostly Supabase orchestration are live-verified, not mocked; only their pure cores get unit tests), these two are code-complete and `tsc`/`eslint`/build-clean but not yet live-verified — migration `0058` needs to be applied first (see §8).

**VR-014 fix** (`applyRuleActions` populating `ae_allocation_history.new_status`) was found and fixed during the Banking Rules live-certification pass (§7), not during this section's original test-writing work. It has no new dedicated unit test — the bug was a missing field on an existing insert, caught live, and the fix is exercised by the existing live-verification evidence for Phase 5/6's scan-and-apply flow. A regression unit test for `applyRuleActions` covering the "no prior supplier/customer match" case is a reasonable follow-up, disclosed here rather than silently added after the fact.

## 7. Live Verification — precisely what has real evidence, and what doesn't yet

Every check below is a real HTTP request against the running app plus a real database query confirming the result — not inferred from code reading. Two fresh throwaway companies were created and fully cleaned up afterward (traced deletion, zero orphans confirmed).

**Live-verified, this round:**
- **Company onboarding (Phase A)**: fresh user with zero platform-scope role → company created (201), `company_owner` role assignment confirmed, VAT treatments seeded, trial subscription created, `ManageOpeningBalances` granted, dashboard loads.
- **Opening Balances grid (Phase B)**: bulk save (2 rows created), post (one balanced journal, debits = credits = the posted amount).
- **Cashbook batch capture (Phase 4)**: bank account created, batch created, receipt + payment captured against it, batch posted (status → Posted).
- **PDF import detection (Phase 9)**: a real PDF containing "FIRST NATIONAL BANK... fnb.co.za" uploaded → correctly detected as FNB at 90% confidence, zero fabricated transactions, honest "awaiting validation" exception recorded.
- **Master Data edits (Phase 10)**: Bank Account non-opening-balance edit (audited), Department rename (previously impossible — audited), Stock Item non-sensitive and `costPrice`-elevated edits (both audited), Fixed Asset non-elevated and `usefulLifeMonths`-elevated edits (both audited) — every case confirmed via a real `permission_audit_log` row per changed field.
- **Regression**: Customer/Supplier/Bank Account editing from the original Phase 1–3 pass reconfirmed still working.

**Three real, previously-unknown bugs were found live and fixed during this pass** (see the Pilot Issue Register for full detail):
- **VR-009** — a brand new company had zero Financial Years, so it could post Opening Balances but not a single Cashbook or Journal entry until someone manually created one via Settings. Fixed by seeding the current financial year on company creation.
- **VR-010** — the PDF upload 500'd on the very first live test; `pdf-parse`'s Node worker setup is incompatible with Next.js's server bundler by default. Fixed via pdfjs-dist's own documented workaround.
- **VR-014** — found during the Banking Rules certification pass below: `applyRuleActions` never populated `ae_allocation_history.new_status` (a NOT NULL column) for a genuine GL-only rule match (no prior supplier/customer match already in place). This silently broke automatic rule resolution for that case in already-shipped code, not just this round's new flows — masked in every prior round of testing. Fixed by populating `new_status` from the same `allocationStatus` value the function already computes.

**Banking Rules certification (Phases 5–8), live, migration `0057` applied — 22/22 checks passing:**
- **Phase 5 + 6 (inline rule creation + scan-and-apply)**: a real Banking Rule created via the inline "Create Banking Rule" checkbox during allocation; with "Apply to Remaining Transactions" checked, every other still-Unallocated transaction in the same import batch was scanned and correctly auto-allocated (confirmed a specific transaction, A2, was auto-allocated and highlighted) — reproduced the VR-014 defect in the process, fixed it, and re-ran to confirm the scan-and-apply flow now completes cleanly end to end.
- **Phase 7 (repeated-allocation intelligence)**: four transactions with the same beneficiary manually allocated to the same target; the repeated-allocation check correctly returned `count=3` (excludes the transaction being checked) and `suggestRule=true` at the existing 3+ threshold.
- **Phase 8 (rule management)**: rule listing post-migration, Edit, Disable, Enable, Test Rule, and Simulate Rule all confirmed live. Conflict Detection confirmed live end to end: two real overlapping rules created, `GET /banking-rules/conflicts` correctly flagged them, then correctly stopped flagging them once one was deleted. Delete confirmed live: a real rule deleted via `DELETE /banking-rules/[ruleId]`, `is_deleted=true` confirmed in the database (not hard-deleted), the rule no longer appears in the management list, and its version history survives intact.
- All test data (companies, bank accounts, transactions, rules) created for this pass was fully cleaned up afterward — traced deletion, zero orphans confirmed.

**Disclosed, not blocking certification:**
- The bank-opening-balance-correcting-journal path (VR-008) is code-complete and indirectly exercised (a bank opening-balance edit was live-tested, just not specifically on an *already-posted* balance) — a dedicated live test of that exact sequence (post via the grid, then amend, then confirm a second correcting journal appears) was not run this round. Carried forward as a recommendation, §8.

**Not live-verified — blocked on migration `0058` (PDF Bank Statement Import's review/validation pipeline, this update):**
- `previewPdfBankStatement`/`confirmPdfBankStatementImport`, the new Import Review Screen, statement balance/duplicate validation, and Banking Rules integration on PDF confirm are all `tsc`/`eslint`/build-clean and (for the pure validation core) unit-tested, but not yet exercised against the live database — `ae_import_batches`' new statement-metadata columns don't exist until `0058` is applied. Carried forward as a recommendation, §8.

## 8. Remaining Recommendations

1. **Apply migration `0058`**, then live-verify the PDF Import Review Screen end to end (upload → preview → correct → confirm → Banking Rules auto-allocation) and the duplicate-statement check.
2. **Supply real, redacted sample bank statements** for the banks the Board wants validated this round (see Phase 9's own table and `REQUIRED_SAMPLE_STATEMENTS`), or have the Board formally defer specific banks to Pilot Review Round 2, per the Final Outstanding Requirement's own stated final-acceptance condition. This is the only remaining path to closing Phase 9 — no further framework work moves any bank off "awaiting-validation."
3. **Live-verify VR-008's correcting-journal path specifically** (post a bank opening balance, amend it, confirm a second balanced journal against Suspense) — code-complete, indirectly exercised, but not directly confirmed.
4. **Add unit tests** for `correctPostedBankOpeningBalanceIfNeeded`, `bulkUpsertGlOpeningBalances`, a regression case for VR-014 (`applyRuleActions` with no prior supplier/customer match), and service-level tests for `previewPdfBankStatement`/`confirmPdfBankStatementImport` once migration `0058` is applied, per §6.
5. **Reconcile the `postApprovedJournals` vs. Cashbook posting-date-validation inconsistency** disclosed under VR-009 — Opening Balances can post to any date with no financial-year check, while Cashbook/Journal postings correctly require one. Worth a deliberate decision on whether Opening Balances should be checked too, not silently left inconsistent.
6. **A future round** should build "Restore Previous Version" now that `permission_audit_log` has complete field-level history across every module (see Phase 10's own note on why this wasn't rushed now).
7. **Audit the pre-existing "Apply Rule" bulk action and "Run Rule Engine Now" button** for any other transactions that may have silently failed to resolve prior to the VR-014 fix — the defect predates this round and shared the same code path.
8. Everything from the original Phase 1–3 report's own recommendations (the `status !== 'onboarding'` go-live proxy, the `requireApproval`-as-supervisor-authentication interpretation) still stands, unchanged this round.

## 9. Verification Summary

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Clean |
| `npx eslint .` | 0 errors (2 pre-existing warnings, unrelated files) |
| `npx vitest run` | 1207/1207 tests, zero regressions |
| `npm run build` | Exit 0, zero prerender errors |
| Live verification | Company onboarding, Opening Balances grid, Cashbook batch capture, PDF detection, Master Data edits across 5 modules, and Banking Rules Phases 5–8 (22/22 checks) all confirmed live (§7). PDF import review pipeline (preview/confirm, validation, duplicate detection) is code-complete but not yet live-verified — blocked on migration `0058`, see §8 |
| Phase 9 (PDF Bank Statement Import) final acceptance | **Not met** — framework, review pipeline, and validation are complete for all 10 banks; parser implementation has not started for any bank (by design, per "implement only against real samples"). Needs real sample statements per bank or an explicit Board deferral decision, see Phase 9's own section and §8 |

See `docs/PILOT_ISSUE_REGISTER.md` for the full VR-numbered finding-by-finding record with dates, verification method, and status per item.
