# Rule Engine hardening — Phases 5A, 5B, 5C, 5D and 5E

Local implementation only. Nothing here has been committed, deployed or applied to
production. Builds on migration 0100 (`docs/ATOMIC_RULE_ENGINE_POSTING.md`).

Phase 5C (below, §11 onwards) closes the posting-permission gaps on Apply Rule,
Import and manual BankSync, wires the bounded mechanism into Import and BankSync,
and records the analysis for the items deliberately NOT changed (Run Scheduler Now,
database role checks, Cashbook, Generate Journal).

Phase 5D (section 21 onwards) fixes the pre-existing `/platform/operations`
production-build failure and closes the Run Now task-state gap 5C reported.

Phase 5E (section 29 onwards) closes the last weaker-permission posting path,
"Run Scheduler Now", and corrects the task-type classification (RecurringTemplate
posts accounting).

## 1. Approved accounting-policy decisions (owner, 2026-09-17)

These PRESERVE current production behaviour. They are not an independent validation that
the treatment is correct; each remains subject to a separate accounting review.

| # | Decision | Where it is enforced |
|---|---|---|
| 1 | A Supplier/Customer-only rule keeps posting to the transaction's existing `suggested_gl_account` (for "Future AI" rows, the AI's suggestion). No classify-only and no control-account variant is built. The 21 Metanoia and 2 Northwood rows this affects today, and the 117 historical Metanoia postings made this way, are not changed. | `rule-processing-service.ts::processTransaction` (resolvedGlAccount starts from the suggestion); `journal-service.ts::resolveTransactionGlAccount` (assigned account before any control account). Documented beside `DEFAULT_RULE_ENGINE_POSTING_POLICY`. |
| 2 | Rule Engine journals stay dated on the run date. The `transaction-date` switch exists locally for testing; its default is OFF. Existing journals are not re-dated. | `DEFAULT_RULE_ENGINE_POSTING_POLICY.journalDate = "run-date"` |
| 3 | No exception type blocks posting (UnknownMerchant, PossibleDuplicate, LargeUnusualPayment included). The blocking list stays EMPTY; exceptions are informational unless explicitly configured. | `DEFAULT_RULE_ENGINE_POSTING_POLICY.blockingExceptionTypes = []` |
| 4 | Historical postings are not corrected — including transactions 1374, 1394, 1587 and 1666. No repair script is written. Any correction needs a separate accounting review and explicit authorization. | — |
| 8 | No database-level role-permission checks yet (see §6). | — |

Outcome logging: the per-run categories (posted / recovered / classified / skipped /
refused / failed / needs-review) are kept in task summaries. No per-transaction outcome
table (later phase).

## 2. Decisions left pending

- Accounting review of decision 1 (AI-suggested account vs creditors/debtors control accounts
  2000/1100 from the "Supplier Payment"/"Customer Receipt" posting rules; Metanoia also uses
  non-control 800/610).
- Accounting review of the journal date (decision 2). Consequences of `transaction-date`:
  journal, GL rows and period follow the bank date; the period/lock check applies to that date
  (a closed or locked period is refused and left for review instead of being moved into the
  current period); the batch keeps the run date; VAT return periods, financial statements,
  bank reconciliation and the Report Centre lifecycle lookup then follow the bank date. The SQL
  posting function still does not check periods itself.
- Historical correction (decision 4).
- Permission changes (§3) — the matrix is produced; no check has been changed except the
  manual "Run Rule Engine Now" route (Phase 5A).
- Database role checks (§6), persistent outcome table, deterministic rule ordering (§7).
- Wiring the bounded mechanism (§5) into import / bank sync.

## 3. Posting-path permission matrix (db05b34 + this branch)

"Posts" = writes a Posted journal and GL rows. Permission checks are application-level
(`permission-service.ts::requirePermission`); inside the database, row-level security checks
company membership only.

