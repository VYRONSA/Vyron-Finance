-- Database tests for migration 0102 (Rule Engine security hardening).
--
-- LOCAL / SYNTHETIC DATA ONLY. Everything runs in ONE transaction that is
-- rolled back at the end. Never run against a shared or production database.
--
--   psql -v ON_ERROR_STOP=1 \
--        -v migration=/path/to/0102_rule_engine_security_hardening.sql \
--        -v down=/path/to/0102_down_without_begin_commit.sql \
--        -f supabase/tests/rule_engine_security_hardening.test.sql
--
-- `down` is the rollback script with its own `begin;` / `commit;` lines
-- removed (inside this transaction they would commit the fixture).
-- Requires 0100 to be applied and production-like table privileges
-- (every public table grants DML to anon/authenticated/service_role).
-- Each check prints "PASS: ..."; the first failure aborts with "FAIL: ...".

\set ON_ERROR_STOP 1
set client_min_messages = notice;
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'PASS: %', label;
end $$;

-- Error text of a statement that must fail (its writes are rolled back).
create function pg_temp.fails(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- True when a statement succeeds; its writes are rolled back afterwards.
create function pg_temp.allowed(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception 'VYRON_TEST_ROLLBACK';
exception when others then
  if sqlerrm = 'VYRON_TEST_ROLLBACK' then return true; end if;
  raise notice 'refused: %', sqlerrm;
  return false;
end $$;

create function pg_temp.co_m() returns uuid language sql immutable as $$ select '0b102000-0000-4000-8000-0000000000c1'::uuid $$;
create function pg_temp.co_n() returns uuid language sql immutable as $$ select '0b102000-0000-4000-8000-0000000000c2'::uuid $$;
create function pg_temp.user_m() returns uuid language sql immutable as $$ select '0b102000-0000-4000-8000-0000000000a1'::uuid $$;
create function pg_temp.user_n() returns uuid language sql immutable as $$ select '0b102000-0000-4000-8000-0000000000a2'::uuid $$;

create function pg_temp.as_member(p_user uuid) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_user), true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function pg_temp.bank(p_company uuid) returns bigint language sql as $$
  select id from ae_bank_accounts where company_id = p_company order by id limit 1
$$;
create sequence pg_temp.tseq;
create sequence pg_temp.jseq;
create function pg_temp.tx(p_company uuid, p_amount numeric) returns bigint language sql as $$
  insert into ae_bank_transactions (company_id, transaction_date, description, import_description, beneficiary, debit, credit, bank_account, bank_account_id, allocation_status, source_occurrence, entry_source)
  values (p_company, date '2026-03-27', 'Spend Money — Salaries', 'Spend Money — Salaries', 'Salaries', p_amount, 0, 'Synthetic bank', pg_temp.bank(p_company), 'Unallocated', nextval('pg_temp.tseq'), 'Imported')
  returning id
$$;
create function pg_temp.payload(p_amount numeric) returns jsonb language sql as $$
  select jsonb_build_object('journalDate', '2026-09-16', 'journalType', 'Bank Transaction Automation', 'description', 'synthetic', 'reference', '',
    'financialYearLabel', 'FY2027', 'financialPeriod', 7,
    'lines', jsonb_build_array(
      jsonb_build_object('accountCode', '6940', 'debit', p_amount, 'credit', 0, 'description', 'synthetic'),
      jsonb_build_object('accountCode', '1020', 'debit', 0, 'credit', p_amount, 'description', 'synthetic')))
$$;
create function pg_temp.claim(p_company uuid) returns jsonb language sql as $$
  select jsonb_build_object('ruleId', r.id, 'ruleName', r.name, 'matchedRuleIds', jsonb_build_array(r.id),
    'suggestedGlAccount', '6940', 'suggestedVatCode', 'No VAT', 'allocationStatus', 'Suggested', 'performedBy', 'Scheduler (cron)')
  from banking_rules r where r.company_id = p_company and r.name = 'Auto: Salaries → GL'
$$;
-- A Banking Rule journal written directly (as an administrator would for a
-- fixture): Posted with batch and ledger rows, or only Approved.
create function pg_temp.rule_journal(p_company uuid, p_txn bigint, p_status text default 'Posted') returns bigint language plpgsql as $$
declare
  v_batch bigint;
  v_journal bigint;
  v_amount numeric;
  v_seq bigint := nextval('pg_temp.jseq');
begin
  select greatest(debit, credit) into v_amount from ae_bank_transactions where id = p_txn;
  if p_status = 'Posted' then
    insert into posting_batches (company_id, batch_number, posting_date, journal_count, transaction_count, posted_by)
    values (p_company, 'PB102-' || v_seq, date '2026-09-16', 1, 2, 'System') returning id into v_batch;
  end if;
  insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, source_id, status, total_debit, total_credit, posted_at, posting_batch_id)
  values (p_company, 'JR102-' || v_seq, date '2026-09-16', 'Bank Transaction Automation', 'fixture', '', 'bank_transaction_rule_engine', p_txn, p_status, v_amount, v_amount,
          case when p_status = 'Posted' then now() end, v_batch)
  returning id into v_journal;
  insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order) values
    (v_journal, '6940', v_amount, 0, 'fixture', 0), (v_journal, '1020', 0, v_amount, 'fixture', 1);
  if p_status = 'Posted' then
    insert into gl_transactions (company_id, journal_id, journal_line_id, account_id, posting_date, reference, description, debit, credit, financial_year_label, financial_period, posted_by)
    select p_company, v_journal, jl.id, c.id, date '2026-09-16', '', 'fixture', jl.debit, jl.credit, 'FY2027', 7, 'System'
      from ae_journal_lines jl join chart_of_accounts c on c.company_id = p_company and c.account_code = jl.account_code
      where jl.journal_id = v_journal;
  end if;
  return v_journal;
