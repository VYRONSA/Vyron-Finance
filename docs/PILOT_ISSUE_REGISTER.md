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

*Round status note: `v1.0.0-pilot1` was tagged 2026-08-06 reflecting Round 1's state at that moment, but the Board's Final Outstanding Requirement (VR-015) and Additional Requirement (VR-016), both added the same day, mean the round is not actually fully closed. The Board's subsequent Final Certification round (same day, migrations `0059`/`0060` applied) live-certified Purchase Processing in full (VR-016 — Bills/Credit Notes/Debit Notes/Purchase Orders, including a genuine "Correct editing" gap found and fixed, VR-017), re-certified Bank Opening Balances and Banking Rules with zero regressions, and re-verified the PDF import workflow's plumbing end to end. **The Board then attached both real FNB PDF files directly** (`PLATINUM_BUSINESS_ACCOUNT_278.pdf`, `BUSINESS_STATEMENT (1).pdf`) — running the actual parser against the actual files (not a reconstruction) found and fixed two more real defects (VR-018: 14 real credit transactions silently dropped from the Platinum statement; VR-019: the Business Credit Card statement had no parser support at all, now built) and one schema gap (VR-020: 6 required header fields with nowhere to be stored, migration `0061` written). **The Board then applied migration `0061`** and asked for one final verification pass: storage of all 6 new fields confirmed live for both real files (VR-020, complete); investigating the Business Credit Card statement's disclosed R205.12 reconciliation gap found and fixed a genuine, generalisable sign-convention defect in the shared validator (VR-021 — it assumed every statement is an asset, wrong for a credit-card liability), after which the residual (R336.48) was demonstrated, to the cent, to exactly match the statement's own separately-printed "Credit Balance" for one cardholder whose activity isn't netted into the account-level "Amount Owing" (VR-019, fully explained, not left as an open question). FNB extraction is now confirmed correct against both real files — 212/212 transactions exactly matching the Platinum statement's own printed totals, balance reconciling exactly; 132/132 transactions for the Business Credit Card statement, independently cross-validated on the debit side against three separately-printed totals, with its own reconciliation now fully explained and demonstrated in code (`checkFnbCreditCardReconciliation`, surfaced live on the Import Review Screen). See the Completion Report's Final Certification Verdict for the precise, per-area breakdown. The `v1.0.0-pilot1` tag itself is frozen and will not be modified; a future tag will mark this round's true close.*

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
  - **Final certification round (same day)**: the Board reported migrations `0059`/`0060` applied and stated two real FNB PDF files had been supplied (Platinum Business Account, Business Credit Card) as the certification data set, with explicit instruction not to assume the parser is correct and to compare every extracted value against the actual documents. **Checked again for the files — still not found** on the local filesystem or attached to the certification message itself. Re-ran the full import workflow live against a synthetic FNB-format statement instead to confirm the surrounding pipeline has no regressions (18/18 checks: parser selection, statement validation, metadata extraction, duplicate detection on first upload AND on re-upload of the same statement, review-screen correction preserved through confirm, transaction creation, Banking Rules engine invocation, and the imported rows surfacing through the same `ae_bank_transactions` query Transaction Explorer/Matching use) — all passing. **The one thing this cannot do without the actual file**: compare extracted values against the real document, which is the specific, explicit requirement for promoting FNB to `validated`. This remains open pending the Board making the actual file accessible (not just describing it as supplied) — a file path in the project's scratchpad directory, or a re-attachment that persists to disk, would resolve it immediately.
- **Priority**: High — the original Phase 9 business requirement (production PDF import for 10 named SA banks) remains unmet for 9 of 10 banks, pending real samples; FNB itself remains unmet pending genuine file access
- **Status**: Complete for the framework/review/validation/error-handling work, the FNB parser's code-complete-and-live-verified-on-synthetic-data state, and the full import-workflow pipeline (live-verified three times now with zero regressions); genuinely Open for the other 9 banks (no samples yet) and for FNB's final "validated" status (blocked on the actual file being made genuinely accessible — described as supplied twice now, not yet actually reachable by this session)
- **Version Target**: 1.0 (Pilot Round 1) — Final Outstanding Requirement
- **Date Found**: 2026-08-06
- **Date Fixed**: 2026-08-06 (framework/review/validation/error-handling + FNB parser); ongoing for the other 9 banks and FNB's final validation
- **Verified By**: `tsc`/`eslint`/`vitest` (16 FNB parser tests + 10 validation-pipeline tests, 26 total)/`npm run build` all clean. Live: three independent full-pipeline runs against synthetic FNB-format statements, most recently 18/18 checks including duplicate-statement detection on re-upload and confirmation that Transaction Explorer/Matching's own query surfaces the imported rows — all via direct database queries, not inferred.
- **Verification Method**: Live + Unit Test
- **Commit Hash**: `35e9c92`, `7608294`, `e587050`