| Path | Entry point | Current permission | Creates journal? | Posts journal? | Required permission (proposal, not applied) |
|---|---|---|---|---|---|
| Run Rule Engine Now | `POST banking-rules/run` → `runRuleEngine` | **Banking:Post** (Phase 5A; was Banking:Edit) | Yes (rule journals) | Yes | Banking:Post |
| Apply Rule (selection) | `POST transactions/bulk` action `apply-rule` → `applyRule` → `applyRulesToTransactions` | Banking:Edit | Yes | Yes | Banking:Post to post; Banking:Edit may classify only |
| Apply rule to rest of statement | bulk action `apply-rule-to-batch` → `applyRulesToRemainingBatchTransactions` → `applyRulesToTransactions` | Banking:Edit | Yes | Yes | as Apply Rule |
| Apply new rule company-wide | bulk action `apply-rule-company-wide` → `applyNewRuleCompanyWide` (`applyRuleActionsBatchOverridingAiSuggestions`) | Banking:Edit | No | No (classification only) | Banking:Edit |
| Generate Journal | bulk action `generate-journal` → `generateJournal` → `generateJournalFromTransactions` | Banking:Edit | Yes (Draft) | No (posting is a separate GL step) | Banking:Edit (+ GeneralLedger:Post to post it) |
| Import bank statement (CSV) | `POST import-centre/bank-transactions` → `importBankStatement` → `applyRulesToTransactions` (new rows) | Banking:Create | Yes | Yes | Banking:Create to import; Banking:Post for the rule posting |
| Import PDF statement (confirm) | `POST import-centre/bank-transactions/confirm` → `confirmPdfBankStatementImport` → `applyRulesToTransactions` | Banking:Create | Yes | Yes | as CSV import |
| Inbound e-mail statement | `POST webhooks/resend/bank-statements` (Svix signature) → `processResendInboundEmail` → `importBankStatement` under service_role | Webhook signature (no user) | Yes | Yes | service path; keep signature + company mapping |
| BankSync (manual) | `POST bank-connections/[id]/sync` → `syncBankConnectionAccount` / `syncAllConnectedAccounts` → `applyRulesToTransactions` (new rows) | Banking:Edit | Yes | Yes | Banking:Edit to sync; Banking:Post for the rule posting |
| BankSync (scheduled) | cron → `runDueTasks` → `syncAllConnectedAccounts` | CRON secret, service_role | Yes | Yes | service path |
| Bank Posting | `POST transactions/post` → `postBankTransactions` → `fn_post_bank_transactions` | Banking:Post | Yes | Yes | Banking:Post |
| Cashbook approve & post | `PATCH cashbook/[id]` action `approve-post` → `approveAndPostCashbookEntry` → `postApprovedJournals(company)` | Cashbook:Edit | Yes | **Yes — every Approved journal in the company** | Cashbook:Post |
| Cashbook batch approve & post | `PATCH cashbook/batches/[id]` → `approveAndPostBatch` | Cashbook:Edit | Yes | Yes (company-wide) | Cashbook:Post |
| Cashbook reverse | `PATCH cashbook/[id]` action `reverse` → `reverseCashbookEntry` → `approveAndPostCashbookEntry` | Cashbook:Edit | Yes (reversal entry + journal) | Yes, immediately (company-wide) | Cashbook:Post |
| Post approved journals | `POST general-ledger/posting/run` → `postApprovedJournals` | GeneralLedger:Post | No | Yes (company-wide) | GeneralLedger:Post |
| Recovery (link only) | inside `runRuleEngine` / `applyRulesToTransactions` → `fn_recover_rule_engine_journal_link` | inherits the caller | No | No (links an already Posted journal) | inherits |
| Scheduled sweep | cron → `runDueTasks` → `runRuleEngine` | CRON secret, service_role | Yes | Yes | service path |
| Run Scheduler Now | `POST automation-tasks` → `runDueTasks` (active, due tasks) | RunAutomation | Yes (via tasks) | Yes | RunAutomation **and** Banking:Post when a RuleEngineRun/BankSync is due |
| Run task now | `PATCH automation-tasks/[id]` action `run-now` → `runTaskNow` (runs Paused/Suspended tasks too) | RunAutomation | Yes | Yes | RunAutomation **and** Banking:Post for RuleEngineRun/BankSync |
| Direct RPC | `fn_post_rule_engine_journal`, `fn_post_bank_transactions`, `fn_post_approved_journals`, `fn_recover_rule_engine_journal_link` via PostgREST | company membership (RLS) only; PUBLIC/anon removed by 0102 | Yes | Yes | database role check (§6) |
| Other modules | sales, purchasing, assets, depreciation, VAT, opening balances, recurring templates, inventory → `createJournal` + `postApprovedJournals(company)` | their own module permissions | Yes | Yes (company-wide posting) | out of scope here; note the company-wide post |

## 4. Migration 0102 — final security review

Prepared, NOT applied: `supabase/migrations/0102_rule_engine_security_hardening.sql`
(numbered 0102; 0101 is reserved by the Phase 0 branch). Down:
`supabase/rollbacks/0102_rule_engine_security_hardening_down.sql`.

| Check | Result (local SQL suite, 56 checks) |
|---|---|
| PUBLIC / anon cannot execute `fn_post_bank_transactions` / `fn_post_approved_journals` | yes (privileges and real anon calls refused) |
| authenticated cannot forge (insert Posted/Draft), re-point, re-source, re-date, re-total, un-post or delete a rule journal, or turn another journal into one | yes |
| authenticated cannot insert/update/delete a rule journal's lines | yes |
| a transaction cannot point at another company's journal or batch (all roles) | yes |
| authenticated cannot insert an already-posted/linked transaction | yes |
| authenticated posting still works: rule posting, recovery, Bank Posting, company-wide posting of ordinary journals, manual journals, ordinary lines | yes |
| service_role works (scheduler posting, server-side inserts) | yes |
| direct administrator session unrestricted (repairs, tests) | yes |
| tenant isolation (WITH CHECK, no cross-company post, nothing changed in the other company) | yes |
| existing rows unchanged by apply, down and re-apply | yes |
| `fn_post_rule_engine_journal`: still SECURITY INVOKER, `search_path=public, pg_temp`, 0100 grants kept; differs from 0100 only by setting/clearing the transaction-local sanction | yes (text diff: 2 statements) |
| guards: SECURITY DEFINER, `search_path=public, pg_temp`, not executable by API roles; `fn_is_api_caller` SECURITY INVOKER and not executable by any API role | yes |
| the sanction `vyron.rule_engine_posting` is set only by the posting function, read only by the two journal guards, cleared before the link and after a refused call | yes |
| no public function sets a caller-chosen parameter; `set_config` is not exposed by the API (local PostgREST: 404); API roles cannot create objects in `public` (production, read-only) | yes |
| 0100 suite (191 checks) and the 12 local end-to-end scenarios pass with 0102 applied | yes |

Residual: the sanction is a transaction-local setting, so a DIRECT SQL session (not the API)
could set it — such sessions are administrators anyway. Journals of every other source type
are still writable by members through the API (existing behaviour); only rule journals are
protected.

## 5. Bounded processing for import / bank sync (designed; mechanism built, not wired)

`applyRulesToTransactionsBounded(company, ids, performedBy, additionalRuleIds, { policy, bounds })`
(`rule-processing-service.ts`):

- `bounds.deadlineAtMs` — explicit maximum duration; `bounds.maxPostings` — explicit maximum
  posting/recovery calls. Omitted = unbounded (today's behaviour; `applyRulesToTransactions`
  now delegates to it with no bounds).
- Limits are checked only before a transaction starts; an atomic database call in progress is
  never interrupted.
- Once a limit is reached no further transaction is started (none is classified, excepted or
  posted), and the pass reports `stopReason` ("time-budget" / "posting-limit"),
  `notAttempted` and `notAttemptedTransactionIds`, plus `outcomes` counts
  (posted, recovered, classified, skipped, refused, failed, needs-review) and `postingAttempts`.

Wiring (NOT done — needs approval): import / bank sync would pass bounds and surface
`notAttempted` to the user / sync run; the transactions left stay unprocessed and open. Today
only the scheduled sweep (Task 10 / Task 5, both paused) would pick them up, so wiring bounds
before a sweep runs would leave imported rows unclassified — that is why it is not wired.
The scheduled sweep already reports the same counts (`outcomes`, `remaining` = not attempted,
`stopReason`).

## 6. Database role checks (separate hardening item, not implemented)

