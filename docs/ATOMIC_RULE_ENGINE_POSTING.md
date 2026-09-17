# Atomic Banking Rule posting (migration 0100)

## Why

On 2026-09-16 the Banking Rules sweep (automation task 10, run 18880) posted
journal **JR000264** (id 278) for Metanoia bank transaction **2151**. The Vercel
cron request was then killed at its 300-second limit before the transaction
was stamped:

| Ledger | Bank transaction 2151 |
|---|---|
| JR000264 Posted, Dr 6940 / Cr 1020 R6,435.00, batch PB000264, two GL rows | `journal_id` NULL, `posted_flag` false |

The amount is in the ledger exactly once. The danger was what could happen next:

1. **Posting was three separate calls.** `createJournal` →
   `postApprovedJournals(companyId)` (every Approved journal in the company)
   → `markTransactionPosted`. A kill between the last two leaves this state.
2. **Recovery could never run.** The existing-journal check came after
   `applyRuleActions`, which refuses any row whose `rule_id` is already set.
   A half-finished post leaves exactly that state.
3. **The amount could be posted twice.** Bank Posting and Generate Journal
   treated `posted_flag = false AND journal_id IS NULL` as "not posted".
4. **The sweep had no time budget.** It ran until the platform killed it,
   which happened on every run that day.

The first version of this change was reviewed and sent back with two high
findings and several medium/low ones. This document describes the revised
version.

| Finding | What was wrong | Fixed by |
|---|---|---|
| **H1** starvation | The posting limit (150) counted every claimable row, matched or not. Northwood has 181 claimable rows no rule matches, so later matched rows would never be reached. | Work is grouped and only posting/recovery calls count (see "The sweep"). |
| **H2** Cashbook double post | `approveAndPostCashbookEntry` writes the ledger before it links the entry, so the link guard fired too late. Nothing stopped a rule from posting a Manual entry first. | Cashbook refuses before writing; rules never take Manual entries. |
| **M1** stranded rows | A failed post left the row rule-owned and unposted, and no later run ever retried it. The old comment said otherwise. | The rule's claim is written inside the atomic posting call. |
| **M2** 1,000-row worklist | The API returns at most 1,000 rows, so older unposted rows were never evaluated. | Keyset-paged worklist, plus a direct recovery list. |
| **L1** posting date | The batch was dated with the database clock. | The caller passes the posting date. |
| **L2** batch link | New postings stamp `posted_at` / `posting_batch_id`; older rows don't. | Kept deliberately (see below). |
| **L4** partial results | "Run Rule Engine Now" showed a stopped run as if complete. | The screen says how many transactions are left. |
| **L6** twin drift | The in-memory claim check could drift from the database. | One SQL definition, plus a unit test pinned to its text. |

## Decisions that bound this change (confirmed 2026-09-17)

1. **New atomic Rule Engine claims are retriable after a failed atomic post.** The rule's claim is written inside `fn_post_rule_engine_journal`. If that call fails for any reason, the claim rolls back with the journal, batch and ledger rows. The transaction is left unclaimed, and the next sweep evaluates and posts it, once.
2. **Historical legacy rule-owned, unposted rows are NOT automatically retried or posted.** A transaction with `rule_id` set, `journal_id` NULL and `posted_flag` false is never claimed, posted or treated as a recovery by the Rule Engine. In code this is `isRuleOwnedAwaitingReview`, reported per run as `awaitingReview`. The database claim guard (`rule_id IS NULL`) enforces the same. No migration marks or converts these rows.
3. **Northwood's existing legacy rows therefore remain for human review.** In production there are about 562 with a GL account, classified 21 Aug – 9 Sep 2026; about 541 could otherwise become postings. They are posted, if at all, by a person (Transaction Explorer / Bank Posting).
4. **Transaction 2151 remains a separately identified recovery case.** It is rule-owned *with* a Posted Banking Rule journal (JR000264), so the only automatic action is linking it to that journal (recovery), never posting it. Repairing it in production is a separate, explicitly approved step (see below). Task 10 stays Suspended until then.
5. **Cashbook is protected against the known Rule Engine / manual duplicate path, but is NOT yet fully atomic under concurrent writers** (see "Known limits").
6. **The journal date keeps the existing run-date policy.** Banking Rule journals are dated the day the rule posts them; this change passes that same date explicitly and does not change it.

