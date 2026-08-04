-- Launch Blocker fix (Product Review Board, post-RC2). RC2's own load
-- testing found that `buildBankingAutomationSummary`/`buildMatchingSummary`
-- — used by the Dashboard, Automation Dashboard, and Matching pages —
-- computed all-time ratios by pulling a company's ENTIRE bank
-- transaction history into application memory via
-- `listTransactionsForExport`'s batched-export path, then reducing it
-- in JavaScript. Confirmed live: Dashboard response time regressed from
-- 3.2s to 5.6-8.3s at 20,000 transactions, and would continue to scale
-- linearly (worse, given the platform's 1,000-row-per-request cap) with
-- no upper bound. The Product Review Board classified this as a launch
-- blocker: "no longer just a performance issue — a correctness risk for
-- larger customers" (an unbounded query is one bad day away from a
-- timeout, at which point the summary tile fails outright, not just
-- slowly).
--
-- Fixed the way `fn_transaction_explorer_summary` (0005) and
-- `fn_trial_balance` (0007) already established: one server-side
-- aggregate query, `count(*) filter (where ...)`, instead of pulling
-- rows to count/reduce in JavaScript. Same `security invoker` + explicit
-- `where company_id = p_company_id` pattern — RLS is still the real
-- boundary, this filter is defense-in-depth, matching this codebase's
-- own "never rely on RLS alone" convention.
create function fn_banking_automation_summary(p_company_id uuid)
returns table (
  total_transactions bigint,
  automated bigint,
  imported bigint,
  imported_matched bigint,
  imported_rule_applied bigint,
  imported_rule_succeeded bigint,
  imported_with_confidence bigint,
  imported_confidence_sum numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) as total_transactions,
    count(*) filter (where rule_id is not null and journal_id is not null) as automated,
    count(*) filter (where entry_source = 'Imported') as imported,
    count(*) filter (where entry_source = 'Imported' and allocation_status = 'Matched') as imported_matched,
    count(*) filter (where entry_source = 'Imported' and rule_id is not null) as imported_rule_applied,
    count(*) filter (where entry_source = 'Imported' and rule_id is not null and allocation_status in ('Matched', 'Allocated')) as imported_rule_succeeded,
    count(*) filter (where entry_source = 'Imported' and confidence_score is not null) as imported_with_confidence,
    coalesce(sum(confidence_score) filter (where entry_source = 'Imported' and confidence_score is not null), 0) as imported_confidence_sum
  from ae_bank_transactions
  where company_id = p_company_id;
$$;