### VR-016 — Purchase Processing: Bills/Credit Notes/Debit Notes AND Purchase Orders had no multi-line capture (Product Review Board's "Additional Requirement: Purchase Processing" + "Final Outstanding Items" item 1)
- **Description**: `ae_imported_bills` has never had a line-items table (imported bills never had one either) — a Purchasing-entered Bill/Credit Note/Debit Note was a single flat record: one net amount, one GL account, one VAT treatment. The Board's Additional Requirement is explicit: unlimited lines, each independently allocated to a GL account, VAT code, cost centre, project, department, with its own description/quantity/unit cost/discount, captured entirely before posting. Added a new `ae_purchase_bill_lines` child table (migration `0059`, **not yet applied**), a `BatchEntryGrid`-based capture screen replacing the old flat form, and `buildMultiLineBillJournal` for posting (one debit line per distinct line GL account plus aggregated VAT Input/Creditors Control lines). The legacy single-amount path (imported bills) is untouched.
  - **Follow-up (same day)**: the Board clarified the requirement applies equally to Purchase Orders, not just Bills — this codebase's Purchasing module has no screen literally called "Purchases"; confirmed with the Board this means the **Purchase Orders tab**. Extended `purchase_order_lines` with the same GL/VAT/cost-centre/project/department/discount dimensions (migration `0060`, **not yet applied**) and replaced its bespoke line-array form with the same `BatchEntryGrid` used by Bills — GL/VAT stay optional on a PO line (Purchase Orders never post to the GL, by design; this is budgetary/commitment data). `createBillFromOrder` now builds a real multi-line Bill directly from a dimensioned order's own lines (same GL accounts, VAT codes, allocations) instead of collapsing them into one number — the natural consequence of both documents now being multi-line — falling back to the original single-subtotal behaviour for any order with an undimensioned line. The shared per-line net/VAT/total arithmetic was extracted into `purchasing/line-amounts.ts` so both screens use one tested core, not duplicated math.
  - **Final certification round (same day)**: migrations `0059`/`0060` applied. Live certification (28/28 checks) found one real gap — **no editing capability existed for a Draft Bill or Purchase Order's lines at all**, only Submit/Approve/Cancel — a direct miss against the certification's explicit "Correct editing" requirement. Fixed immediately per the stop-fix-retest instruction: `updateBillLines`/`updateOrderLines` (Draft-only, full line-set replacement, header totals recomputed from scratch), API `update-lines` actions, and UI edit panels reusing the same `BatchEntryGrid` — see VR-017. Re-ran the full 28-check pass after the fix, including editing a Draft bill's lines, confirming a Posted bill correctly rejects editing, and editing a Draft Purchase Order before submission — all passing.
- **Priority**: High — explicit Board requirement, confirmed as a joint Certification Requirement alongside VR-015's PDF work
- **Status**: Complete — live-certified end to end for Bills, Credit Notes, Debit Notes, and Purchase Orders, including multi-line create, edit, submit, approve-and-post with correct multi-GL-account journal creation, and PO-to-Bill conversion with exact line pass-through
- **Version Target**: 1.0 (Pilot Round 1) — Additional Requirement
- **Date Found**: 2026-08-06
- **Date Fixed**: 2026-08-06
- **Verified By**: `tsc`/`eslint`/`vitest` (22 unit tests: `computeBillLine`, `computeLineAmounts`, `computeOrderLine`, Purchase Order status transitions)/`npm run build` all clean. Live (28/28 checks against the real database): Bill multi-line create (correct net/VAT/total), edit (old lines fully replaced, not appended, header roll-up recomputed), submit + approve + post (a real 5-line journal — 3 distinct expense debit lines, 1 aggregated VAT Input debit, 1 aggregated Creditors Control credit — balanced, total 1322.50), editing a Posted bill correctly rejected (400), Credit Note and Debit Note creation via the same screen, Purchase Order multi-line create + edit, submit + approve, and PO-to-Bill conversion producing a Bill with the exact same 2 lines (matching edited quantities, GL accounts, VAT codes) rather than a collapsed single amount.
- **Verification Method**: Live + Unit Test
- **Commit Hash**: `1ea14b0`, `436ae33`, `d3dbb2b`