## What changed

### Database (`supabase/migrations/0100_atomic_rule_engine_posting.sql`)

| Object | Purpose |
|---|---|
| `ae_journals_rule_engine_source_key` | Unique partial index: at most one Banking Rule journal per bank transaction. The migration checks for existing duplicates first. |
| `fn_bank_transaction_is_claimable_by_rule(row)` | **The** definition of "a Banking Rule may take this transaction": not posted, not overridden, not on hold, not owned by a rule or the Matching Engine, **not a Manual Cashbook entry**, and either untouched or carrying only an unconfirmed AI suggestion. |
| `fn_claim_bank_transaction_for_rule` | The claim write: the guard, the classification, its `ae_allocation_history` row and the `banking_rule_applications` rows, in one call. Same fields, G/S/C precedence and "Resolved by rule" wording as the two PostgREST writes it replaces. Every rule named must belong to the company. |
| `fn_post_rule_engine_journal(company, txn, journal, posted_by, posting_date, claim)` | Claims and posts **one** transaction in **one** database transaction: claim, journal (Posted), lines, posting batch, GL rows and link. It runs recovery first and re-validates everything (balanced, equal to the transaction amount, accounts exist, claim present, claimed GL account appears in the lines). It refuses Manual entries. Any failure rolls back everything, **including the claim**. |
| `fn_recover_rule_engine_journal_link` | Links a transaction to its existing Posted, unreversed Banking Rule journal when the ledger rows are complete. Writes only `journal_id` and `posted_flag`, plus an audit entry. |
| `fn_record_rule_engine_link_audit` | Narrow SECURITY DEFINER writer for `automation_audit_log` (action `RuleEngineJournalLinkRecovered`). Refuses callers outside the company and links that don't exist. |
| `fn_list_rule_engine_worklist` | One keyset page (at most 1,000 rows) of `journal_id IS NULL` rows, optionally only the claimable ones. Order: newest transaction date first (no date first), then id. |
| `fn_list_rule_engine_recovery_candidates` | Transactions whose Posted, unreversed Banking Rule journal lost its link, in a shape recovery may repair. Found directly, however long the worklist is. |
| `fn_bank_transaction_has_live_rule_engine_journal` | A journal is "live" if it is Posted and not reversed, or still Draft/Submitted/Approved. |
| `fn_post_bank_transactions` | Same as 0092, plus one claim condition: never claim a transaction a live Banking Rule journal already carries. |
| `ae_bank_transactions_rule_engine_journal_guard` | BEFORE UPDATE trigger: a transaction with a live Banking Rule journal cannot be flagged posted or linked to any other journal. Unlinking is never blocked. It fires on the link write, so it cannot stop a path that writes the ledger *before* linking (Cashbook). That path checks first itself (see Cashbook). |

All new functions except the trigger function and the audit helper are
SECURITY INVOKER, so RLS is their tenant boundary, as in 0063/0092.
`authenticated` and `service_role` can execute them; `anon` cannot.

0100 updates no existing row and changes no column.

**L2 decision.** A new Banking Rule posting stamps the transaction's
`posted_at` and `posting_batch_id`, exactly as Bank Posting (0092) does, so
the transaction points at its batch.
- **No accounting impact:** these columns are display and traceability fields (Report Centre audit trail, the Bank Posting message). No balance, report total or eligibility rule reads them.
- **Tested for consistency:** the transaction, journal and batch point at each other.
- **Not back-filled:** the 383 older Banking Rule postings and the 2151 repair set only `journal_id` / `posted_flag`.