end $$;
create function pg_temp.company_fp(p_company uuid) returns text language sql as $$
  select md5(
    coalesce((select string_agg(j::text, '|' order by j.id) from ae_journals j where j.company_id = p_company), '') || '#' ||
    coalesce((select string_agg(l::text, '|' order by l.id) from ae_journal_lines l join ae_journals j on j.id = l.journal_id where j.company_id = p_company), '') || '#' ||
    coalesce((select string_agg(b::text, '|' order by b.id) from posting_batches b where b.company_id = p_company), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from gl_transactions g where g.company_id = p_company), '') || '#' ||
    coalesce((select string_agg(t::text, '|' order by t.id) from ae_bank_transactions t where t.company_id = p_company), '') || '#' ||
    coalesce((select string_agg(a::text, '|' order by a.id) from automation_audit_log a where a.company_id = p_company), ''))
$$;

-- ---------------------------------------------------------------------
-- Fixture (before 0102): two companies, one owner each.
-- ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  (pg_temp.user_m(), 'hardening-owner-m@synthetic.test', 'authenticated', 'authenticated'),
  (pg_temp.user_n(), 'hardening-owner-n@synthetic.test', 'authenticated', 'authenticated');
insert into organisations (id, name) values
  ('0b102000-0000-4000-8000-0000000000b1'::uuid, 'Synthetic Org M'),
  ('0b102000-0000-4000-8000-0000000000b2'::uuid, 'Synthetic Org N');
insert into companies (id, organisation_id, name) values
  (pg_temp.co_m(), '0b102000-0000-4000-8000-0000000000b1'::uuid, 'Synthetic Hardening M'),
  (pg_temp.co_n(), '0b102000-0000-4000-8000-0000000000b2'::uuid, 'Synthetic Hardening N');
select seed_company_rbac_defaults(pg_temp.co_m());
select seed_company_rbac_defaults(pg_temp.co_n());
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.user_m(), company_id, id, 'hardening-test' from permission_roles where company_id = pg_temp.co_m() and role_key = 'company_owner';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.user_n(), company_id, id, 'hardening-test' from permission_roles where company_id = pg_temp.co_n() and role_key = 'company_owner';
insert into chart_of_accounts (company_id, account_code, description, account_type, normal_balance)
select co, code, code, case when code in ('1000', '1020') then 'Asset' else 'Expense' end, 'Debit'
  from unnest(array[pg_temp.co_m(), pg_temp.co_n()]) co, unnest(array['1000', '1020', '6940']) code;