### VR-017 — Purchase Processing: no way to edit a Draft Bill's or Purchase Order's lines after creation
- **Description**: Found live during the final Purchase Processing certification pass — a genuine, confirmed gap, not a documentation oversight: `bills-tab.tsx`/`purchase-orders-tab.tsx` only ever offered Submit/Approve/Cancel (Reject for orders)/Retry-Posting actions on an existing document; there was no way to change a line's GL account, VAT code, quantity, cost centre/project/department, or add/remove a line once the document existed, even while still in Draft. Directly contradicts the certification's explicit "Correct editing" requirement. Fixed the same session, before continuing certification, per the Board's own stop-fix-retest instruction: `updateBillLines`/`updateOrderLines` (only a Draft document is editable — once Submitted a Bill is in the approval workflow, once Approved/Posted a real journal exists, and once Approved/Received a Purchase Order may already have a GRN or Bill referencing its lines by id), a new `update-lines` PATCH action on both `.../bills/[billId]` and `.../orders/[orderId]`, and new UI edit panels reusing the exact same `BatchEntryGrid` the create flow uses.
- **Priority**: High — directly named in the certification's own requirement list, found only because the certification pass was run against the real database rather than assumed
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1) — found and closed during Final Certification
- **Date Found**: 2026-08-06
- **Date Fixed**: 2026-08-06
- **Verified By**: Live — a Draft bill's 2 lines edited to 3 lines with a changed quantity, header total recomputed correctly (1322.50); attempting to edit the same bill after it was Posted correctly rejected with a 400; a Draft Purchase Order's line quantity edited and confirmed persisted before submission. Included in the 28/28 Purchase Processing certification pass.
- **Verification Method**: Live
- **Commit Hash**: `d3dbb2b`

### VR-018 — FNB PDF parser: 14 real credit transactions silently dropped (space before "Cr" in the real PDF's text layer)
- **Description**: Found live during the genuine-file certification round, once the Board's two real FNB PDF files were finally made accessible to this session (`PLATINUM_BUSINESS_ACCOUNT_278.pdf`, `BUSINESS_STATEMENT (1).pdf`, both attached directly). Running the actual parser against the actual PDF's own `extractPdfText` output (not the earlier chat-reconstructed text) showed only 198 of the statement's own printed 212 transactions extracted, and balance reconciliation failing by exactly the statement's own printed total credit amount (R3,524,738.43) — i.e. every one of the 14 credit rows was missing, not just some. Root cause: the real PDF prints a credit row's "Cr" marker with a space before it ("10,000.00 Cr"), while the parser's `TRAILING_AMOUNTS` regex required it directly appended ("10,000.00Cr") — true of the earlier chat-reconstructed text this parser was originally built against, but not of the real file's own text layer. Every credit row therefore failed to match the row pattern at all and was silently skipped.
- **Priority**: Critical — a direct, exact violation of the certification's own "No missing transactions" and "opening/closing balances reconcile" requirements, on the genuine certification data set
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1) — Final Certification round
- **Date Found**: 2026-08-06
- **Date Fixed**: 2026-08-06
- **Verified By**: Live, against the actual PDF file via this app's own `extractPdfText`/parser/API pipeline (not a reconstruction): after the fix, extraction is 212/212, exactly matching the statement's own printed "Turnover for Statement Period" footer (14 credit transactions totalling R3,524,738.43, 198 debit transactions totalling R3,323,468.25); balance reconciliation passes exactly (delta 0); every running-balance check passes (0 issues, down from 9); the last extracted row's own running balance matches the statement's printed Closing Balance exactly. Confirmed end-to-end via the real API: preview → confirm → 212 real `ae_bank_transactions` rows created, batch recorded in `ae_import_batches` with `balance_reconciles: true`. Re-uploading the identical file a second time correctly detected as a duplicate.
- **Verification Method**: Live
- **Commit Hash**: Pending (this commit)