### Application

**`rule-processing-service.ts`**

- **One transaction:**
  - Recovery runs **before** rule matching.
  - A transaction the rule will post is claimed **inside** `postRuleEngineJournalAtomic`. Before that call nothing is written, so a closed period, a missing account, an unavailable database or a database refusal leaves the transaction exactly as it was. The next sweep evaluates it and tries again, and it can only ever be posted once.
  - A rule-owned transaction without a journal (legacy, or classification-only) returns before any claim or posting (`isRuleOwnedAwaitingReview`, `awaitingReview: true`).
  - A transaction the rule only classifies is claimed on its own, in one database call (`applyRuleActions`), as before, and is not posted by later sweeps. This covers:
    - a flag-for-review rule;
    - a rule without a GL account;
    - journal lines that cannot be built (a supplier/customer allocation, or a bank account without a GL account).
  - Manual Cashbook entries are never claimed or posted (`isClaimableByRule`, and again in the database).
- **The sweep (`runRuleEngine`)** runs three passes, each paging through the whole worklist (500 rows a page) until the deadline:
  1. **Recoveries**, from `fn_list_rule_engine_recovery_candidates`.
  2. **Claimable transactions a rule matches**, the only work that posts.
  3. **Everything else:** unmatched and rule-owned transactions. This pass raises exceptions only and never claims or posts. Open UnknownMerchant exceptions are looked up in batches, so re-running over the same rows costs almost nothing.

  **Only posting/recovery database calls count towards `maxPostings` (150).**
  Unmatched rows can no longer use up the budget. When the budget runs out,
  pass 3 still runs, and the matched rows left over are counted in
  `remaining` for the next run (which comes back in 5 minutes). The outcome also reports `awaitingReview` (rule-owned transactions left for a person). The deadline
  (default 120 s; the scheduler uses `min(request deadline, 150 s)`) bounds
  all three passes. The outcome also reports `postingAttempts`.
- **Accounting is unchanged:**
  - same lines (`buildJournalLinesForTransaction`), amounts, VAT split and accounts;
  - same journal date (the run date), period and checks;
  - the batch posting date is the same run date, now passed explicitly (L1).

**Other services and routes**

- **`scheduler-service.ts`**
  - `runDueTasks(..., { deadlineAtMs })` starts no task once the deadline has passed. Such tasks are reported as `postponed` and stay due.
  - The sweep's summary now includes `postingAttempts`.
  - A sweep that stopped early but made progress runs again in 5 minutes; otherwise it runs hourly.
- **`/api/automation/run-due-tasks`**
  - `maxDuration = 300` is stated explicitly. It is **not** raised.
  - Work deadline is request start + 200 s.
- **`cashbook-service.ts` (H2).** `approveAndPostCashbookEntry` (and both legs of a transfer, batch posting and reversals) refuses **before** building, creating or posting anything if the entry:
  - is already linked to a journal;
  - is already flagged posted;
  - is carried by a live Banking Rule journal.

  Cashbook posting itself is otherwise unchanged. It still posts
  through `postApprovedJournals` and links afterwards; making that one
  atomic call is a separate change (see "Known limits").
- **`bank-posting-service.ts`:** covered transactions are reported as "already posted by Banking Rule journal JR…" (or blocked while that journal is still Draft/Submitted/Approved).
- **`journal-service.ts` (Generate Journal)**
  - Covered transactions are skipped.
  - If the database refuses a link, the draft is rebuilt from the linked transactions only, or cancelled if none linked.
- **Repositories**
  - `transaction-explorer-repository.ts`:
    - `applyRuleActions` is one `fn_claim_bank_transaction_for_rule` call;
    - `listRuleEngineWorklistPage`, `listRuleEngineRecoveryCandidates` and `countUnprocessedTransactions` are new;
    - `markTransactionPosted` is removed.
  - `listUnprocessedTransactions` stays for the explicit "apply to remaining" action; that action is still capped at 1,000 rows.
  - `banking-exception-repository.ts`: `listTransactionIdsWithOpenException` is new (batched).
