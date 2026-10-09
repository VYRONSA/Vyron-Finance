-- Bulk Unallocate Bank Transactions by date range.
--
-- WHY A MIGRATION. A bank transaction's GL allocation lives on the row
-- itself: `suggested_gl_account` + `allocation_type = 'G'` +
-- `allocation_status`. `is_allocated` (0096) is GENERATED from
-- `suggested_gl_account`, so a row cannot keep its GL there and also be
-- unallocated — it would still read as allocated / Ready to Post. The
-- imported `gl_account` column is source data and is never written here.
-- There was no unallocate path before this one; clearing the allocation
-- would have destroyed the only live copy of the GL account. So:
--
--   1. `retained_gl_account` — the GL account a transaction carried when it
--      was unallocated. A reference for the next review ONLY: nothing reads
--      it as an allocation, `is_allocated` ignores it, posting ignores it.
--   2. `bank_unallocation_runs` / `bank_unallocation_run_items` — the
--      append-only audit of every bulk run and every transaction in it
--      (outcome, reason, previous allocation state, retained GL code and
--      name). Actor stamped from the session; no update/delete/truncate.
--   3. `fn_bank_unallocation_exclusion(row)` — the ONE eligibility rule,
--      shared by the preview and the execution.
--   4. `fn_preview_bank_unallocation(...)` — read-only candidate list.
--   5. `fn_bulk_unallocate_bank_transactions(...)` — the only writer. One
--      transaction; re-validates every row under a row lock; per-row
--      sub-transactions so a failure leaves that row untouched; refuses a
--      repeated request key.
--
-- WHAT THIS DOES NOT DO. It creates no journal, GL transaction, payment,
-- receipt or balancing entry. It never touches a posted, reconciled,
-- split, manual-cashbook, bill-matched or supplier/customer-allocated
-- transaction — those are excluded and the reason is shown. It never
-- changes a transaction's date, amount, description, reference, source
-- account or import identity, and never deletes a transaction.
--
-- Requires 0098 (user_has_permission) and 0111 (fn_session_actor_label).
-- Does NOT require 0102. Idempotent.

-- ---------------------------------------------------------------------
-- 1. The retained GL account.
-- ---------------------------------------------------------------------
alter table ae_bank_transactions
  add column if not exists retained_gl_account text;

comment on column ae_bank_transactions.retained_gl_account is
  'The GL account this transaction was allocated to when it was last bulk-unallocated (fn_bulk_unallocate_bank_transactions). A reference for the next review only: it is NOT an allocation, is_allocated ignores it, and nothing posts from it.';

-- ---------------------------------------------------------------------
-- 2. The audit tables.
-- ---------------------------------------------------------------------
create table if not exists bank_unallocation_runs (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  -- Client-generated once per preview; a second execution of the same
  -- preview is refused.
  request_key uuid not null unique,
  bank_account_id bigint references ae_bank_accounts (id) on delete set null,
  date_from date not null,
  date_to date not null,
  requested_count int not null check (requested_count >= 0),
  unallocated_count int not null check (unallocated_count >= 0),
  skipped_count int not null check (skipped_count >= 0),
  failed_count int not null check (failed_count >= 0),
  actor_user_id uuid not null,
  actor_label text not null check (length(btrim(actor_label)) > 0),
  executed_at timestamptz not null default now(),
  constraint bank_unallocation_runs_range check (date_from <= date_to),
  constraint bank_unallocation_runs_counts check (requested_count = unallocated_count + skipped_count + failed_count)
);

create index if not exists bank_unallocation_runs_company_idx
  on bank_unallocation_runs (company_id, executed_at desc);