### VR-019 — FNB PDF parser: the "FNB Business Credit Card" statement (the second real file in the certification data set) had no parser support at all
- **Description**: The Board's certification data set names two real FNB statement types — "FNB Platinum Business Account" and "FNB Business Credit Card" — but only the first had ever been built against. The Business Credit Card statement is a structurally different document: a multi-cardholder control account (several named cardholders, each with their own card limit and sub-balance, rolling up into one control-account "Amount Owing"), no per-transaction running-balance column at all, no "Statement Period" line, and a page-1 letterhead where labels ("Statement Date"/"Statement Number"/"Payment Due Date") and their values extract as two separate, non-adjacent blocks (a PDF paint-order artifact). Run against the existing FNB parser, this file was correctly *detected* as FNB but genuinely could not be parsed — it would have returned the honest "not yet covered" exception with zero transactions. Built a new, dedicated parser (`fnb-credit-card-statement-parser.ts`) and registered it as a separate adapter (`fnb-credit-card-pdf`, routed ahead of the generic FNB adapter via a more specific "BUSINESS CREDIT CARD" content marker, since both statement types share FNB's own generic letterhead text). Two further real defects were found and fixed while building it, both confirmed against the real bytes: (1) this statement's thousands separator is a plain space ("1 426.54"), not a comma — a naive comma-only amount regex silently truncated amounts and corrupted descriptions; (2) the statement prints the same 5 "Balance Transferred" internal consolidation amounts a second time at the very end, re-labelled by cardholder name instead of "Balance Transferred" — left unexcluded, this would have double-counted those 5 amounts as extra fake transactions.
  - **Final verification pass (same day)**: investigating the residual R205.12 reconciliation gap (first found this round, disclosed as unresolved) traced it to a real, confirmed, generalisable defect in the shared validator, not the extraction — see VR-021. After that fix, the residual is exactly R336.48, which precisely and demonstrably matches this statement's own printed "Credit Balance" (independently printed twice: page 1's whole-account summary and, separately, one specific cardholder's own "Card Total" — the only one of 6 cards whose activity nets into a credit rather than a debit). This control account reports "Credit Balance" and "Amount Owing" as two distinct, un-netted fields rather than one incorporating the other — i.e. one cardholder's credit isn't offset against what the rest of the account owes. `checkFnbCreditCardReconciliation` (new, `fnb-credit-card-statement-parser.ts`) demonstrates this arithmetic explicitly and is now wired into the live review screen, which shows a clarifying badge instead of a bare "danger" alert for this specific, evidenced case.