- **`banking-rules-tab.tsx` (L4):** "Run Rule Engine Now" says when a run stopped early and how many transactions are left.

### What this deliberately does NOT do

- **Legacy rule-owned rows (important for Northwood):** rows a rule classified but that were never posted are **not** posted automatically. Production has 562 such Northwood rows with a GL account (classified 21 Aug – 9 Sep 2026, before rules posted automatically). They remain "Suggested" rows for a person to review and post. Auto-posting them would be an accounting decision, and would date them the run date.
- **Journal date:** Banking Rule journals are still dated the day the rule posts them, not the transaction date (see "Known limits").
- **Historical data:** no journal, line, batch, GL row or transaction is changed.

## Deploy order (when approved)

1. **Apply 0100 first, then deploy the app promptly.** With the old app still running, 0100 never makes anything worse:
   - **Rule engine:** the old path still works. It doesn't call any new function, and its `markTransactionPosted` links to the rule journal, which the trigger allows.
   - **Bank Posting:** it immediately stops double-posting 2151. The old code reports it as "posted by another posting run".
   - **One gap remains until the app is deployed:** old Generate Journal code doesn't expect the trigger's refusal. A selection that includes 2151 fails with an error, possibly after creating a Draft journal. Today it would silently link 2151 into that draft instead, so this is no worse, but don't use Generate Journal on 2151 in that window.
   - **Cashbook:** the old code has no pre-check. Production has no Manual entries (all 1,726 transactions are Imported), so there is nothing to protect in that window.
2. **Deploy the app.** The new app needs the new functions, so it must not go out before the migration.
3. **Keep Task 10 suspended** until the repair decision is made. **Don't press "Run now" on it either:** a manual run of a suspended task still runs the sweep, and the new sweep would link 2151 by itself (audited as `RuleEngineJournalLinkRecovered`).

Rollback: roll the app back first, then run
`supabase/rollbacks/0100_atomic_rule_engine_posting_down.sql`. It removes
every 0100 object (including the claim and worklist functions) and restores
`fn_post_bank_transactions` byte-for-byte as 0092 left it. No data changes.

## Repairing 2151 (only after approval)

Scripts:
- Repair: `supabase/repairs/2026-09-16_link_txn_2151_to_jr000264.sql`
- Rollback: `supabase/repairs/2026-09-16_link_txn_2151_to_jr000264_rollback.sql`

The repair works as follows:
- **Approval:** it refuses to run unless `vyron.repair_approval` is set inside the transaction. The line is commented out in the file.
- **Pre-checks:** it re-verifies every fact:
  - company, amount and bank account;
  - `journal_id` NULL and `posted_flag` false;
  - exactly one Banking Rule journal, which is 278 / JR000264, Posted, unreversed, in batch 272;
  - two balanced lines with Cr 1020, and one GL row per line;
  - no other transaction references journal 278.
- **The change:** it updates only `journal_id` and `posted_flag` on exactly one row.
- **Post-checks:** it proves the rest of that row, every other transaction, and every journal, line, batch and GL row are unchanged.
- **Audit:** it writes one `RuleEngineJournalLinkRepair` audit entry.

## Running the tests

