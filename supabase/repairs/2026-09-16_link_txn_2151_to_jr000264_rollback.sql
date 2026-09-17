-- =====================================================================
-- ROLLBACK of 2026-09-16_link_txn_2151_to_jr000264.sql
--
-- NOT A MIGRATION. Run only if the approved repair must be undone.
-- =====================================================================
--
-- Restores transaction 2151 to `journal_id = NULL, posted_flag = false`
-- — the exact state before the repair — and records that in the audit
-- log. The repair's own audit entry is kept (the audit log is
-- append-only). No journal, line, batch or GL row is touched; journal 278
-- stays Posted, so the ledger still carries R6,435.00 exactly once.
--
-- Refuses to run unless the transaction is in precisely the state the
-- repair left it in and the repair's audit entry exists.
--
-- NOTE: after a rollback the transaction is again protected from double
-- posting only by migration 0100 (Bank Posting skips it; the trigger
-- refuses any other link). A resumed Banking Rules sweep would link it
-- again, automatically.
--
-- HOW TO RUN: uncomment the approval line, then run the whole file as one
-- transaction. Expect the NOTICE "ROLLED BACK: ...".

begin;

-- set local vyron.repair_approval = 'ROLLBACK-LINK-2151-TO-JR000264';
-- set local vyron.repair_operator = 'name of the approving person';

do $$
declare
  c_company constant uuid := '45b3d2a0-3973-4587-a043-0e05d8d9bff3';
  c_txn constant bigint := 2151;
  c_journal constant bigint := 278;
  v_txn ae_bank_transactions%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_updated int;
  v_ledger_before text;
  v_ledger_after text;
begin
  if current_setting('vyron.repair_approval', true) is distinct from 'ROLLBACK-LINK-2151-TO-JR000264' then
    raise exception 'ROLLBACK_NOT_APPROVED: set vyron.repair_approval to run this rollback. Nothing was changed.';
  end if;

  select * into v_txn from ae_bank_transactions where id = c_txn and company_id = c_company for update;
  if not found then raise exception 'ROLLBACK_CHECK: transaction % not found for Metanoia.', c_txn; end if;
  if v_txn.journal_id is distinct from c_journal or not v_txn.posted_flag then
    raise exception 'ROLLBACK_CHECK: transaction % is not in the repaired state (journal_id %, posted_flag %).', c_txn, v_txn.journal_id, v_txn.posted_flag;
  end if;
  if v_txn.posting_batch_id is not null or v_txn.posted_at is not null or v_txn.reconciliation_id is not null then
    raise exception 'ROLLBACK_CHECK: transaction % has changed since the repair (batch/posted_at/reconciliation set).', c_txn;
  end if;
  if not exists (select 1 from automation_audit_log
                  where company_id = c_company and action_type = 'RuleEngineJournalLinkRepair'
                    and document_type = 'BankTransaction' and document_id = c_txn and journal_ids = array[c_journal]) then
    raise exception 'ROLLBACK_CHECK: no repair audit entry for transaction % — this link was not made by the approved repair.', c_txn;
  end if;

  select md5(
    coalesce((select string_agg(j::text, '|' order by j.id) from ae_journals j where j.company_id = c_company), '') ||
    coalesce((select string_agg(l::text, '|' order by l.id) from ae_journal_lines l join ae_journals j on j.id = l.journal_id where j.company_id = c_company), '') ||
    coalesce((select string_agg(b::text, '|' order by b.id) from posting_batches b where b.company_id = c_company), '') ||
    coalesce((select string_agg(g::text, '|' order by g.id) from gl_transactions g where g.company_id = c_company), '')
  ) into v_ledger_before;
  v_before := to_jsonb(v_txn);

  update ae_bank_transactions
    set journal_id = null, posted_flag = false
    where id = c_txn and company_id = c_company and journal_id = c_journal and posted_flag;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'ROLLBACK_CHECK: expected to update exactly 1 row, updated %.', v_updated; end if;

  select to_jsonb(t) into v_after from ae_bank_transactions t where t.id = c_txn;
  if (v_before - 'journal_id' - 'posted_flag') <> (v_after - 'journal_id' - 'posted_flag') then
    raise exception 'ROLLBACK_VERIFY: transaction % changed in more than journal_id and posted_flag.', c_txn;
  end if;
  select md5(
    coalesce((select string_agg(j::text, '|' order by j.id) from ae_journals j where j.company_id = c_company), '') ||
    coalesce((select string_agg(l::text, '|' order by l.id) from ae_journal_lines l join ae_journals j on j.id = l.journal_id where j.company_id = c_company), '') ||
    coalesce((select string_agg(b::text, '|' order by b.id) from posting_batches b where b.company_id = c_company), '') ||
    coalesce((select string_agg(g::text, '|' order by g.id) from gl_transactions g where g.company_id = c_company), '')
  ) into v_ledger_after;
  if v_ledger_after <> v_ledger_before then raise exception 'ROLLBACK_VERIFY: journals, lines, batches or GL rows changed.'; end if;

  insert into automation_audit_log (company_id, performed_by, action_type, reason, changes, journal_ids, document_type, document_id, is_reversible)
  values (
    c_company,
    coalesce(nullif(current_setting('vyron.repair_operator', true), ''), 'Approved rollback'),
    'RuleEngineJournalLinkRepairRollback',
    'Rolled back the approved link of bank transaction 2151 to JR000264. Journal JR000264 remains Posted; the ledger is unchanged.',
    jsonb_build_object(
      'before', jsonb_build_object('journal_id', c_journal, 'posted_flag', true),
      'after', jsonb_build_object('journal_id', null, 'posted_flag', false),
      'ledgerFingerprint', v_ledger_after
    ),
    array[c_journal],
    'BankTransaction',
    c_txn,
    false
  );

  raise notice 'ROLLED BACK: transaction % unlinked from journal %; 1 row updated; ledger fingerprint % unchanged.', c_txn, c_journal, v_ledger_after;
end;
$$;

commit;