- **Priority**: High — one of the two documents in the Board's own certification data set was entirely unparseable before this fix
- **Status**: Complete — extraction confirmed complete and accurate; the reconciliation variance is fully explained and demonstrated, not merely noted
- **Version Target**: 1.0 (Pilot Round 1) — Final Certification round
- **Date Found**: 2026-08-06
- **Date Fixed**: 2026-08-06
- **Verified By**: Live, against the actual PDF file, twice this round (once before and once after the VR-021 sign-convention fix). Extracts 132 real transactions (144 raw date-prefixed candidate lines in the source text, minus 2 false-positive matches from the header's "9 April"/"14 April" values, minus 5 "Balance Transferred" internal rows, minus 5 name-labelled duplicates of those same 5 rows — 132 exactly, no row unaccounted for). The 120 debit transactions' total (R110,243.08) exactly matches THREE independent figures printed elsewhere on the same statement (the Expense Summary table's own "Total Expenses" and "Charges" column totals). All 12 credit transactions match the raw text's own "Cr"-suffixed lines 1:1. After the sign-convention fix, `opening + debits - credits + Credit Balance = closing` holds exactly to the cent (R35,143.08 + R336.48 = R35,479.56), confirmed live via the real API (preview → confirm → 132 real `ae_bank_transactions` rows, batch's `balance_reconciles: false` correctly recorded since the raw formula still shows a delta, alongside a `reconciliationExplanation` field confirming `explainedByUnnettedCardholderCredit: true`).
- **Verification Method**: Live + Unit Test
- **Commit Hash**: `5151667`, plus this commit

### VR-020 — PDF Bank Statement Import: statement metadata schema had no room for 6 of the Board's own required header fields
- **Description**: The Board's header field list for PDF Bank Statement Import names Account Holder, Account Number, Statement Number, Statement Period, Statement Date, Opening Balance, Closing Balance, Credit Limit, Available Balance, Interest information, VAT, and Fees. `BankStatementMetadata` (and the `ae_import_batches` columns migration `0058` added) only ever had room for 6 of these — Statement Number, Credit Limit, Available Balance, Interest, VAT, and Fees had nowhere to go, for either FNB statement type. Extended the type with 6 new nullable fields, updated both FNB parsers to extract them (confirmed against the real bytes — e.g. the Platinum statement's "Overdraft Limit" mapped to Credit Limit, its 4 separately-printed "Bank Charges" lines summed to a Fees total; the Business Credit Card statement's own "Credit Limit"/"Credit Balance"/"Vat on Fees" fields extracted directly), added the fields to the Import Review Screen, and wrote migration `0061` to persist them.
  - **Final verification pass (same day)**: the Board applied migration `0061` to the live database. Re-ran both real files end to end — all 13 statement-metadata columns (the original 7 plus these 6) confirmed correctly stored in `ae_import_batches` for both statements, with the exact extracted values (e.g. Platinum: statement_number "278", statement_credit_limit 1,500,000, statement_vat 431.82, statement_fees 3,310.60; Business Credit Card: statement_number "254", statement_credit_limit 59,000, statement_available_balance 336.48, statement_vat 60.32).
- **Priority**: Medium — a real, confirmed gap against the certification's own explicit field list, but purely additive/informational (not used by balance reconciliation, duplicate detection, or posting)
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1) — Final Certification round
- **Date Found**: 2026-08-06
- **Date Fixed**: 2026-08-06
- **Verified By**: `tsc`/`eslint`/`vitest` (15 new parser tests) all clean. Extraction confirmed correct against real bytes for both statement types. Storage confirmed live against the actual database, post-migration: a direct `select` of all 13 statement-metadata columns for both real-file batches returned the exact expected values.
- **Verification Method**: Live + Unit Test
- **Commit Hash**: `5151667`, plus this commit

### VR-021 — PDF Bank Statement Import: `reconcileStatementBalances` applied a universal asset-account sign convention, silently wrong for a liability (credit-card) statement
- **Description**: Found while investigating VR-019's disclosed R205.12 reconciliation gap. `pdf-statement-validation.ts`'s `reconcileStatementBalances`/`validateRunningBalances` unconditionally computed `opening + credits - debits = closing` for every statement type — correct for a bank/cheque account (an asset: a credit, money in, increases the tracked value), but backwards for a credit card (a liability: a debit, a new charge, increases what's owed; a credit, a payment, decreases it). Confirmed to the cent against the real Business Credit Card statement: the asset-convention formula computed R35,684.68 (R205.12 too high); the correct liability-convention formula computes R35,143.08 (only R336.48 off, and THAT residual is itself fully explained — see VR-019). Fixed by adding an optional `balancePolarity: "asset" | "liability"` field to `BankStatementMetadata` (absent/null defaults to `"asset"`, so every existing bank-account-style parser is unaffected), branching both validation functions on it, and having the new credit-card parser set `"liability"`.
- **Priority**: High — a real, confirmed, generalisable defect (not specific to this one statement) that silently misreconciled any future liability-type statement, not just this one
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1) — Final Certification round
- **Date Found**: 2026-08-06
- **Date Fixed**: 2026-08-06
- **Verified By**: Unit tests (2 new `reconcileStatementBalances`/`validateRunningBalances` cases confirming the liability formula; 2 new `checkFnbCreditCardReconciliation` cases). Live: re-ran the real Business Credit Card file through the actual API after the fix — `validation.balanceReconciliation.expectedClosingBalance` changed from R35,684.68 (wrong, asset convention) to R35,143.08 (correct, liability convention), confirmed via the real preview response, not inferred.
- **Verification Method**: Live + Unit Test
- **Commit Hash**: `0ce2b0a`

### VR-023 — Company Dashboard: production SSR crash, "ReferenceError: DOMMatrix is not defined"
- **Description**: Production build crashed rendering `/company/[companyId]/dashboard` — a page that never parses a PDF — with a browser-only `pdfjs-dist` API evaluated during SSR. Traced precisely: the dashboard imports `listRecentImports` from `import-service.ts`, which statically imported `pdf-text-extraction.ts` (directly, and again via `bank-statement-adapter-registry.ts`), which statically imported `pdf-parse` and `pdfjs-dist`'s worker at module top level — pulling the entire PDF toolchain into the dashboard's SSR module graph regardless of whether PDF parsing is ever invoked. Local `next dev` never reproduced it; only a real production build did.
- **Priority**: Critical — broke a core, unrelated page in production
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-06
- **Date Fixed**: 2026-08-06
- **Verified By**: Live, against a real local production build (`next build && next start`) with a real authenticated session hitting the actual dashboard route — 200, full page render, no error.
- **Verification Method**: Live
- **Commit Hash**: `3fa674e`

### VR-024 — FNB PDF parser: `extractPdfText` detaches the caller's own `ArrayBuffer`, breaking the second of two calls per import request
- **Description**: Found while root-causing VR-025 (below). `pdfjs-dist`'s `getDocument()` detaches the underlying `ArrayBuffer` it's handed (its fake-worker transfer simulation) — a real, confirmed bug independent of any deployment environment. `extractPdfText` is called twice per PDF import request (once for bank detection in `previewPdfBankStatement`, once again inside the resolved adapter's own `parse()`), both times with the identical buffer reference; the second call failed with "Cannot perform Construct on a detached ArrayBuffer" once the first had already consumed it.
- **Priority**: Critical — blocked every PDF import, not statement-type-specific
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-06
- **Date Fixed**: 2026-08-06
- **Verified By**: Live, against a real local production build — confirmed the exact "detached ArrayBuffer" error via temporary diagnostic logging, fixed by slicing an independent copy from the still-intact caller-owned buffer on every call, re-confirmed the same request succeeding afterward (132/132 transactions).
- **Verification Method**: Live
- **Commit Hash**: `44d6182`

### VR-025 — PDF Bank Statement Import: HTTP 500 in production only — six compounding deployment-environment defects, none reproducible in `next dev` or a local production build
- **Description**: After VR-023/VR-024 were fixed and every local verification passed (including a full local production build), PDF import still 500'd on the actual deployed Vercel site. Root-caused by making the API route surface real error detail instead of a bare 500 (temporary, reverted once diagnosed) and querying the live deployed API directly — the only way to see what was actually happening, since this session has no Vercel dashboard/log access. Six distinct, compounding causes, each confirmed live against the real deployment before being fixed, not guessed:
  1. `pdf-parse`'s package.json `"exports"` map has three competing conditions ("browser"/"import"/"require") for its bare `.` specifier; its browser build alone has 14 unguarded top-level `DOMMatrix` references (confirmed by inspecting the built output — the "import"/"require" conditions' own builds have none). Turbopack's runtime loader for `serverExternalPackages`-listed packages resolved the ambiguous specifier to the browser condition on Vercel specifically, for both `import()` and `require()` (via `createRequire`) — confirmed live both ways.
  2. `pdf-parse`'s own `./node` subpath export exists but doesn't expose its `PDFParse` class at all (only header-reading helpers), so there was no unambiguous alternative entry point within the package itself. Fixed by dropping `pdf-parse` entirely and calling `pdfjs-dist` directly via deep import paths, reimplementing `pdf-parse`'s own text-extraction algorithm exactly (`lineThreshold: 4.6`, `cellSeparator: '\t'`, `lineEnforce: true`, the `-- N of Total --` page marker) so the FNB parsers' carefully-tuned regexes kept working against an identical text shape — verified byte-for-byte equivalent output against both real files.
  3. Even `pdfjs-dist`'s own deep `legacy/build/pdf.mjs` path (no package.json `exports` field at all, ruling out condition ambiguity) crashed identically through Turbopack's `serverExternalPackages` loader — confirmed live, ruling out `pdf-parse`'s package structure as the cause entirely.
  4. Removing `serverExternalPackages` let Turbopack bundle `pdfjs-dist` normally instead — but Turbopack's own bundling *transformation* of that content then crashed at module-evaluation time with the same error, a genuine Turbopack bug (or at minimum an unsupported pattern) with this specific file, not anything about the package or this codebase — the exact same file imports cleanly with zero errors in plain Node.js every single time it was tested.
  5. Building both `pdfjs-dist` import specifiers from concatenated string segments at runtime (rather than plain literals) made Turbopack skip static analysis of these two imports entirely, avoiding the bundling crash — but this also defeated Vercel's own deployment file-tracing, which relies on the same static analysis to know a dependency needs to be included in the deployed function: "Cannot find package 'pdfjs-dist'" at runtime. Fixed by adding `outputFileTracingIncludes` (Next's own documented mechanism for exactly this situation) to force-include `pdfjs-dist`'s files independently of specifier literalness.
  6. The actual, final root cause once every deployment/bundling issue above was resolved: `pdfjs-dist/legacy/build/pdf.mjs` unconditionally constructs `new DOMMatrix()` at true module top level (confirmed by reading the exact source line the production stack trace itself pointed to) — true in every `pdfjs-dist` build, legacy and modern both checked, regardless of which API is ever called. Node.js has no native `DOMMatrix`. `pdfjs-dist` already ships its own official mechanism for this — not a polyfill this codebase wrote — `@napi-rs/canvas`, one of `pdfjs-dist`'s own `optionalDependencies`, providing a real N-API-native `DOMMatrix` implementation it auto-detects. Present locally (installed automatically alongside `pdfjs-dist`, explaining why every local test passed) but its platform-specific native binary sub-package needed the same `outputFileTracingIncludes` help Next's own docs show for other native-binary packages (`sharp`, `aws-crt`) to actually reach the deployed function.
- **Priority**: Critical — the PDF import feature was completely non-functional in production despite being fully certified against a local build; per the Board's own framing, "the code may exist, but the feature is not working in production, therefore it is not complete"
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-06
- **Date Fixed**: 2026-08-06
- **Verified By**: Live, directly against the deployed production API (`vyron-finance-v3y1.vercel.app`) after every fix, not inferred from local success — the actual failure mode changed with each fix, confirming each was real and the next was genuinely different, not a repeat. Final state confirmed with a full real-file round trip against production: both real FNB PDFs (Platinum 212/212, Business Credit Card 132/132) preview (200) and confirm (201) successfully; duplicate re-upload correctly detected; Dashboard/Cashbook/Transaction Explorer/Banking Rules pages all load (200); 344 real transactions confirmed in the live database via a direct query; a corrupted PDF correctly returns 400 with a specific message, never a bare 500.
- **Verification Method**: Live
- **Commit Hash**: `e55b0cc`, `ae147ab`, `e983aa6`, `05b2604`, `d1a6438`, `84a4a31`

### VR-022 — Transaction Explorer: the data grid pushed the entire page wider instead of scrolling internally
- **Description**: Board-reported. A classic flexbox overflow bug in `workspace-shell.tsx` — the one shared layout every page in the workspace renders inside, not something specific to Transaction Explorer. Both flex items wrapping page content (`<div className="flex flex-1 flex-col">` holding the header+main, and `<main>` itself) lacked `min-width: 0`; a flex item's default `min-width` is `auto`, which lets it grow to fit its widest descendant rather than respecting the row's available width. Transaction Explorer's 17-column grid was wide enough to trigger it, so its overflow propagated all the way up through the shell's flex row (sidebar + content) to the document itself, instead of being caught by the grid's own `overflow-x-auto` container (which already existed and was already correctly scoped — the bug was entirely about ancestors upstream of it not constraining their own width).
- **Priority**: High — broke the primary transaction-review screen's usability
- **Status**: Complete
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-06
- **Date Fixed**: 2026-08-06
- **Verified By**: Live — full test suite (1276/1276) and production build clean; fetched the actual rendered Transaction Explorer page HTML against 212 real imported transactions and confirmed the fix's classes are present in the output; Dashboard, Cashbook, Import Centre, Banking Rules, and Reconciliation all confirmed still rendering (200) with the shell-level change, satisfying "ensure no other pages have the same layout problem" by construction (one shared shell, one fix). This session has no browser automation tooling available, so pixel-level visual scrolling behaviour was not directly screenshotted — disclosed, not glossed over; the fix itself is the standard, well-established CSS solution for this exact overflow pattern (`min-width: 0` on a flex item to allow it to shrink below its content size).
- **Verification Method**: Live
- **Commit Hash**: `8135279`

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
