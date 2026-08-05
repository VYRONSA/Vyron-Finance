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

### VR-001 — Opening Balances Centre: BankAccount-category postings never synced the bank account's own cached balance
- **Description**: `postOpeningBalances` correctly posted a BankAccount-category entry to the General Ledger (against the account's `glAccount` code), but never updated `ae_bank_accounts.opening_balance`/`current_balance` — the figures the Bank Accounts screen and reconciliation module actually display, which are cached separately from the GL rather than derived from it. The two would silently diverge: GL correct, Bank Accounts screen stale.
- **Priority**: High
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Live certification (fresh test company, real bank account, real posted journal — bank `current_balance`/`opening_balance` confirmed updated by exactly the posted delta)
- **Verification Method**: Live
- **Commit Hash**: Pending (Commit 2)

### VR-002 — Company creation: a genuinely new user (no pre-existing platform-scope role) receives a 500 creating their first company
- **Description**: `createCompany`'s role-bootstrap step read the newly-seeded `company_owner` role via a plain client-side `SELECT` on `permission_roles`, then called `assign_company_role` — both independently require the caller to already have access to/a permission on a company that, by definition at that exact moment, has zero role assignments yet. A chicken-and-egg RLS problem, masked in every prior round of live verification because the test accounts used already held a platform-scope role that unconditionally satisfies both checks. A real first-time self-service signup — the product's actual onboarding path — would 500.
- **Priority**: Critical — blocks all new-customer self-service onboarding
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Live certification (fresh throwaway user with zero platform-scope role, real `POST /api/companies` — company created, `company_owner` role assignment confirmed in `user_role_assignments`)
- **Verification Method**: Live
- **Commit Hash**: Pending (Commit 2)

### VR-008 — Editable Bank Opening Balances didn't correct a previously-posted GL journal
- **Description**: Amending a bank account's opening balance after it had already been posted via the Opening Balances Centre updated the cached balance and audit trail correctly, but never touched the General Ledger — the originally-posted journal stayed exactly as it was, silently diverging from the new, corrected balance. Found while implementing the Board's explicit "Update the Bank Account balance. Update the Opening Balance Journal. Update the General Ledger... Preserve double-entry accounting integrity" requirement.
- **Priority**: High
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Unit-level via `tsc`/build; the correcting-journal path itself (`correctPostedBankOpeningBalanceIfNeeded`) is code-complete and exercised indirectly by the live opening-balance-edit tests, but a dedicated live test of editing an *already-posted* balance was not separately run this round — disclosed as a real gap, see the Completion Report
- **Verification Method**: Build/Unit (not independently Live-verified this round)
- **Commit Hash**: Pending (Commit 2)

### VR-009 — New companies had zero Financial Years, blocking all Cashbook/Journal posting from day one
- **Description**: `financial_years` has always been a purely manual table — nothing in company creation ever seeded one. `validatePostingDate` correctly refused every Cashbook and Journal posting with "No financial year covers `<date>`" for a genuinely new company, discovered live while verifying Phase 4's new Cashbook batch-posting flow. Opening Balances posting never surfaced this because `postApprovedJournals` doesn't call `validatePostingDate` at all — a separate, disclosed inconsistency between modules, left as-is (out of this round's scope to reconcile).
- **Priority**: Critical — a brand new company could not post a single real transaction until someone manually created a Financial Year via Settings
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Live certification — reproduced (Cashbook batch post failed with the exact error above), fixed by seeding the current financial year on company creation via the existing `suggestFinancialYear`/`createFinancialYear`/`setCurrentFinancialYear` functions (no new date logic), re-verified live (same batch posts successfully)
- **Verification Method**: Live
- **Commit Hash**: Pending (Commit 2)

### VR-010 — `pdf-parse`'s worker setup fails under Next.js's server bundler
- **Description**: `pdfjs-dist` (wrapped by `pdf-parse`) always runs a Node.js "fake worker" that dynamically `import()`s its own `WorkerMessageHandler` at runtime with a webpack/vite-ignore comment; Next.js's server bundler doesn't honour that comment, so every real PDF upload 500'd with "Setting up fake worker failed." Found live on the very first PDF upload test.
- **Priority**: Critical — the entire PDF import feature (Phase 9) was non-functional until fixed
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Live certification — reproduced, fixed by statically importing the worker module and assigning it to `globalThis.pdfjsWorker` (pdfjs-dist's own documented escape hatch, which skips the dynamic import entirely), re-verified live with a real PDF upload (correct bank detection, honest "awaiting validation" result, zero fabricated transactions)
- **Verification Method**: Live
- **Commit Hash**: Pending (Commit 2)

### VR-011 — Banking Rule "Delete" was entirely missing at every layer
- **Description**: No delete capability existed in the repository, service, API route, or UI for Banking Rules — only Enable/Disable. The Board's Phase 8 explicitly requires it.
- **Priority**: Medium
- **Status**: Complete (code) — pending live certification, blocked on migration `0057` (adds `banking_rules.is_deleted`) being applied
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Pending live certification once migration `0057` is applied
- **Verification Method**: Build/Unit confirmed; Live pending
- **Commit Hash**: Pending (Commit 2)

### VR-012 — Banking Rule Conflict Detection did not exist anywhere in the codebase
- **Description**: Confirmed via exhaustive search: no type, function, or even a stub existed for detecting two rules that could both match the same transaction with disagreeing actions — only unrelated marketing-copy mentions of the phrase. The Board's Phase 8 explicitly requires it.
- **Priority**: Medium
- **Status**: Complete (code) — pending live certification, blocked on migration `0057`
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Unit tests (10 cases covering overlap heuristics, action-agreement, active/inactive, pairwise counting); Live pending migration `0057`
- **Verification Method**: Unit Test; Live pending
- **Commit Hash**: Pending (Commit 2)

### VR-013 — Master Data Framework: Inventory, Departments/Projects/Branches/Cost Centres, and Fixed Assets had no edit-with-audit-trail capability
- **Description**: Only Customer/Supplier (and, narrowly, a Bank Account's opening balance) had the edit/audit/permission framework. Inventory's `updateStockItem` existed at the repository/service layer but had zero UI and zero audit trail — the update path was dead code. Departments/Projects/Branches/Cost Centres could only be renamed never (create + Active/Inactive toggle only — not even a rename). Fixed Assets had no general edit path at all, only 5 narrow lifecycle actions.
- **Priority**: Medium — real usability gap (an accountant fixing a typo'd department name had no way to), explicitly named in the Board's Phase 10
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Live certification — Bank Account (non-opening-balance fields), Stock Item (including the `Inventory:Approve`-gated `costPrice`), Department rename, and Fixed Asset (including the `Assets:Approve`-gated `usefulLifeMonths`) edits all confirmed live with real `permission_audit_log` rows for every changed field
- **Verification Method**: Live
- **Commit Hash**: Pending (Commit 2)
