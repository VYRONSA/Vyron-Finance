-- Launch Blocker fix, part 2 — found during the Product Review Board's
-- own required "verify at scale well beyond RC2's test size" step.
-- Migration 0039's `fn_banking_automation_summary` eliminated the
-- application-memory transaction pull, but a live test at 1,000,000
-- rows (4x RC2's own 250,000-row test) surfaced a SECOND, independent
-- bottleneck: the function was `security invoker`, meaning
-- `ae_bank_transactions`' own RLS policy (`user_can_access_company(company_id)`)
-- still applies to every row the aggregate scans. Since every one of
-- those rows shares the exact same `company_id` (the function's own
-- `where company_id = p_company_id` already narrowed to one company),
-- RLS was independently re-answering the *identical* "can this user
-- access this company" question 1,000,000 times over — each answer
-- requiring its own subquery against `user_role_assignments`. Measured
-- live: 886ms bypassing RLS (superuser) vs. 15,455ms through RLS as an
-- authenticated user for the exact same query and data — the real
-- application code path timed out (Supabase's own PostgREST statement
-- timeout, ~8-9s) at this scale, a genuine correctness failure the
-- Product Review Board explicitly warned this class of bug would
-- become: "no longer just a performance issue — a correctness risk".
--
-- Fixed the way this codebase already handles every other case where a
-- privileged operation needs ONE access check rather than N per-row
-- checks (`assign_company_role`, `bootstrap_organisation`): `security
-- definer` (bypasses RLS on the table this function itself queries)
-- plus one explicit `user_can_access_company()` check at the top,
-- raising an exception if it fails. This is not a weaker security
-- boundary than RLS — it's the SAME boundary, checked once instead of
-- once per row, which is both correct (the answer cannot differ
-- between rows sharing one company_id) and the only way to make an
-- aggregate over many rows of one company actually scale.
drop function if exists fn_banking_automation_summary(uuid);

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
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not user_can_access_company(p_company_id) then
    raise exception 'Not authorized to access this company.';
  end if;

  return query
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
end;
$$;