insert into ae_bank_accounts (company_id, account_number, account_name, gl_account) values
  (pg_temp.co_m(), 'H102-M', 'Synthetic M bank', '1020'),
  (pg_temp.co_n(), 'H102-N', 'Synthetic N bank', '1000');
insert into banking_rules (company_id, rule_type, name) values
  (pg_temp.co_m(), 'GL', 'Auto: Salaries → GL'),
  (pg_temp.co_n(), 'GL', 'Auto: Salaries → GL');

-- Existing accounting rows of every shape the guards look at.
select pg_temp.tx(pg_temp.co_m(), 100) as t_posted \gset
select pg_temp.rule_journal(pg_temp.co_m(), :t_posted) as j_posted \gset
update ae_bank_transactions set journal_id = :j_posted, posted_flag = true where id = :t_posted;
select pg_temp.tx(pg_temp.co_m(), 200) as t_orphan \gset
select pg_temp.rule_journal(pg_temp.co_m(), :t_orphan) as j_orphan \gset
select pg_temp.tx(pg_temp.co_m(), 300) as t_approved \gset
select pg_temp.rule_journal(pg_temp.co_m(), :t_approved, 'Approved') as j_approved \gset
select pg_temp.tx(pg_temp.co_n(), 400) as t_n \gset
select pg_temp.rule_journal(pg_temp.co_n(), :t_n) as j_n \gset
select id as batch_n from posting_batches where company_id = pg_temp.co_n() order by id desc limit 1 \gset
select pg_temp.tx(pg_temp.co_m(), 500) as t_open \gset
select pg_temp.tx(pg_temp.co_m(), 600) as t_open2 \gset
insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, status, total_debit, total_credit)
values (pg_temp.co_m(), 'JR102-MANUAL', date '2026-09-16', 'General', 'manual fixture', '', 'manual', 'Approved', 70, 70)
returning id as j_manual \gset
insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order) values
  (:j_manual, '6940', 70, 0, 'manual', 0), (:j_manual, '1020', 0, 70, 'manual', 1);

select pg_temp.company_fp(pg_temp.co_m()) as m_fp_before \gset
select pg_temp.company_fp(pg_temp.co_n()) as n_fp_before \gset

-- ---------------------------------------------------------------------
-- 0. Apply 0102. Existing rows are untouched.
-- ---------------------------------------------------------------------
\i :migration
select pg_temp.ok(pg_temp.company_fp(pg_temp.co_m()) = :'m_fp_before' and pg_temp.company_fp(pg_temp.co_n()) = :'n_fp_before', '0: applying 0102 changed no journal, line, batch, GL row, transaction or audit entry');

do $$ begin
  execute format('grant usage, select on all sequences in schema %I to authenticated, anon, service_role', pg_my_temp_schema()::regnamespace);
end $$;

