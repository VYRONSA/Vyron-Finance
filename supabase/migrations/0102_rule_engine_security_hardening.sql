-- =====================================================================
-- 0102 — Rule Engine security hardening (Phase 5A).
-- =====================================================================
--
-- NUMBERING: 0101 is reserved by the separate Phase 0 commercial/RBAC
-- hardening branch (security/phase0-commercial-rbac-hardening). This file
-- does not depend on 0101 and changes nothing 0101 touches.
--
-- WHAT THIS MIGRATION DOES (security only — no accounting behaviour and no
-- existing row changes):
--
--   A. The two bulk posting functions from 0063/0092 were never granted
--      explicitly, so PostgreSQL's default gave EXECUTE to PUBLIC (and
--      Supabase's defaults to anon). They are SECURITY INVOKER, so RLS
--      already limited what an anonymous caller could reach, but posting
--      is not an anonymous operation. EXECUTE is now limited to
--      authenticated and service_role (the two roles the application uses).
--
--   B. The row-level policies on ae_journals and ae_bank_transactions state
--      their WITH CHECK explicitly. For a FOR ALL policy PostgreSQL already
--      applies USING as the check when WITH CHECK is omitted, so the
--      effective tenant boundary is unchanged; the explicit form documents
--      it and keeps it if a later migration ever adds a second policy.
--
--   C. Banking Rule journals (source_type 'bank_transaction_rule_engine') can
--      be created or have their accounting identity changed ONLY by the
--      atomic posting function (fn_post_rule_engine_journal, which marks its
--      own transaction). An API caller (authenticated / anon) can no longer
--      insert one directly, turn another journal into one, change its
--      source, company, status, totals, date, number or batch, or delete it.
--      Reversal (is_reversed / reversed_by_journal_id / reversal_of_journal_id)
--      stays allowed — that is how journal-workflow-service reverses a
--      journal. service_role and direct administrator sessions are not
--      restricted (server-side operation, tests and approved repairs).
--      Consequence (intended): the company-wide fn_post_approved_journals
--      can no longer post a stray Approved Banking Rule journal without its
--      link (none exist in production; the rule engine has not created one
--      since 0100).
--
--   D. A bank transaction can only point at a journal and a posting batch of
--      its OWN company (all roles — a foreign key alone ignores the tenant).
--      An API caller cannot INSERT a bank transaction that is already
--      posted or linked (the 0100 guard covers UPDATE only); every
--      application insert (import, bank sync, Cashbook capture) leaves
--      those columns at their defaults.
--
-- WHAT THIS MIGRATION DOES NOT DO: it changes no journal, line, batch, GL
-- row, bank transaction, allocation or audit entry; it does not restrict
-- the ordinary journal paths (manual journals, Cashbook, Generate Journal,
-- Bank Posting) beyond A–D; it does not add role-permission checks inside
-- the database (see docs/RULE_ENGINE_HARDENING_5A.md — a decision gate).

-- ---------------------------------------------------------------------
-- Pre-checks: refuse to install over data the new guards would reject.
-- ---------------------------------------------------------------------
do $$
declare
  v_cross_journal int;
  v_cross_batch int;
begin
  select count(*) into v_cross_journal
    from ae_bank_transactions t join ae_journals j on j.id = t.journal_id
    where j.company_id <> t.company_id;
  select count(*) into v_cross_batch
    from ae_bank_transactions t join posting_batches b on b.id = t.posting_batch_id
    where b.company_id <> t.company_id;
  if v_cross_journal > 0 or v_cross_batch > 0 then
    raise exception 'VYRON_0102_CROSS_COMPANY_LINKS: % transaction(s) point at another company''s journal and % at another company''s posting batch. Investigate before applying this migration.', v_cross_journal, v_cross_batch;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- A. Posting functions: no PUBLIC / anon execution.