`user_has_permission(company, key)` exists (0098). A posting function could refuse API callers
without `Banking:Post`. Prerequisite: prove it returns exactly what
`permission-service.ts::resolveEffectivePermissions` returns for every role and inheritance
chain (including Owner / platform roles), otherwise legitimate users are refused.

## 7. Equal-priority rule ordering (documented, unchanged)

`banking-rule-repository.ts::listActiveBankingRules` orders by `rule_type, priority` only;
`rule-engine.ts::evaluateTransactionAgainstRules` takes the first match after a stable sort
by priority. Rules of one type with equal priority are therefore decided by database row
order (all production rules have priority 100). Deterministic change for later: add
`.order("id")` after `.order("priority")` in `listActiveBankingRules` (and `listBankingRules`),
so the lowest id wins a tie. No production transaction matches two rules of one type today.

## 8. Other posting paths (not changed)

Cashbook (create Approved → company-wide `postApprovedJournals` → link) and Generate Journal
(Draft → link) are not atomic and have no per-source uniqueness; Bank Posting has no
Manual-entry exclusion. Each needs its own atomic function in a later phase.

## 9. Deployment order (when approved)

1. Read-only pre-flight fingerprints (Northwood / Metanoia).
2. Apply 0102 (`supabase db push` from a clean export of the approved commit; it is the only
   pending migration after 0100). Verify objects, grants and that no accounting group changed.
3. Deploy the application (route permission, UI message, outcome counts; policy defaults =
   current behaviour).
4. Read-only smoke + fingerprints.
5. Tasks 4, 5 and 10 stay paused until separately authorized.

0102 needs no new application code and the application change does not need 0102. Removing
0102 later: run its down script BEFORE any 0100 down script.

## 10. Local test commands

- `supabase/tests/rule_engine_security_hardening.test.sql` — 56 checks
  (`-v migration=<0102>` `-v down=<0102 down script without its begin;/commit; lines>`).
- `supabase/tests/atomic_rule_engine_posting.test.sql` — 191 checks, also with 0102 applied first.
- `src/server/services/rule-engine-posting.scenario.test.ts` — 12 local end-to-end scenarios
  (with 0102 applied).
- `src/server/services/rule-processing-service.test.ts`,
  `src/app/api/companies/[companyId]/banking-rules/run/route.test.ts`.

---

# Phase 5C — posting-permission and processing gaps

Local only. No commit, no deploy, no migration applied. No new migration is
introduced by 5C: it is application-only, on top of the 0102 that 5B prepared.

## 11. The principle now enforced

A caller may not cause an accounting journal to be CREATED or POSTED using a
permission weaker than the one that action requires. Phase 5A did this for
"Run Rule Engine Now". 5C does it for the remaining rule-driven paths, by
separating the operation's own permission from the POSTING it can trigger:

| Operation | Permission for the operation | Permission for the posting it triggers |
|---|---|---|
| Apply Rule / apply to rest of statement | `Banking:Edit` (unchanged) | `Banking:Post` |
| Import CSV / PDF confirm | `Banking:Create` (unchanged) | `Banking:Post` |
| Manual BankSync | `Banking:Edit` (unchanged) | `Banking:Post` |

Nobody loses access to what they were entitled to: classification still runs
under the weaker permission, and importing/syncing still works in full.

### The mechanism: `mayPost`

`ProcessTransactionOptions.mayPost` (`rule-processing-service.ts`), default
`true`, threaded through `applyRulesToTransactions(Bounded)` and the three
callers. Routes answer it with `hasPermission(companyId, "Banking:Post")`.

`hasPermission` (`permission-service.ts`) is new: the same resolution
`requirePermission` performs, returned as a boolean and WITHOUT recording a
`PermissionDenied` event — an importer who holds `Banking:Create` but not
`Banking:Post` is not being refused, and logging it as a denial would bury real
refusals. Real refusals still go through `requirePermission` and are still logged.

### Why a refused transaction is left UNTOUCHED, not "classified instead"

The gate sits at the first point where the transaction is known to be postable
and before anything is written. When `mayPost` is false it writes NOTHING and
reports the new outcome `not-permitted`.

Downgrading to a classification would have been the dangerous option: writing
the claim sets `rule_id` with no journal, which `isRuleOwnedAwaitingReview`
reads as "a person must deal with this" and `isClaimableByRule` then refuses
FOREVER. The transaction would silently leave automatic posting for good, and no
later run by a user who DOES hold `Banking:Post` would pick it up. Leaving it
untouched keeps it in the worklist. A weaker permission may do less work, never
less recoverable work.

Classification the rules would have done anyway without posting (a
`flag_for_review` rule, no resolved GL account, journal lines that cannot be
built) still happens — those paths post nothing, so `Banking:Edit` remains
sufficient and blocking them would remove entitled function.

## 12. Bounds wired into Import and BankSync (Phase 5B section 5, now done)

Every bound is an EXISTING constant, reused rather than newly chosen:

| Path | Deadline | Max postings | Source |
|---|---|---|---|
| A. Manual BankSync | now + 120s | 150 | `ATTACHED_RULE_PASS_*` = `DEFAULT_RULE_ENGINE_BUDGET_MS` / `DEFAULT_RULE_ENGINE_MAX_POSTINGS` |
| B. Scheduled BankSync | the cron request's own `deadlineAtMs` (200s budget), or 120s, whichever is sooner | 150 | `CRON_WORK_BUDGET_MS`, already in `run-due-tasks/route.ts` |
| C. CSV / PDF import | now + 120s | 150 | as A |
| D. Rule Engine sweep | unchanged (150s task budget / 120s default, 150 postings) | unchanged | `RULE_ENGINE_TASK_BUDGET_MS` |

B also fixes a real gap: `runTask`'s BankSync branch passed NO deadline, so the
scheduled sync was the one unbounded posting path in the scheduler — a large
first sync could run past the 200-second cron budget and be killed by the
300-second platform limit part-way through a rule pass. A caller's deadline only
ever SHORTENS the attached pass, never extends it.

Bound behaviour (unchanged from the 5B mechanism, now reachable): limits are
checked only BEFORE a transaction is started, so an atomic posting RPC already
running is never interrupted; nothing is started once a limit is reached; the
pass returns exact `outcomes` counts, `notAttempted`, `notPermitted` and
`stopReason`; the transactions left are untouched and still claimable, so a
later pass processes them; no unprocessed transaction is ever marked processed.