create table if not exists bank_unallocation_run_items (
  id bigint generated always as identity primary key,
  run_id bigint not null references bank_unallocation_runs (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  -- No foreign key: the audit must outlive anything that happens to the
  -- transaction, and a refused id may not exist in this company at all.
  transaction_id bigint not null,
  outcome text not null check (outcome in ('unallocated', 'skipped', 'failed')),
  reason text not null default '',
  transaction_date date,
  debit numeric(14, 2),
  credit numeric(14, 2),
  previous_allocation_status text,
  previous_allocation_type text,
  previous_allocation_method text,
  previous_rule_id bigint,
  previous_is_manual_override boolean,
  previous_gl_account text,
  previous_gl_account_name text,
  unique (run_id, transaction_id)
);

create index if not exists bank_unallocation_run_items_txn_idx
  on bank_unallocation_run_items (company_id, transaction_id);

alter table bank_unallocation_runs enable row level security;
alter table bank_unallocation_run_items enable row level security;

-- Nobody writes these tables directly — not even the service role.
revoke all on table bank_unallocation_runs, bank_unallocation_run_items from public, anon, authenticated, service_role;
grant select on table bank_unallocation_runs, bank_unallocation_run_items to authenticated, service_role;

drop policy if exists "banking view reads unallocation runs" on bank_unallocation_runs;
create policy "banking view reads unallocation runs"
  on bank_unallocation_runs for select
  using (user_has_permission(company_id, 'Banking:View'));

drop policy if exists "banking view reads unallocation run items" on bank_unallocation_run_items;
create policy "banking view reads unallocation run items"
  on bank_unallocation_run_items for select
  using (user_has_permission(company_id, 'Banking:View'));

-- The actor is always the session's.
create or replace function fn_bank_unallocation_runs_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'a bulk unallocation can only be recorded for a signed-in user' using errcode = '42501';
  end if;
  new.actor_user_id := auth.uid();
  new.actor_label := left(coalesce(nullif(btrim(fn_session_actor_label()), ''), auth.uid()::text), 200);
  new.executed_at := now();
  return new;
end;
$$;
revoke execute on function fn_bank_unallocation_runs_stamp() from public, anon, authenticated, service_role;

drop trigger if exists bank_unallocation_runs_stamp on bank_unallocation_runs;
create trigger bank_unallocation_runs_stamp
  before insert on bank_unallocation_runs
  for each row execute function fn_bank_unallocation_runs_stamp();

-- Append-only, except a whole company being removed through a foreign-key
-- cascade (one trigger level deeper than any direct statement), as in 0113.
create or replace function fn_bank_unallocation_audit_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception '% is append-only: it cannot be truncated', tg_table_name;
  end if;
  if tg_op = 'UPDATE' then
    raise exception '% is append-only: a recorded unallocation cannot be modified', tg_table_name;
  end if;
  if pg_trigger_depth() <= 1 then
    raise exception '% is append-only: a recorded unallocation cannot be deleted', tg_table_name;
  end if;
  return old;
end;
$$;
revoke execute on function fn_bank_unallocation_audit_immutable() from public, anon, authenticated, service_role;

drop trigger if exists bank_unallocation_runs_immutable on bank_unallocation_runs;
create trigger bank_unallocation_runs_immutable
  before update or delete on bank_unallocation_runs
  for each row execute function fn_bank_unallocation_audit_immutable();
drop trigger if exists bank_unallocation_runs_no_truncate on bank_unallocation_runs;
create trigger bank_unallocation_runs_no_truncate
  before truncate on bank_unallocation_runs
  for each statement execute function fn_bank_unallocation_audit_immutable();

drop trigger if exists bank_unallocation_run_items_immutable on bank_unallocation_run_items;
create trigger bank_unallocation_run_items_immutable
  before update or delete on bank_unallocation_run_items
  for each row execute function fn_bank_unallocation_audit_immutable();
drop trigger if exists bank_unallocation_run_items_no_truncate on bank_unallocation_run_items;
create trigger bank_unallocation_run_items_no_truncate
  before truncate on bank_unallocation_run_items
  for each statement execute function fn_bank_unallocation_audit_immutable();

-- ---------------------------------------------------------------------
-- 3. The one eligibility rule. NULL = may be unallocated here; otherwise
--    the reason it may not, in words an accountant can act on.
-- ---------------------------------------------------------------------
create or replace function fn_bank_unallocation_exclusion(p_txn ae_bank_transactions)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when p_txn.journal_id is not null or p_txn.posted_flag or p_txn.posting_batch_id is not null
      then 'Posted to the general ledger. Reverse the posting first; a posted allocation is never changed here.'
    when p_txn.reconciliation_id is not null
      then 'Included in a bank reconciliation. Reopen the reconciliation first.'
    when p_txn.entry_source = 'Manual'
      then 'Manual cashbook entry. Change it in the Cashbook.'
    when p_txn.is_split
      then 'Split across several accounts. Change the split on the transaction itself.'
    when p_txn.matched_bill_id is not null
      then 'Matched to a supplier bill. Unmatch it in Matching first.'
    when p_txn.allocation_type in ('S', 'C')
      then 'Allocated to a supplier or customer, not to a GL account. Change it on the transaction itself.'
    when nullif(btrim(coalesce(p_txn.suggested_gl_account, '')), '') is null
      then case when p_txn.allocation_status = 'Unallocated' then 'Already unallocated.' else 'No GL account allocated.' end
    else null
  end
$$;
revoke execute on function fn_bank_unallocation_exclusion(ae_bank_transactions) from public, anon;
grant execute on function fn_bank_unallocation_exclusion(ae_bank_transactions) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Preview. Read-only, runs as the caller (RLS applies). Lists every
--    transaction DATED in the range (inclusive; transaction_date, never
--    the import or allocation date) that carries an allocation, eligible
--    or not. Banking:Edit, like the Find & Recode preview: it is the step
--    before a change. p_limit lets the caller detect an over-large range.
-- ---------------------------------------------------------------------
create or replace function fn_preview_bank_unallocation(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_bank_account_id bigint,
  p_limit int
)
returns table (
  id bigint,
  transaction_date date,
  description text,
  reference text,
  debit numeric,
  credit numeric,
  bank_account_id bigint,
  bank_account_name text,
  allocation_status text,
  allocation_method text,
  gl_account_code text,
  gl_account_name text,
  exclusion_reason text
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'a signed-in user is required' using errcode = '42501';
  end if;
  if not user_has_permission(p_company_id, 'Banking:Edit') then
    raise exception 'Banking:Edit is required' using errcode = '42501';
  end if;
  if p_date_from is null or p_date_to is null then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: From Date and To Date are required.' using errcode = '22023';
  end if;
  if p_date_from > p_date_to then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: From Date cannot be later than To Date.' using errcode = '22023';
  end if;

  return query
    select t.id, t.transaction_date, t.description, t.reference, t.debit, t.credit,
           t.bank_account_id, coalesce(nullif(ba.account_name, ''), ba.account_number),
           t.allocation_status, t.allocation_method,
           nullif(btrim(coalesce(t.suggested_gl_account, '')), ''),
           coa.description,
           fn_bank_unallocation_exclusion(t)
    from ae_bank_transactions t
    left join ae_bank_accounts ba on ba.id = t.bank_account_id and ba.company_id = t.company_id
    left join chart_of_accounts coa on coa.company_id = t.company_id and coa.account_code = btrim(t.suggested_gl_account)
    where t.company_id = p_company_id
      and t.transaction_date between p_date_from and p_date_to
      and (p_bank_account_id is null or t.bank_account_id = p_bank_account_id)
      and (t.allocation_status <> 'Unallocated' or t.is_allocated)
    order by t.transaction_date, t.id
    limit greatest(coalesce(p_limit, 5001), 1);
end;
$$;
revoke execute on function fn_preview_bank_unallocation(uuid, date, date, bigint, int) from public, anon, service_role;
grant execute on function fn_preview_bank_unallocation(uuid, date, date, bigint, int) to authenticated;

-- ---------------------------------------------------------------------
-- 5. The writer.
--
-- p_items: [{ "id": <transaction id>, "glAccount": "<GL code the preview
-- showed>" }, ...]. A row whose GL changed since the preview is skipped,
-- never unallocated on a stale picture.
--
-- Per eligible row:
--   suggested_gl_account -> NULL (so is_allocated becomes false)
--   retained_gl_account  -> the GL it had (kept for the next review)
--   allocation_status    -> 'Unallocated'; allocation_type, allocation_method, rule_id -> NULL
--   is_manual_override   -> true  (a person decided: neither the Rule
--                                   Engine nor AI classification may
--                                   automatically re-allocate it —
--                                   fn_bank_transaction_is_claimable_by_rule
--                                   and isEligibleForAiClassification
--                                   both require false)
-- Untouched: VAT treatment, supplier/customer/merchant identification,
-- review status/hold, notes, and every source/identity column.
-- One ae_allocation_history row per unallocated transaction, like every
-- other allocation change.
-- ---------------------------------------------------------------------
create or replace function fn_bulk_unallocate_bank_transactions(
  p_company_id uuid,
  p_request_key uuid,
  p_date_from date,
  p_date_to date,
  p_bank_account_id bigint,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text;
  v_ids bigint[];
  v_expected jsonb := '{}'::jsonb;
  v_item jsonb;
  v_id bigint;
  v_txn ae_bank_transactions;
  v_gl text;
  v_gl_name text;
  v_reason text;
  v_outcome text;
  v_run_id bigint;
  v_rows jsonb := '[]'::jsonb;
  v_results jsonb;
  v_unallocated int := 0;
  v_skipped int := 0;
  v_failed int := 0;
begin
  if auth.uid() is null then
    raise exception 'a signed-in user is required' using errcode = '42501';
  end if;
  if not user_has_permission(p_company_id, 'Banking:Edit') then
    raise exception 'Banking:Edit is required' using errcode = '42501';
  end if;
  if p_request_key is null then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: a request key is required.' using errcode = '22023';
  end if;
  if p_date_from is null or p_date_to is null then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: From Date and To Date are required.' using errcode = '22023';
  end if;
  if p_date_from > p_date_to then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: From Date cannot be later than To Date.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: select at least one transaction.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 5000 then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: at most 5000 transactions per run; narrow the date range.' using errcode = '22023';
  end if;
  if p_bank_account_id is not null
     and not exists (select 1 from ae_bank_accounts where id = p_bank_account_id and company_id = p_company_id) then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: that bank account does not belong to this company.' using errcode = '42501';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'id') <> 'number' then
      raise exception 'PRECISIA_UNALLOCATION_INVALID: every item needs a numeric id.' using errcode = '22023';
    end if;
    v_expected := v_expected || jsonb_build_object(v_item->>'id', coalesce(v_item->>'glAccount', ''));
  end loop;
  select array_agg(distinct k::bigint order by k::bigint) into v_ids from jsonb_object_keys(v_expected) k;

  -- One execution per preview, even under a double click or a retry.
  perform pg_advisory_xact_lock(hashtextextended('bank-unallocation:' || p_request_key::text, 0));
  if exists (select 1 from bank_unallocation_runs where request_key = p_request_key) then
    raise exception 'PRECISIA_UNALLOCATION_DUPLICATE: this preview has already been executed. Preview again to start a new run.'
      using errcode = '23505';
  end if;

  v_actor := left(coalesce(nullif(btrim(fn_session_actor_label()), ''), auth.uid()::text), 200);
  v_run_id := nextval(pg_get_serial_sequence('bank_unallocation_runs', 'id'));

  -- Lock every requested row of THIS company, in id order (no deadlock
  -- between two overlapping runs), before deciding anything.
  perform 1 from ae_bank_transactions
    where company_id = p_company_id and id = any(v_ids)
    order by id
    for update;

  foreach v_id in array v_ids loop
    v_txn := null;
    v_gl := null;
    v_gl_name := null;
    select * into v_txn from ae_bank_transactions where company_id = p_company_id and id = v_id;

    if v_txn.id is null then
      v_outcome := 'skipped';
      v_reason := 'Transaction not found in this company.';
    else
      v_gl := nullif(btrim(coalesce(v_txn.suggested_gl_account, '')), '');
      select description into v_gl_name from chart_of_accounts where company_id = p_company_id and account_code = v_gl limit 1;
      v_reason := fn_bank_unallocation_exclusion(v_txn);
      if v_reason is null and (v_txn.transaction_date is null or v_txn.transaction_date not between p_date_from and p_date_to) then
        v_reason := 'Outside the selected date range.';
      end if;
      if v_reason is null and p_bank_account_id is not null and v_txn.bank_account_id is distinct from p_bank_account_id then
        v_reason := 'Not on the selected bank account.';
      end if;
      if v_reason is null and coalesce(v_gl, '') <> btrim(v_expected->>v_id::text) then
        v_reason := format('Changed since the preview (GL account is now %s). Preview again.', coalesce(v_gl, 'none'));
      end if;

      if v_reason is not null then
        v_outcome := 'skipped';
      else
        begin
          update ae_bank_transactions
             set retained_gl_account = v_gl,
                 suggested_gl_account = null,
                 allocation_type = null,
                 allocation_status = 'Unallocated',
                 allocation_method = null,
                 rule_id = null,
                 is_manual_override = true,
                 allocation_reason = format('Bulk unallocated (run %s); GL account %s retained for review', v_run_id, v_gl)
           where company_id = p_company_id and id = v_id;

          insert into ae_allocation_history (
            company_id, transaction_id, previous_status, new_status, previous_gl_account, new_gl_account,
            previous_vat_code, new_vat_code, allocation_method, allocation_reason, is_manual_override, performed_by
          ) values (
            p_company_id, v_id, v_txn.allocation_status, 'Unallocated', v_gl, null,
            v_txn.suggested_vat_code, v_txn.suggested_vat_code, 'Manual',
            format('Bulk unallocated (run %s); GL account %s retained for review', v_run_id, v_gl), true, v_actor
          );
          v_outcome := 'unallocated';
          v_reason := '';
        exception when others then
          -- The sub-transaction is rolled back: this row is exactly as it was.
          v_outcome := 'failed';
          v_reason := left(sqlerrm, 500);
        end;
      end if;
    end if;

    if v_outcome = 'unallocated' then v_unallocated := v_unallocated + 1;
    elsif v_outcome = 'skipped' then v_skipped := v_skipped + 1;
    else v_failed := v_failed + 1;
    end if;

    v_rows := v_rows || jsonb_build_object(
      'transaction_id', v_id, 'outcome', v_outcome, 'reason', v_reason,
      'transaction_date', v_txn.transaction_date, 'debit', v_txn.debit, 'credit', v_txn.credit,
      'previous_allocation_status', v_txn.allocation_status, 'previous_allocation_type', v_txn.allocation_type,
      'previous_allocation_method', v_txn.allocation_method, 'previous_rule_id', v_txn.rule_id,
      'previous_is_manual_override', v_txn.is_manual_override,
      'previous_gl_account', v_gl, 'previous_gl_account_name', v_gl_name
    );
  end loop;

  insert into bank_unallocation_runs (
    id, company_id, request_key, bank_account_id, date_from, date_to,
    requested_count, unallocated_count, skipped_count, failed_count, actor_user_id, actor_label
  ) overriding system value values (
    v_run_id, p_company_id, p_request_key, p_bank_account_id, p_date_from, p_date_to,
    coalesce(array_length(v_ids, 1), 0), v_unallocated, v_skipped, v_failed, auth.uid(), 'session'
  );

  insert into bank_unallocation_run_items (
    run_id, company_id, transaction_id, outcome, reason, transaction_date, debit, credit,
    previous_allocation_status, previous_allocation_type, previous_allocation_method,
    previous_rule_id, previous_is_manual_override, previous_gl_account, previous_gl_account_name
  )
  select v_run_id, p_company_id, r.transaction_id, r.outcome, r.reason, r.transaction_date, r.debit, r.credit,
         r.previous_allocation_status, r.previous_allocation_type, r.previous_allocation_method,
         r.previous_rule_id, r.previous_is_manual_override, r.previous_gl_account, r.previous_gl_account_name
  from jsonb_to_recordset(v_rows) as r(
    transaction_id bigint, outcome text, reason text, transaction_date date, debit numeric, credit numeric,
    previous_allocation_status text, previous_allocation_type text, previous_allocation_method text,
    previous_rule_id bigint, previous_is_manual_override boolean, previous_gl_account text, previous_gl_account_name text
  )
  order by r.transaction_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'transactionId', (r->>'transaction_id')::bigint,
           'outcome', r->>'outcome',
           'reason', r->>'reason',
           'glAccount', r->>'previous_gl_account',
           'glAccountName', r->>'previous_gl_account_name'
         ) order by (r->>'transaction_id')::bigint), '[]'::jsonb)
    into v_results
    from jsonb_array_elements(v_rows) r;

  return jsonb_build_object(
    'runId', v_run_id,
    'requested', coalesce(array_length(v_ids, 1), 0),
    'unallocated', v_unallocated,
    'skipped', v_skipped,
    'failed', v_failed,
    'items', v_results
  );
end;
$$;
revoke execute on function fn_bulk_unallocate_bank_transactions(uuid, uuid, date, date, bigint, jsonb) from public, anon, service_role;
grant execute on function fn_bulk_unallocate_bank_transactions(uuid, uuid, date, date, bigint, jsonb) to authenticated;