| Layer | Command | What it covers |
|---|---|---|
| Unit | `npx vitest run` | Rule engine (claim/post atomicity, H1 starvation, M1 retry vs. 600 legacy rule-owned rows, M2 paging over 2,600 rows, Manual entries, L1 date), scheduler and route deadlines, Bank Posting, Generate Journal, Cashbook (H2), repositories, the Run Rule Engine screen |
| Database | `psql -v ON_ERROR_STOP=1 -v migration=<path to 0100> -f supabase/tests/atomic_rule_engine_posting.test.sql` | 191 checks in one rolled-back transaction:<br>• A–E, G–I, K, L<br>• the claim (F), Manual entries (H2), claim rollback on failure (M1), legacy rule-owned rows left alone<br>• L1/L2, the paged worklist over 2,590 rows (M2), and the 0098 cross-tenant reader (CTR)<br>• privileges, validation, simulated crashes, index, trigger, re-applying the migration |
| Repair | `PSQL="docker exec -i <local db container> psql -U postgres" supabase/tests/repair_2151/run.sh` | M, N: the real repair and rollback files against a local replica with the production ids |
| End to end | `RULE_POSTING_LOCAL_SUPABASE_URL=http://127.0.0.1:<port> RULE_POSTING_LOCAL_SERVICE_ROLE_KEY=<local key> npx vitest run src/server/services/rule-engine-posting.scenario.test.ts` | Real services through PostgREST:<br>• 20 parallel posts of one transaction, 3 concurrent sweeps<br>• recovery, bounded sweeps<br>• H1 (200 unmatched before 3 matched, plus a legacy rule-owned row left byte-identical)<br>• M2 (1,100+ rows through the real 1,000-row limit, with a matched row and a recovery at the tail)<br>• H2 (a Manual entry through the real Cashbook)<br>• M1 (a database refusal, then one post)<br>• Bank Posting / Generate Journal refusal, tenant isolation |

All database and end-to-end tests are **local only**; the scripts refuse
remote targets and the repair seed refuses any database that already
contains the real Metanoia company.

Two notes on local setups:
- **Table privileges.** Recent local Supabase images grant the API roles less than production does. Production grants DML to `anon`/`authenticated`/`service_role` and relies on RLS. Grant the same privileges on the local database before running the database and end-to-end tests.
- **Production build.** `next build` needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Without them `/platform/operations` is prerendered in preview mode and fails on an existing `useSearchParams` Suspense issue. That failure is unrelated to this change and also occurs on `ce73e43`.

## Known limits

- **Journal date.** Banking Rule journals are still dated the day the rule posts them, not the transaction date, as before this change. The 384 existing Metanoia rule journals are all dated 2026-09-16 (FY2027 period 7) for March–July transactions. That is an accounting question for separate review; this change deliberately preserves it.
- **Cashbook posting is not yet atomic.**
  - **What is protected:** the new pre-check stops a Cashbook post over any entry that is already linked, flagged posted or carried by a Banking Rule journal, and Banking Rules no longer take Manual entries.
  - **What is not:** Cashbook still writes the ledger (`postApprovedJournals`, which also posts any other Approved journal in the company) before linking the entry. A **concurrent** Bank Posting or Generate Journal of the same Manual entry in that window could still post it twice. That is a pre-existing gap; both paths accept Manual entries.
  - **The fix:** a single database function that posts and links a Cashbook entry. It is a separate change.
- **M3 (not changed).** The request deadline stops new tasks from starting, but does not bound a task already running (e.g. BankSync or the AI sweep started at 199 s). Banking Rule postings are atomic, so this cannot create a half-posted transaction. It can leave such a task to be killed and retried.
- **L3 (not changed).** The audit helper accepts the caller's free-text reason. It only records links that genuinely exist, and the existing `record_automation_audit_entry` already allows the same.
- **L5 (not changed).** The Generate Journal draft rebuild uses `updateJournal` (delete lines, then insert). The journal is only a Draft, so a failure leaves an empty Draft, never a posting.
- **The "everything else" pass has no persistent cursor.** It restarts from the newest row each run. It is almost free for rows that already have their exception, and the deadline bounds it. If a run is cut short, the rows it reached have their exceptions, so successive runs move further on.
- **Unbounded callers.** `applyRulesToTransactions` (imports, bank feed, "Apply Rule") is not time-bounded. Each transaction is atomic, so a kill leaves no half-posted state.
- **Numbering.** Journal and batch numbers from other paths still use `COUNT(*)+1`. The unique constraints remain the backstop; a collision rolls that posting back, and with the claim inside the call, the transaction is retried by the next sweep.
