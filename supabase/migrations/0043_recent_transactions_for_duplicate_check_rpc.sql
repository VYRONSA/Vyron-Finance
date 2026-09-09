-- Launch Blocker fix, part 4 — the same RLS-per-row problem, a third
-- time, on a third distinct query shape. `getMatchingQueue`'s duplicate-
-- payment check window (0 rows in this live test, since the synthetic
-- data predates the 30-day window) still took 2.4 seconds: no index on
-- this table supports a `company_id` + `transaction_date` RANGE query
-- efficiently (the only index touching `transaction_date` is a unique
-- natural-key index led by `bank_account`, not usable for a pure date
-- range), and whatever rows Postgres does have to examine before it can
-- rule them out still pay the per-row `user_can_access_company()` RLS
-- cost. Fixed two ways at once, matching the standard already applied
-- to the same class of problem: a proper composite index (broadly
-- useful for any date-range query on this table, not just this one),
-- and the same `security definer` RPC pattern (0041/0042) so RLS is
-- checked once, not per row.
create index if not exists ae_bank_transactions_company_date_idx on ae_bank_transactions (company_id, transaction_date);

create function fn_recent_bank_transactions_for_duplicate_check(p_company_id uuid, p_date_from date, p_date_to date, p_limit integer)
returns table (
  id bigint,
  transaction_date date,
  debit numeric,
  credit numeric,
  beneficiary text
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
  select t.id, t.transaction_date, t.debit, t.credit, t.beneficiary
  from ae_bank_transactions t
  where t.company_id = p_company_id and t.transaction_date >= p_date_from and t.transaction_date <= p_date_to
  order by t.transaction_date desc, t.id desc
  limit p_limit;
end;
$$;
