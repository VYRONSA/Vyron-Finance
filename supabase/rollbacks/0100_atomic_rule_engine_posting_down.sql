-- =====================================================================
-- DOWN script for migration 0100 (atomic Banking Rule posting).
--
-- NOT A MIGRATION. Use only together with a rollback of the application
-- to a build that does not call fn_post_rule_engine_journal /
-- fn_recover_rule_engine_journal_link / fn_claim_bank_transaction_for_rule /
-- the fn_list_rule_engine_* functions (i.e. before 0100's code). Rolling
-- back the database alone would break the deployed rule engine.
-- =====================================================================
--
-- Removes the objects 0100 added and restores `fn_post_bank_transactions`
-- to its exact 0092 definition (copied verbatim below). Changes no data:
-- journals, lines, batches, GL rows, transactions and audit entries
-- written while 0100 was live all stay as they are — they are ordinary,
-- valid rows under the pre-0100 schema too.
--
-- WARNING: after this, the protections 0100 added are gone: a transaction
-- carried by a Banking Rule journal but not linked to it (the 2151 state)
-- can again be posted a second time by Bank Posting. Check first:
--
--   select t.id from ae_bank_transactions t
--   join ae_journals j on j.company_id = t.company_id and j.source_type = 'bank_transaction_rule_engine' and j.source_id = t.id
--   where j.status = 'Posted' and not j.is_reversed and (t.journal_id is null or not t.posted_flag);

begin;

drop trigger if exists ae_bank_transactions_rule_engine_journal_guard on ae_bank_transactions;
drop function if exists fn_guard_rule_engine_journal_link();
drop function if exists fn_post_rule_engine_journal(uuid, bigint, jsonb, text, date, jsonb);
drop function if exists fn_post_rule_engine_journal(uuid, bigint, jsonb, text);
drop function if exists fn_list_rule_engine_worklist(uuid, boolean, date, bigint, int);
drop function if exists fn_list_rule_engine_recovery_candidates(uuid, int);
drop function if exists fn_claim_bank_transaction_for_rule(uuid, bigint, jsonb, text);
drop function if exists fn_bank_transaction_is_claimable_by_rule(ae_bank_transactions);
drop function if exists fn_recover_rule_engine_journal_link(uuid, bigint, text);
drop function if exists fn_record_rule_engine_link_audit(uuid, bigint, bigint, text, text, text, jsonb);

-- 0092's definition, verbatim (no Banking Rule journal check in the claim).
create or replace function fn_post_bank_transactions(
  p_company_id uuid,
  p_transaction_ids bigint[],
  p_journals jsonb,
  p_batch_number text,
  p_posting_date date,
  p_posted_by text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claimed bigint[];
  v_claimed_count int;
  v_batch_id bigint;
  v_batch_row record;
  v_journal jsonb;
  v_journal_id bigint;
  v_journal_txn_ids bigint[];
  v_journal_claimed_ids bigint[];
  v_total_debit numeric(14, 2);
  v_total_credit numeric(14, 2);
  v_missing_accounts text;
  v_journals_out jsonb := '[]'::jsonb;
  v_gl_line_count int := 0;
  v_journal_count int := 0;
begin
  -- Claim. `posted_flag = false and journal_id is null` is the whole
  -- double-post guard: an already-posted transaction, or one already
  -- attached to another journal, is simply not claimed and is reported
  -- back to the caller as unchanged.
  with claimed as (
    update ae_bank_transactions
      set posted_flag = true, posted_at = now()
      where company_id = p_company_id
        and id = any(p_transaction_ids)
        and posted_flag = false
        and journal_id is null
      returning id
  )
  select coalesce(array_agg(id), '{}'::bigint[]) into v_claimed from claimed;

  v_claimed_count := coalesce(array_length(v_claimed, 1), 0);
  if v_claimed_count = 0 then
    return jsonb_build_object('batch', null, 'journals', '[]'::jsonb, 'claimedTransactionIds', '[]'::jsonb);
  end if;

  insert into posting_batches (company_id, batch_number, posting_date, journal_count, transaction_count, posted_by)
  values (p_company_id, p_batch_number, p_posting_date, 0, 0, p_posted_by)
  returning id into v_batch_id;

  for v_journal in select value from jsonb_array_elements(p_journals) loop
    select coalesce(array_agg(t.txn_id::bigint), '{}'::bigint[])
      into v_journal_txn_ids
      from jsonb_array_elements_text(v_journal->'transactionIds') as t(txn_id);

    select coalesce(array_agg(u.txn_id), '{}'::bigint[])
      into v_journal_claimed_ids
      from unnest(v_journal_txn_ids) as u(txn_id)
      where u.txn_id = any(v_claimed);

    -- Every transaction this journal covered was claimed by a concurrent
    -- run: nothing left to post, so no empty journal is created.
    if coalesce(array_length(v_journal_claimed_ids, 1), 0) = 0 then
      continue;
    end if;

    select string_agg(distinct l.account_code, ', ')
      into v_missing_accounts
      from jsonb_array_elements(v_journal->'lines') r
      cross join lateral (select r->>'accountCode' as account_code, (r->>'transactionId')::bigint as tid) l
      where l.tid = any(v_journal_claimed_ids)
        and not exists (
          select 1 from chart_of_accounts c
          where c.company_id = p_company_id and c.account_code = l.account_code
        );
    if v_missing_accounts is not null then
      raise exception 'VYRON_POST_NO_ACCOUNT: no Chart of Accounts entry for account code(s): %', v_missing_accounts;
    end if;

    select coalesce(round(sum((r->>'debit')::numeric), 2), 0), coalesce(round(sum((r->>'credit')::numeric), 2), 0)
      into v_total_debit, v_total_credit
      from jsonb_array_elements(v_journal->'lines') r
      where (r->>'transactionId')::bigint = any(v_journal_claimed_ids);

    if abs(v_total_debit - v_total_credit) > 0.01 then
      raise exception 'VYRON_POST_UNBALANCED: journal % debit % <> credit %', v_journal->>'journalNumber', v_total_debit, v_total_credit;
    end if;

    insert into ae_journals (
      company_id, journal_number, journal_date, journal_type, description, reference,
      source_type, source_id, status, total_debit, total_credit, posted_at,
      submitted_by, submitted_at, approved_by, approved_at, posting_batch_id
    )
    values (
      p_company_id,
      v_journal->>'journalNumber',
      (v_journal->>'journalDate')::date,
      coalesce(v_journal->>'journalType', 'Bank Transactions'),
      coalesce(v_journal->>'description', ''),
      coalesce(v_journal->>'reference', ''),
      'bank_transactions_post',
      null,
      'Posted',
      v_total_debit,
      v_total_credit,
      now(),
      p_posted_by, now(), p_posted_by, now(),
      v_batch_id
    )
    returning id into v_journal_id;

    insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order)
    select
      v_journal_id,
      r->>'accountCode',
      (r->>'debit')::numeric,
      (r->>'credit')::numeric,
      coalesce(r->>'description', ''),
      (t.ord - 1)::int
    from jsonb_array_elements(v_journal->'lines') with ordinality t(r, ord)
    where (r->>'transactionId')::bigint = any(v_journal_claimed_ids);

    insert into gl_transactions (
      company_id, journal_id, journal_line_id, account_id, posting_date, reference, description,
      debit, credit, financial_year_label, financial_period, posted_by
    )
    select
      p_company_id,
      v_journal_id,
      jl.id,
      c.id,
      (v_journal->>'journalDate')::date,
      coalesce(v_journal->>'reference', ''),
      case when jl.description <> '' then jl.description else coalesce(v_journal->>'description', '') end,
      jl.debit,
      jl.credit,
      coalesce(v_journal->>'financialYearLabel', ''),
      coalesce((v_journal->>'financialPeriod')::int, 0),
      p_posted_by
    from ae_journal_lines jl
    join chart_of_accounts c on c.company_id = p_company_id and c.account_code = jl.account_code
    where jl.journal_id = v_journal_id;

    -- Back-link every claimed transaction to the journal and batch that
    -- carried it into the ledger. This is what makes a posted row
    -- traceable to its GL entries and its GL entries traceable back to
    -- the originating bank transaction.
    update ae_bank_transactions
      set journal_id = v_journal_id, posting_batch_id = v_batch_id
      where company_id = p_company_id and id = any(v_journal_claimed_ids);

    v_journal_count := v_journal_count + 1;
    v_gl_line_count := v_gl_line_count + (select count(*) from ae_journal_lines where journal_id = v_journal_id);
    v_journals_out := v_journals_out || jsonb_build_object(
      'id', v_journal_id,
      'journalNumber', v_journal->>'journalNumber',
      'journalDate', v_journal->>'journalDate',
      'transactionIds', to_jsonb(v_journal_claimed_ids)
    );
  end loop;

  update posting_batches
    set journal_count = v_journal_count, transaction_count = v_gl_line_count
    where id = v_batch_id;

  select id, company_id, batch_number, posting_date, journal_count, transaction_count, posted_by, created_at
    into v_batch_row
    from posting_batches where id = v_batch_id;

  return jsonb_build_object(
    'batch', jsonb_build_object(
      'id', v_batch_row.id,
      'companyId', v_batch_row.company_id,
      'batchNumber', v_batch_row.batch_number,
      'postingDate', v_batch_row.posting_date,
      'journalCount', v_batch_row.journal_count,
      'transactionCount', v_batch_row.transaction_count,
      'postedBy', v_batch_row.posted_by,
      'createdAt', v_batch_row.created_at
    ),
    'journals', v_journals_out,
    'claimedTransactionIds', to_jsonb(v_claimed)
  );
end;
$$;

drop function if exists fn_bank_transaction_has_live_rule_engine_journal(uuid, bigint);
drop index if exists ae_journals_rule_engine_source_key;

commit;
