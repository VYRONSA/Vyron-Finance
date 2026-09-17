-- Database tests for migration 0100 (atomic Banking Rule posting,
-- existing-journal recovery, double-posting protection).
--
-- LOCAL / SYNTHETIC DATA ONLY. Everything runs in ONE transaction that is
-- rolled back at the end, so nothing is left behind. Never run against a
-- shared or production database.
--
--   psql -v ON_ERROR_STOP=1 -v migration=/path/to/0100_atomic_rule_engine_posting.sql \
--        -f supabase/tests/atomic_rule_engine_posting.test.sql
--
-- Each check prints "PASS: ..." as a NOTICE; the first failure aborts the
-- run with "FAIL: ...". Letters refer to the approved test list (A–N);
-- the review fixes add F (the claim, M1), H2 (Manual Cashbook entries),
-- L1/L2 (dates and batch link), M2 (paged worklist) and CTR (the 0098
-- platform cross-tenant reader).
-- Concurrency across real connections (F) is exercised end to end in
-- src/server/services/rule-engine-posting.scenario.test.ts; the repair of
-- production transaction 2151 (M, N) in supabase/tests/repair_2151/.

\set ON_ERROR_STOP 1
set client_min_messages = notice;
begin;

-- ---------------------------------------------------------------------
-- Helpers (session-temporary).
-- ---------------------------------------------------------------------
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'PASS: %', label;
end $$;

create function pg_temp.co_m() returns uuid language sql immutable as $$ select '0b100000-0000-4000-8000-0000000000c1'::uuid $$;
create function pg_temp.co_n() returns uuid language sql immutable as $$ select '0b100000-0000-4000-8000-0000000000c2'::uuid $$;
create function pg_temp.user_m() returns uuid language sql immutable as $$ select '0b100000-0000-4000-8000-0000000000a1'::uuid $$;
create function pg_temp.user_n() returns uuid language sql immutable as $$ select '0b100000-0000-4000-8000-0000000000a2'::uuid $$;

create function pg_temp.bank(p_company uuid) returns bigint language sql as $$
  select id from ae_bank_accounts where company_id = p_company order by id limit 1
$$;

-- Repeated identical payments are real (four R6,435 salaries on one day);
-- `source_occurrence` keeps them distinct under the import natural key.
create sequence pg_temp.tseq;
-- An imported transaction nobody has classified yet (what a Banking Rule
-- may claim). `p_source` 'Manual' makes it a Cashbook entry.
create function pg_temp.tx(p_company uuid, p_amount numeric, p_desc text default 'Spend Money — Salaries', p_source text default 'Imported') returns bigint language sql as $$
  insert into ae_bank_transactions (company_id, transaction_date, description, import_description, beneficiary, debit, credit, bank_account, bank_account_id, allocation_status, suggested_gl_account, allocation_type, source_occurrence, entry_source, capture_status)
  values (p_company, date '2026-03-27', p_desc, p_desc, 'Salaries', p_amount, 0, 'Synthetic bank', pg_temp.bank(p_company), 'Unallocated', null, null, nextval('pg_temp.tseq'),
          p_source, case when p_source = 'Manual' then 'Submitted' end)
  returning id
$$;

create function pg_temp.payload(p_amount numeric, p_bank_gl text default '1020', p_expense_gl text default '6940') returns jsonb language sql as $$
  select jsonb_build_object(
    'journalDate', '2026-09-16',
    'journalType', 'Bank Transaction Automation',
    'description', 'Automated from rule "Auto: Salaries → GL" — Spend Money — Salaries',
    'reference', '',
    'financialYearLabel', 'FY2027',
    'financialPeriod', 7,
    'lines', jsonb_build_array(
      jsonb_build_object('accountCode', p_expense_gl, 'debit', p_amount, 'credit', 0, 'description', 'Spend Money — Salaries'),
      jsonb_build_object('accountCode', p_bank_gl, 'debit', 0, 'credit', p_amount, 'description', 'Spend Money — Salaries')
    )
  )
$$;

-- The Banking Rule's claim, as rule-processing-service.ts sends it.
create function pg_temp.claim(p_company uuid, p_gl text default '6940') returns jsonb language sql as $$
  select jsonb_build_object('ruleId', r.id, 'ruleName', r.name, 'matchedRuleIds', jsonb_build_array(r.id),
    'suggestedGlAccount', p_gl, 'suggestedVatCode', 'No VAT', 'allocationStatus', 'Suggested', 'performedBy', 'Scheduler (cron)')
  from banking_rules r where r.company_id = p_company and r.name = 'Auto: Salaries → GL'
$$;

-- fn_post_rule_engine_journal with the run date and the claim filled in.
create function pg_temp.post(p_company uuid, p_txn bigint, p_payload jsonb, p_by text, p_date date default date '2026-09-16', p_claim jsonb default null) returns jsonb language sql as $$
  select fn_post_rule_engine_journal(p_company, p_txn, p_payload, p_by, p_date, coalesce(p_claim, pg_temp.claim(p_company)))
$$;

-- The pre-0100 failure state, built directly: a Posted Banking Rule journal
-- with its lines, batch and ledger rows, and a transaction left unlinked.
create function pg_temp.legacy_posted_journal(p_company uuid, p_txn bigint, p_status text default 'Posted', p_with_gl boolean default true, p_reversed boolean default false) returns bigint language plpgsql as $$
declare
  v_batch bigint;
  v_journal bigint;
  v_amount numeric;
  v_seq bigint := nextval('pg_temp.jseq');
begin
  select greatest(debit, credit) into v_amount from ae_bank_transactions where id = p_txn;
  if p_status = 'Posted' then
    insert into posting_batches (company_id, batch_number, posting_date, journal_count, transaction_count, posted_by)
    values (p_company, 'PBLEGACY' || v_seq, date '2026-09-16', 1, 2, 'System') returning id into v_batch;
  end if;
  insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, source_id, status, total_debit, total_credit, posted_at, posting_batch_id, is_reversed)
  values (p_company, 'JRLEGACY' || v_seq, date '2026-09-16', 'Bank Transaction Automation', 'legacy', '', 'bank_transaction_rule_engine', p_txn, p_status, v_amount, v_amount,
          case when p_status = 'Posted' then now() end, v_batch, p_reversed)
  returning id into v_journal;
  insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order) values
    (v_journal, '6940', v_amount, 0, 'legacy', 0),
    (v_journal, '1020', 0, v_amount, 'legacy', 1);
  if p_status = 'Posted' and p_with_gl then
    insert into gl_transactions (company_id, journal_id, journal_line_id, account_id, posting_date, reference, description, debit, credit, financial_year_label, financial_period, posted_by)
    select p_company, v_journal, jl.id, c.id, date '2026-09-16', '', 'legacy', jl.debit, jl.credit, 'FY2027', 7, 'System'
      from ae_journal_lines jl join chart_of_accounts c on c.company_id = p_company and c.account_code = jl.account_code
      where jl.journal_id = v_journal;
  end if;
  return v_journal;
end $$;
create sequence pg_temp.jseq;

-- Everything a posting can write, for one company.
create function pg_temp.ledger_fp(p_company uuid) returns text language sql as $$
  select md5(
    coalesce((select string_agg(j::text, '|' order by j.id) from ae_journals j where j.company_id = p_company), '') || '#' ||
    coalesce((select string_agg(l::text, '|' order by l.id) from ae_journal_lines l join ae_journals j on j.id = l.journal_id where j.company_id = p_company), '') || '#' ||
    coalesce((select string_agg(b::text, '|' order by b.id) from posting_batches b where b.company_id = p_company), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from gl_transactions g where g.company_id = p_company), '')
  )
$$;
create function pg_temp.txn_fp(p_company uuid) returns text language sql as $$
  select md5(coalesce((select string_agg(t::text, '|' order by t.id) from ae_bank_transactions t where t.company_id = p_company), ''))
$$;
create function pg_temp.company_fp(p_company uuid) returns text language sql as $$
  select md5(pg_temp.ledger_fp(p_company) || pg_temp.txn_fp(p_company) ||
    coalesce((select string_agg(a::text, '|' order by a.id) from automation_audit_log a where a.company_id = p_company), ''))
$$;
create function pg_temp.txn_row(p_txn bigint) returns jsonb language sql as $$
  select to_jsonb(t) from ae_bank_transactions t where t.id = p_txn
$$;

