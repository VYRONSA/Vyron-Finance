-- Repair simulation — one line of machine-comparable state.
-- LEDGER: journals, lines, batches and GL rows for every company.
-- OTHERS: every bank transaction except 2151.
-- T2151 : transaction 2151 without its two repairable columns.
-- LINK  : 2151's journal_id / posted_flag.
-- AUDIT : repair-related audit entries.
\pset format unaligned
\pset tuples_only on
select
  'LEDGER=' || md5(
    coalesce((select string_agg(j::text, '|' order by j.id) from ae_journals j), '') ||
    coalesce((select string_agg(l::text, '|' order by l.id) from ae_journal_lines l), '') ||
    coalesce((select string_agg(b::text, '|' order by b.id) from posting_batches b), '') ||
    coalesce((select string_agg(g::text, '|' order by g.id) from gl_transactions g), '')
  )
  || ' OTHERS=' || md5(coalesce((select string_agg(t::text, '|' order by t.id) from ae_bank_transactions t where t.id <> 2151), ''))
  || ' T2151=' || md5(coalesce((select ((to_jsonb(t) - 'journal_id') - 'posted_flag')::text from ae_bank_transactions t where t.id = 2151), ''))
  || ' LINK=' || coalesce((select coalesce(journal_id::text, 'null') || '/' || posted_flag from ae_bank_transactions where id = 2151), 'missing')
  || ' AUDIT=' || (select count(*) filter (where action_type = 'RuleEngineJournalLinkRepair') || '/' || count(*) filter (where action_type = 'RuleEngineJournalLinkRepairRollback')
                   from automation_audit_log where document_id = 2151);
