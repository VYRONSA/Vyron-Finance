-- Corrective migration for 0041 (already ran live) — the RPC's WHERE
-- clause matched allocation_status but not entry_source, so the
-- returned rows could include Manual (Cashbook-captured) transactions
-- that `getMatchingQueue`'s own JS loop then filtered back out. Moving
-- that filter server-side removes both a needless round-trip of rows
-- that were always going to be discarded and the need to return an
-- entry_source column the caller no longer needs. Matches this
-- codebase's own "an already-applied migration's file is never edited,
-- a follow-up migration corrects it" discipline (see 0034/0035).
drop function if exists fn_unmatched_bank_transactions(uuid, integer);

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
  where t.company_id = p_company_id and t.entry_source = 'Imported' and t.allocation_status in ('Suggested', 'Unallocated');

  return query
  select t.id, t.description, t.reference, t.allocation_status, t.debit, t.credit, t.transaction_date, t.confidence_score,
         (total_matching > p_limit) as has_more
  from ae_bank_transactions t
  where t.company_id = p_company_id and t.entry_source = 'Imported' and t.allocation_status in ('Suggested', 'Unallocated')
  order by t.transaction_date desc, t.id desc
  limit p_limit;
end;
$$;
