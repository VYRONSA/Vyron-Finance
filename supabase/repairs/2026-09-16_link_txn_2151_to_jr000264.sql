-- =====================================================================
-- REPAIR — link Metanoia bank transaction 2151 to its already-Posted
-- Banking Rule journal 278 (JR000264).
--
-- NOT A MIGRATION. Run once, by hand, ONLY after written approval.
-- =====================================================================
--
-- Background (read-only investigation, 2026-09-16): the Banking Rules
-- sweep posted JR000264 (Dr 6940 / Cr 1020, R6,435.00, batch 272 /
-- PB000264, two GL rows) for transaction 2151, and the Vercel request was
-- killed at its 300-second limit before the transaction was stamped. The
-- ledger already carries the amount exactly once; only the transaction's
-- own `journal_id` / `posted_flag` are missing.
--
-- This script writes exactly what the interrupted `markTransactionPosted`
-- would have written — `journal_id = 278`, `posted_flag = true` — on
-- exactly one row, plus one audit entry. It creates, changes or reverses
-- no journal, line, posting batch or GL row, and touches no other
-- transaction, amount, allocation, VAT or reconciliation. It refuses to
-- run (and changes nothing) unless every fact below still holds.
--
-- PREREQUISITE: migration 0100 is applied (its trigger and index are
-- checked below). Once 0100 is deployed, a resumed Banking Rules sweep
-- would make this same link by itself (audited as
-- RuleEngineJournalLinkRecovered); this script exists so the repair can
-- be done deliberately, before Task 10 is resumed.
--
-- HOW TO RUN (after approval):
--   1. Uncomment the `set local vyron.repair_approval` line below.
--   2. Optionally set the operator name on the next line.
--   3. Run the whole file as one transaction, e.g.
--        supabase db query --linked --workdir <linked dir> -f <absolute path to this file>
--   4. Expect the NOTICE "REPAIRED: ...". Any other outcome is an ERROR
--      and the transaction is rolled back — nothing changed.
--   5. Verify with the read-only checks in the approved procedure.
-- Rollback: 2026-09-16_link_txn_2151_to_jr000264_rollback.sql

begin;

-- set local vyron.repair_approval = 'LINK-2151-TO-JR000264';
-- set local vyron.repair_operator = 'name of the approving person';

do $$
declare
  c_company constant uuid := '45b3d2a0-3973-4587-a043-0e05d8d9bff3';  -- Metanoia Hospitality (Pty) Ltd
  c_txn constant bigint := 2151;
  c_journal constant bigint := 278;
  c_journal_number constant text := 'JR000264';
  c_batch constant bigint := 272;
  c_bank_account constant bigint := 3;
  c_bank_gl constant text := '1020';
  c_amount constant numeric(14, 2) := 6435.00;
  v_txn ae_bank_transactions%rowtype;
  v_journal ae_journals%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_count int;
  v_updated int;
  v_ledger_before text;
  v_ledger_after text;
  v_others_before text;
  v_others_after text;