-- ---------------------------------------------------------------------
-- A. Posting functions are not executable by PUBLIC / anon.
-- ---------------------------------------------------------------------
select pg_temp.ok(
  not has_function_privilege('anon', 'fn_post_bank_transactions(uuid, bigint[], jsonb, text, date, text)', 'execute')
  and not has_function_privilege('anon', 'fn_post_approved_journals(uuid, bigint[], jsonb, text, date, text)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.proname in ('fn_post_bank_transactions', 'fn_post_approved_journals') and a.grantee = 0),
  'A: anon and PUBLIC cannot execute fn_post_bank_transactions / fn_post_approved_journals');
select pg_temp.ok(
  has_function_privilege('authenticated', 'fn_post_bank_transactions(uuid, bigint[], jsonb, text, date, text)', 'execute')
  and has_function_privilege('service_role', 'fn_post_bank_transactions(uuid, bigint[], jsonb, text, date, text)', 'execute')
  and has_function_privilege('authenticated', 'fn_post_approved_journals(uuid, bigint[], jsonb, text, date, text)', 'execute')
  and has_function_privilege('service_role', 'fn_post_approved_journals(uuid, bigint[], jsonb, text, date, text)', 'execute')
  and has_function_privilege('authenticated', 'fn_post_rule_engine_journal(uuid, bigint, jsonb, text, date, jsonb)', 'execute'),
  'A: authenticated and service_role keep EXECUTE on every posting function');
select pg_temp.ok(not has_function_privilege('authenticated', 'fn_guard_rule_engine_journal_write()', 'execute')
  and not has_function_privilege('authenticated', 'fn_guard_bank_transaction_links()', 'execute')
  and not has_function_privilege('anon', 'fn_guard_rule_engine_journal_line_write()', 'execute'), 'A: nobody can call the guard functions directly');

-- Security attributes (final review): the atomic posting function stays
-- SECURITY INVOKER with its fixed search_path; every guard is SECURITY
-- DEFINER with a fixed search_path (pg_temp last); the helper is not callable.
select pg_temp.ok((select not prosecdef and proconfig = array['search_path=public, pg_temp'] from pg_proc where proname = 'fn_post_rule_engine_journal'),
  'A: fn_post_rule_engine_journal is still SECURITY INVOKER with search_path=public, pg_temp');
select pg_temp.ok((select bool_and(prosecdef and proconfig = array['search_path=public, pg_temp']) and count(*) = 3 from pg_proc
  where proname in ('fn_guard_rule_engine_journal_write', 'fn_guard_rule_engine_journal_line_write', 'fn_guard_bank_transaction_links')),
  'A: the three guard functions are SECURITY DEFINER with search_path=public, pg_temp');
select pg_temp.ok((select not prosecdef and proconfig = array['search_path=public, pg_temp'] from pg_proc where proname = 'fn_is_api_caller')
  and not has_function_privilege('authenticated', 'fn_is_api_caller()', 'execute')
  and not has_function_privilege('anon', 'fn_is_api_caller()', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.proname = 'fn_is_api_caller' and a.grantee = 0),
  'A: fn_is_api_caller is SECURITY INVOKER and not executable by any API role');
select pg_temp.ok((select array_agg(proname order by proname) from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%vyron.rule_engine_posting''%')
  = array['fn_guard_rule_engine_journal_line_write', 'fn_guard_rule_engine_journal_write', 'fn_post_rule_engine_journal']::name[],
  'A: only the posting function sets the sanction, and only the two journal guards read it');
select pg_temp.ok((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~* 'set_config\s*\(\s*[a-z_]+\s*,') = 0,
  'A: no public function sets a caller-chosen configuration parameter');

set local role anon;
select pg_temp.ok(pg_temp.fails(format('select fn_post_bank_transactions(%L, array[%s]::bigint[], ''[]'', ''PBX'', date ''2026-09-16'', ''anon'')', pg_temp.co_m(), :t_open)) like 'permission denied%', 'A: anon calling fn_post_bank_transactions is refused');
select pg_temp.ok(pg_temp.fails(format('select fn_post_approved_journals(%L, array[%s]::bigint[], ''[]'', ''PBX'', date ''2026-09-16'', ''anon'')', pg_temp.co_m(), :j_manual)) like 'permission denied%', 'A: anon calling fn_post_approved_journals is refused');
reset role;

-- ---------------------------------------------------------------------
-- B. Explicit WITH CHECK, same expression as USING.
-- ---------------------------------------------------------------------
select pg_temp.ok((select count(*) from pg_policy p where p.polrelid in ('ae_journals'::regclass, 'ae_bank_transactions'::regclass) and p.polcmd = '*'
  and pg_get_expr(p.polwithcheck, p.polrelid) = pg_get_expr(p.polqual, p.polrelid) and pg_get_expr(p.polqual, p.polrelid) = 'user_can_access_company(company_id)') = 2,
  'B: both tenant policies carry WITH CHECK = USING = user_can_access_company(company_id)');

-- ---------------------------------------------------------------------
-- C. Banking Rule journals: API callers cannot forge or edit them.
-- ---------------------------------------------------------------------
select pg_temp.as_member(pg_temp.user_m());
select pg_temp.ok(pg_temp.allowed(format($s$insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, status, total_debit, total_credit)
  values (%L, 'JR102-M1', date '2026-09-16', 'General', 'ok', '', 'manual', 'Draft', 0, 0)$s$, pg_temp.co_m())), 'C: a member can still create an ordinary (manual) journal');
select pg_temp.ok(pg_temp.fails(format($s$insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, source_id, status, total_debit, total_credit)
  values (%L, 'JR102-F1', date '2026-09-16', 'Bank Transaction Automation', 'forged', '', 'bank_transaction_rule_engine', %s, 'Posted', 500, 500)$s$, pg_temp.co_m(), :t_open)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%', 'C: a member cannot insert a Banking Rule journal (even Posted, forged)');
select pg_temp.ok(pg_temp.fails(format($s$insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, source_id, status, total_debit, total_credit)
  values (%L, 'JR102-F2', date '2026-09-16', 'Bank Transaction Automation', 'forged', '', 'bank_transaction_rule_engine', %s, 'Draft', 0, 0)$s$, pg_temp.co_m(), :t_open)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%', 'C: a member cannot insert a Draft Banking Rule journal (would block the transaction forever)');
select pg_temp.ok(pg_temp.fails(format('update ae_journals set source_type = ''bank_transaction_rule_engine'', source_id = %s where id = %s', :t_open, :j_manual)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%', 'C: a member cannot turn an ordinary journal into a Banking Rule journal');
select pg_temp.ok(pg_temp.fails(format('update ae_journals set status = ''Draft'' where id = %s', :j_posted)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%', 'C: a member cannot un-post a Banking Rule journal');
select pg_temp.ok(pg_temp.fails(format('update ae_journals set source_id = %s where id = %s', :t_open, :j_orphan)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%', 'C: a member cannot re-point a Banking Rule journal at another transaction');
select pg_temp.ok(pg_temp.fails(format('update ae_journals set source_type = ''manual'' where id = %s', :j_orphan)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%', 'C: a member cannot disguise a Banking Rule journal as an ordinary one');
select pg_temp.ok(pg_temp.fails(format('update ae_journals set total_debit = 1, total_credit = 1 where id = %s', :j_posted)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%', 'C: a member cannot change a Banking Rule journal''s totals');
select pg_temp.ok(pg_temp.fails(format('update ae_journals set journal_date = date ''2026-03-27'' where id = %s', :j_posted)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%', 'C: a member cannot re-date a Banking Rule journal');
select pg_temp.ok(pg_temp.fails(format('delete from ae_journals where id = %s', :j_approved)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%', 'C: a member cannot delete a Banking Rule journal');
select pg_temp.ok(pg_temp.fails(format('insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order) values (%s, ''6940'', 1, 0, ''x'', 9)', :j_posted)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%'
  and pg_temp.fails(format('update ae_journal_lines set debit = 1 where journal_id = %s', :j_posted)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%'
  and pg_temp.fails(format('delete from ae_journal_lines where journal_id = %s', :j_approved)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%',
  'C: a member cannot add, change or remove the lines of a Banking Rule journal');
select pg_temp.ok(pg_temp.allowed(format('update ae_journal_lines set description = ''edited'' where journal_id = %s', :j_manual)), 'C: lines of an ordinary journal stay editable');
select pg_temp.ok(pg_temp.allowed(format('update ae_journals set is_reversed = true, reversed_by_journal_id = %s where id = %s', :j_manual, :j_posted)), 'C: reversing a Banking Rule journal (the reversal flags) is still allowed');
select pg_temp.ok(pg_temp.fails(format($s$select fn_post_approved_journals(%L, array[%s]::bigint[], '[]'::jsonb, 'PB102-X', date '2026-09-16', 'member')$s$, pg_temp.co_m(), :j_approved)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%',
  'C: the company-wide posting engine can no longer post a stray Approved Banking Rule journal unlinked');
-- The legitimate company-wide posting path still posts an ordinary journal.
select pg_temp.ok((fn_post_approved_journals(pg_temp.co_m(), array[:j_manual]::bigint[],
  (select jsonb_agg(jsonb_build_object('journalId', l.journal_id, 'journalLineId', l.id, 'accountId', c.id, 'postingDate', '2026-09-16', 'debit', l.debit, 'credit', l.credit, 'financialYearLabel', 'FY2027', 'financialPeriod', 7))
     from ae_journal_lines l join chart_of_accounts c on c.company_id = pg_temp.co_m() and c.account_code = l.account_code where l.journal_id = :j_manual),
  'PB102-MANUAL', date '2026-09-16', 'member')->'claimedJournalIds') = jsonb_build_array(:j_manual), 'C: a member still posts an ordinary Approved journal through fn_post_approved_journals');

-- The atomic posting function is the sanctioned writer.
select fn_post_rule_engine_journal(pg_temp.co_m(), :t_open, pg_temp.payload(500), 'member', date '2026-09-16', pg_temp.claim(pg_temp.co_m())) as post_open \gset
select pg_temp.ok((:'post_open'::jsonb)->>'outcome' = 'posted', 'C: a member still posts through fn_post_rule_engine_journal');
select pg_temp.ok(coalesce(current_setting('vyron.rule_engine_posting', true), '') = '', 'C: the posting function leaves no sanction behind in the transaction');
select pg_temp.ok((select journal_id = ((:'post_open'::jsonb)->>'journalId')::bigint and posted_flag from ae_bank_transactions where id = :t_open)
  and (select count(*) from ae_journal_lines where journal_id = ((:'post_open'::jsonb)->>'journalId')::bigint) = 2
  and (select count(*) from gl_transactions where journal_id = ((:'post_open'::jsonb)->>'journalId')::bigint) = 2, 'C: that posting wrote its journal, both lines, both GL rows and the link');
select pg_temp.ok(pg_temp.fails(format('select fn_post_rule_engine_journal(%L, %s, pg_temp.payload(1), ''member'', date ''2026-09-16'', pg_temp.claim(%L))', pg_temp.co_m(), :t_open2, pg_temp.co_m())) like 'VYRON_RULE_POST_AMOUNT_MISMATCH%'
  and coalesce(current_setting('vyron.rule_engine_posting', true), '') = '', 'C: a refused posting leaves no sanction behind either');
select pg_temp.ok(pg_temp.fails(format($s$insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, source_id, status, total_debit, total_credit)
  values (%L, 'JR102-F3', date '2026-09-16', 'x', 'forged after a real post', '', 'bank_transaction_rule_engine', %s, 'Posted', 600, 600)$s$, pg_temp.co_m(), :t_open2)) like 'VYRON_RULE_ENGINE_JOURNAL_PROTECTED%', 'C: a forged insert right after a real posting is still refused');
select pg_temp.ok((fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_orphan, 'member')->>'outcome') = 'recovered', 'C: a member still recovers an orphaned link');
select pg_temp.ok((fn_recover_rule_engine_journal_link(pg_temp.co_m(), :t_orphan, 'member')->>'outcome') = 'already_linked', 'C: recovery stays idempotent');
select pg_temp.as_admin();

-- Server-side operation is not restricted.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.ok(pg_temp.allowed(format($s$insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, source_id, status, total_debit, total_credit)
  values (%L, 'JR102-S1', date '2026-09-16', 'x', 'server', '', 'bank_transaction_rule_engine', %s, 'Draft', 0, 0)$s$, pg_temp.co_m(), :t_open2)), 'C: service_role (server-side) is not restricted by the journal guard');
select pg_temp.ok((fn_post_rule_engine_journal(pg_temp.co_m(), :t_open2, pg_temp.payload(600), 'Scheduler', date '2026-09-16', pg_temp.claim(pg_temp.co_m()))->>'outcome') = 'posted', 'C: the scheduler (service_role) still posts');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.allowed(format('update ae_journals set status = ''Cancelled'' where id = %s', :j_approved)), 'C: a direct administrator session (approved repairs, tests) is not restricted');

-- ---------------------------------------------------------------------
-- D. Bank transaction links stay in the company; API inserts start unposted.
-- ---------------------------------------------------------------------
select pg_temp.as_member(pg_temp.user_m());
select pg_temp.ok(pg_temp.allowed(format($s$insert into ae_bank_transactions (company_id, transaction_date, description, beneficiary, debit, credit, bank_account, bank_account_id, allocation_status, source_occurrence, entry_source)
  values (%L, date '2026-03-28', 'import row', 'x', 1, 0, 'Synthetic bank', %s, 'Unallocated', 1, 'Imported')$s$, pg_temp.co_m(), pg_temp.bank(pg_temp.co_m()))), 'D: a member can still insert an ordinary (unposted) bank transaction');
select pg_temp.ok(pg_temp.fails(format($s$insert into ae_bank_transactions (company_id, transaction_date, description, beneficiary, debit, credit, bank_account, bank_account_id, allocation_status, source_occurrence, entry_source, posted_flag)
  values (%L, date '2026-03-28', 'pre-posted', 'x', 1, 0, 'Synthetic bank', %s, 'Unallocated', 2, 'Imported', true)$s$, pg_temp.co_m(), pg_temp.bank(pg_temp.co_m()))) like 'VYRON_BANK_TRANSACTION_INSERT_POSTED%', 'D: a member cannot insert a bank transaction already flagged posted');
select pg_temp.ok(pg_temp.fails(format($s$insert into ae_bank_transactions (company_id, transaction_date, description, beneficiary, debit, credit, bank_account, bank_account_id, allocation_status, source_occurrence, entry_source, journal_id)
  values (%L, date '2026-03-28', 'pre-linked', 'x', 1, 0, 'Synthetic bank', %s, 'Unallocated', 3, 'Imported', %s)$s$, pg_temp.co_m(), pg_temp.bank(pg_temp.co_m()), :j_manual)) like 'VYRON_BANK_TRANSACTION_INSERT_POSTED%', 'D: a member cannot insert a bank transaction already linked to a journal');
select pg_temp.ok(pg_temp.fails(format('update ae_bank_transactions set journal_id = %s where id = %s', :j_n, :t_approved)) like 'VYRON_BANK_TRANSACTION_LINK_TENANT%', 'D: a member cannot link a transaction to another company''s journal');
select pg_temp.ok(pg_temp.fails(format('update ae_bank_transactions set posting_batch_id = %s where id = %s', :batch_n, :t_approved)) like 'VYRON_BANK_TRANSACTION_LINK_TENANT%', 'D: a member cannot point a transaction at another company''s posting batch');
select pg_temp.ok(pg_temp.allowed(format('update ae_bank_transactions set description = ''edited'' where id = %s', :t_posted)), 'D: unguarded columns stay editable');
select pg_temp.as_admin();
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.ok(pg_temp.fails(format('update ae_bank_transactions set journal_id = %s where id = %s', :j_n, :t_approved)) like 'VYRON_BANK_TRANSACTION_LINK_TENANT%', 'D: the cross-company link check applies to service_role too');
select pg_temp.as_admin();
-- Bank Posting still works for a member (and links inside the company).
select pg_temp.tx(pg_temp.co_m(), 71) as t_bank \gset
select pg_temp.as_member(pg_temp.user_m());
select pg_temp.ok((fn_post_bank_transactions(pg_temp.co_m(), array[:t_bank]::bigint[],
  jsonb_build_array(jsonb_build_object('journalNumber', 'JR102-BANK', 'journalDate', '2026-03-27', 'transactionIds', jsonb_build_array(:t_bank),
    'lines', jsonb_build_array(jsonb_build_object('transactionId', :t_bank, 'accountCode', '6940', 'debit', 71, 'credit', 0), jsonb_build_object('transactionId', :t_bank, 'accountCode', '1020', 'debit', 0, 'credit', 71)))),
  'PB102-BANK', date '2026-09-16', 'member')->'claimedTransactionIds') = jsonb_build_array(:t_bank), 'D: a member still posts through fn_post_bank_transactions');
select pg_temp.ok((select journal_id is not null and posted_flag and posting_batch_id is not null from ae_bank_transactions where id = :t_bank), 'D: Bank Posting linked its journal and batch');
select pg_temp.as_admin();

-- ---------------------------------------------------------------------
-- I. Tenant isolation is unchanged.
-- ---------------------------------------------------------------------
select pg_temp.company_fp(pg_temp.co_m()) as m_fp_i \gset
select pg_temp.as_member(pg_temp.user_n());
select pg_temp.ok(pg_temp.fails(format($s$insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, status, total_debit, total_credit)
  values (%L, 'JR102-X', date '2026-09-16', 'General', 'intruder', '', 'manual', 'Draft', 0, 0)$s$, pg_temp.co_m())) like '%row-level security%', 'I: another company''s member cannot insert a journal into this company (WITH CHECK)');
select pg_temp.ok(pg_temp.fails(format('update ae_journals set company_id = %L where company_id = %L', pg_temp.co_m(), pg_temp.co_n())) is not null, 'I: another company''s member cannot move its journals into this company');
select pg_temp.ok((fn_post_rule_engine_journal(pg_temp.co_m(), :t_approved, pg_temp.payload(300), 'intruder', date '2026-09-16', pg_temp.claim(pg_temp.co_n()))->>'outcome') = 'not_found', 'I: another company''s member cannot post this company''s transaction');
select pg_temp.ok((select count(*) from ae_journals where company_id = pg_temp.co_m()) = 0, 'I: another company''s member sees none of this company''s journals');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.company_fp(pg_temp.co_m()) = :'m_fp_i', 'I: this company is byte-identical after every attempt by the other company''s member');
select pg_temp.ok(pg_temp.company_fp(pg_temp.co_n()) = :'n_fp_before', 'I: the other company''s books are unchanged by this whole suite');

-- ---------------------------------------------------------------------
-- R. The down script restores the 0100 state; re-applying is clean.
-- ---------------------------------------------------------------------
select pg_temp.company_fp(pg_temp.co_m()) as m_fp_r \gset
\i :down
select pg_temp.ok(not exists (select 1 from pg_trigger where tgname in ('ae_journals_rule_engine_write_guard', 'ae_journal_lines_rule_engine_write_guard', 'ae_bank_transactions_link_guard'))
  and exists (select 1 from pg_trigger where tgname = 'ae_bank_transactions_rule_engine_journal_guard'), 'R: the down script removes only the 0102 triggers (0100''s guard stays)');
select pg_temp.ok(has_function_privilege('anon', 'fn_post_bank_transactions(uuid, bigint[], jsonb, text, date, text)', 'execute')
  and (select prosrc not like '%set_config(''vyron.rule_engine_posting''%' from pg_proc where proname = 'fn_post_rule_engine_journal'), 'R: the down script restores the pre-0102 grants and the 0100 posting function');
select pg_temp.ok(pg_temp.company_fp(pg_temp.co_m()) = :'m_fp_r', 'R: the down script changes no data');
\i :migration
select pg_temp.ok((select count(*) from pg_trigger where tgname in ('ae_journals_rule_engine_write_guard', 'ae_journal_lines_rule_engine_write_guard', 'ae_bank_transactions_link_guard')) = 3
  and (select prosrc like '%set_config(''vyron.rule_engine_posting'', ''on''%' from pg_proc where proname = 'fn_post_rule_engine_journal')
  and pg_temp.company_fp(pg_temp.co_m()) = :'m_fp_r', 'R: re-applying 0102 is clean and changes no data');

rollback;
\echo 'rule_engine_security_hardening: all checks passed (rolled back)'
