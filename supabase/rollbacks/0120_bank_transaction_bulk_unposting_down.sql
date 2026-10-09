-- Rollback for 0120_bank_transaction_bulk_unposting.sql.
--
-- REFUSES once any bulk unposting has run, or any customer / supplier has
-- been retained: the run audit and the reversal journals it references are
-- permanent records, and dropping the retained columns would erase what
-- those runs kept for review. (Reversal journals are ordinary posted
-- journals; this script never touches journals or the ledger.)
--
-- Before any unposting run it removes everything 0120 added and restores
-- 0119's writer and audit constraints exactly. 0119 runs recorded after 0120
-- are kept; their new columns hold only defaults and are dropped.

begin;

do $$
begin
  if exists (select 1 from bank_unallocation_runs where mode = 'unpost')
     or exists (select 1 from ae_bank_transactions where retained_customer_id is not null or retained_supplier_id is not null) then
    raise exception '0120 rollback refused: bulk unposting audit records or retained customers/suppliers exist (they are permanent)';
  end if;
end $$;

drop function if exists fn_bulk_unpost_bank_transactions(uuid, uuid, date, date, bigint, jsonb);
drop function if exists fn_preview_bank_unposting(uuid, date, date, bigint, int);
drop function if exists fn_bank_unposting_next_number(uuid, text);
drop function if exists fn_bank_unposting_exclusion(ae_bank_transactions);
drop function if exists fn_bank_unposting_journal_exclusion(uuid, bigint, bigint);
drop function if exists fn_bank_unposting_row_exclusion(ae_bank_transactions);

-- 0119's writer, exactly as 0119 created it.
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

alter table bank_unallocation_run_items drop constraint if exists bank_unallocation_run_items_outcome_check;
alter table bank_unallocation_run_items add constraint bank_unallocation_run_items_outcome_check
  check (outcome in ('unallocated', 'skipped', 'failed'));
alter table bank_unallocation_run_items
  drop column if exists previous_posted_flag,
  drop column if exists previous_journal_id,
  drop column if exists previous_journal_number,
  drop column if exists previous_journal_source_type,
  drop column if exists previous_posting_batch_id,
  drop column if exists reversal_journal_id,
  drop column if exists reversal_journal_number,
  drop column if exists previous_customer_id,
  drop column if exists previous_customer_code,
  drop column if exists previous_supplier_id,
  drop column if exists previous_supplier_code;

alter table bank_unallocation_runs drop constraint if exists bank_unallocation_runs_counts;
alter table bank_unallocation_runs drop constraint if exists bank_unallocation_runs_unposting_counts;
alter table bank_unallocation_runs drop constraint if exists bank_unallocation_runs_mode;
alter table bank_unallocation_runs
  drop column if exists mode,
  drop column if exists unposted_count,
  drop column if exists reversed_journal_count,
  drop column if exists reversal_posting_batch_id;
alter table bank_unallocation_runs add constraint bank_unallocation_runs_counts
  check (requested_count = unallocated_count + skipped_count + failed_count);

alter table ae_bank_transactions
  drop column if exists retained_customer_id,
  drop column if exists retained_supplier_id;

commit;