begin
  if current_setting('vyron.repair_approval', true) is distinct from 'LINK-2151-TO-JR000264' then
    raise exception 'REPAIR_NOT_APPROVED: set vyron.repair_approval to run this repair. Nothing was changed.';
  end if;

  if to_regclass('public.ae_journals_rule_engine_source_key') is null
     or not exists (select 1 from pg_trigger where tgname = 'ae_bank_transactions_rule_engine_journal_guard') then
    raise exception 'REPAIR_PREREQUISITE: migration 0100 is not applied. Nothing was changed.';
  end if;

  -- The transaction.
  select * into v_txn from ae_bank_transactions where id = c_txn for update;
  if not found then raise exception 'REPAIR_CHECK: transaction % not found.', c_txn; end if;
  if v_txn.company_id <> c_company then raise exception 'REPAIR_CHECK: transaction % belongs to company %, not Metanoia.', c_txn, v_txn.company_id; end if;
  if v_txn.journal_id is not null then raise exception 'REPAIR_CHECK: transaction % already has journal_id % — nothing to repair.', c_txn, v_txn.journal_id; end if;
  if v_txn.posted_flag then raise exception 'REPAIR_CHECK: transaction % is already flagged posted.', c_txn; end if;
  if v_txn.reconciliation_id is not null then raise exception 'REPAIR_CHECK: transaction % is reconciled.', c_txn; end if;
  if v_txn.posting_batch_id is not null then raise exception 'REPAIR_CHECK: transaction % already has posting batch %.', c_txn, v_txn.posting_batch_id; end if;
  if v_txn.bank_account_id is distinct from c_bank_account or v_txn.debit <> c_amount or v_txn.credit <> 0 then
    raise exception 'REPAIR_CHECK: transaction % is not the R6,435.00 Metanoia Hospitality payment this repair was approved for.', c_txn;
  end if;
  if (select gl_account from ae_bank_accounts where id = c_bank_account and company_id = c_company) is distinct from c_bank_gl then
    raise exception 'REPAIR_CHECK: bank account % no longer maps to GL %.', c_bank_account, c_bank_gl;
  end if;

  -- Exactly one Banking Rule journal for it, and it is 278.
  select count(*) into v_count from ae_journals
    where company_id = c_company and source_type = 'bank_transaction_rule_engine' and source_id = c_txn;
  if v_count <> 1 then raise exception 'REPAIR_CHECK: expected exactly 1 Banking Rule journal for transaction %, found %.', c_txn, v_count; end if;

  select * into v_journal from ae_journals where id = c_journal for update;
  if not found then raise exception 'REPAIR_CHECK: journal % not found.', c_journal; end if;
  if v_journal.company_id <> c_company
     or v_journal.source_type <> 'bank_transaction_rule_engine'
     or v_journal.source_id is distinct from c_txn
     or v_journal.journal_number <> c_journal_number then
    raise exception 'REPAIR_CHECK: journal % is not %, the Banking Rule journal of transaction %.', c_journal, c_journal_number, c_txn;
  end if;
  if v_journal.status <> 'Posted' then raise exception 'REPAIR_CHECK: journal % is %, not Posted.', c_journal, v_journal.status; end if;
  if v_journal.is_reversed or v_journal.reversed_by_journal_id is not null then raise exception 'REPAIR_CHECK: journal % has been reversed.', c_journal; end if;
  if v_journal.posting_batch_id is distinct from c_batch then raise exception 'REPAIR_CHECK: journal % is in batch %, expected %.', c_journal, v_journal.posting_batch_id, c_batch; end if;
  if v_journal.total_debit <> c_amount or v_journal.total_credit <> c_amount then raise exception 'REPAIR_CHECK: journal % totals are not R6,435.00.', c_journal; end if;

  -- Its lines and ledger rows: two each, balanced, bank GL credited once.
  if (select count(*) from ae_journal_lines where journal_id = c_journal) <> 2
     or (select sum(debit) from ae_journal_lines where journal_id = c_journal) <> c_amount
     or (select sum(credit) from ae_journal_lines where journal_id = c_journal) <> c_amount
     or (select count(*) from ae_journal_lines where journal_id = c_journal and account_code = c_bank_gl and credit = c_amount and debit = 0) <> 1 then
    raise exception 'REPAIR_CHECK: journal % lines are not the expected Dr expense / Cr % R6,435.00 pair.', c_journal, c_bank_gl;
  end if;
  if (select count(*) from gl_transactions where company_id = c_company and journal_id = c_journal) <> 2
     or (select sum(debit) from gl_transactions where company_id = c_company and journal_id = c_journal) <> c_amount
     or (select sum(credit) from gl_transactions where company_id = c_company and journal_id = c_journal) <> c_amount
     or exists (select 1 from ae_journal_lines l where l.journal_id = c_journal
                  and (select count(*) from gl_transactions g where g.journal_line_id = l.id) <> 1) then
    raise exception 'REPAIR_CHECK: journal % does not have exactly one balanced GL row per line.', c_journal;
  end if;
  if (select count(*) from posting_batches where id = c_batch and company_id = c_company) <> 1 then
    raise exception 'REPAIR_CHECK: posting batch % not found for Metanoia.', c_batch;
  end if;

  -- Nothing else points at the journal.
  if exists (select 1 from ae_bank_transactions where journal_id = c_journal) then
    raise exception 'REPAIR_CHECK: another transaction already references journal %.', c_journal;
  end if;

  -- Snapshot everything the repair must not change.
  select md5(
    coalesce((select string_agg(j::text, '|' order by j.id) from ae_journals j where j.company_id = c_company), '') ||
    coalesce((select string_agg(l::text, '|' order by l.id) from ae_journal_lines l join ae_journals j on j.id = l.journal_id where j.company_id = c_company), '') ||
    coalesce((select string_agg(b::text, '|' order by b.id) from posting_batches b where b.company_id = c_company), '') ||
    coalesce((select string_agg(g::text, '|' order by g.id) from gl_transactions g where g.company_id = c_company), '')
  ) into v_ledger_before;
  select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) into v_others_before
    from ae_bank_transactions t where t.id <> c_txn;
  v_before := to_jsonb(v_txn);

  -- The repair.
  update ae_bank_transactions
    set journal_id = c_journal, posted_flag = true
    where id = c_txn and company_id = c_company and journal_id is null and posted_flag = false;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'REPAIR_CHECK: expected to update exactly 1 row, updated %.', v_updated; end if;

  -- Prove nothing else moved.
  select to_jsonb(t) into v_after from ae_bank_transactions t where t.id = c_txn;
  if (v_before - 'journal_id' - 'posted_flag') <> (v_after - 'journal_id' - 'posted_flag')
     or (v_after->>'journal_id')::bigint <> c_journal or not (v_after->>'posted_flag')::boolean then
    raise exception 'REPAIR_VERIFY: transaction % changed in more than journal_id and posted_flag.', c_txn;
  end if;
  select md5(
    coalesce((select string_agg(j::text, '|' order by j.id) from ae_journals j where j.company_id = c_company), '') ||
    coalesce((select string_agg(l::text, '|' order by l.id) from ae_journal_lines l join ae_journals j on j.id = l.journal_id where j.company_id = c_company), '') ||
    coalesce((select string_agg(b::text, '|' order by b.id) from posting_batches b where b.company_id = c_company), '') ||
    coalesce((select string_agg(g::text, '|' order by g.id) from gl_transactions g where g.company_id = c_company), '')
  ) into v_ledger_after;
  select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) into v_others_after
    from ae_bank_transactions t where t.id <> c_txn;
  if v_ledger_after <> v_ledger_before then raise exception 'REPAIR_VERIFY: journals, lines, batches or GL rows changed.'; end if;
  if v_others_after <> v_others_before then raise exception 'REPAIR_VERIFY: another bank transaction changed.'; end if;

  insert into automation_audit_log (company_id, performed_by, action_type, reason, changes, journal_ids, document_type, document_id, is_reversible)
  values (
    c_company,
    coalesce(nullif(current_setting('vyron.repair_operator', true), ''), 'Approved repair'),
    'RuleEngineJournalLinkRepair',
    'Approved repair: linked bank transaction 2151 to its existing Posted Banking Rule journal JR000264 (batch PB000264). The ledger already carried R6,435.00 exactly once; no journal, batch or GL row was created, changed or reversed.',
    jsonb_build_object(
      'before', jsonb_build_object('journal_id', null, 'posted_flag', false),
      'after', jsonb_build_object('journal_id', c_journal, 'posted_flag', true),
      'journalNumber', c_journal_number,
      'postingBatchId', c_batch,
      'ledgerFingerprint', v_ledger_after,
      'cause', 'Vercel 300-second timeout (run 18880) between posting JR000264 and linking transaction 2151'
    ),
    array[c_journal],
    'BankTransaction',
    c_txn,
    true
  );

  raise notice 'REPAIRED: transaction % linked to journal % (%); 1 row updated; ledger fingerprint % unchanged.', c_txn, c_journal, c_journal_number, v_ledger_after;
end;
$$;

commit;