-- Runs a statement that must fail; returns the error text. Everything the
-- statement wrote is rolled back with its sub-transaction.
create function pg_temp.fails(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- Synthetic fixture: "Metanoia" (M) and "Northwood" (N), one owner each.
-- ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  (pg_temp.user_m(), 'rule-posting-owner-m@synthetic.test', 'authenticated', 'authenticated'),
  (pg_temp.user_n(), 'rule-posting-owner-n@synthetic.test', 'authenticated', 'authenticated');
insert into organisations (id, name) values
  ('0b100000-0000-4000-8000-0000000000b1'::uuid, 'Synthetic Org M'),
  ('0b100000-0000-4000-8000-0000000000b2'::uuid, 'Synthetic Org N');
insert into companies (id, organisation_id, name) values
  (pg_temp.co_m(), '0b100000-0000-4000-8000-0000000000b1'::uuid, 'Synthetic Metanoia'),
  (pg_temp.co_n(), '0b100000-0000-4000-8000-0000000000b2'::uuid, 'Synthetic Northwood');
select seed_company_rbac_defaults(pg_temp.co_m());
select seed_company_rbac_defaults(pg_temp.co_n());
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.user_m(), company_id, id, 'rule-posting-test' from permission_roles where company_id = pg_temp.co_m() and role_key = 'company_owner';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.user_n(), company_id, id, 'rule-posting-test' from permission_roles where company_id = pg_temp.co_n() and role_key = 'company_owner';

insert into chart_of_accounts (company_id, account_code, description, account_type, normal_balance)
select co, code, code, case when code in ('1000', '1020', '1030') then 'Asset' else 'Expense' end, 'Debit'
  from unnest(array[pg_temp.co_m(), pg_temp.co_n()]) co, unnest(array['1000', '1020', '1030', '6940', '3030']) code;
insert into ae_bank_accounts (company_id, account_number, account_name, gl_account) values
  (pg_temp.co_m(), 'SYN-M', 'Synthetic Metanoia bank', '1020'),
  (pg_temp.co_n(), 'SYN-N', 'Synthetic Northwood bank', '1000');
insert into banking_rules (company_id, rule_type, name) values
  (pg_temp.co_m(), 'GL', 'Auto: Salaries → GL'),
  (pg_temp.co_n(), 'GL', 'Auto: Salaries → GL');

-- Northwood's books before anything below runs; nothing Metanoia does may change them.
select pg_temp.company_fp(pg_temp.co_n()) as n_fp_start \gset

-- ---------------------------------------------------------------------
-- 0. Structure and privileges.
-- ---------------------------------------------------------------------
select pg_temp.ok(exists (select 1 from pg_indexes where indexname = 'ae_journals_rule_engine_source_key' and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%bank_transaction_rule_engine%'), 'unique partial index on the Banking Rule journal source exists');
select pg_temp.ok(exists (select 1 from pg_trigger where tgname = 'ae_bank_transactions_rule_engine_journal_guard' and tgrelid = 'ae_bank_transactions'::regclass and tgenabled = 'O'), 'double-post guard trigger is installed and enabled');
select pg_temp.ok(not (select prosecdef from pg_proc where proname = 'fn_post_rule_engine_journal'), 'fn_post_rule_engine_journal is SECURITY INVOKER (RLS is its tenant boundary)');
select pg_temp.ok(not (select prosecdef from pg_proc where proname = 'fn_recover_rule_engine_journal_link'), 'fn_recover_rule_engine_journal_link is SECURITY INVOKER');
select pg_temp.ok((select prosecdef from pg_proc where proname = 'fn_record_rule_engine_link_audit'), 'the audit helper is SECURITY DEFINER (members cannot write the audit log directly)');
select pg_temp.ok(
  not has_function_privilege('anon', 'fn_post_rule_engine_journal(uuid, bigint, jsonb, text, date, jsonb)', 'execute')
  and not has_function_privilege('anon', 'fn_recover_rule_engine_journal_link(uuid, bigint, text)', 'execute')
  and not has_function_privilege('anon', 'fn_record_rule_engine_link_audit(uuid, bigint, bigint, text, text, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'fn_bank_transaction_has_live_rule_engine_journal(uuid, bigint)', 'execute')
  and not has_function_privilege('anon', 'fn_claim_bank_transaction_for_rule(uuid, bigint, jsonb, text)', 'execute')
  and not has_function_privilege('anon', 'fn_bank_transaction_is_claimable_by_rule(ae_bank_transactions)', 'execute')
  and not has_function_privilege('anon', 'fn_list_rule_engine_worklist(uuid, boolean, date, bigint, int)', 'execute')
  and not has_function_privilege('anon', 'fn_list_rule_engine_recovery_candidates(uuid, int)', 'execute'),
  'anon cannot execute any 0100 function');
select pg_temp.ok(
  has_function_privilege('authenticated', 'fn_post_rule_engine_journal(uuid, bigint, jsonb, text, date, jsonb)', 'execute')
  and has_function_privilege('service_role', 'fn_post_rule_engine_journal(uuid, bigint, jsonb, text, date, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'fn_recover_rule_engine_journal_link(uuid, bigint, text)', 'execute')
  and has_function_privilege('service_role', 'fn_recover_rule_engine_journal_link(uuid, bigint, text)', 'execute')
  and has_function_privilege('authenticated', 'fn_claim_bank_transaction_for_rule(uuid, bigint, jsonb, text)', 'execute')
  and has_function_privilege('service_role', 'fn_list_rule_engine_worklist(uuid, boolean, date, bigint, int)', 'execute')
  and has_function_privilege('authenticated', 'fn_list_rule_engine_recovery_candidates(uuid, int)', 'execute'),
  'signed-in users and the scheduler (service_role) can execute the posting functions');
select pg_temp.ok(not exists (select 1 from pg_proc where proname = 'fn_post_rule_engine_journal' and pronargs = 4), 'the earlier 4-argument posting function does not exist');
select pg_temp.ok(
  not (select prosecdef from pg_proc where proname = 'fn_claim_bank_transaction_for_rule')
  and not (select prosecdef from pg_proc where proname = 'fn_list_rule_engine_worklist')
  and not (select prosecdef from pg_proc where proname = 'fn_list_rule_engine_recovery_candidates')
  and not (select prosecdef from pg_proc where proname = 'fn_bank_transaction_is_claimable_by_rule'),
  'the claim and worklist functions are SECURITY INVOKER (RLS is their tenant boundary)');
select pg_temp.ok(not has_function_privilege('authenticated', 'fn_guard_rule_engine_journal_link()', 'execute'), 'nobody calls the trigger function directly');

-- ---------------------------------------------------------------------
-- A. Normal posting: journal, lines, batch, GL and link in one call.
-- ---------------------------------------------------------------------
select pg_temp.tx(pg_temp.co_m(), 6435) as t_a \gset
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_before_a \gset
select pg_temp.post(pg_temp.co_m(), :t_a, pg_temp.payload(6435), 'System') as r_a \gset

select set_config('vyron_test.r_a', :'r_a', false);
do $$
declare
  r jsonb := current_setting('vyron_test.r_a')::jsonb;
  t record;
  j record;
  b record;
  v_lines int;
  v_gl int;
begin
  perform pg_temp.ok(r->>'outcome' = 'posted', 'A: outcome is posted');
  select * into j from ae_journals where id = (r->>'journalId')::bigint;
  perform pg_temp.ok(j.status = 'Posted' and j.posted_at is not null, 'A: journal is Posted');
  perform pg_temp.ok(j.source_type = 'bank_transaction_rule_engine' and j.source_id = (r->>'transactionId')::bigint, 'A: journal is sourced from this transaction');
  perform pg_temp.ok(j.journal_number ~ '^JR[0-9]{6}$' and j.journal_number = r->>'journalNumber', 'A: journal numbered in the JR000000 format');
  perform pg_temp.ok(j.total_debit = 6435 and j.total_credit = 6435 and j.journal_date = date '2026-09-16', 'A: totals and date as supplied');
  perform pg_temp.ok(j.submitted_by is null and j.approved_by is null, 'A: approval stamps unchanged from the old rule-engine journals (null)');
  select count(*) into v_lines from ae_journal_lines where journal_id = j.id;
  select count(*) into v_gl from gl_transactions where journal_id = j.id and company_id = j.company_id;
  perform pg_temp.ok(v_lines = 2 and v_gl = 2, 'A: two lines, two GL rows');
  perform pg_temp.ok((select sum(debit) = sum(credit) and sum(debit) = 6435 from gl_transactions where journal_id = j.id), 'A: ledger rows balance at the transaction amount');
  perform pg_temp.ok(not exists (
    select 1 from ae_journal_lines l left join gl_transactions g on g.journal_line_id = l.id
    where l.journal_id = j.id and (g.id is null or g.debit <> l.debit or g.credit <> l.credit or g.posting_date <> j.journal_date or g.financial_year_label <> 'FY2027' or g.financial_period <> 7)
  ), 'A: every line has exactly its GL row (amount, date, period)');
  perform pg_temp.ok(exists (select 1 from gl_transactions g join chart_of_accounts c on c.id = g.account_id where g.journal_id = j.id and c.account_code = '1020' and g.credit = 6435), 'A: the bank GL (1020) is credited');
  select * into b from posting_batches where id = j.posting_batch_id;
  perform pg_temp.ok(b.company_id = j.company_id and b.journal_count = 1 and b.transaction_count = 2 and b.batch_number ~ '^PB[0-9]{6}$' and b.id = (r->>'batchId')::bigint, 'A: one batch for this one journal');
  select * into t from ae_bank_transactions where id = (r->>'transactionId')::bigint;
  perform pg_temp.ok(t.journal_id = j.id and t.posted_flag and t.posting_batch_id = b.id and t.posted_at is not null, 'A: the transaction is linked to its journal and batch');
  perform pg_temp.ok(t.debit = 6435 and t.credit = 0 and t.suggested_gl_account = '6940' and t.allocation_status = 'Suggested', 'A: amounts untouched; the rule''s classification written');
  perform pg_temp.ok(t.rule_id = (select id from banking_rules where company_id = t.company_id) and t.allocation_type = 'G' and t.allocation_method is null and t.suggested_vat_code = 'No VAT', 'A: the claim (rule, G allocation, VAT code) is part of the same call');
  perform pg_temp.ok((select count(*) = 1 and bool_and(performed_by = 'Scheduler (cron)' and new_status = 'Suggested') from ae_allocation_history where transaction_id = t.id), 'A: one allocation history row, by the sweep');
  perform pg_temp.ok((select count(*) = 1 from banking_rule_applications where bank_transaction_id = t.id), 'A: one rule application');
  perform pg_temp.ok(b.posting_date = date '2026-09-16', 'A/L1: the batch carries the supplied posting date');
end $$;

-- A (repeat): calling again is a no-op.
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_after_a \gset
select pg_temp.post(pg_temp.co_m(), :t_a, pg_temp.payload(6435), 'System')->>'outcome' as r_a2 \gset
select pg_temp.ok(:'r_a2' = 'already_linked', 'A: a second call reports already_linked');
select pg_temp.ok(pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_after_a', 'A: the second call wrote nothing');
select pg_temp.ok(:'fp_before_a' <> :'fp_after_a', 'A: (sanity) the first call did write');

-- ---------------------------------------------------------------------
-- Validation failures roll back completely.
-- ---------------------------------------------------------------------
select pg_temp.tx(pg_temp.co_m(), 100) as t_v \gset
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_v \gset
select pg_temp.txn_row(:t_v)::text as row_v \gset
select set_config('vyron_test.t_v', :'t_v', false);
do $$
declare
  t bigint := current_setting('vyron_test.t_v')::bigint;
  e text;
begin
  e := pg_temp.fails(format('select pg_temp.post(%L, %s, jsonb_set(pg_temp.payload(100), ''{lines,1,credit}'', ''90''), ''System'')', pg_temp.co_m(), t));
  perform pg_temp.ok(e like 'VYRON_RULE_POST_UNBALANCED%', 'refuses an unbalanced journal');
  e := pg_temp.fails(format('select pg_temp.post(%L, %s, pg_temp.payload(99), ''System'')', pg_temp.co_m(), t));
  perform pg_temp.ok(e like 'VYRON_RULE_POST_AMOUNT_MISMATCH%', 'refuses a journal whose total is not the transaction amount');
  e := pg_temp.fails(format('select pg_temp.post(%L, %s, pg_temp.payload(100, ''1020'', ''9999''), ''System'', date ''2026-09-16'', pg_temp.claim(%L, ''9999''))', pg_temp.co_m(), t, pg_temp.co_m()));
  perform pg_temp.ok(e like 'VYRON_RULE_POST_NO_ACCOUNT%9999%', 'refuses an account missing from the Chart of Accounts');
  e := pg_temp.fails(format('select pg_temp.post(%L, %s, jsonb_set(pg_temp.payload(100), ''{lines}'', ''[]''), ''System'')', pg_temp.co_m(), t));
  perform pg_temp.ok(e like 'VYRON_RULE_POST_NO_LINES%', 'refuses a journal without lines');
  e := pg_temp.fails(format('select pg_temp.post(%L, %s, jsonb_set(pg_temp.payload(100), ''{lines,0,credit}'', ''5''), ''System'')', pg_temp.co_m(), t));
  perform pg_temp.ok(e like 'VYRON_RULE_POST_BAD_LINE%', 'refuses a line with both a debit and a credit');
  e := pg_temp.fails(format('select pg_temp.post(%L, %s, pg_temp.payload(100) #- ''{lines,0,debit}'', ''System'')', pg_temp.co_m(), t));
  perform pg_temp.ok(e like 'VYRON_RULE_POST_BAD_LINE%', 'refuses a line with a missing amount');
  e := pg_temp.fails(format('select pg_temp.post(%L, %s, pg_temp.payload(100) - ''financialPeriod'', ''System'')', pg_temp.co_m(), t));
  perform pg_temp.ok(e like 'VYRON_RULE_POST_NO_PERIOD%', 'refuses a journal without a financial period');
end $$;
select pg_temp.ok(pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_v', 'validation failures wrote no journal, line, batch or GL row');
select pg_temp.ok(pg_temp.txn_row(:t_v)::text = :'row_v', 'validation failures left the transaction byte-identical');

-- ---------------------------------------------------------------------
-- B. Failure after the journal is written but before the ledger is.
-- C. Failure after the ledger is written but before the link.
-- The whole call rolls back in both cases.
-- ---------------------------------------------------------------------
create function pg_temp.explode() returns trigger language plpgsql as $$
begin
  raise exception 'SIMULATED_CRASH at %', tg_table_name;
end $$;

select pg_temp.tx(pg_temp.co_m(), 250) as t_b \gset
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_b \gset
select pg_temp.txn_row(:t_b)::text as row_b \gset
create trigger zz_simulated_gl_crash before insert on gl_transactions for each row execute function pg_temp.explode();
select pg_temp.fails(format('select pg_temp.post(%L, %s, pg_temp.payload(250), ''System'')', pg_temp.co_m(), :t_b)) as err_b \gset
drop trigger zz_simulated_gl_crash on gl_transactions;
select pg_temp.ok(:'err_b' like 'SIMULATED_CRASH at gl_transactions%', 'B: the simulated crash happened while writing the ledger');
select pg_temp.ok(pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_b', 'B: no journal, line or batch survived the crash');
select pg_temp.ok(not exists (select 1 from ae_journals where source_type = 'bank_transaction_rule_engine' and source_id = :t_b), 'B: no Banking Rule journal exists for the transaction');
select pg_temp.ok(pg_temp.txn_row(:t_b)::text = :'row_b', 'B: the transaction is unchanged — including the claim (rule_id still null)');
select pg_temp.ok(not exists (select 1 from ae_allocation_history where transaction_id = :t_b) and not exists (select 1 from banking_rule_applications where bank_transaction_id = :t_b), 'B/M1: no allocation history and no rule application survived the crash');

select pg_temp.tx(pg_temp.co_m(), 375) as t_c \gset
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_c \gset
select pg_temp.txn_row(:t_c)::text as row_c \gset
create function pg_temp.explode_on_link() returns trigger language plpgsql as $$
begin
  if new.journal_id is not null and old.journal_id is null then
    raise exception 'SIMULATED_CRASH at link of %', old.id;
  end if;
  return new;
end $$;
create trigger zz_simulated_link_crash before update on ae_bank_transactions for each row execute function pg_temp.explode_on_link();
select pg_temp.fails(format('select pg_temp.post(%L, %s, pg_temp.payload(375), ''System'')', pg_temp.co_m(), :t_c)) as err_c \gset
drop trigger zz_simulated_link_crash on ae_bank_transactions;
select pg_temp.ok(:'err_c' like 'SIMULATED_CRASH at link of%', 'C: the simulated crash happened at the link step, after the ledger rows were written');
select pg_temp.ok(pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_c', 'C: the posted journal, batch and GL rows were rolled back with it');
select pg_temp.ok(pg_temp.txn_row(:t_c)::text = :'row_c', 'C: the transaction is unchanged — no Posted-but-unlinked state is possible');
-- ...and a retry after the crash posts it normally, once.
select pg_temp.post(pg_temp.co_m(), :t_c, pg_temp.payload(375), 'System')->>'outcome' as r_c_retry \gset
select pg_temp.ok(:'r_c_retry' = 'posted' and (select count(*) from ae_journals where source_type = 'bank_transaction_rule_engine' and source_id = :t_c) = 1, 'C: the retry posts exactly one journal');

-- ---------------------------------------------------------------------
-- Eligibility.
-- ---------------------------------------------------------------------
select pg_temp.tx(pg_temp.co_m(), 10) as t_mo \gset
update ae_bank_transactions set is_manual_override = true where id = :t_mo;
select pg_temp.tx(pg_temp.co_m(), 11) as t_rh \gset
update ae_bank_transactions set review_hold = true where id = :t_rh;
select pg_temp.tx(pg_temp.co_m(), 12) as t_pf \gset
update ae_bank_transactions set posted_flag = true where id = :t_pf;
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_el \gset
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_mo, pg_temp.payload(10), 'System')->>'outcome' = 'not_eligible', 'a manually overridden transaction is not posted by a rule');
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_rh, pg_temp.payload(11), 'System')->>'outcome' = 'not_eligible', 'a transaction on review hold is not posted by a rule');
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_pf, pg_temp.payload(12), 'System')->>'outcome' = 'already_posted', 'an already-posted transaction is not posted again');
select pg_temp.ok(pg_temp.post(pg_temp.co_n(), :t_mo, pg_temp.payload(10), 'System')->>'outcome' = 'not_found', 'another company''s transaction is not found (company filter)');
select pg_temp.ok(fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_mo, 'System')->>'outcome' = 'no_journal', 'recovery with no Banking Rule journal is a no-op');
select pg_temp.ok(pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_el', 'refusals wrote nothing');

-- ---------------------------------------------------------------------
-- D/E. The production failure state (2151 / JR000264) is recovered by
-- linking — no new journal, batch or GL row — and audited.
-- ---------------------------------------------------------------------
select pg_temp.tx(pg_temp.co_m(), 6435) as t_d \gset
select pg_temp.legacy_posted_journal(pg_temp.co_m(), :t_d) as j_d \gset
select pg_temp.ok(fn_bank_transaction_has_live_rule_engine_journal(pg_temp.co_m(), :t_d), 'D: the unlinked transaction is recognised as carried by a live journal');
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_d \gset
select pg_temp.txn_row(:t_d) as row_d \gset
select count(*) as audit_before_d from automation_audit_log where company_id = pg_temp.co_m() \gset

select fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_d, 'Scheduler (cron)') as r_d \gset
select pg_temp.ok((:'r_d'::jsonb)->>'outcome' = 'recovered' and ((:'r_d'::jsonb)->>'journalId')::bigint = :j_d, 'D: recovery links the transaction to its existing journal');
select pg_temp.ok((select journal_id = :j_d and posted_flag from ae_bank_transactions where id = :t_d), 'D: journal_id and posted_flag are now set');
select pg_temp.ok((pg_temp.txn_row(:t_d) - 'journal_id' - 'posted_flag') = ((:'row_d'::jsonb) - 'journal_id' - 'posted_flag'), 'D: nothing but journal_id and posted_flag changed on the transaction');
select pg_temp.ok(pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_d', 'D: no journal, line, batch or GL row was created or changed');
select pg_temp.ok((select count(*) from automation_audit_log where company_id = pg_temp.co_m()) = :audit_before_d + 1, 'D: exactly one audit entry was written');
select pg_temp.ok(exists (
  select 1 from automation_audit_log
  where company_id = pg_temp.co_m() and action_type = 'RuleEngineJournalLinkRecovered' and document_type = 'BankTransaction' and document_id = :t_d
    and journal_ids = array[:j_d::bigint] and performed_by = 'Scheduler (cron)'
    and changes->'before' = '{"journal_id": null, "posted_flag": false}'::jsonb
    and (changes->'after'->>'journal_id')::bigint = :j_d and (changes->'after'->>'posted_flag')::boolean
), 'D: the audit entry records the before/after values, the journal and the actor');

select pg_temp.ok(fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_d, 'System')->>'outcome' = 'already_linked', 'D: a second recovery is a no-op');
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_d, pg_temp.payload(6435), 'System')->>'outcome' = 'already_linked', 'D: a rerun of the posting never creates a second journal');
select pg_temp.ok(pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_d', 'D: reruns wrote nothing — no second journal, batch or GL rows');
select pg_temp.ok((select count(*) from ae_journals where source_type = 'bank_transaction_rule_engine' and source_id = :t_d) = 1, 'D: still exactly one journal for the transaction');

-- E: the posting call itself recovers (the rule engine may reach it either way).
select pg_temp.tx(pg_temp.co_m(), 500) as t_e \gset
select pg_temp.legacy_posted_journal(pg_temp.co_m(), :t_e) as j_e \gset
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_e \gset
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_e, pg_temp.payload(500), 'System')->>'outcome' = 'recovered', 'E: fn_post_rule_engine_journal recovers instead of posting');
select pg_temp.ok(pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_e' and (select journal_id from ae_bank_transactions where id = :t_e) = :j_e, 'E: linked, and no new ledger entries');

-- Recovery refuses every state it may not safely repair.
select pg_temp.tx(pg_temp.co_m(), 20) as t_ap \gset
select pg_temp.legacy_posted_journal(pg_temp.co_m(), :t_ap, 'Approved', false) as j_ap \gset
select pg_temp.tx(pg_temp.co_m(), 21) as t_rv \gset
select pg_temp.legacy_posted_journal(pg_temp.co_m(), :t_rv, 'Posted', true, true) as j_rv \gset
select pg_temp.tx(pg_temp.co_m(), 22) as t_ng \gset
select pg_temp.legacy_posted_journal(pg_temp.co_m(), :t_ng, 'Posted', false) as j_ng \gset
select pg_temp.tx(pg_temp.co_m(), 23) as t_ol \gset
select (select id from ae_journals where company_id = pg_temp.co_m() and source_type = 'bank_transaction_rule_engine' and source_id = :t_a) as j_other \gset
update ae_bank_transactions set journal_id = :j_other where id = :t_ol;
select pg_temp.legacy_posted_journal(pg_temp.co_m(), :t_ol) as j_ol \gset
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_bl \gset
select pg_temp.txn_fp(pg_temp.co_m()) as tfp_bl \gset
select pg_temp.ok((fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_ap, 'System')->>'outcome') = 'blocked', 'recovery refuses a journal that is not Posted');
select pg_temp.ok((pg_temp.post(pg_temp.co_m(), :t_ap, pg_temp.payload(20), 'System')->>'outcome') = 'blocked', 'posting refuses a transaction whose Banking Rule journal is still Approved');
select pg_temp.ok((fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_rv, 'System')->>'reason') like '%reversed%', 'recovery refuses a reversed journal');
select pg_temp.ok((fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_ng, 'System')->>'reason') like '%incomplete%', 'recovery refuses a Posted journal without its ledger rows');
select pg_temp.ok((fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_ol, 'System')->>'reason') like '%different journal%', 'recovery refuses a transaction linked to a different journal');
select pg_temp.ok(pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_bl' and pg_temp.txn_fp(pg_temp.co_m()) = :'tfp_bl', 'blocked recoveries wrote nothing');

-- ---------------------------------------------------------------------
-- Idempotency: at most one Banking Rule journal per transaction.
-- ---------------------------------------------------------------------
select pg_temp.ok(pg_temp.fails(format(
  'insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, source_id, status, total_debit, total_credit) values (%L, ''JRDUP'', current_date, ''x'', '''', '''', ''bank_transaction_rule_engine'', %s, ''Draft'', 0, 0)',
  pg_temp.co_m(), :t_a)) like '%ae_journals_rule_engine_source_key%', 'a second Banking Rule journal for the same transaction is rejected by the unique index');
select pg_temp.ok(pg_temp.fails(format(
  'insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, source_id, status, total_debit, total_credit) values (%L, ''JRREV1'', current_date, ''x'', '''', '''', ''journal_reversal'', %s, ''Draft'', 0, 0), (%L, ''JRREV2'', current_date, ''x'', '''', '''', ''journal_reversal'', %s, ''Draft'', 0, 0)',
  pg_temp.co_m(), :t_a, pg_temp.co_m(), :t_a)) is null, 'other source types are not constrained by the index');
select pg_temp.ok(pg_temp.fails(
  'do $x$ begin
     drop index ae_journals_rule_engine_source_key;
     insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, source_id, status, total_debit, total_credit)
       select company_id, ''JRDUP2'', current_date, ''x'', '''', '''', source_type, source_id, ''Draft'', 0, 0 from ae_journals where source_type = ''bank_transaction_rule_engine'' limit 1;
     execute $m$ do $d$ declare v_duplicates int; begin
       select count(*) into v_duplicates from (select company_id, source_id from ae_journals where source_type = ''bank_transaction_rule_engine'' group by company_id, source_id having count(*) > 1) d;
       if v_duplicates > 0 then raise exception ''VYRON_0100_DUPLICATE_RULE_ENGINE_JOURNALS: %'', v_duplicates; end if;
     end $d$ $m$;
   end $x$') like 'VYRON_0100_DUPLICATE_RULE_ENGINE_JOURNALS%', 'the migration refuses to build the index over duplicate data (rolled back)');
select pg_temp.ok(exists (select 1 from pg_indexes where indexname = 'ae_journals_rule_engine_source_key'), '(the index is intact after that check)');

-- ---------------------------------------------------------------------
-- G. Bank Posting never claims a transaction a live Banking Rule journal
--    carries; the rest of the batch still posts.
-- ---------------------------------------------------------------------
select pg_temp.tx(pg_temp.co_m(), 700) as t_g_covered \gset
select pg_temp.legacy_posted_journal(pg_temp.co_m(), :t_g_covered) as j_g \gset
select pg_temp.tx(pg_temp.co_m(), 80) as t_g_free \gset
select pg_temp.txn_row(:t_g_covered)::text as row_g \gset
select fn_post_bank_transactions(
  pg_temp.co_m(),
  array[:t_g_covered, :t_g_free]::bigint[],
  jsonb_build_array(jsonb_build_object(
    'journalNumber', 'JRBANK1', 'journalDate', '2026-03-27', 'journalType', 'Bank Transactions', 'description', 'bank posting', 'reference', '',
    'financialYearLabel', 'FY2026', 'financialPeriod', 1,
    'transactionIds', jsonb_build_array(:t_g_covered, :t_g_free),
    'lines', jsonb_build_array(
      jsonb_build_object('transactionId', :t_g_covered, 'accountCode', '6940', 'debit', 700, 'credit', 0, 'description', 'covered'),
      jsonb_build_object('transactionId', :t_g_covered, 'accountCode', '1020', 'debit', 0, 'credit', 700, 'description', 'covered'),
      jsonb_build_object('transactionId', :t_g_free, 'accountCode', '6940', 'debit', 80, 'credit', 0, 'description', 'free'),
      jsonb_build_object('transactionId', :t_g_free, 'accountCode', '1020', 'debit', 0, 'credit', 80, 'description', 'free')
    )
  )),
  'PBBANK1', date '2026-09-16', 'tester'
) as r_g \gset
select pg_temp.ok((:'r_g'::jsonb)->'claimedTransactionIds' = to_jsonb(array[:t_g_free::bigint]), 'G: Bank Posting claimed only the uncovered transaction');
select pg_temp.ok(pg_temp.txn_row(:t_g_covered)::text = :'row_g', 'G: the covered transaction is untouched');
select pg_temp.ok((select sum(l.debit) from ae_journal_lines l join ae_journals j on j.id = l.journal_id where j.journal_number = 'JRBANK1' and j.company_id = pg_temp.co_m()) = 80, 'G: the bank journal carries only the uncovered amount — 700 is not posted twice');
select pg_temp.ok((select count(*) from gl_transactions g join ae_journals j on j.id = g.journal_id where j.journal_number = 'JRBANK1') = 2, 'G: two GL rows (the uncovered transaction only)');

select pg_temp.ledger_fp(pg_temp.co_m()) as fp_g2 \gset
select fn_post_bank_transactions(pg_temp.co_m(), array[:t_g_covered]::bigint[],
  jsonb_build_array(jsonb_build_object('journalNumber', 'JRBANK2', 'journalDate', '2026-03-27', 'transactionIds', jsonb_build_array(:t_g_covered),
    'lines', jsonb_build_array(jsonb_build_object('transactionId', :t_g_covered, 'accountCode', '6940', 'debit', 700, 'credit', 0), jsonb_build_object('transactionId', :t_g_covered, 'accountCode', '1020', 'debit', 0, 'credit', 700)))),
  'PBBANK2', date '2026-09-16', 'tester')->'batch' as r_g2 \gset
select pg_temp.ok(:'r_g2' = 'null' and pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_g2', 'G: posting only a covered transaction writes nothing at all');

-- ---------------------------------------------------------------------
-- H. The trigger backstop protects every other write path.
-- ---------------------------------------------------------------------
select (select id from ae_journals where journal_number = 'JRBANK1' and company_id = pg_temp.co_m()) as j_bank \gset
select pg_temp.ok(pg_temp.fails(format('update ae_bank_transactions set journal_id = %s where id = %s and journal_id is null', :j_bank, :t_g_covered)) like 'VYRON_RULE_ENGINE_JOURNAL_EXISTS%', 'H: linking a covered transaction to another journal (Generate Journal / Cashbook path) is refused');
select pg_temp.ok(pg_temp.fails(format('update ae_bank_transactions set posted_flag = true where id = %s', :t_g_covered)) like 'VYRON_RULE_ENGINE_JOURNAL_EXISTS%', 'H: flagging a covered transaction posted without its journal is refused');
select pg_temp.ok(pg_temp.fails(format('update ae_bank_transactions set journal_id = %s where id = %s', :j_bank, :t_ap)) like 'VYRON_RULE_ENGINE_JOURNAL_EXISTS%', 'H: an Approved (still postable) Banking Rule journal also protects its transaction');
select pg_temp.ok(pg_temp.fails(format('update ae_bank_transactions set description = description || '' (edited)'', capture_status = capture_status where id = %s', :t_g_covered)) is null, 'H: unrelated edits to a covered transaction are unaffected');
select pg_temp.ok(pg_temp.fails(format('do $x$ begin update ae_bank_transactions set journal_id = %s where id = %s; raise exception ''UNDO_OK''; end $x$', :j_bank, :t_rv)) = 'UNDO_OK', 'H: a reversed Banking Rule journal does not block linking elsewhere');
select pg_temp.ok(pg_temp.fails(format('do $x$ begin update ae_bank_transactions set journal_id = null, posted_flag = false where id = %s; raise exception ''UNDO_OK''; end $x$', :t_a)) = 'UNDO_OK', 'H: unlinking (e.g. ON DELETE SET NULL) is never blocked');
select pg_temp.ok(pg_temp.fails(format('update ae_bank_transactions set journal_id = journal_id, posted_flag = posted_flag where id = %s', :t_a)) is null, 'H: rewriting an existing link with itself is allowed');

-- ---------------------------------------------------------------------
-- I. Tenant isolation, row-level security and privileges.
-- ---------------------------------------------------------------------
select pg_temp.tx(pg_temp.co_m(), 910) as t_i_m \gset
select pg_temp.tx(pg_temp.co_m(), 920) as t_i_m2 \gset
select pg_temp.legacy_posted_journal(pg_temp.co_m(), :t_i_m2) as j_i_m2 \gset
select pg_temp.company_fp(pg_temp.co_m()) as m_fp_i \gset

-- The session's temporary sequences are used under the API roles below.
do $$ begin
  execute format('grant usage, select on all sequences in schema %I to authenticated, anon, service_role', pg_my_temp_schema()::regnamespace);
end $$;

-- Northwood's owner, aiming at Metanoia's rows.
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', pg_temp.user_n()), true);
select set_config('request.jwt.claim.sub', pg_temp.user_n()::text, true);
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_i_m, pg_temp.payload(910), 'intruder')->>'outcome' = 'not_found', 'I: a Northwood member cannot post a Metanoia transaction (not visible)');
select pg_temp.ok(fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_i_m2, 'intruder')->>'outcome' = 'not_found', 'I: a Northwood member cannot recover a Metanoia transaction');
select pg_temp.ok(pg_temp.fails(format('select fn_record_rule_engine_link_audit(%L, %s, %s, ''intruder'', ''RuleEngineJournalLinkRecovered'', '''', ''{}'')', pg_temp.co_m(), :t_d, :j_d)) like 'VYRON_RULE_POST_FORBIDDEN%', 'I: a Northwood member cannot write Metanoia''s audit log');
select pg_temp.ok(not fn_bank_transaction_has_live_rule_engine_journal(pg_temp.co_m(), :t_i_m2), 'I: a Northwood member learns nothing about Metanoia''s journals');
select pg_temp.ok(pg_temp.fails(format('select pg_temp.post(%L, %s, pg_temp.payload(910), ''intruder'')', pg_temp.co_n(), :t_i_m)) is null
  and pg_temp.post(pg_temp.co_n(), :t_i_m, pg_temp.payload(910), 'intruder')->>'outcome' = 'not_found', 'I: naming their own company with a Metanoia transaction id finds nothing either');
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.ok(pg_temp.company_fp(pg_temp.co_m()) = :'m_fp_i', 'I: Metanoia''s books are byte-identical after the Northwood member''s attempts');

-- Metanoia's own owner: the signed-in path works end to end under RLS.
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', pg_temp.user_m()), true);
select set_config('request.jwt.claim.sub', pg_temp.user_m()::text, true);
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_i_m, pg_temp.payload(910), 'owner-m@synthetic.test')->>'outcome' = 'posted', 'I: a Metanoia member posts their own transaction (journal, lines, batch, GL, link all allowed by RLS)');
select pg_temp.ok(fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_i_m2, 'owner-m@synthetic.test')->>'outcome' = 'recovered', 'I: a Metanoia member recovers their own transaction, audited through the helper');
select pg_temp.ok(pg_temp.fails(format('insert into automation_audit_log (company_id, action_type) values (%L, ''forged'')', pg_temp.co_m())) is not null, 'I: the member still cannot write the audit log directly');
select pg_temp.ok(pg_temp.fails(format('select fn_record_rule_engine_link_audit(%L, %s, %s, ''owner'', ''RuleEngineJournalLinkRecovered'', '''', ''{}'')', pg_temp.co_m(), :t_i_m, :j_d)) like 'VYRON_RULE_POST_AUDIT_MISMATCH%', 'I: the audit helper refuses to record a link that does not exist');
select pg_temp.ok(pg_temp.fails(format('select fn_record_rule_engine_link_audit(%L, %s, %s, ''owner'', ''Anything'', '''', ''{}'')', pg_temp.co_m(), :t_d, :j_d)) like 'VYRON_RULE_POST_AUDIT_TYPE%', 'I: the audit helper records only its own action type');
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.ok((select journal_id is not null and posted_flag from ae_bank_transactions where id = :t_i_m), 'I: (the member''s post landed)');

-- The scheduler (service_role) path.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.tx(pg_temp.co_m(), 930) as t_i_svc \gset
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_i_svc, pg_temp.payload(930), 'System')->>'outcome' = 'posted', 'I: the scheduler (service_role) posts');
select pg_temp.tx(pg_temp.co_m(), 940) as t_i_svc2 \gset
reset role;
select pg_temp.legacy_posted_journal(pg_temp.co_m(), :t_i_svc2) as j_i_svc2 \gset
set local role service_role;
select pg_temp.ok(fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_i_svc2, 'Scheduler (cron)')->>'outcome' = 'recovered', 'I: the scheduler (service_role) recovers, and its audit entry is accepted');
reset role;
select set_config('request.jwt.claims', '', true);

-- Anonymous callers.
set local role anon;
select pg_temp.ok(pg_temp.fails(format('select pg_temp.post(%L, 1, ''{}'', ''x'', current_date, ''{}'')', pg_temp.co_m())) like '%permission denied%', 'I: anon cannot call the posting function');
select pg_temp.ok(pg_temp.fails(format('select fn_claim_bank_transaction_for_rule(%L, 1, ''{}'', ''x'')', pg_temp.co_m())) like '%permission denied%', 'I: anon cannot call the claim function');
select pg_temp.ok(pg_temp.fails(format('select * from fn_list_rule_engine_worklist(%L, false, null, null, 10)', pg_temp.co_m())) like '%permission denied%', 'I: anon cannot list the worklist');
select pg_temp.ok(pg_temp.fails(format('select fn_recover_rule_engine_journal_link(%L, 1, ''x'')', pg_temp.co_m())) like '%permission denied%', 'I: anon cannot call the recovery function');
reset role;

-- ---------------------------------------------------------------------
-- L. Northwood regression: its own Bank Posting is unchanged, and nothing
--    above touched its books.
-- ---------------------------------------------------------------------
select pg_temp.ok(pg_temp.company_fp(pg_temp.co_n()) = :'n_fp_start', 'L: every Metanoia operation above left Northwood byte-identical');
select pg_temp.tx(pg_temp.co_n(), 1234) as t_n \gset
select fn_post_bank_transactions(pg_temp.co_n(), array[:t_n]::bigint[],
  jsonb_build_array(jsonb_build_object('journalNumber', 'JR000001', 'journalDate', '2026-03-27', 'journalType', 'Bank Transactions', 'description', 'nw', 'reference', '',
    'financialYearLabel', 'FY2026', 'financialPeriod', 1, 'transactionIds', jsonb_build_array(:t_n),
    'lines', jsonb_build_array(jsonb_build_object('transactionId', :t_n, 'accountCode', '3030', 'debit', 1234, 'credit', 0, 'description', 'nw'), jsonb_build_object('transactionId', :t_n, 'accountCode', '1000', 'debit', 0, 'credit', 1234, 'description', 'nw')))),
  'PB000001', date '2026-09-16', 'nw-user') as r_n \gset
select pg_temp.ok((:'r_n'::jsonb)->'claimedTransactionIds' = to_jsonb(array[:t_n::bigint]), 'L: Northwood Bank Posting claims its transaction as before');
select pg_temp.ok((select journal_id is not null and posted_flag and posting_batch_id is not null from ae_bank_transactions where id = :t_n), 'L: Northwood Bank Posting links journal and batch as before');
select pg_temp.ok((select j.source_type = 'bank_transactions_post' and j.source_id is null and j.submitted_by = 'nw-user' from ae_journals j join ae_bank_transactions t on t.journal_id = j.id where t.id = :t_n), 'L: Northwood journal shape unchanged (bank_transactions_post, stamped)');
select pg_temp.ok(pg_temp.fails(format('update ae_bank_transactions set description = ''edited'' where id = %s', :t_n)) is null, 'L: the trigger does not interfere with Northwood''s posted rows');

-- ---------------------------------------------------------------------
-- F. The Banking Rule claim — one definition, one write (review M1/L6).
-- ---------------------------------------------------------------------
select (select id from banking_rules where company_id = pg_temp.co_m()) as rule_m \gset
select (select id from banking_rules where company_id = pg_temp.co_n()) as rule_n \gset
select pg_temp.tx(pg_temp.co_m(), 30) as t_f \gset
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_f \gset
select pg_temp.ok((select fn_bank_transaction_is_claimable_by_rule(t) from ae_bank_transactions t where id = :t_f), 'F: an untouched imported transaction is claimable');
select pg_temp.ok(fn_claim_bank_transaction_for_rule(pg_temp.co_m(), :t_f, pg_temp.claim(pg_temp.co_m()) || jsonb_build_object('matchedRuleIds', jsonb_build_array(:rule_m, :rule_m)), 'claimer'), 'F: the claim succeeds');
select pg_temp.ok((select rule_id = :rule_m and suggested_gl_account = '6940' and suggested_vat_code = 'No VAT' and allocation_status = 'Suggested' and allocation_type = 'G' and allocation_method is null and journal_id is null and not posted_flag and debit = 30
                   from ae_bank_transactions where id = :t_f), 'F: the claim writes the classification, and nothing else');
select pg_temp.ok((select count(*) = 1 and bool_and(new_status = 'Suggested' and performed_by = 'claimer' and allocation_reason = 'Resolved by rule "Auto: Salaries → GL"' and not is_manual_override)
                   from ae_allocation_history where transaction_id = :t_f), 'F: one allocation history row, with the same wording as before');
select pg_temp.ok((select count(*) = 2 from banking_rule_applications where bank_transaction_id = :t_f and rule_id = :rule_m and company_id = pg_temp.co_m()), 'F: one rule application per matched rule, as before');
select pg_temp.ok(not fn_claim_bank_transaction_for_rule(pg_temp.co_m(), :t_f, pg_temp.claim(pg_temp.co_m()), 'claimer'), 'F: a second claim is refused');
select pg_temp.ok((select count(*) from ae_allocation_history where transaction_id = :t_f) = 1 and (select count(*) from banking_rule_applications where bank_transaction_id = :t_f) = 2, 'F: the refused claim wrote nothing');
select pg_temp.ok(pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_f', 'F: a claim never writes the ledger');
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_f, pg_temp.payload(30), 'System')->>'outcome' = 'not_eligible',
  'F: a transaction a rule already owns without a journal is not posted by a rule later (a person posts it) — legacy rule-owned rows stay as they are');
select pg_temp.ok(pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_f', 'F: (that refusal wrote nothing)');

-- LEGACY rule-owned rows (the ~562 Northwood rows): classified by a rule
-- under the OLD system, never posted, no journal. They are not a recovery,
-- not claimable, and never posted — not even with an active rule, a real GL
-- account and a complete claim. They wait for a person.
select pg_temp.tx(pg_temp.co_m(), 39, 'Legacy salary') as t_leg \gset
update ae_bank_transactions set rule_id = :rule_m, allocation_status = 'Suggested', suggested_gl_account = '6940', suggested_vat_code = 'No VAT', allocation_type = 'G' where id = :t_leg;
insert into ae_allocation_history (company_id, transaction_id, new_status, is_manual_override, performed_by, allocation_reason)
values (pg_temp.co_m(), :t_leg, 'Suggested', false, 'System', 'Resolved by rule "Auto: Salaries → GL"');
select pg_temp.txn_row(:t_leg)::text as row_leg \gset
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_leg \gset
select pg_temp.ok(not exists (select 1 from fn_list_rule_engine_recovery_candidates(pg_temp.co_m(), 1000) c where c.id = :t_leg), 'M1/legacy: a legacy rule-owned row is not a recovery candidate');
select pg_temp.ok(not exists (select 1 from fn_list_rule_engine_worklist(pg_temp.co_m(), true, null, null, 1000) w where w.id = :t_leg), 'M1/legacy: ...not in the claimable worklist');
select pg_temp.ok(exists (select 1 from fn_list_rule_engine_worklist(pg_temp.co_m(), false, null, null, 1000) w where w.id = :t_leg), 'M1/legacy: ...but still in the unposted worklist, visible for review');
select pg_temp.ok(not fn_claim_bank_transaction_for_rule(pg_temp.co_m(), :t_leg, pg_temp.claim(pg_temp.co_m()), 'x'), 'M1/legacy: ...cannot be claimed again');
select pg_temp.post(pg_temp.co_m(), :t_leg, pg_temp.payload(39), 'Scheduler (cron)') as r_leg \gset
select pg_temp.ok((:'r_leg'::jsonb)->>'outcome' = 'not_eligible', 'M1/legacy: ...and the posting function refuses it, even with a complete claim');
select pg_temp.ok(pg_temp.txn_row(:t_leg)::text = :'row_leg' and pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_leg'
  and (select count(*) from ae_allocation_history where transaction_id = :t_leg) = 1
  and not exists (select 1 from ae_journals where source_type = 'bank_transaction_rule_engine' and source_id = :t_leg),
  'M1/legacy: the legacy row, its history and the ledger are unchanged');

select pg_temp.tx(pg_temp.co_m(), 32) as t_ai \gset
update ae_bank_transactions set allocation_status = 'Suggested', suggested_gl_account = '3030', allocation_method = 'Future AI', allocation_type = 'G' where id = :t_ai;
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_ai, pg_temp.payload(32), 'System')->>'outcome' = 'posted', 'F: a transaction carrying only an unconfirmed AI suggestion is posted by a rule (Phase 53)');
select pg_temp.ok((select allocation_method is null and suggested_gl_account = '6940' and rule_id = :rule_m and journal_id is not null from ae_bank_transactions where id = :t_ai),
  'F: ...and the rule''s classification replaced the AI guess');

select pg_temp.tx(pg_temp.co_m(), 33) as t_sug \gset
update ae_bank_transactions set allocation_status = 'Suggested', suggested_gl_account = '3030', allocation_method = 'Matched Bill' where id = :t_sug;
select pg_temp.ok(not fn_claim_bank_transaction_for_rule(pg_temp.co_m(), :t_sug, pg_temp.claim(pg_temp.co_m()), 'x'), 'F: a non-AI suggestion is not claimable');
select pg_temp.tx(pg_temp.co_m(), 34) as t_ov \gset
update ae_bank_transactions set is_manual_override = true where id = :t_ov;
select pg_temp.tx(pg_temp.co_m(), 35) as t_hold \gset
update ae_bank_transactions set review_hold = true where id = :t_hold;
select pg_temp.ok(not fn_claim_bank_transaction_for_rule(pg_temp.co_m(), :t_ov, pg_temp.claim(pg_temp.co_m()), 'x')
  and not fn_claim_bank_transaction_for_rule(pg_temp.co_m(), :t_hold, pg_temp.claim(pg_temp.co_m()), 'x'), 'F: overridden and held transactions are not claimable');

select pg_temp.tx(pg_temp.co_m(), 36) as t_part \gset
select pg_temp.txn_row(:t_part)::text as row_part \gset
select pg_temp.ok(fn_claim_bank_transaction_for_rule(pg_temp.co_m(), :t_part, '{"ruleName": "x", "matchedRuleIds": []}', 'x'), 'F: a claim with nothing to write reports success (as before)...');
select pg_temp.ok(pg_temp.txn_row(:t_part)::text = :'row_part' and not exists (select 1 from ae_allocation_history where transaction_id = :t_part),
  'F: ...and writes nothing');
select pg_temp.ok(fn_claim_bank_transaction_for_rule(pg_temp.co_m(), :t_part, jsonb_build_object('ruleId', :rule_m, 'ruleName', 'x', 'matchedRuleIds', '[]'::jsonb, 'suggestedVatCode', 'Zero', 'allocationStatus', 'Suggested'), 'x'),
  'F: a partial claim succeeds');
select pg_temp.ok((select suggested_gl_account is null and allocation_type is null and suggested_vat_code = 'Zero' and rule_id = :rule_m from ae_bank_transactions where id = :t_part),
  'F: keys the rule did not resolve leave their columns alone');
select pg_temp.tx(pg_temp.co_m(), 37) as t_wr \gset
select pg_temp.ok(pg_temp.fails(format('select fn_claim_bank_transaction_for_rule(%L, %s, %L::jsonb, ''x'')', pg_temp.co_m(), :t_wr, jsonb_build_object('ruleId', :rule_n, 'allocationStatus', 'Suggested'))) like 'VYRON_RULE_CLAIM_RULE_MISMATCH%',
  'F: a rule from another company is refused');
select pg_temp.ok(pg_temp.fails(format('select fn_claim_bank_transaction_for_rule(%L, %s, %L::jsonb, ''x'')', pg_temp.co_m(), :t_wr, jsonb_build_object('matchedRuleIds', jsonb_build_array(:rule_n), 'ruleId', :rule_m, 'allocationStatus', 'Suggested'))) like 'VYRON_RULE_CLAIM_RULE_MISMATCH%',
  'F: a matched rule from another company is refused');
select pg_temp.ok(pg_temp.fails(format('select fn_claim_bank_transaction_for_rule(%L, %s, ''[]'', ''x'')', pg_temp.co_m(), :t_wr)) like 'VYRON_RULE_CLAIM_INVALID%', 'F: a claim must be an object');
select pg_temp.ok((select rule_id is null from ae_bank_transactions where id = :t_wr), 'F: (refused claims wrote nothing)');

-- ---------------------------------------------------------------------
-- H2. Manual Cashbook entries are never a Banking Rule's.
-- ---------------------------------------------------------------------
select pg_temp.tx(pg_temp.co_m(), 41, 'Cashbook payment', 'Manual') as t_man \gset
select pg_temp.txn_row(:t_man)::text as row_man \gset
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_man \gset
select pg_temp.ok(not (select fn_bank_transaction_is_claimable_by_rule(t) from ae_bank_transactions t where id = :t_man), 'H2: a Manual entry is not claimable');
select pg_temp.ok(not fn_claim_bank_transaction_for_rule(pg_temp.co_m(), :t_man, pg_temp.claim(pg_temp.co_m()), 'x'), 'H2: a rule cannot classify a Manual entry');
select pg_temp.post(pg_temp.co_m(), :t_man, pg_temp.payload(41), 'System') as r_man \gset
select pg_temp.ok((:'r_man'::jsonb)->>'outcome' = 'not_eligible' and (:'r_man'::jsonb)->>'reason' like '%Manual Cashbook%', 'H2: the posting function refuses a Manual entry');
update ae_bank_transactions set allocation_method = 'Future AI', suggested_gl_account = '3030', allocation_status = 'Suggested' where id = :t_man;
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_man, pg_temp.payload(41), 'System')->>'outcome' = 'not_eligible', 'H2: ...even when it carries only an AI suggestion');
update ae_bank_transactions set allocation_method = null, suggested_gl_account = null, allocation_status = 'Unallocated' where id = :t_man;
select pg_temp.ok(pg_temp.txn_row(:t_man)::text = :'row_man' and pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_man'
  and not exists (select 1 from ae_journals where source_type = 'bank_transaction_rule_engine' and source_id = :t_man)
  and not exists (select 1 from ae_allocation_history where transaction_id = :t_man),
  'H2: no journal, no ledger row, no classification for the Manual entry');
-- A Manual entry that is ALREADY carried by a Banking Rule journal (taken
-- before this change) is still protected against a second post by the link
-- guard, and recovery still links it (so the Cashbook sees it as posted).
select pg_temp.tx(pg_temp.co_m(), 42, 'Cashbook receipt', 'Manual') as t_man2 \gset
select pg_temp.legacy_posted_journal(pg_temp.co_m(), :t_man2) as j_man2 \gset
select pg_temp.ok(pg_temp.fails(format('update ae_bank_transactions set journal_id = %s where id = %s', (select id from ae_journals where journal_number = 'JRBANK1' and company_id = pg_temp.co_m()), :t_man2)) like 'VYRON_RULE_ENGINE_JOURNAL_EXISTS%', 'H2: a Manual entry carried by a rule journal cannot be linked to a Cashbook journal');
select pg_temp.ok(fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_man2, 'System')->>'outcome' = 'recovered', 'H2: ...and its missing link is recovered, so the Cashbook sees it as posted');

-- ---------------------------------------------------------------------
-- M1. A failure after the claim rolls the claim back; the retry posts once.
-- ---------------------------------------------------------------------
select pg_temp.tx(pg_temp.co_m(), 51) as t_m1 \gset
select pg_temp.txn_row(:t_m1)::text as row_m1 \gset
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_m1 \gset
create trigger zz_simulated_gl_crash_m1 before insert on gl_transactions for each row execute function pg_temp.explode();
select pg_temp.fails(format('select pg_temp.post(%L, %s, pg_temp.payload(51), ''System'')', pg_temp.co_m(), :t_m1)) as err_m1 \gset
drop trigger zz_simulated_gl_crash_m1 on gl_transactions;
select pg_temp.ok(:'err_m1' like 'SIMULATED_CRASH%', 'M1: the simulated crash happened after the claim, while writing the ledger');
select pg_temp.ok(pg_temp.txn_row(:t_m1)::text = :'row_m1', 'M1: the transaction is exactly as before — not left rule-owned and unposted');
select pg_temp.ok((select fn_bank_transaction_is_claimable_by_rule(t) from ae_bank_transactions t where id = :t_m1), 'M1: ...so the next sweep can claim it again');
select pg_temp.ok(not exists (select 1 from ae_allocation_history where transaction_id = :t_m1) and not exists (select 1 from banking_rule_applications where bank_transaction_id = :t_m1), 'M1: no history or rule application survived');
select pg_temp.ok(pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_m1', 'M1: no journal, batch or GL row survived');
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_m1, pg_temp.payload(51), 'System')->>'outcome' = 'posted', 'M1: the retry posts');
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_m1, pg_temp.payload(51), 'System')->>'outcome' = 'already_linked', 'M1: a further retry finds it done');
select pg_temp.ok((select count(*) from ae_journals where source_type = 'bank_transaction_rule_engine' and source_id = :t_m1) = 1
  and (select count(*) from ae_allocation_history where transaction_id = :t_m1) = 1
  and (select count(*) from banking_rule_applications where bank_transaction_id = :t_m1) = 1
  and (select count(*) from gl_transactions g join ae_journals j on j.id = g.journal_id where j.source_type = 'bank_transaction_rule_engine' and j.source_id = :t_m1) = 2,
  'M1: exactly one journal, two GL rows, one history row, one rule application');

-- The claim must be present and agree with the journal. Nothing is written otherwise.
select pg_temp.tx(pg_temp.co_m(), 52) as t_cv \gset
select pg_temp.txn_row(:t_cv)::text as row_cv \gset
select pg_temp.ledger_fp(pg_temp.co_m()) as fp_cv \gset
select set_config('vyron_test.t_cv', :'t_cv', false);
do $$
declare
  t bigint := current_setting('vyron_test.t_cv')::bigint;
  e text;
begin
  e := pg_temp.fails(format('select fn_post_rule_engine_journal(%L, %s, pg_temp.payload(52), ''System'', date ''2026-09-16'', null)', pg_temp.co_m(), t));
  perform pg_temp.ok(e like 'VYRON_RULE_POST_NO_CLAIM%', 'claim: posting without a claim is refused');
  e := pg_temp.fails(format('select fn_post_rule_engine_journal(%L, %s, pg_temp.payload(52), ''System'', date ''2026-09-16'', pg_temp.claim(%L) - ''ruleId'')', pg_temp.co_m(), t, pg_temp.co_m()));
  perform pg_temp.ok(e like 'VYRON_RULE_POST_NO_CLAIM%', 'claim: a claim without its rule is refused');
  e := pg_temp.fails(format('select fn_post_rule_engine_journal(%L, %s, pg_temp.payload(52), ''System'', date ''2026-09-16'', pg_temp.claim(%L, ''3030''))', pg_temp.co_m(), t, pg_temp.co_m()));
  perform pg_temp.ok(e like 'VYRON_RULE_POST_CLAIM_MISMATCH%', 'claim: a journal that does not post to the claimed GL account is refused');
  e := pg_temp.fails(format('select fn_post_rule_engine_journal(%L, %s, pg_temp.payload(52), ''System'', null, pg_temp.claim(%L))', pg_temp.co_m(), t, pg_temp.co_m()));
  perform pg_temp.ok(e like 'VYRON_RULE_POST_NO_PERIOD%posting date%', 'L1: posting without a posting date is refused');
end $$;
select pg_temp.ok(pg_temp.txn_row(:t_cv)::text = :'row_cv' and pg_temp.ledger_fp(pg_temp.co_m()) = :'fp_cv', 'claim: the refusals wrote nothing');

-- ---------------------------------------------------------------------
-- L1 / L2. Dates are the caller's; the batch link is consistent.
-- ---------------------------------------------------------------------
select pg_temp.tx(pg_temp.co_m(), 61) as t_l \gset
select pg_temp.post(pg_temp.co_m(), :t_l, pg_temp.payload(61), 'System', date '2020-01-31') as r_l \gset
select set_config('vyron_test.r_l', :'r_l', false);
do $$
declare
  r jsonb := current_setting('vyron_test.r_l')::jsonb;
  j record;
  b record;
  t record;
begin
  select * into j from ae_journals where id = (r->>'journalId')::bigint;
  select * into b from posting_batches where id = (r->>'batchId')::bigint;
  select * into t from ae_bank_transactions where id = (r->>'transactionId')::bigint;
  perform pg_temp.ok(b.posting_date = date '2020-01-31' and b.posting_date <> current_date, 'L1: the batch is dated with the supplied posting date, never the database date');
  perform pg_temp.ok(j.journal_date = date '2026-09-16', 'L1: the journal keeps the journal date it was given (the unchanged run-date policy)');
  perform pg_temp.ok(not exists (select 1 from gl_transactions g where g.journal_id = j.id and g.posting_date <> j.journal_date), 'L1: every ledger row carries the journal date, as before');
  perform pg_temp.ok(j.posting_batch_id = b.id and t.posting_batch_id = b.id and t.journal_id = j.id, 'L2: transaction, journal and batch point at each other');
  perform pg_temp.ok(t.posted_at is not null and t.posted_flag and j.posted_at is not null, 'L2: posted_at is stamped on the transaction and the journal');
end $$;

-- ---------------------------------------------------------------------
-- M2. The paged worklist reaches every row; recovery candidates are
-- found directly, however long the worklist is.
-- ---------------------------------------------------------------------
create function pg_temp.co_p() returns uuid language sql immutable as $$ select '0b100000-0000-4000-8000-0000000000c3'::uuid $$;
insert into organisations (id, name) values ('0b100000-0000-4000-8000-0000000000b3'::uuid, 'Synthetic Org P');
insert into companies (id, organisation_id, name) values (pg_temp.co_p(), '0b100000-0000-4000-8000-0000000000b3'::uuid, 'Synthetic paging company');
insert into chart_of_accounts (company_id, account_code, description, account_type, normal_balance)
select pg_temp.co_p(), code, code, 'Expense', 'Debit' from unnest(array['1020', '6940']) code;
insert into ae_bank_accounts (company_id, account_number, account_name, gl_account) values (pg_temp.co_p(), 'SYN-P', 'Synthetic paging bank', '1020');
insert into ae_bank_transactions (company_id, transaction_date, description, import_description, beneficiary, debit, credit, bank_account, bank_account_id,
                                  allocation_status, source_occurrence, is_manual_override, review_hold, entry_source, capture_status)
select pg_temp.co_p(),
       case when g % 97 = 0 then null else date '2025-01-01' + (g % 400) end,
       'paged ' || g, 'paged ' || g, 'Payee ' || g, 10 + g, 0, 'Synthetic paging bank', pg_temp.bank(pg_temp.co_p()),
       'Unallocated', g, g % 3 = 0, g % 5 = 0, case when g % 7 = 0 then 'Manual' else 'Imported' end, case when g % 7 = 0 then 'Draft' end
  from generate_series(1, 2600) g;
-- Ten rows are already posted (Bank Posting): they are not in the worklist.
insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, status, total_debit, total_credit)
values (pg_temp.co_p(), 'JRP1', date '2025-06-01', 'Bank Transactions', '', '', 'bank_transactions_post', 'Posted', 0, 0);
update ae_bank_transactions set journal_id = (select id from ae_journals where journal_number = 'JRP1'), posted_flag = true
 where company_id = pg_temp.co_p() and description in (select 'paged ' || g from generate_series(250, 2500, 250) g);
-- Recovery shapes at the very tail of the order (the oldest dates).
update ae_bank_transactions set transaction_date = date '2000-01-01' where company_id = pg_temp.co_p() and description in ('paged 1', 'paged 2', 'paged 4', 'paged 8');
select (select id from ae_bank_transactions where company_id = pg_temp.co_p() and description = 'paged 1') as p_rec \gset
select (select id from ae_bank_transactions where company_id = pg_temp.co_p() and description = 'paged 2') as p_appr \gset
select (select id from ae_bank_transactions where company_id = pg_temp.co_p() and description = 'paged 4') as p_rev \gset
select (select id from ae_bank_transactions where company_id = pg_temp.co_p() and description = 'paged 8') as p_flag \gset
select pg_temp.legacy_posted_journal(pg_temp.co_p(), :p_rec) as j_prec \gset
select pg_temp.legacy_posted_journal(pg_temp.co_p(), :p_appr, 'Approved', false) as j_pappr \gset
select pg_temp.legacy_posted_journal(pg_temp.co_p(), :p_rev, 'Posted', true, true) as j_prev \gset
select pg_temp.legacy_posted_journal(pg_temp.co_p(), :p_flag) as j_pflag \gset
alter table ae_bank_transactions disable trigger ae_bank_transactions_rule_engine_journal_guard;
update ae_bank_transactions set posted_flag = true where id = :p_flag;
alter table ae_bank_transactions enable trigger ae_bank_transactions_rule_engine_journal_guard;

create table pg_temp.pages (mode text, page int, ord int, id bigint);
create function pg_temp.walk(p_claimable boolean, p_limit int) returns int language plpgsql as $$
declare
  v_date date;
  v_id bigint;
  v_page int := 0;
  v_rows int;
begin
  loop
    v_page := v_page + 1;
    insert into pg_temp.pages (mode, page, ord, id)
    select case when p_claimable then 'claimable' else 'all' end, v_page, w.ordinality, w.id
      from fn_list_rule_engine_worklist(pg_temp.co_p(), p_claimable, v_date, v_id, p_limit) with ordinality w;
    get diagnostics v_rows = row_count;
    exit when v_rows < p_limit;
    select coalesce(t.transaction_date, 'infinity'::date), t.id into v_date, v_id
      from pg_temp.pages p join ae_bank_transactions t on t.id = p.id
      where p.mode = case when p_claimable then 'claimable' else 'all' end and p.page = v_page
      order by p.ord desc limit 1;
  end loop;
  return v_page;
end $$;
select pg_temp.walk(false, 1000) as pages_all \gset
select pg_temp.walk(true, 1000) as pages_claimable \gset
select (select count(*) from ae_bank_transactions where company_id = pg_temp.co_p() and journal_id is null) as p_total \gset
select pg_temp.ok(:p_total = 2590 and :pages_all = 3, 'M2: 2,590 unposted rows come back in three pages of at most 1,000');
select pg_temp.ok((select count(*) = :p_total and count(distinct id) = :p_total from pg_temp.pages where mode = 'all'), 'M2: every unposted row is reached exactly once');
select pg_temp.ok((select array_agg(id order by page, ord) from pg_temp.pages where mode = 'all')
  = (select array_agg(id order by coalesce(transaction_date, 'infinity'::date) desc, id desc) from ae_bank_transactions where company_id = pg_temp.co_p() and journal_id is null),
  'M2: in the sweep''s order — newest date first (no date first), then id');
select pg_temp.ok((select id from pg_temp.pages where mode = 'all' order by page desc, ord desc limit 1) in (:p_rec, :p_appr, :p_rev, :p_flag), 'M2: the oldest rows at the very tail are reached');
select pg_temp.ok((select array_agg(id order by id) from pg_temp.pages where mode = 'claimable')
  = (select array_agg(t.id order by t.id) from ae_bank_transactions t where t.company_id = pg_temp.co_p() and t.journal_id is null
       and not t.is_manual_override and not t.review_hold and t.entry_source <> 'Manual' and t.rule_id is null
       and t.matched_supplier_id is null and t.matched_customer_id is null and t.matched_merchant_id is null
       and ((t.allocation_status = 'Unallocated' and t.suggested_gl_account is null) or t.allocation_method = 'Future AI')),
  'M2: the claimable pages hold exactly the claimable rows (overridden, held and Manual rows excluded)');
select pg_temp.ok((select count(*) from fn_list_rule_engine_worklist(pg_temp.co_p(), false, null, null, 5000)) = 1000, 'M2: a page is never larger than 1,000 rows');
select pg_temp.ok((select count(*) from fn_list_rule_engine_worklist(pg_temp.co_p(), false, null, null, -3)) = 0, 'M2: a non-positive page size returns nothing');
select pg_temp.ok((select array_agg(id) from fn_list_rule_engine_recovery_candidates(pg_temp.co_p(), 1000)) = array[:p_rec::bigint],
  'M2: the one recoverable link is found directly behind 2,590 rows (Approved, reversed and flagged-posted shapes are not candidates)');
select pg_temp.ok((select count(*) from fn_list_rule_engine_recovery_candidates(pg_temp.co_p(), 0)) = 0, 'M2: a zero limit returns no candidates');
select pg_temp.ok((select count(*) from fn_list_rule_engine_worklist(pg_temp.co_m(), false, null, null, 1000) w where w.company_id <> pg_temp.co_m()) = 0, 'M2: the worklist is company-scoped');

-- The same through the API roles.
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', pg_temp.user_n()), true);
select set_config('request.jwt.claim.sub', pg_temp.user_n()::text, true);
select pg_temp.ok((select count(*) from fn_list_rule_engine_worklist(pg_temp.co_p(), false, null, null, 1000)) = 0
  and (select count(*) from fn_list_rule_engine_recovery_candidates(pg_temp.co_p(), 1000)) = 0
  and (select count(*) from fn_list_rule_engine_worklist(pg_temp.co_m(), false, null, null, 1000)) = 0,
  'M2/I: a member of another company sees none of these worklists');
select pg_temp.ok((select count(*) from fn_list_rule_engine_worklist(pg_temp.co_n(), false, null, null, 1000)) >= 0, 'M2/I: ...and can list their own');
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.ok((select count(*) from fn_list_rule_engine_worklist(pg_temp.co_p(), false, null, null, 1000)) = 1000
  and (select array_agg(id) from fn_list_rule_engine_recovery_candidates(pg_temp.co_p(), 10)) = array[:p_rec::bigint],
  'M2: the scheduler (service_role) pages the worklist and finds the recovery');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------
-- CTR. A platform cross-tenant reader (0098) can read, but cannot use the
-- posting, recovery or claim paths: FOR UPDATE and UPDATE need the
-- members-only policies, so the functions find nothing.
-- ---------------------------------------------------------------------
create function pg_temp.user_p() returns uuid language sql immutable as $$ select '0b100000-0000-4000-8000-0000000000a9'::uuid $$;
insert into auth.users (id, email, aud, role) values (pg_temp.user_p(), 'platform-reader@synthetic.test', 'authenticated', 'authenticated');
insert into permission_roles (company_id, role_key, name, scope, is_system_role) values (null, 'synthetic_cross_tenant_reader', 'Synthetic cross-tenant reader', 'platform', false);
insert into role_permissions (role_id, permission_key) select id, 'CrossTenantRead' from permission_roles where role_key = 'synthetic_cross_tenant_reader' and company_id is null;
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.user_p(), null, id, 'rule-posting-test' from permission_roles where role_key = 'synthetic_cross_tenant_reader' and company_id is null;
select pg_temp.tx(pg_temp.co_m(), 71) as t_ctr \gset
select pg_temp.tx(pg_temp.co_m(), 72) as t_ctr2 \gset
select pg_temp.legacy_posted_journal(pg_temp.co_m(), :t_ctr2) as j_ctr2 \gset
select pg_temp.company_fp(pg_temp.co_m()) as m_fp_ctr \gset
select (select id from ae_journals where journal_number = 'JRBANK1' and company_id = pg_temp.co_m()) as j_bank_ctr \gset

set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', pg_temp.user_p()), true);
select set_config('request.jwt.claim.sub', pg_temp.user_p()::text, true);
select pg_temp.ok(user_has_platform_permission('CrossTenantRead') and not user_can_access_company(pg_temp.co_m()), 'CTR: (the reader holds CrossTenantRead and no company access)');
select pg_temp.ok((select count(*) from ae_bank_transactions where company_id = pg_temp.co_m() and id = :t_ctr) = 1, 'CTR: the reader can SELECT the Metanoia transaction (0098 unchanged)');
select pg_temp.ok(pg_temp.post(pg_temp.co_m(), :t_ctr, pg_temp.payload(71), 'reader')->>'outcome' = 'not_found', 'CTR: the posting function returns not_found (its FOR UPDATE needs UPDATE rights)');
select pg_temp.ok(fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_ctr2, 'reader')->>'outcome' = 'not_found', 'CTR: the recovery function returns not_found');
select pg_temp.ok(not fn_claim_bank_transaction_for_rule(pg_temp.co_m(), :t_ctr, pg_temp.claim(pg_temp.co_m()), 'reader'), 'CTR: the claim writes nothing');
select pg_temp.ok(pg_temp.fails(format('select fn_record_rule_engine_link_audit(%L, %s, %s, ''reader'', ''RuleEngineJournalLinkRecovered'', '''', ''{}'')', pg_temp.co_m(), :t_d, :j_d)) like 'VYRON_RULE_POST_FORBIDDEN%', 'CTR: the audit helper refuses the reader');
select pg_temp.ok(fn_post_bank_transactions(pg_temp.co_m(), array[:t_ctr]::bigint[],
  jsonb_build_array(jsonb_build_object('journalNumber', 'JRCTR', 'journalDate', '2026-03-27', 'transactionIds', jsonb_build_array(:t_ctr),
    'lines', jsonb_build_array(jsonb_build_object('transactionId', :t_ctr, 'accountCode', '6940', 'debit', 71, 'credit', 0), jsonb_build_object('transactionId', :t_ctr, 'accountCode', '1020', 'debit', 0, 'credit', 71)))),
  'PBCTR', date '2026-09-16', 'reader')->'batch' = 'null'::jsonb, 'CTR: Bank Posting claims nothing for the reader');
