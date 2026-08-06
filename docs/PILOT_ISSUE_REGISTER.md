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

*Round status note: `v1.0.0-pilot1` was tagged 2026-08-06 reflecting Round 1's state at that moment, but the Board's Final Outstanding Requirement (VR-015) and Additional Requirement (VR-016), both added the same day and both with same-day follow-ups, mean the round is not actually fully closed — Phase 9 (PDF Bank Statement Import) remains open: FNB's parser is `implemented-unvalidated` pending the actual PDF file (not yet accessible to this session), and 9 of 10 banks remain `awaiting-validation` pending real sample statements or an explicit Board deferral decision. Purchase Processing multi-line capture (VR-016, now covering both Bills/Credit Notes/Debit Notes and Purchase Orders) is code-complete pending migrations `0059` and `0060`. The tag itself is frozen and will not be modified; a future tag will mark the round's true close once VR-015/VR-016 resolve.*

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
- **Description**: The Board's own Final Outstanding Requirement, raised after `v1.0.0-pilot1` was first tagged: the PDF Bank Statement Import framework (detection, honest non-parsing, upload UI) was a strong foundation but not production import support — no statement-level field extraction, no balance/running-balance/duplicate-statement validation, no review-before-import screen, no manual-correction affordance, and no Banking Rules integration on import. Closed the gaps that don't require a real bank sample: statement-metadata types (`BankStatementMetadata`), a pure bank-agnostic validation pipeline (`pdf-statement-validation.ts` — balance reconciliation, running-balance consistency), duplicate-statement detection against `ae_import_batches` (migration `0058`, applied), a genuine two-step preview/confirm split (`previewPdfBankStatement`/`confirmPdfBankStatementImport`) replacing the old single-shot PDF commit, an Import Review Screen (`PdfImportReviewPanel`, built on the existing `BatchEntryGrid` framework) that displays the full statement header (account holder, account number, statement period, opening/closing balance) plus every extracted transaction and allows manual correction before commit, and Banking Rules integration on confirm (`applyRulesToTransactions`, the same pipeline Phase 5/6 already use).
  - **Follow-up round (same day)**: the Board reported the Import Centre still rejected PDFs with a bare "Unsupported file type," meaning none of the above was actually reachable end-to-end. Root-caused live: a dev server process left running from earlier in the session was serving pre-preview compiled routes, not a code defect in the committed code — confirmed by killing the stale process, rebuilding clean, and live-testing the real upload flow (see Verified By). While investigating, also built the first real, bank-specific parser (FNB — `parsers/fnb-bank-statement-parser.ts`), constructed and unit-tested against a genuine FNB Platinum Business Account statement the Board supplied in-conversation; added "missing transactions" (cross-checked against a bank's own printed transaction count, where one exists) and "invalid values" validation; and replaced the single generic PDF-rejection message with a taxonomy (password-protected, scanned-image, corrupted, bank-not-supported/format-not-recognised) per the Board's own "Unsupported PDFs" requirement.
  - **Honest scope of the FNB parser**: marked `implemented-unvalidated`, not `validated` — built and live-verified against a synthetic PDF constructed to match the real statement's text shape, not the literal real PDF file's bytes through the actual `pdf-parse` extraction pipeline. A genuine text-fidelity gap was found and disclosed while building it (a real row's description is dropped in the rendered text form available for review, only visible in the statement's image) — the parser was built defensively because of this, but full "validated" status needs the actual PDF file itself.
  - **Second follow-up (same day)**: the Board confirmed the `implemented-unvalidated` marking is correct and explicitly instructed not to promote it to `validated` until tested against the actual PDF file. Checked the local filesystem (scratchpad, project directory, Downloads) for it — **not found**; only the statement's rendered text/image content is available in this conversation, not the file itself. This is a genuine external dependency, not something resolvable from this session alone — see the Completion Report's Phase 9 section and the final summary for what's needed from the Board to close this out.
- **Priority**: High — the original Phase 9 business requirement (production PDF import for 10 named SA banks) remains unmet for 9 of 10 banks, pending real samples; FNB itself remains unmet pending the actual file
- **Status**: Complete for the framework/review/validation/error-handling work and the FNB parser's code-complete-and-live-verified-on-synthetic-data state; genuinely Open for the other 9 banks (no samples yet) and for FNB's final "validated" status (blocked on the actual file being made accessible, not just its text)
- **Version Target**: 1.0 (Pilot Round 1) — Final Outstanding Requirement
- **Date Found**: 2026-08-06
- **Date Fixed**: 2026-08-06 (framework/review/validation/error-handling + FNB parser); ongoing for the other 9 banks
- **Verified By**: `tsc`/`eslint`/`vitest` (16 new FNB parser tests + 10 new validation-pipeline tests, 26 total)/`npm run build` all clean. Live: a synthetic FNB-format statement uploaded through the real running app → correctly detected, parsed into 2 real transactions with correct sign/balance math, validated (balance reconciliation, transaction count, zero invalid values all passing), reviewed, confirmed, committed to `ae_bank_transactions` with full statement metadata persisted to `ae_import_batches`, and run through the Banking Rules engine — all confirmed via direct database queries, not inferred.
- **Verification Method**: Live + Unit Test
- **Commit Hash**: `35e9c92`, `7608294`, `e587050`

### VR-016 — Purchase Processing: Bills/Credit Notes/Debit Notes AND Purchase Orders had no multi-line capture (Product Review Board's "Additional Requirement: Purchase Processing" + "Final Outstanding Items" item 1)
- **Description**: `ae_imported_bills` has never had a line-items table (imported bills never had one either) — a Purchasing-entered Bill/Credit Note/Debit Note was a single flat record: one net amount, one GL account, one VAT treatment. The Board's Additional Requirement is explicit: unlimited lines, each independently allocated to a GL account, VAT code, cost centre, project, department, with its own description/quantity/unit cost/discount, captured entirely before posting. Added a new `ae_purchase_bill_lines` child table (migration `0059`, **not yet applied**), a `BatchEntryGrid`-based capture screen replacing the old flat form, and `buildMultiLineBillJournal` for posting (one debit line per distinct line GL account plus aggregated VAT Input/Creditors Control lines). The legacy single-amount path (imported bills) is untouched.
  - **Follow-up (same day)**: the Board clarified the requirement applies equally to Purchase Orders, not just Bills — this codebase's Purchasing module has no screen literally called "Purchases"; confirmed with the Board this means the **Purchase Orders tab**. Extended `purchase_order_lines` with the same GL/VAT/cost-centre/project/department/discount dimensions (migration `0060`, **not yet applied**) and replaced its bespoke line-array form with the same `BatchEntryGrid` used by Bills — GL/VAT stay optional on a PO line (Purchase Orders never post to the GL, by design; this is budgetary/commitment data). `createBillFromOrder` now builds a real multi-line Bill directly from a dimensioned order's own lines (same GL accounts, VAT codes, allocations) instead of collapsing them into one number — the natural consequence of both documents now being multi-line — falling back to the original single-subtotal behaviour for any order with an undimensioned line. The shared per-line net/VAT/total arithmetic was extracted into `purchasing/line-amounts.ts` so both screens use one tested core, not duplicated math.
- **Priority**: High — explicit Board requirement, confirmed as a joint Certification Requirement alongside VR-015's PDF work
- **Status**: Code-complete, unit-tested, `tsc`/`eslint`/build clean for both Bills and Purchase Orders; **live verification blocked on migrations `0059` and `0060`** — confirmed live for both: the creation request reaches the database and fails honestly with "table/column not found," not a code-path error, isolating exactly what's pending
- **Version Target**: 1.0 (Pilot Round 1) — Additional Requirement
- **Date Found**: 2026-08-06
- **Date Fixed**: Code-complete 2026-08-06 (Bills); code-complete 2026-08-06 (Purchase Orders, same-day follow-up); live verification pending both migrations
- **Verified By**: `tsc`/`eslint`/`vitest` (9 tests for `computeBillLine`, 4 for `computeLineAmounts`, 9 for `computeOrderLine` and Purchase Order status transitions — 22 total)/`npm run build` all clean. Live: company/supplier/chart-of-accounts/VAT-treatment/posting-rule setup and both the bill-creation and order-creation requests confirmed reaching the real API and service layer correctly — the only failures are the missing table/columns, which migrations `0059`/`0060` resolve.
- **Verification Method**: Unit Test (pending Live)
- **Commit Hash**: `1ea14b0`, `436ae33`

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
