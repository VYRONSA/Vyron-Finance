-- Launch Blocker fix, part 3 — the same RLS-per-row problem found and
-- fixed for the banking-automation aggregate (0040) also affects any
-- plain SELECT that needs to scan/sort a large fraction of one
-- company's own rows, not just aggregates. Proven live: querying up to
-- 800,000 "Suggested"/"Unallocated" transactions (out of 1,000,000
-- total, in an adversarial worst-case test — a real, if extreme,
-- scenario for a company that stopped running its matching engine for
-- a long period) to find the most recent 500, sorted, took 14.9 seconds
-- — Postgres must evaluate `user_can_access_company(company_id)` for
-- every one of the 800,000 rows satisfying the WHERE clause before it
-- can determine which 500 sort to the top, timing out the real request
-- path (Supabase's PostgREST statement timeout, ~8-9s).
--
-- `getMatchingQueue`'s "every unmatched item must appear" listing is
-- the one caller that hits this specific shape (status-filtered,
-- sorted, capped) — fixed with a narrow, purpose-built RPC mirroring
-- exactly what that one caller needs, not a rewrite of the general
-- Transaction Explorer query engine (`queryTransactions`), which
-- remains security invoker and serves the interactive, already-
-- pagination-bounded Transaction Explorer UI correctly as-is. Same
-- `security definer` + one explicit `user_can_access_company()` check
-- pattern as 0040 and every other privileged-operation RPC in this
-- codebase (`assign_company_role`, `bootstrap_organisation`).
create function fn_unmatched_bank_transactions(p_company_id uuid, p_limit integer)
returns table (
  id bigint,
  description text,
  reference text,
  allocation_status text,
  debit numeric,
  credit numeric,
  transaction_date date,
  confidence_score numeric,
  has_more boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  total_matching bigint;
begin
  if not user_can_access_company(p_company_id) then
    raise exception 'Not authorized to access this company.';
  end if;

  select count(*) into total_matching
  from ae_bank_transactions t
  where t.company_id = p_company_id and t.allocation_status in ('Suggested', 'Unallocated');

  return query
  select t.id, t.description, t.reference, t.allocation_status, t.debit, t.credit, t.transaction_date, t.confidence_score,
         (total_matching > p_limit) as has_more
  from ae_bank_transactions t
  where t.company_id = p_company_id and t.allocation_status in ('Suggested', 'Unallocated')
  order by t.transaction_date desc, t.id desc
  limit p_limit;
end;
$$;
