-- =====================================================================
-- DOWN for 0102_rule_engine_security_hardening.sql — NOT A MIGRATION.
-- Run only if 0102 must be removed. Restores exactly the 0100 state:
-- the two guard triggers and their functions are dropped, the atomic
-- posting function returns to its 0100 body, the two policies return to
-- USING-only (identical effective check), and the bulk posting functions'
-- EXECUTE grants return to what production had before 0102 (PUBLIC and
-- anon included). No data row is touched.
-- =====================================================================

begin;

drop trigger if exists ae_journals_rule_engine_write_guard on ae_journals;
drop trigger if exists ae_journal_lines_rule_engine_write_guard on ae_journal_lines;
drop trigger if exists ae_bank_transactions_link_guard on ae_bank_transactions;
drop function if exists fn_guard_rule_engine_journal_write();
drop function if exists fn_guard_rule_engine_journal_line_write();
drop function if exists fn_guard_bank_transaction_links();
drop function if exists fn_is_api_caller();

create or replace function fn_post_rule_engine_journal(
  p_company_id uuid,
  p_transaction_id bigint,
  p_journal jsonb,
  p_posted_by text,
  p_posting_date date,
  p_claim jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_recovery jsonb;
  v_txn record;
  v_line jsonb;
  v_line_count int;
  v_total_debit numeric(14, 2);
  v_total_credit numeric(14, 2);
  v_expected numeric(14, 2);
  v_missing_accounts text;
  v_journal_date date;
  v_fy_label text;
  v_fy_period int;
  v_next bigint;
  v_journal_number text;
  v_batch_number text;
  v_batch_id bigint;
  v_journal_id bigint;
  v_gl_count int;
  v_updated int;
  v_posted_by text := coalesce(nullif(p_posted_by, ''), 'System');
begin
  v_recovery := fn_recover_rule_engine_journal_link(p_company_id, p_transaction_id, v_posted_by);
  if v_recovery->>'outcome' <> 'no_journal' then
    return v_recovery;
  end if;

  -- Already locked FOR UPDATE by the recovery call above.
  select id, debit, credit, journal_id, posted_flag, reconciliation_id, is_manual_override, review_hold, entry_source
    into v_txn
    from ae_bank_transactions
    where company_id = p_company_id and id = p_transaction_id;

  if v_txn.journal_id is not null or v_txn.posted_flag or v_txn.reconciliation_id is not null then
    return jsonb_build_object('outcome', 'already_posted', 'transactionId', p_transaction_id, 'journalId', v_txn.journal_id,
      'reason', 'The transaction is already posted, linked to a journal, or reconciled.');
  end if;
  if v_txn.is_manual_override or v_txn.review_hold then
    return jsonb_build_object('outcome', 'not_eligible', 'transactionId', p_transaction_id,
      'reason', 'The transaction was taken over by a person (manual override or review hold) after the rule matched it.');
  end if;
  if v_txn.entry_source = 'Manual' then
    return jsonb_build_object('outcome', 'not_eligible', 'transactionId', p_transaction_id,
      'reason', 'Manual Cashbook entries are approved and posted from the Cashbook, never by a Banking Rule.');
  end if;

  -- Backstop validation. Nothing has been written yet.
  if p_journal is null or jsonb_typeof(p_journal->'lines') <> 'array' or jsonb_array_length(p_journal->'lines') = 0 then
    raise exception 'VYRON_RULE_POST_NO_LINES: journal for transaction % has no lines.', p_transaction_id;
  end if;
  v_journal_date := nullif(p_journal->>'journalDate', '')::date;
  v_fy_label := nullif(p_journal->>'financialYearLabel', '');
  v_fy_period := nullif(p_journal->>'financialPeriod', '')::int;
  if v_journal_date is null or v_fy_label is null or v_fy_period is null then
    raise exception 'VYRON_RULE_POST_NO_PERIOD: journal date and financial period are required.';
  end if;
  if p_posting_date is null then
    raise exception 'VYRON_RULE_POST_NO_PERIOD: a posting date is required.';
  end if;
  if p_claim is null or jsonb_typeof(p_claim) <> 'object'
     or nullif(p_claim->>'ruleId', '') is null
     or nullif(p_claim->>'suggestedGlAccount', '') is null
     or nullif(p_claim->>'allocationStatus', '') is null then
    raise exception 'VYRON_RULE_POST_NO_CLAIM: posting needs the rule''s claim (rule, GL account, allocation status).';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_journal->'lines') r where r->>'accountCode' = p_claim->>'suggestedGlAccount') then
    raise exception 'VYRON_RULE_POST_CLAIM_MISMATCH: the journal does not post to the claimed GL account %.', p_claim->>'suggestedGlAccount';
  end if;

  for v_line in select value from jsonb_array_elements(p_journal->'lines') loop
    if coalesce(v_line->>'accountCode', '') = ''
       or coalesce((v_line->>'debit')::numeric, -1) < 0 or coalesce((v_line->>'credit')::numeric, -1) < 0
       or ((v_line->>'debit')::numeric > 0 and (v_line->>'credit')::numeric > 0) then
      raise exception 'VYRON_RULE_POST_BAD_LINE: invalid journal line %.', v_line;
    end if;
  end loop;

  select count(*), coalesce(round(sum((r->>'debit')::numeric), 2), 0), coalesce(round(sum((r->>'credit')::numeric), 2), 0)
    into v_line_count, v_total_debit, v_total_credit
    from jsonb_array_elements(p_journal->'lines') r;
  if v_total_debit <> v_total_credit or v_total_debit = 0 then
    raise exception 'VYRON_RULE_POST_UNBALANCED: debit % <> credit %.', v_total_debit, v_total_credit;
  end if;
  v_expected := round(greatest(v_txn.debit, v_txn.credit), 2);
  if v_total_debit <> v_expected then
    raise exception 'VYRON_RULE_POST_AMOUNT_MISMATCH: journal total % does not equal transaction amount %.', v_total_debit, v_expected;
  end if;

  select string_agg(distinct r->>'accountCode', ', ')
    into v_missing_accounts
    from jsonb_array_elements(p_journal->'lines') r
    where not exists (
      select 1 from chart_of_accounts c
      where c.company_id = p_company_id and c.account_code = r->>'accountCode'
    );
  if v_missing_accounts is not null then
    raise exception 'VYRON_RULE_POST_NO_ACCOUNT: no Chart of Accounts entry for account code(s): %', v_missing_accounts;
  end if;

  -- The claim, in this transaction (the row is already locked).
  -- The allocation history keeps the sweep's own actor label, as before.
  if not fn_claim_bank_transaction_for_rule(p_company_id, p_transaction_id, p_claim, coalesce(nullif(p_claim->>'performedBy', ''), v_posted_by)) then
    return jsonb_build_object('outcome', 'not_eligible', 'transactionId', p_transaction_id,
      'reason', 'The transaction is no longer open to a Banking Rule (another rule, the Matching Engine or a person has taken it).');
  end if;

  -- Numbering, serialized per company for this path.
  perform pg_advisory_xact_lock(hashtextextended('vyron.rule_engine_posting.' || p_company_id::text, 0));

  select coalesce(max(substring(journal_number from '^JR([0-9]+)$')::bigint), 0) + 1
    into v_next
    from ae_journals
    where company_id = p_company_id and journal_number ~ '^JR[0-9]+$';
  v_journal_number := 'JR' || case when length(v_next::text) >= 6 then v_next::text else lpad(v_next::text, 6, '0') end;

  select coalesce(max(substring(batch_number from '^PB([0-9]+)$')::bigint), 0) + 1
    into v_next
    from posting_batches
    where company_id = p_company_id and batch_number ~ '^PB[0-9]+$';
  v_batch_number := 'PB' || case when length(v_next::text) >= 6 then v_next::text else lpad(v_next::text, 6, '0') end;

  insert into posting_batches (company_id, batch_number, posting_date, journal_count, transaction_count, posted_by)
  values (p_company_id, v_batch_number, p_posting_date, 1, v_line_count, v_posted_by)
  returning id into v_batch_id;

  insert into ae_journals (
    company_id, journal_number, journal_date, journal_type, description, reference,
    source_type, source_id, status, total_debit, total_credit, posted_at, posting_batch_id
  )
  values (
    p_company_id,
    v_journal_number,
    v_journal_date,
    coalesce(nullif(p_journal->>'journalType', ''), 'Bank Transaction Automation'),
    coalesce(p_journal->>'description', ''),
    coalesce(p_journal->>'reference', ''),
    'bank_transaction_rule_engine',
    p_transaction_id,
    'Posted',
    v_total_debit,
    v_total_credit,
    now(),
    v_batch_id
  )
  returning id into v_journal_id;

  insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order)
  select
    v_journal_id,
    t.r->>'accountCode',
    (t.r->>'debit')::numeric,
    (t.r->>'credit')::numeric,
    coalesce(t.r->>'description', ''),
    (t.ord - 1)::int
  from jsonb_array_elements(p_journal->'lines') with ordinality t(r, ord);

  -- Same row shape `posting-engine-service.ts::buildGlTransactionRowsForJournal`
  -- produced for these journals: posting date = journal date, the line's
  -- own description falling back to the journal's.
  insert into gl_transactions (
    company_id, journal_id, journal_line_id, account_id, posting_date, reference, description,
    debit, credit, financial_year_label, financial_period, posted_by
  )
  select
    p_company_id,
    v_journal_id,
    jl.id,
    c.id,
    v_journal_date,
    coalesce(p_journal->>'reference', ''),
    case when jl.description <> '' then jl.description else coalesce(p_journal->>'description', '') end,
    jl.debit,
    jl.credit,
    v_fy_label,
    v_fy_period,
    v_posted_by
  from ae_journal_lines jl
  join chart_of_accounts c on c.company_id = p_company_id and c.account_code = jl.account_code
  where jl.journal_id = v_journal_id;
  get diagnostics v_gl_count = row_count;
  if v_gl_count <> v_line_count then
    raise exception 'VYRON_RULE_POST_LEDGER_MISMATCH: % lines but % GL rows.', v_line_count, v_gl_count;
  end if;

  update ae_bank_transactions
    set journal_id = v_journal_id, posted_flag = true, posted_at = now(), posting_batch_id = v_batch_id
    where company_id = p_company_id
      and id = p_transaction_id
      and journal_id is null
      and posted_flag = false;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'VYRON_RULE_POST_LINK_CONFLICT: expected to link exactly 1 transaction, linked %.', v_updated;
  end if;

  return jsonb_build_object(
    'outcome', 'posted',
    'transactionId', p_transaction_id,
    'journalId', v_journal_id,
    'journalNumber', v_journal_number,
    'journalStatus', 'Posted',
    'batchId', v_batch_id,
    'batchNumber', v_batch_number
  );
end;
$$;

drop policy if exists "members can access their company's journals" on ae_journals;
create policy "members can access their company's journals" on ae_journals for all using (user_can_access_company(company_id));
drop policy if exists "members can access their company's bank transactions" on ae_bank_transactions;
create policy "members can access their company's bank transactions" on ae_bank_transactions for all using (user_can_access_company(company_id));

grant execute on function fn_post_bank_transactions(uuid, bigint[], jsonb, text, date, text) to public, anon, authenticated, service_role;
grant execute on function fn_post_approved_journals(uuid, bigint[], jsonb, text, date, text) to public, anon, authenticated, service_role;

commit;