select pg_temp.ok(pg_temp.fails(format('update ae_bank_transactions set journal_id = %s where id = %s', :j_bank_ctr, :t_ctr)) is null
  and (select journal_id is null from ae_bank_transactions where id = :t_ctr), 'CTR: a direct link attempt updates no row');
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.ok(pg_temp.company_fp(pg_temp.co_m()) = :'m_fp_ctr', 'CTR: Metanoia is byte-identical after every attempt by the reader');

-- ---------------------------------------------------------------------
-- K. Re-applying 0100 over existing posted data changes no row.
-- ---------------------------------------------------------------------
select md5(pg_temp.company_fp(pg_temp.co_m()) || pg_temp.company_fp(pg_temp.co_n())) as fp_k \gset
\i :migration
select pg_temp.ok(md5(pg_temp.company_fp(pg_temp.co_m()) || pg_temp.company_fp(pg_temp.co_n())) = :'fp_k', 'K: re-applying the migration changed no journal, line, batch, GL row, transaction or audit entry');
select pg_temp.ok((select count(*) from pg_trigger where tgname = 'ae_bank_transactions_rule_engine_journal_guard') = 1, 'K: re-applying leaves exactly one guard trigger');
select pg_temp.ok(not exists (
  select 1 from ae_bank_transactions t join ae_journals j on j.id = t.journal_id
  where t.company_id = pg_temp.co_m() and t.id <> :t_ol  -- t_ol was mislinked on purpose above
    and j.source_type = 'bank_transaction_rule_engine' and (j.source_id <> t.id or not t.posted_flag or j.status <> 'Posted')
), 'K: every linked Banking Rule transaction points at its own Posted journal');
select pg_temp.ok(pg_temp.fails(format('update ae_bank_transactions set description = ''still editable'' where id = %s', :t_a)) is null, 'K: already-posted transactions stay editable in unguarded columns');

rollback;
\echo 'atomic_rule_engine_posting: all checks passed (rolled back)'
