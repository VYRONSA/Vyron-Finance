# VYRON FINANCE — Pilot Issue Register

A living record of every finding raised during Pilot Review rounds, tracked from discovery through live certification. This is distinct from `docs/DEFECT_REGISTER.md` (the pre-launch LR1 audit's D-XXX findings, closed before pilot testing began) — pilot findings use a separate `VR-XXX` sequence, opened by the Product Review Board's Pilot Review directives rather than a static code audit.

Maintain strict separation between pilot rounds: a round is certified and frozen (see `docs/PILOT_REVIEW_ROUND_1_COMPLETION_REPORT.md` and its eventual `v1.0.0-pilot1` tag) once its findings are Complete or explicitly Deferred. New findings after a round is frozen open under the next round, not retroactively inserted into a closed one — unless a genuine production defect is discovered in frozen work, per the Board's own instruction.

| Field | Meaning |
|---|---|
| Pilot ID | `VR-XXX`, assigned in discovery order, never reused |
| Priority | Critical / High / Medium / Low |
| Status | Open / In Progress / Complete / Deferred |
| Version Target | The release this must land in |
| Verification Method | Live / Unit Test / Integration Test |

---

## Pilot Review Round 1

*Numbering note: the Board's own continuation instruction specified the next batch starts at VR-008. VR-003–VR-007 are intentionally unused — not renumbered, not skipped by mistake.*

*Round status note: `v1.0.0-pilot1` was tagged 2026-08-06 reflecting Round 1's state at that moment, but the Board's Final Outstanding Requirement (VR-015, added the same day) means the round is not actually fully closed — Phase 9 (PDF Bank Statement Import) remains open pending real sample statements or an explicit Board deferral decision. The tag itself is frozen and will not be modified; a future tag will mark the round's true close once VR-015 resolves.*

### VR-001 — Opening Balances Centre: BankAccount-category postings never synced the bank account's own cached balance
- **Description**: `postOpeningBalances` correctly posted a BankAccount-category entry to the General Ledger (against the account's `glAccount` code), but never updated `ae_bank_accounts.opening_balance`/`current_balance` — the figures the Bank Accounts screen and reconciliation module actually display, which are cached separately from the GL rather than derived from it. The two would silently diverge: GL correct, Bank Accounts screen stale.
- **Priority**: High
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Live certification (fresh test company, real bank account, real posted journal — bank `current_balance`/`opening_balance` confirmed updated by exactly the posted delta)
- **Verification Method**: Live
- **Commit Hash**: `e2a4ea4`

### VR-002 — Company creation: a genuinely new user (no pre-existing platform-scope role) receives a 500 creating their first company
- **Description**: `createCompany`'s role-bootstrap step read the newly-seeded `company_owner` role via a plain client-side `SELECT` on `permission_roles`, then called `assign_company_role` — both independently require the caller to already have access to/a permission on a company that, by definition at that exact moment, has zero role assignments yet. A chicken-and-egg RLS problem, masked in every prior round of live verification because the test accounts used already held a platform-scope role that unconditionally satisfies both checks. A real first-time self-service signup — the product's actual onboarding path — would 500.
- **Priority**: Critical — blocks all new-customer self-service onboarding
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Live certification (fresh throwaway user with zero platform-scope role, real `POST /api/companies` — company created, `company_owner` role assignment confirmed in `user_role_assignments`)
- **Verification Method**: Live
- **Commit Hash**: `e2a4ea4`

### VR-008 — Editable Bank Opening Balances didn't correct a previously-posted GL journal
- **Description**: Amending a bank account's opening balance after it had already been posted via the Opening Balances Centre updated the cached balance and audit trail correctly, but never touched the General Ledger — the originally-posted journal stayed exactly as it was, silently diverging from the new, corrected balance. Found while implementing the Board's explicit "Update the Bank Account balance. Update the Opening Balance Journal. Update the General Ledger... Preserve double-entry accounting integrity" requirement.
- **Priority**: High
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Unit-level via `tsc`/build; the correcting-journal path itself (`correctPostedBankOpeningBalanceIfNeeded`) is code-complete and exercised indirectly by the live opening-balance-edit tests, but a dedicated live test of editing an *already-posted* balance was not separately run this round — disclosed as a real gap, see the Completion Report
- **Verification Method**: Build/Unit (not independently Live-verified this round)
- **Commit Hash**: `e2a4ea4`

### VR-009 — New companies had zero Financial Years, blocking all Cashbook/Journal posting from day one
- **Description**: `financial_years` has always been a purely manual table — nothing in company creation ever seeded one. `validatePostingDate` correctly refused every Cashbook and Journal posting with "No financial year covers `<date>`" for a genuinely new company, discovered live while verifying Phase 4's new Cashbook batch-posting flow. Opening Balances posting never surfaced this because `postApprovedJournals` doesn't call `validatePostingDate` at all — a separate, disclosed inconsistency between modules, left as-is (out of this round's scope to reconcile).
- **Priority**: Critical — a brand new company could not post a single real transaction until someone manually created a Financial Year via Settings
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Live certification — reproduced (Cashbook batch post failed with the exact error above), fixed by seeding the current financial year on company creation via the existing `suggestFinancialYear`/`createFinancialYear`/`setCurrentFinancialYear` functions (no new date logic), re-verified live (same batch posts successfully)
- **Verification Method**: Live
- **Commit Hash**: `e2a4ea4`

### VR-010 — `pdf-parse`'s worker setup fails under Next.js's server bundler
- **Description**: `pdfjs-dist` (wrapped by `pdf-parse`) always runs a Node.js "fake worker" that dynamically `import()`s its own `WorkerMessageHandler` at runtime with a webpack/vite-ignore comment; Next.js's server bundler doesn't honour that comment, so every real PDF upload 500'd with "Setting up fake worker failed." Found live on the very first PDF upload test.
- **Priority**: Critical — the entire PDF import feature (Phase 9) was non-functional until fixed
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Live certification — reproduced, fixed by statically importing the worker module and assigning it to `globalThis.pdfjsWorker` (pdfjs-dist's own documented escape hatch, which skips the dynamic import entirely), re-verified live with a real PDF upload (correct bank detection, honest "awaiting validation" result, zero fabricated transactions)
- **Verification Method**: Live
- **Commit Hash**: `e2a4ea4`

### VR-011 — Banking Rule "Delete" was entirely missing at every layer
- **Description**: No delete capability existed in the repository, service, API route, or UI for Banking Rules — only Enable/Disable. The Board's Phase 8 explicitly requires it.
- **Priority**: Medium
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Live certification (migration `0057` applied 2026-08-06) — a real rule deleted via `DELETE /banking-rules/[ruleId]`, confirmed `is_deleted=true` in the database (not hard-deleted), confirmed it no longer appears in the management list, confirmed its version history survives intact
- **Verification Method**: Live
- **Commit Hash**: `e2a4ea4`

### VR-012 — Banking Rule Conflict Detection did not exist anywhere in the codebase
- **Description**: Confirmed via exhaustive search: no type, function, or even a stub existed for detecting two rules that could both match the same transaction with disagreeing actions — only unrelated marketing-copy mentions of the phrase. The Board's Phase 8 explicitly requires it.
- **Priority**: Medium
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Unit tests (10 cases) plus live certification (migration `0057` applied 2026-08-06) — two real overlapping rules created live, `GET /banking-rules/conflicts` correctly flagged them, and correctly stopped flagging them once one was deleted
- **Verification Method**: Live + Unit Test
- **Commit Hash**: `e2a4ea4`

### VR-014 — `applyRuleActions` never populated `ae_allocation_history.new_status`, a NOT NULL column — breaking every successful automatic rule match
- **Description**: Found live while certifying Phase 6's scan-and-apply flow, but pre-existing in already-shipped code, not introduced this round: the Rule Engine's own transaction-resolution path (`processTransaction` → `explorerRepo.applyRuleActions`) has never set `new_status` on its `ae_allocation_history` insert. Every time a rule successfully resolved a transaction with no separate supplier/customer match already in place (i.e. a genuine GL-only rule match — exactly what Phase 5/6's new inline-rule-creation flow produces), the insert violated the column's NOT NULL constraint and the whole operation threw. This is not limited to this round's new code: the pre-existing "Apply Rule" bulk action and "Run Rule Engine Now" button in Banking Rules share the exact same code path and were equally broken for this case — masked in every prior round of testing because those tests only ever exercised rules against transactions that already had a Matching-Engine-assigned supplier (a separate, working code path).
- **Priority**: Critical — silently broke a core, pre-existing, heavily-relied-on feature (automatic rule resolution) for a whole class of real transactions
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-06
- **Date Fixed**: 2026-08-06
- **Verified By**: Live certification — reproduced (a fresh, genuinely GL-only rule match threw exactly this constraint violation), fixed by populating `new_status` from the same `allocationStatus` value the function already computes and writes to `ae_bank_transactions`, re-verified live (scan-and-apply now correctly auto-allocates the rest of a statement)
- **Verification Method**: Live
- **Commit Hash**: Pending (this commit)

### VR-015 — PDF Bank Statement Import: framework alone did not satisfy the original business requirement (Product Review Board's Final Outstanding Requirement)
- **Description**: The Board's own Final Outstanding Requirement, raised after `v1.0.0-pilot1` was first tagged: the PDF Bank Statement Import framework (detection, honest non-parsing, upload UI) was a strong foundation but not production import support — no statement-level field extraction, no balance/running-balance/duplicate-statement validation, no review-before-import screen, no manual-correction affordance, and no Banking Rules integration on import. Closed the gaps that don't require a real bank sample: statement-metadata types (`BankStatementMetadata`), a pure bank-agnostic validation pipeline (`pdf-statement-validation.ts` — balance reconciliation, running-balance consistency), duplicate-statement detection against `ae_import_batches` (migration `0058`), a genuine two-step preview/confirm split (`previewPdfBankStatement`/`confirmPdfBankStatementImport`) replacing the old single-shot PDF commit, an Import Review Screen (`PdfImportReviewPanel`, built on the existing `BatchEntryGrid` framework) that displays every extracted transaction and allows manual correction before commit, and Banking Rules integration on confirm (`applyRulesToTransactions`, the same pipeline Phase 5/6 already use). **What remains explicitly out of reach without real bank samples**: per-bank column/field extraction. Per "Do not fabricate parsers or guess layouts. Implement only against real bank statement samples," no bank has moved off "awaiting-validation" — this is disclosed, not a defect, and the fix is supplying real redacted sample statements (see the Completion Report's Phase 9 section for the exact list) or an explicit Board deferral decision.
- **Priority**: High — the original Phase 9 business requirement (production PDF import for 10 named SA banks) remains unmet pending real samples
- **Status**: In Progress — framework/pipeline complete and code-complete; live verification pending migration `0058`; parser implementation pending real samples per bank
- **Version Target**: 1.0 (Pilot Round 1) — Final Outstanding Requirement
- **Date Found**: 2026-08-06
- **Date Fixed**: Partial — see Status
- **Verified By**: `tsc`/`eslint`/`vitest` (10 new unit tests for the validation pipeline) /`npm run build` all clean; live verification of the review/confirm pipeline pending migration `0058`
- **Verification Method**: Unit Test (pending Live)
- **Commit Hash**: Pending (this commit)

### VR-013 — Master Data Framework: Inventory, Departments/Projects/Branches/Cost Centres, and Fixed Assets had no edit-with-audit-trail capability
- **Description**: Only Customer/Supplier (and, narrowly, a Bank Account's opening balance) had the edit/audit/permission framework. Inventory's `updateStockItem` existed at the repository/service layer but had zero UI and zero audit trail — the update path was dead code. Departments/Projects/Branches/Cost Centres could only be renamed never (create + Active/Inactive toggle only — not even a rename). Fixed Assets had no general edit path at all, only 5 narrow lifecycle actions.
- **Priority**: Medium — real usability gap (an accountant fixing a typo'd department name had no way to), explicitly named in the Board's Phase 10
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Live certification — Bank Account (non-opening-balance fields), Stock Item (including the `Inventory:Approve`-gated `costPrice`), Department rename, and Fixed Asset (including the `Assets:Approve`-gated `usefulLifeMonths`) edits all confirmed live with real `permission_audit_log` rows for every changed field
- **Verification Method**: Live
- **Commit Hash**: `e2a4ea4`