-- ---------------------------------------------------------------------
revoke execute on function fn_post_bank_transactions(uuid, bigint[], jsonb, text, date, text) from public, anon;
revoke execute on function fn_post_approved_journals(uuid, bigint[], jsonb, text, date, text) from public, anon;
grant execute on function fn_post_bank_transactions(uuid, bigint[], jsonb, text, date, text) to authenticated, service_role;
grant execute on function fn_post_approved_journals(uuid, bigint[], jsonb, text, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- B. Explicit WITH CHECK (same expression as USING — unchanged boundary).
-- ---------------------------------------------------------------------
alter policy "members can access their company's journals" on ae_journals
  using (user_can_access_company(company_id))
  with check (user_can_access_company(company_id));
alter policy "members can access their company's bank transactions" on ae_bank_transactions
  using (user_can_access_company(company_id))
  with check (user_can_access_company(company_id));

-- ---------------------------------------------------------------------
-- Shared: is this an API role (PostgREST sets the role per request)?
-- ---------------------------------------------------------------------
create or replace function fn_is_api_caller()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon');
$$;
-- Called only from the SECURITY DEFINER guard functions below (as their
-- owner), so no API role needs to execute it.
revoke execute on function fn_is_api_caller() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- C. Banking Rule journals: only the atomic posting function writes them.
-- ---------------------------------------------------------------------
create or replace function fn_guard_rule_engine_journal_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_type constant text := 'bank_transaction_rule_engine';
  v_sanctioned boolean := coalesce(current_setting('vyron.rule_engine_posting', true), '') = 'on';
begin
  if v_sanctioned or not fn_is_api_caller() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if new.source_type = c_type then
      raise exception using errcode = '42501',
        message = 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED: Banking Rule journals are created only by the Banking Rules posting engine.';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.source_type = c_type then
      raise exception using errcode = '42501',
        message = format('VYRON_RULE_ENGINE_JOURNAL_PROTECTED: Banking Rule journal %s cannot be deleted.', old.journal_number);
    end if;
    return old;
  end if;

  -- UPDATE
  if (old.source_type = c_type or new.source_type = c_type)
     and (new.source_type is distinct from old.source_type
       or new.source_id is distinct from old.source_id
       or new.company_id is distinct from old.company_id
       or new.status is distinct from old.status
       or new.total_debit is distinct from old.total_debit
       or new.total_credit is distinct from old.total_credit
       or new.journal_date is distinct from old.journal_date
       or new.journal_number is distinct from old.journal_number
       or new.posting_batch_id is distinct from old.posting_batch_id
       or new.posted_at is distinct from old.posted_at) then
    raise exception using errcode = '42501',
      message = format('VYRON_RULE_ENGINE_JOURNAL_PROTECTED: Banking Rule journal %s can only be reversed, not edited.', old.journal_number);
  end if;
  return new;
end;
$$;

drop trigger if exists ae_journals_rule_engine_write_guard on ae_journals;
create trigger ae_journals_rule_engine_write_guard
  before insert or update or delete on ae_journals
  for each row
  execute function fn_guard_rule_engine_journal_write();

revoke execute on function fn_guard_rule_engine_journal_write() from public, anon, authenticated;

-- Lines of a Banking Rule journal belong to that journal's single posting.
create or replace function fn_guard_rule_engine_journal_line_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_journal_ids bigint[];
begin
  if coalesce(current_setting('vyron.rule_engine_posting', true), '') = 'on' or not fn_is_api_caller() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_journal_ids := case tg_op
    when 'INSERT' then array[new.journal_id]
    when 'DELETE' then array[old.journal_id]
    else array[old.journal_id, new.journal_id]
  end;
  if exists (select 1 from ae_journals j where j.id = any(v_journal_ids) and j.source_type = 'bank_transaction_rule_engine') then
    raise exception using errcode = '42501',
      message = 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED: the lines of a Banking Rule journal cannot be changed.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists ae_journal_lines_rule_engine_write_guard on ae_journal_lines;
create trigger ae_journal_lines_rule_engine_write_guard
  before insert or update or delete on ae_journal_lines
  for each row
  execute function fn_guard_rule_engine_journal_line_write();

revoke execute on function fn_guard_rule_engine_journal_line_write() from public, anon, authenticated;

-- The atomic posting function, unchanged from 0100 except that it marks
-- its own transaction around the journal insert (see C). Same signature,
-- so its 0100 grants are kept.

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

  -- 0102: the only sanctioned writer of Banking Rule journals marks its own
  -- transaction while it writes the journal and its lines (see
  -- fn_guard_rule_engine_journal_write); cleared again before the link.
  perform set_config('vyron.rule_engine_posting', 'on', true);

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

  perform set_config('vyron.rule_engine_posting', '', true);

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

-- ---------------------------------------------------------------------
-- D. Bank transaction links stay inside the company; API inserts start
--    unposted.
-- ---------------------------------------------------------------------
create or replace function fn_guard_bank_transaction_links()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.journal_id is not null and (tg_op = 'INSERT' or new.journal_id is distinct from old.journal_id or new.company_id is distinct from old.company_id) then
    if not exists (select 1 from ae_journals j where j.id = new.journal_id and j.company_id = new.company_id) then
      raise exception using errcode = '42501',
        message = format('VYRON_BANK_TRANSACTION_LINK_TENANT: journal %s does not belong to this transaction''s company.', new.journal_id);
    end if;
  end if;
  if new.posting_batch_id is not null and (tg_op = 'INSERT' or new.posting_batch_id is distinct from old.posting_batch_id or new.company_id is distinct from old.company_id) then
    if not exists (select 1 from posting_batches b where b.id = new.posting_batch_id and b.company_id = new.company_id) then
      raise exception using errcode = '42501',
        message = format('VYRON_BANK_TRANSACTION_LINK_TENANT: posting batch %s does not belong to this transaction''s company.', new.posting_batch_id);
    end if;
  end if;
  if tg_op = 'INSERT' and fn_is_api_caller()
     and (new.posted_flag or new.journal_id is not null or new.posting_batch_id is not null or new.posted_at is not null) then
    raise exception using errcode = '42501',
      message = 'VYRON_BANK_TRANSACTION_INSERT_POSTED: a bank transaction is created unposted; posting links it to its journal.';
  end if;
  return new;
end;
$$;

drop trigger if exists ae_bank_transactions_link_guard on ae_bank_transactions;
create trigger ae_bank_transactions_link_guard
  before insert or update of journal_id, posting_batch_id, company_id on ae_bank_transactions
  for each row
  execute function fn_guard_bank_transaction_links();

revoke execute on function fn_guard_bank_transaction_links() from public, anon, authenticated;