### The limit is not silent

Phase 5B's section 5 warned that wiring bounds could leave imported rows
unprocessed with nobody to pick them up while the sweeps are paused. That is why
every count is surfaced, not just returned: `ImportOutcomeSummary` now states, in
both import flows, how many transactions were left unposted for want of
`Banking:Post` and how many the rules did not reach, and that both are imported,
unchanged and still to be processed. Sync and Apply Rule return the same counts
on their API responses. The residual risk is unchanged and stated in section 18.

## 13. Scheduled BankSync — verified, unchanged (section 4)

Cron secret + service_role, `maxDuration = 300`, `CRON_WORK_BUDGET_MS = 200_000`.
Verified: it is scoped per company (`runDueTasks(companyId, …)`, every repository
call company-scoped, `listAllCompanyIds()` the one deliberate cross-tenant
enumeration, iterated one company at a time); it reaches the ledger only through
`applyRulesToTransactionsBounded` and the same atomic `fn_post_rule_engine_journal`;
it uses `DEFAULT_RULE_ENGINE_POSTING_POLICY` like every other path; and it is NOT
given `mayPost`, so its posting is unchanged and stays service-role controlled.
No user permission was added to the scheduler.

## 14. Run Scheduler Now / Run task now — reported, NOT changed (section 6)

Current behaviour: `runTaskNow` (`scheduler-service.ts`) loads the task, claims
it and runs it regardless of status. It preserves a stopped status afterwards
(`keepStoppedStatus` for Paused/Disabled/Suspended, so the task does not become
scheduled again and its retry count is not reset) — but it DOES execute the work.
A `RunAutomation` holder can therefore run a Paused, Disabled or Suspended
RuleEngineRun, BankSync or AiClassificationSweep task, and a RuleEngineRun or
BankSync task posts accounting journals. `runDueTasks` ("Run Scheduler Now") is
different: it only takes tasks `listDueTasks` returns, which excludes Paused and
Suspended, so it cannot run a stopped task.

Security implication: task state is a safety control here and is being used as
one (Tasks 4/5/10 are paused, Task 6 is paused for the AI Gateway 402, Task 11 is
suspended). "Run task now" is a way around that state, under a permission
(`RunAutomation`) that is not the posting permission. It is the one remaining
path where a weaker permission can trigger posting.

Exact callers: `PATCH automation-tasks/[id]` action `run-now`
(`requirePermission(companyId, "RunAutomation")`) then `runTaskNow`; UI: the
Automation dashboard's per-task "Run now". `POST automation-tasks`
(`RunAutomation`) then `runDueTasks`.

Recommended model (needs approval, not implemented):
1. Refuse `run-now` for a Suspended task outright — suspension is the system
   saying the task is unsafe to run; clearing it should require Resume.
2. Allow `run-now` for Paused/Disabled (a deliberate operator action) but require
   `Banking:Post` IN ADDITION to `RunAutomation` when the task type is
   `RuleEngineRun` or `BankSync`, matching the manual triggers.
3. Leave `runDueTasks` as it is; add `Banking:Post` alongside `RunAutomation`
   only if a due RuleEngineRun/BankSync exists.

Tests required: run-now on Paused/Disabled/Suspended per task type; the added
permission for posting task types; task status unchanged after a manual run; no
cross-company run; the cron path unaffected.

## 15. Database role permission — analysis only, NOT equivalent (section 7)

`user_has_permission(company, key)` (0098) and
`permission-service.ts::resolveEffectivePermissions` agree for Company Owner,
Financial Manager, Senior Bookkeeper, Bookkeeper/standard user and platform admin
on `Banking:Post` — but ONLY inside a narrow envelope (one company-scope
assignment, a seeded role, same-company inheritance no deeper than 10, a real
`auth.uid()`). They are NOT equivalent in general:

| # | Divergence | Direction |
|---|---|---|
| D1 | `user_has_permission` reads `auth.uid()`, which is NULL under service_role. The cron scheduler and the inbound-statement webhook post with a service-role client and no user, so it returns FALSE for every key there. | **Legitimate posting wrongly refused — blocking.** A bare check inside the posting functions would break the scheduled sweep and the e-mail pipeline outright. |
| D2 | A user may hold several roles in one company (`unique (user_id, company_id, role_id)`), but the app reads the assignment with `.maybeSingle()` while the SQL unions all of them. | App refuses/errors where the DB allows. |
| D3 | The SQL inheritance CTE has no company filter; the app drops a parent role not in this company. | DB wrongly allows. |
| D4 | The app caps inheritance at depth 10; the SQL recursion is unbounded (0025's "depth-capped at 10" comment is wrong — `UNION` guards cycles, not depth). | DB more permissive. |
| D5 | The app resolves under RLS (can wrongly deny if the policy hides the rows — this has happened twice, 0034 and 0056); the SQL function is SECURITY DEFINER and cannot. | App can wrongly refuse. |
| D6 | `user_has_permission(NULL, key)` silently becomes a PLATFORM permission check. | Silent wrong-allow if ever called with a null company. |
| D7 | A SQL `raise` records no `PermissionDenied` event, so a DB refusal would be invisible to the Security Dashboard. | Audit-trail loss. |

Verified directly against the source: `0098:82-108` (the `auth.uid()` dependency)
and `0102:94-105` (`fn_is_api_caller()`, which is the right primitive to exempt
non-API callers).

So the Phase 5B prerequisite ("prove it returns exactly what the application
returns, otherwise legitimate users are refused") FAILS today, on D1. What must
be reconciled first: D1 (gate any check with `fn_is_api_caller()` so service_role
is exempt), D2 (align the app's single-assignment assumption), D3/D4 (align the
inheritance walk), D5 (state that a DB check is strictly additive), D7 (map the
refusal to a 403 and record the event), plus a read-only pre-flight that every
production company's roles actually carry the `Banking:Post` grant — the seed is
skipped for a company that already has any `permission_roles` row, so a partially
seeded tenant would have its posting silently refused. Only then would a
migration add, before any write in the posting functions, a check of the form
"if `fn_is_api_caller()` and not `user_has_permission(p_company_id,
'Banking:Post')` then raise with errcode 42501". Not implemented in 5C.

## 16. Cashbook — documented, NOT changed (section 8)

Permission: `Cashbook:Edit` gates the whole `PATCH cashbook/[id]` route,
including `approve-post` and `reverse`, and `PATCH cashbook/batches/[id]`.
`Cashbook:Post`, `Cashbook:Approve` and `Cashbook:View` are valid, grantable keys
that NO route checks. There is no separate approval step: the journal is created
already at `status: "Approved"` in-line, with no `ApproveJournals` check and no
`requireApproval` amount limit — unlike the GL journal route, which requires both.
Posting then calls `postApprovedJournals(companyId)`, which posts EVERY Approved
journal in the company (status-only filter, no source/id predicate), under the
Cashbook user's `posted_by`.

Non-atomic, precisely: journal header and lines are two separate writes (a
failure between leaves an Approved journal with no lines, which every later
posting run re-reads and skips forever); the ledger is written BEFORE the entry
is linked, so a failure between leaves a Posted journal and GL rows with
`journal_id IS NULL` on the entry — the entry reads as unposted everywhere, and
because the pre-flight guard only checks `journal_id`/`posted_flag` and
rule-engine journals, a retry builds a SECOND journal and the amount lands in the
GL twice; a transfer links its two legs in separate writes, and a failure between
them leaves one leg permanently unrepairable; a batch approve-post loops
per-entry with no try/catch, so a mid-batch failure leaves earlier entries posted
with no rollback and no per-entry result; reverse is a three-step unguarded
sequence that can produce a second reversal.

This is the pre-0100 rule-engine architecture, unchanged: no single RPC, no
per-source uniqueness index, no recovery function, no per-entry posting scope.
Each needs its own atomic function in a later phase. No code changed in 5C.

## 17. Generate Journal — documented, NOT changed (section 9)

Draft journals: `generate-journal` on the bulk transactions route creates real
`ae_journals`/`ae_journal_lines` rows at `status: "Draft"` and posts nothing —
gated only by `Banking:Edit`. The manual journal routes create Drafts under
`GeneralLedger:Create`. So a seeded Bookkeeper, who has `Banking:Edit` but not
`GeneralLedger:Create`, can author GL Draft journals of unlimited value: the GL
module's own create gate is reachable around through Banking. Approve
(Draft to Submitted to Approved) needs `ApproveJournals` PLUS a `Journal`
approval limit covering the amount; `reject` needs the permission but no limit.
Post (Approved to Posted) needs `GeneralLedger:Post` and is company-wide, so the
poster needs no approval limit at all. Reverse needs `GeneralLedger:Reverse`
(seeded to FD/MD/Owner only) and creates an Approved reversal with no amount
limit.

Mutating a Posted journal: blocked in the service layer only (`updateJournal`
refuses a non-Draft status; no DELETE route exists; `Posted: []` in the
transition table). The repository write has no status predicate, RLS is `FOR ALL`
and tenant-only with no status dimension, and 0102's triggers key off
`source_type = 'bank_transaction_rule_engine'`, not status — so a Posted manual
or Generate-Journal journal has NO database-level write protection. Consistent
with 0102's stated scope, and a real residual.

Consistency: `Banking:Edit` creating GL journals, and `Cashbook:Edit`/`Sales:Edit`
triggering the company-wide posting engine, are the same class of gap 5C fixed
for the rule paths. Out of scope here; no redesign in this phase.

## 18. Remaining risks after 5C

1. "Run task now" can still run a Paused/Suspended RuleEngineRun or BankSync
   under `RunAutomation` alone (section 14) — the one remaining
   weaker-permission posting path. Policy proposed, not implemented.
2. No database-level role check (section 15) — D1 must be resolved first.
3. Cashbook (section 16) and Generate Journal (section 17) keep their current
   permissions and non-atomic paths.
4. `postApprovedJournals` remains company-wide for every non-rule module.
5. If an import or sync DOES hit a bound, the remainder waits for a Banking Rules
   run. Tasks 5 and 10 are paused, so today that means a manual run. The counts
   are surfaced in the UI and on the API responses so this is visible, never
   silent — but it is a real operational dependency while the sweeps are paused.
6. A Posted non-rule journal has no DB-level write protection (section 17).

## 19. Phase 5C — files changed

Application (10):
- `src/server/services/permission-service.ts` — new `hasPermission`.
- `src/server/services/rule-processing-service.ts` — `mayPost` option and gate,
  `not-permitted` outcome, `notPermitted` counts, `ATTACHED_RULE_PASS_*` and
  `attachedRulePassBounds`.
- `src/server/services/transaction-explorer-service.ts` — `mayPost` on
  `applyRule` and `applyRulesToRemainingBatchTransactions`.
- `src/server/services/import-service.ts` — shared bounded `runImportRulePass`,
  `mayPost` option and `rulePass` outcome on both import paths.
- `src/server/bank-connectivity/bank-sync-service.ts` — `BankSyncOptions`
  (`mayPost`, `deadlineAtMs`), bounded rule pass, `rulePass` per account and
  aggregated on the company summary.
- `src/server/services/scheduler-service.ts` — passes the request deadline to
  the scheduled BankSync.
- `src/app/api/companies/[companyId]/transactions/bulk/route.ts`,
  `.../import-centre/bank-transactions/route.ts`,
  `.../import-centre/bank-transactions/confirm/route.ts`,
  `.../bank-connections/[connectionId]/sync/route.ts` — ask `Banking:Post` and
  pass it; report `notPermitted`/`rulePass`.

UI (3): `import-outcome-summary.tsx` (disclosure), `import-upload-card.tsx`,
`pdf-import-review-panel.tsx` (pass it through).

Migrations: NONE added by 5C. 0102 remains prepared and unapplied.

## 20. Phase 5C — tests

New: `transactions/bulk/apply-rule-permission.test.ts` (8),
`import-centre/bank-transactions/import-permission.test.ts` (10),
`bank-connections/[connectionId]/sync/sync-permission.test.ts` (7),
`permission-service.has-permission.test.ts` (8),
`import-centre/import-outcome-summary.test.tsx` (7).

Extended: `rule-processing-service.test.ts` (+15 — the gate, the
still-claimable regression, mixed selections, exact accounting, tenant
isolation, the attached bounds), `bank-sync-service.test.ts` (+6),
`import-service.test.ts` (+7), `scheduler-service.test.ts` (+3).

The load-bearing one: "the untouched transaction is still CLAIMABLE, so a later
run by someone who may post still posts it" — the regression that would make a
transaction disappear from automatic processing.

---

# Phase 5D — build blocker and Run Now task-state safety

Local only. No commit, no deploy, no migration applied, no production change.
Two objectives: the `/platform/operations` build failure, and the Run Now gap
left open by 5C section 14.

## 21. The `/platform/operations` build blocker

Root cause: `OperationsTabs` is a client component that keeps its selected tab
in the query string via `useUrlParam`, which calls `useSearchParams()`. The page
renders STATICALLY when Supabase is not configured — Preview Mode takes the
mock-data branch and awaits nothing, so Next.js prerenders it at build time. A
client component reading search params during a static prerender bails out of
prerendering, and `next build` fails with "useSearchParams() should be wrapped
in a suspense boundary". It was live on untouched db05b34 and blocked every
production build; 5C verified that by stashing and building the clean baseline.

Why only this page, when 24 other components use the same hook: every other one
sits under a route that renders dynamically (per-request auth/cookies), so it is
never prerendered. `/platform/operations` is the only statically prerendered
route that reaches `useSearchParams`.

Fix: wrap `<OperationsTabs>` in a bare `<Suspense>` in
`src/app/platform/operations/page.tsx` — the same boundary the login page
already uses for `LoginForm`, which reads search params for the same reason. No
fallback, because the tabs render immediately on the client and a skeleton would
only flash. Nothing else changed: no routing, no auth, no permissions, no
Operations Centre behaviour, no suppression of the error, no client-side
architecture change.

Regression guard: `src/app/platform/operations/suspense-boundary.test.ts`
asserts the page imports `Suspense`, that `<OperationsTabs>` sits inside the
boundary, that it is still rendered exactly once, and that the tab component
really does read search params (so the boundary is required, not cargo cult). A
unit test cannot run the prerender, so this catches removal of the boundary in
seconds instead of at the end of a production build.

`next build` now completes with exit 0 and `/platform/operations` is listed as
prerendered static content.

## 22. Run Now — the task-state machine

| Task state | Run Now | Why |
|---|---|---|
| Active (Queued/Success/Failed/Running) | Allowed, subject to permissions | Normal operation |
| **Paused** | **Allowed**, subject to permissions | A normal operational control; running a paused task by hand during controlled testing is deliberately preserved. It never becomes scheduled again — `keepStoppedStatus` keeps its status and retry count |
| **Suspended** | **REFUSED** — "This task is suspended and must be resumed before it can be run." | A safety state the scheduler sets after exhausting retries (0099) or reclaiming a stale claim. Letting Run Now execute it would make the suspension decorative; it takes an explicit Resume |
| **Disabled** | **REFUSED** — "This task is disabled and must be resumed before it can be run." | A deliberate operator decision, treated the same way |

Enforced in `scheduler-service.ts::runTaskNow` itself, BEFORE the task is
claimed — so a refused run leaves no claim, no task-run row, no status change,
no retry-count change and no accounting write. It is enforced in the service
rather than only the route so no other caller can get around it; the UI button
state is not relied on at all.

## 23. Run Now — task-specific posting permission

`RunAutomation` says a person may work the scheduler. It does not say they may
post accounting journals. So:

| Task type | Posts? | Permission for Run Now |
|---|---|---|
| RuleEngineRun | Yes | RunAutomation **and** Banking:Post |
| BankSync | Yes | RunAutomation **and** Banking:Post |
| AiClassificationSweep | No | RunAutomation only — unchanged |
| CommunicationQueue, SubscriptionLifecycleSweep, RecurringTemplate, ReportRefresh, Custom | No | RunAutomation only — unchanged |

`taskPostsAccounting(taskType)` is the single exported predicate both the route
and the service use, so the two cannot drift. AI classification is deliberately
excluded: it writes `suggested_gl_account`, the same field a manual GL
assignment writes, and posts nothing — sharing the scheduler framework is not a
reason to demand a posting permission.

Enforcement is layered. The route (`PATCH automation-tasks/[id]`, action
`run-now`) is the permission authority: it reads the task to learn its TYPE,
and for a posting type without `Banking:Post` returns the standard 403 through
`requirePermission`, so the refusal is recorded as a `PermissionDenied` event
like every other one. It then passes the answer to `runTaskNow`, which refuses
again if `mayPost` is false — the server-side backstop, so no caller reaches a
posting run without having answered the question. Omitting `mayPost` permits
posting, which is what internal callers need.

## 24. Service-role behaviour is untouched

`runTaskNow` is NOT on the scheduled path. Cron authenticates with the cron
secret, runs under service_role, and calls `runDueTasks`, whose `listDueTasks`
already excludes Paused and Suspended tasks at the SQL level. None of the Run
Now gates are reachable from it, no user-permission check was added to the
scheduler, and no `auth.uid()`-based check exists anywhere on that path.
Covered by tests: a due RuleEngineRun and a due BankSync both still run through
`runDueTasks` with no permission answer at all.

## 25. Run Now path audit

UI `automation-dashboard-tab.tsx` "Run Now" → `PATCH
/api/companies/[companyId]/automation-tasks/[taskId]` `{action:"run-now"}` →
`requireSession` → `requirePermission(companyId, "RunAutomation")` →
`getAutomationTask` (type only) → `taskPostsAccounting` → for a posting type,
`requirePermission(companyId, "Banking:Post")` → `runTaskNow` → **task-state
gate** → **mayPost backstop** → `claimTaskForRunning` → `startTaskRun` →
`runTask` → the task-specific service. Every gate is server-side; the UI is
told, not trusted.

The UI previously ignored the response entirely and called `router.refresh()`
regardless, so a 400/403 was indistinguishable from a run that happened. It now
shows the server's message in a `role="alert"` and does not refresh on failure.

## 26. Not changed in 5D

"Run Scheduler Now" (`POST automation-tasks` → `runDueTasks`) still needs only
`RunAutomation`, and can trigger posting if a RuleEngineRun or BankSync task is
DUE. Its task-state safety is already sound — `listDueTasks` excludes Paused and
Suspended — so the Run Now hole does not exist there. The remaining permission
gap is narrower than the one 5D closed (it cannot target a specific stopped
task), and closing it means deciding what should happen when a user without
`Banking:Post` runs the scheduler and a posting task is due: refuse the whole
run, or run the non-posting tasks and leave the posting ones due. That is an
operational decision, not a code detail, so it is left for a decision rather
than guessed at here.

## 27. Phase 5D — files changed

Application (3):
- `src/app/platform/operations/page.tsx` — `<Suspense>` around `OperationsTabs`.
- `src/server/services/scheduler-service.ts` — `taskPostsAccounting`,
  `RUN_NOW_REFUSED_STATUSES`, `RunTaskNowOptions`, and the two gates at the top
  of `runTaskNow`.
- `src/app/api/companies/[companyId]/automation-tasks/[taskId]/route.ts` —
  the `Banking:Post` check for posting task types, and `mayPost` passed down.

UI (1): `src/components/financial/automation/automation-dashboard-tab.tsx` —
surfaces a refusal instead of swallowing it.

Migrations: NONE. 0102 remains prepared and unapplied.

## 28. Phase 5D — tests

New: `src/app/platform/operations/suspense-boundary.test.ts` (4),
`automation-tasks/[taskId]/run-now-permission.test.ts` (14),
`automation/run-now-refusal.test.tsx` (5).

Extended: `scheduler-service.test.ts` (+20 across three suites — the state
machine per task type, the posting gate, and the service-role path).

Updated: the two pre-existing "Run Now never re-activates a paused, disabled or
suspended task" cases were `it.each(["Paused","Disabled","Suspended"])` and
asserted that all three RUN. Disabled and Suspended are now refused, so those
cases are narrowed to Paused and the refusals are covered by the new state-
machine suite. This is a deliberate policy change, not a test weakened to pass.

---

# Phase 5E — final scheduler permission hardening

Local only. No commit, no deploy, no migration applied, no production change.
Closes the last path where a weaker permission could trigger accounting posting:
the manual "Run Scheduler Now".

## 29. Complete task-type classification

Every member of `AutomationTaskType` traced to what it actually calls. Nothing
classified by assumption — `taskPostsAccounting()` in `scheduler-service.ts` is
an exhaustive switch, so adding a task type stops the build until it is
classified.

| Task type | Posts accounting? | Traced to |
|---|---|---|
| RuleEngineRun | **YES** | `runRuleEngine` -> `fn_post_rule_engine_journal` |
| BankSync | **YES** | `syncAllConnectedAccounts` -> attached rule pass -> the same atomic posting |
| RecurringTemplate | **YES** | `generateFromTemplate`: a `Journal` template writes an Approved journal then `postApprovedJournals`; `CustomerInvoice`/`SupplierBill` call `approveAndPostInvoice`/`approveAndPostBill`; `InventoryAdjustment` carries a journal |
| AiClassificationSweep | no | writes `suggested_gl_account` only — the field a manual GL assignment writes |
| CommunicationQueue | no | `processCommunicationQueue` — sends queued messages |
| SubscriptionLifecycleSweep | no | `runSubscriptionLifecycleSweep` — billing lifecycle, no ledger write |
| ReportRefresh | no | no branch in `runTask` — a no-op today |
| Custom | no | no branch in `runTask` — a no-op today |

**RecurringTemplate is a correction to Phase 5D**, which had classified it as
non-posting. It posts through the sales / purchasing / GL modules rather than the
banking ones, which is exactly why a from-memory list missed it and why the
predicate is now central, exhaustive and documented against what each task calls.

Consequence: a manual run of a RecurringTemplate task — through "Run task now"
as well as "Run Scheduler Now" — now needs `Banking:Post` too.

## 30. Run Scheduler Now behaviour

The queue is NOT one atomic operation: `runDueTasks` loops over due tasks,
claiming, running and recording each independently, with a per-task try/catch.
So refusing the whole request would be wrong, and the preferred behaviour is
directly implementable:

1. `RunAutomation` is still required for the action at all (unchanged).
2. The route answers `Banking:Post` once with `hasPermission` and passes it as
   `mayPost`.
3. In the loop, BEFORE the claim, a posting task with `mayPost === false` is
   skipped: not claimed, not started, no run row, no outcome recorded, and its
   `next_run_at` untouched — so it stays due and the scheduled cron pass (which
   has no such restriction) runs it as normal.
4. Non-posting due tasks run exactly as before.
5. The outcome reports `refused` and `refusedTasks` (id, type, name, reason).
   `SchedulerRunOutcome`'s base shape is unchanged — the two fields appear only
   when something was actually skipped — so the cron path's outcome is identical.

Nothing is silently omitted: the counts are on the API response, the UI names
each skipped task and says it is unchanged and still due, and the route records
one `PermissionDenied` system event per run that skipped anything (the existing
convention from `permission-service`), fire-and-forget so an observability
failure cannot change what the scheduler did.

## 31. Permission model

| Path | Non-posting task | Posting task |
|---|---|---|
| Run Scheduler Now | `RunAutomation` | `RunAutomation` **and** `Banking:Post` |
| Run task now | `RunAutomation` | `RunAutomation` **and** `Banking:Post` |
| Scheduled cron | cron secret + service_role | unchanged — no user permission |

Both manual paths ask the same predicate, so they cannot drift.

Worth recording: in the seeded role model `RunAutomation` is granted ONLY to
Financial Manager, Financial Director, Managing Director and Company Owner
(`0025_rbac_platform.sql`), and all four also hold `Banking:Post`. So this
restriction refuses nobody in the default roles. It bites exactly one case — a
custom role granting `RunAutomation` without `Banking:Post` — which is the
privilege-escalation this phase exists to close.

## 32. Suspended / Disabled / Paused — Phase 5D rules unchanged

Active: permitted subject to task permissions. Paused: permitted subject to task
permissions. Suspended: REFUSED. Disabled: REFUSED. Enforced in `runTaskNow`
before the claim, untouched by 5E. "Run Scheduler Now" cannot reach a stopped
task at all, because `listDueTasks` excludes Paused and Suspended in SQL.

## 33. Service-role behaviour

Unchanged and verified. `runDueTasks` without `mayPost` behaves exactly as it
always has; the cron route passes only `deadlineAtMs`. No `auth.uid()` check was
added to `runDueTasks`, the scheduled Rule Engine, the scheduled BankSync, the
scheduled AI classification or any inbound service-role path. Tests assert that a
due RuleEngineRun and a due BankSync both still run with no permission answer at
all, and that the cron-shaped outcome is byte-for-byte what it was.

## 34. No accounting side effect on refusal

A refused task produces no journal, no ledger row, no posting batch, no posted
flag and no claim that it ran: it is never claimed, `runRuleEngine` /
`syncAllConnectedAccounts` / `generateFromTemplate` are never called,
`finishTaskRun` and `recordTaskOutcome` are never reached, and no usage event is
metered. Asserted directly.

## 35. Phase 5E — files changed

Application (3):
- `src/server/services/scheduler-service.ts` — `taskPostsAccounting` rewritten as
  a documented exhaustive switch (RecurringTemplate corrected to posting);
  `SchedulerRunOptions.mayPost`; `RefusedSchedulerTask`; the pre-claim skip in
  `runDueTasks`; `refused`/`refusedTasks` on the outcome.
- `src/app/api/companies/[companyId]/automation-tasks/route.ts` — answers
  `Banking:Post`, passes `mayPost`, records the `PermissionDenied` event.
- `src/app/api/companies/[companyId]/automation-tasks/[taskId]/route.ts` —
  unchanged in 5E; it already asks the same predicate, which now includes
  RecurringTemplate.

UI (1): `automation-dashboard-tab.tsx` — names the skipped tasks and reports a
failed scheduler run instead of swallowing it.

Migrations: NONE. 0102 remains prepared and unapplied.

## 36. Phase 5E — tests

New: `automation-tasks/run-scheduler-permission.test.ts` (9).
Extended: `scheduler-service.test.ts` (+13 — per-type refusal, the mixed queue,
no-side-effect, cron unchanged, tenant isolation, and the predicate driving the
decision), `automation/run-now-refusal.test.tsx` (+4 — the UI reports skipped
tasks), `automation-tasks/[taskId]/run-now-permission.test.ts` (+2, and its
non-posting list corrected now that RecurringTemplate posts).

---

# Phase 5F — validation stability

Investigation only. No production code changed; one behavioural test added.

## 37. The intermittent 5-second timeout is pre-existing

Full-suite sampling, same machine, same session, nothing else running:

| Tree | Runs | Clean | Failed | Timeouts | Mean duration | Tests/run |
|---|---|---|---|---|---|---|
| **Baseline db05b34** | 8 | 3 | **5** | 24 | 139.0s | 4447 |
| **Working tree (5A–5E)** | 6 | 4 | 2 | 10 | 140.0s | 4632 |

The untouched baseline fails MORE often than the working tree. Every failure on
both trees is the identical signature — `Error: Test timed out in 5000ms` — in
the same files: `transaction-grid`, `update-allocated-pending-count`,
`banking-rules-tabs`, `roles-permissions-tab` (one baseline run also caught
`find-and-recode.integration`, a file that has never failed on the working
tree). The failures are therefore not attributable to 5A–5E.

Isolation, working tree, 3 runs each: every one of the four suites passes
individually (2.00–3.54s) and all four pass as a group (3.85–4.01s). They fail
only inside the full parallel run.

Nothing in 5A–5E is imported by three of the four suites; the fourth reaches
`banking-rules-tab.tsx`, whose Phase 5A change adds one conditional `<p>` that
does not render in that test.

Ruled out by inspection, not assumption: no file in the suite uses fake timers;
RTL `cleanup()` runs in the global `afterEach`; vitest's `forks` pool isolates
per file, so cross-file state and ordering dependencies cannot apply.

## 38. Why the 5-second threshold lands unevenly

`vitest.config.ts` sets no `testTimeout` (5s default) and no worker cap, so up
to one fork per logical core runs jsdom concurrently; 37 files run CPU-bound
`jest-axe` scans, and the PDF suites launch real Microsoft Edge processes.

Observed, and worth recording because it explains the asymmetry rather than
excusing it: the PDF tests run 4356–6633 ms — beyond the 5-second limit — and
still pass, because their pixel-scanning loop
(`getImageData` + a per-pixel `for`) blocks the event loop, so the timeout
callback cannot fire during the blocking section. The tests that DO fail are
asynchronous (`waitFor`/`findBy`, `axe`), which yield to the event loop and are
therefore killed the moment the deadline passes. This is the observed reason the
same threshold behaves differently for blocking and non-blocking tests. It is
NOT evidence that the timeout configuration is correct.

**No global timeout change was made.** No `testTimeout`, worker-count or retry
setting was modified, and no test was weakened, skipped or deleted. The
affected tests have roughly 2x headroom when the machine is quiet; under full
parallel load that margin disappears. Raising `testTimeout`, or capping workers,
would make the suite deterministic — but both are project-wide policy decisions
and neither is required by 5A–5F, so both are left for a separate decision.

## 39. Performance comparison

Mean full-suite wall clock: baseline 139.0s, working tree 140.0s — +0.7% for
+4.2% more tests (4632 vs 4447), i.e. marginally faster per test. The affected
tests measure the same on both trees (`repeated mount/unmount`: baseline
2275/3147/2431 ms vs working tree 2442/2713/2407 ms; slowest axe scan: baseline
2285 ms vs working tree 2379 ms). No slowdown is attributable to 5A–5E. With
6 and 8 samples these are indicative, not statistically strong.

## 40. `/platform/operations` — behavioural verification

`operations-tabs-suspense.test.tsx` (new, 5/5 passing) renders `OperationsTabs`
inside a real `<Suspense>` boundary exactly as the page does, and proves it
renders through the boundary, honours `?tab=security` deep links, falls back to
the default tab for an unknown slug, writes the slug back on a tab click, and
clears the param when the default tab is selected. This is stronger than the 5D
guard, which only asserted the boundary exists in the source.

`next build` exits 0 and lists `/platform/operations` as prerendered static.
