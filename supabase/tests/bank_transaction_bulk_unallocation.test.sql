-- Database tests for migration 0119 (Bulk Unallocate Bank Transactions).
--
-- LOCAL / SYNTHETIC DATA ONLY. One transaction, rolled back at the end.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/bank_transaction_bulk_unallocation.test.sql
--
-- Sections:
--   G  grants: only the writer function writes; the audit is read-only
--   P  preview: transaction-date range (inclusive), bank filter, exclusions, permissions
--   X  execution: eligible rows unallocated, GL retained, nothing else touched
--   N  no accounting created: journals, GL, payments, receipts unchanged
--   A  audit: actor from the session, accurate per-row outcome, immutable
--   F  a failing row is rolled back on its own and reported as failed
--   D  a repeated request is refused
--   R  refusals: view-only, cross-company, invalid range
--   S  the ordinary allocation write still works afterwards

\set ON_ERROR_STOP 1
set client_min_messages = notice;
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'BU_TEST_ROLLBACK';
exception when others then
  if sqlerrm = 'BU_TEST_ROLLBACK' then return null; end if;
  raise notice '  (error: %)', sqlerrm;
  return sqlerrm;
end $$;

create function pg_temp.co_a() returns uuid language sql immutable as $$ select '5f400000-0000-4000-8000-0000000011a1'::uuid $$;
create function pg_temp.co_b() returns uuid language sql immutable as $$ select '5f400000-0000-4000-8000-0000000011b1'::uuid $$;
create function pg_temp.uid(p_name text) returns uuid language sql immutable as $$
  select (case p_name
    when 'editor' then '5f400000-0000-4000-8000-000000001101'
    when 'viewer' then '5f400000-0000-4000-8000-000000001102'
    when 'outsider' then '5f400000-0000-4000-8000-000000001103' end)::uuid
$$;
create function pg_temp.email(p_name text) returns text language sql immutable as $$ select 'bu-' || p_name || '@synthetic.test' $$;
create function pg_temp.as_user(p_name text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated","email":"%s"}', pg_temp.uid(p_name), pg_temp.email(p_name)), true);
  perform set_config('request.jwt.claim.sub', pg_temp.uid(p_name)::text, true);
end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
-- Everything that is accounting, EXCEPT the bank transactions themselves
-- (whose allocation columns this feature legitimately changes; they are
-- checked column by column below).
create function pg_temp.accounting_fingerprint() returns text language sql security definer as $$
  select md5(
    coalesce((select string_agg(j::text, '|' order by j.id) from ae_journals j), '') || '#' ||
    coalesce((select string_agg(l::text, '|' order by l.id) from ae_journal_lines l), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from gl_transactions g), '') || '#' ||
    coalesce((select string_agg(b::text, '|' order by b.id) from ae_imported_bills b), '') || '#' ||
    coalesce((select string_agg(s::text, '|' order by s.id) from supplier_payments s), '') || '#' ||
    coalesce((select string_agg(a::text, '|' order by a.id) from supplier_payment_allocations a), '') || '#' ||
    coalesce((select string_agg(r::text, '|' order by r.id) from customer_receipts r), '') || '#' ||
    coalesce((select string_agg(x::text, '|' order by x.id) from bank_transaction_splits x), '') || '#' ||
    coalesce((select string_agg(p::text, '|' order by p.id) from posting_batches p), '') || '#' ||
    coalesce((select string_agg(c::text, '|' order by c.id) from bank_reconciliations c), ''))
$$;
-- The columns this feature must never change on ANY transaction.
create function pg_temp.source_fingerprint() returns text language sql security definer as $$
  select md5(string_agg(concat_ws('|', id, company_id, transaction_date, reference, description, import_description, beneficiary,
    debit, credit, balance, bank_account, bank_account_id, gl_account, import_batch, source_filename, source_occurrence,
    journal_id, posted_flag, posting_batch_id, reconciliation_id, entry_source, is_split, suggested_vat_code,
    matched_supplier_id, matched_customer_id, matched_merchant_id, matched_bill_id, review_status, review_hold, created_at), '#' order by id))
  from ae_bank_transactions
$$;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select pg_temp.uid(n), pg_temp.email(n), 'authenticated', 'authenticated' from unnest(array['editor', 'viewer', 'outsider']) n;
insert into organisations (id, name) values ('5f400000-0000-4000-8000-0000000011aa', 'BU Org');
insert into companies (id, organisation_id, name, base_currency_code) values
  (pg_temp.co_a(), '5f400000-0000-4000-8000-0000000011aa', 'BU Company A', 'ZAR'),
  (pg_temp.co_b(), '5f400000-0000-4000-8000-0000000011aa', 'BU Company B', 'ZAR');
insert into permission_roles (company_id, role_key, name) values
  (pg_temp.co_a(), 'bu_editor', 'e'), (pg_temp.co_a(), 'bu_viewer', 'v'), (pg_temp.co_b(), 'bu_outsider', 'o');
insert into role_permissions (role_id, permission_key)
select pr.id, 'Banking:' || a from permission_roles pr
cross join lateral unnest(case pr.role_key when 'bu_viewer' then array['View'] else array['View', 'Edit'] end) a
where pr.role_key like 'bu_%';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.uid(replace(pr.role_key, 'bu_', '')), pr.company_id, pr.id, 'bu-test' from permission_roles pr where pr.role_key like 'bu_%';

insert into chart_of_accounts (company_id, account_code, description, account_type, normal_balance)
select co, code, case code when '6100' then 'Bank Charges' else 'Motor Vehicle Expenses' end, 'Expense', 'Debit'
  from unnest(array[pg_temp.co_a(), pg_temp.co_b()]) co, unnest(array['6100', '6200']) code;
insert into ae_bank_accounts (company_id, account_number, account_name) values
  (pg_temp.co_a(), 'BU-A1', 'BU Cheque'), (pg_temp.co_a(), 'BU-A2', 'BU Savings'), (pg_temp.co_b(), 'BU-B1', 'BU B Cheque');
create function pg_temp.bank(p text) returns bigint language sql security definer as $$ select id from ae_bank_accounts where account_number = p $$;
insert into ae_suppliers (company_id, name) values (pg_temp.co_a(), 'BU Supplier');
insert into ae_imported_bills (company_id, invoice_number) values (pg_temp.co_a(), 'BU-INV-1');
insert into banking_rules (company_id, rule_type, name) values (pg_temp.co_a(), 'GL', 'BU Rule');
insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, status, total_debit, total_credit)
values (pg_temp.co_a(), 'BU-J1', date '2026-03-10', 'General', 'posted fixture', '', 'manual', 'Posted', 10, 10);
insert into bank_reconciliations (company_id, bank_account_id, statement_date, statement_closing_balance)
values (pg_temp.co_a(), pg_temp.bank('BU-A1'), date '2026-03-31', 0);

create sequence pg_temp.tseq;
create function pg_temp.txn(p_company uuid, p_bank text, p_date date, p_desc text, p_gl text, p_status text) returns bigint language sql as $$
  insert into ae_bank_transactions (company_id, transaction_date, reference, description, import_description, beneficiary, debit, credit,
    bank_account, bank_account_id, gl_account, allocation_status, suggested_gl_account, allocation_type, allocation_method,
    is_manual_override, suggested_vat_code, source_occurrence, entry_source)
  values (p_company, p_date, 'REF-' || p_desc, p_desc, p_desc, 'Payee ' || p_desc, 100 + nextval('pg_temp.tseq'), 0,
    p_bank, pg_temp.bank(p_bank), 'Source 9999', p_status, p_gl, case when p_gl is not null then 'G' end,
    case when p_gl is not null then 'Manual' end, p_gl is not null, 'S15', 1, 'Imported')
  returning id
$$;
create function pg_temp.t(p_desc text) returns bigint language sql security definer as $$ select id from ae_bank_transactions where description = p_desc $$;

select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-02-28', 'before', '6100', 'Allocated');
select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-03-01', 'from', '6100', 'Allocated');
select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-03-15', 'mid', '6200', 'Allocated');
select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-03-31', 'to', '6100', 'Allocated');
select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-04-01', 'after', '6100', 'Allocated');
select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-03-10', 'posted', '6100', 'Allocated');
select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-03-11', 'reconciled', '6100', 'Allocated');
select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-03-12', 'manual', '6100', 'Allocated');
select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-03-13', 'split', null, 'Allocated');
select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-03-14', 'billmatched', '6100', 'Matched');
select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-03-16', 'supplier', null, 'Allocated');
select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-03-17', 'open', null, 'Unallocated');
select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-03-18', 'stale', '6200', 'Allocated');
select pg_temp.txn(pg_temp.co_a(), 'BU-A1', date '2026-03-19', 'failme', '6100', 'Allocated');
select pg_temp.txn(pg_temp.co_a(), 'BU-A2', date '2026-03-20', 'savings', '6100', 'Allocated');
select pg_temp.txn(pg_temp.co_b(), 'BU-B1', date '2026-03-15', 'otherco', '6100', 'Allocated');

-- An AI allocation (the sweep's own shape) and a Rule allocation: after
-- unallocation neither automatic path may claim them again.
update ae_bank_transactions set allocation_method = 'Future AI', is_manual_override = false where id = pg_temp.t('from');
update ae_bank_transactions set rule_id = (select id from banking_rules where name = 'BU Rule'), allocation_method = null, is_manual_override = false where id = pg_temp.t('mid');
update ae_bank_transactions set journal_id = (select id from ae_journals where journal_number = 'BU-J1'), posted_flag = true where id = pg_temp.t('posted');
update ae_bank_transactions set reconciliation_id = (select id from bank_reconciliations where company_id = pg_temp.co_a()) where id = pg_temp.t('reconciled');
update ae_bank_transactions set entry_source = 'Manual', capture_status = 'Submitted' where id = pg_temp.t('manual');
update ae_bank_transactions set is_split = true where id = pg_temp.t('split');
update ae_bank_transactions set matched_bill_id = (select id from ae_imported_bills where invoice_number = 'BU-INV-1') where id = pg_temp.t('billmatched');
update ae_bank_transactions set allocation_type = 'S', matched_supplier_id = (select id from ae_suppliers where name = 'BU Supplier') where id = pg_temp.t('supplier');

create temp table bu_state as select pg_temp.accounting_fingerprint() as accounting, pg_temp.source_fingerprint() as source,
  (select count(*) from ae_bank_transactions) as txn_count,
  (select string_agg(t::text, '|' order by t.id) from ae_bank_transactions t where t.description in ('before', 'after', 'posted', 'reconciled', 'manual', 'split', 'billmatched', 'supplier', 'open', 'stale', 'failme', 'savings', 'otherco')) as untouched;
create temp table bu_preview as select * from fn_preview_bank_unallocation(pg_temp.co_a(), date '2026-03-01', date '2026-03-31', null, 5001) limit 0;
create temp table bu_result (result jsonb);
grant select, insert, delete on bu_preview, bu_result to authenticated;
grant select on bu_state to authenticated;

-- A trigger that makes exactly one row fail mid-run (F).
create function pg_temp.fail_one() returns trigger language plpgsql as $$
begin
  if new.description = 'failme' and new.suggested_gl_account is null then
    raise exception 'BU synthetic failure for one row';
  end if;
  return new;
end $$;
create trigger bu_fail_one before update on ae_bank_transactions for each row execute function pg_temp.fail_one();

create function pg_temp.items(variadic p_desc text[]) returns jsonb language sql security definer as $$
  select jsonb_agg(jsonb_build_object('id', t.id, 'glAccount', coalesce(t.suggested_gl_account, '')) order by t.id)
  from ae_bank_transactions t where t.description = any(p_desc)
$$;
create function pg_temp.outcome(p_desc text) returns text language sql as $$
  select i->>'outcome' from bu_result r, jsonb_array_elements(r.result->'items') i where (i->>'transactionId')::bigint = pg_temp.t(p_desc)
$$;
create function pg_temp.reason(p_desc text) returns text language sql as $$
  select i->>'reason' from bu_result r, jsonb_array_elements(r.result->'items') i where (i->>'transactionId')::bigint = pg_temp.t(p_desc)
$$;

-- =====================================================================
-- G. Grants
-- =====================================================================
select pg_temp.ok(has_function_privilege('authenticated', 'fn_bulk_unallocate_bank_transactions(uuid,uuid,date,date,bigint,jsonb)', 'execute')
  and not has_function_privilege('anon', 'fn_bulk_unallocate_bank_transactions(uuid,uuid,date,date,bigint,jsonb)', 'execute')
  and not has_function_privilege('service_role', 'fn_bulk_unallocate_bank_transactions(uuid,uuid,date,date,bigint,jsonb)', 'execute'),
  'G1 the writer is for signed-in users only (the actor comes from the session)');
select pg_temp.ok(has_function_privilege('authenticated', 'fn_preview_bank_unallocation(uuid,date,date,bigint,int)', 'execute')
  and not has_function_privilege('anon', 'fn_preview_bank_unallocation(uuid,date,date,bigint,int)', 'execute'),
  'G2 the preview is for signed-in users only');
select pg_temp.ok(not has_table_privilege('authenticated', 'bank_unallocation_runs', 'insert')
  and not has_table_privilege('authenticated', 'bank_unallocation_runs', 'update')
  and not has_table_privilege('authenticated', 'bank_unallocation_runs', 'delete')
  and not has_table_privilege('service_role', 'bank_unallocation_runs', 'insert')
  and not has_table_privilege('authenticated', 'bank_unallocation_run_items', 'insert')
  and not has_table_privilege('service_role', 'bank_unallocation_run_items', 'delete')
  and has_table_privilege('authenticated', 'bank_unallocation_runs', 'select'),
  'G3 nobody writes the audit directly — not even the service role; it is readable');

-- =====================================================================
-- P. Preview
-- =====================================================================
select pg_temp.as_user('editor');
insert into bu_preview select * from fn_preview_bank_unallocation(pg_temp.co_a(), date '2026-03-01', date '2026-03-31', null, 5001);
select pg_temp.ok((select count(*) from bu_preview where id = pg_temp.t('from')) = 1
  and (select count(*) from bu_preview where id = pg_temp.t('to')) = 1,
  'P1 both boundary dates are included (transaction_date between From and To)');
select pg_temp.ok((select count(*) from bu_preview where id in (pg_temp.t('before'), pg_temp.t('after'))) = 0,
  'P2 the day before From and the day after To are not candidates');
select pg_temp.ok((select count(*) from bu_preview where id = pg_temp.t('open')) = 0,
  'P3 an already-unallocated transaction is not a candidate');
select pg_temp.ok((select count(*) from bu_preview where id = pg_temp.t('otherco')) = 0,
  'P4 another company''s transaction never appears');
select pg_temp.ok((select gl_account_code = '6200' and gl_account_name = 'Motor Vehicle Expenses' and exclusion_reason is null and bank_account_name = 'BU Cheque'
  from bu_preview where id = pg_temp.t('mid')),
  'P5 an eligible row shows its current GL code and name and no exclusion');
select pg_temp.ok(
  (select exclusion_reason like 'Posted to the general ledger%' from bu_preview where id = pg_temp.t('posted'))
  and (select exclusion_reason like 'Included in a bank reconciliation%' from bu_preview where id = pg_temp.t('reconciled'))
  and (select exclusion_reason like 'Manual cashbook entry%' from bu_preview where id = pg_temp.t('manual'))
  and (select exclusion_reason like 'Split across several accounts%' from bu_preview where id = pg_temp.t('split'))
  and (select exclusion_reason like 'Matched to a supplier bill%' from bu_preview where id = pg_temp.t('billmatched'))
  and (select exclusion_reason like 'Allocated to a supplier or customer%' from bu_preview where id = pg_temp.t('supplier')),
  'P6 posted, reconciled, manual cashbook, split, bill-matched and supplier allocations are excluded with a reason');
delete from bu_preview;
insert into bu_preview select * from fn_preview_bank_unallocation(pg_temp.co_a(), date '2026-03-01', date '2026-03-31', pg_temp.bank('BU-A2'), 5001);
select pg_temp.ok((select count(*) = 1 and bool_and(id = pg_temp.t('savings')) from bu_preview),
  'P7 the bank account filter limits the candidates to that account');
select pg_temp.ok(pg_temp.err(format('select * from fn_preview_bank_unallocation(%L, date ''2026-03-31'', date ''2026-03-01'', null, 10)', pg_temp.co_a()))
  like '%From Date cannot be later than To Date%',
  'P8 From Date later than To Date is refused');
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.err(format('select * from fn_preview_bank_unallocation(%L, date ''2026-03-01'', date ''2026-03-31'', null, 10)', pg_temp.co_a()))
  like '%Banking:Edit is required%',
  'P9 a view-only user cannot preview');
select pg_temp.as_user('outsider');
select pg_temp.ok(pg_temp.err(format('select * from fn_preview_bank_unallocation(%L, date ''2026-03-01'', date ''2026-03-31'', null, 10)', pg_temp.co_a()))
  like '%Banking:Edit is required%',
  'P10 another company''s user cannot preview this company');

-- =====================================================================
-- R. Refusals — nothing is written by any of these
-- =====================================================================
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.err(format('select fn_bulk_unallocate_bank_transactions(%L, gen_random_uuid(), date ''2026-03-01'', date ''2026-03-31'', null, %L)',
  pg_temp.co_a(), pg_temp.items('mid'))) like '%Banking:Edit is required%',
  'R1 a view-only user cannot execute');
select pg_temp.as_user('outsider');
select pg_temp.ok(pg_temp.err(format('select fn_bulk_unallocate_bank_transactions(%L, gen_random_uuid(), date ''2026-03-01'', date ''2026-03-31'', null, %L)',
  pg_temp.co_a(), pg_temp.items('mid'))) like '%Banking:Edit is required%',
  'R2 another company''s editor cannot execute against this company');
select pg_temp.ok(pg_temp.err(format('select fn_bulk_unallocate_bank_transactions(%L, gen_random_uuid(), date ''2026-03-01'', date ''2026-03-31'', %s, %L)',
  pg_temp.co_b(), pg_temp.bank('BU-A1'), pg_temp.items('otherco'))) like '%does not belong to this company%',
  'R3 a bank account from another company is refused');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('select fn_bulk_unallocate_bank_transactions(%L, gen_random_uuid(), date ''2026-03-31'', date ''2026-03-01'', null, %L)',
  pg_temp.co_a(), pg_temp.items('mid'))) like '%From Date cannot be later than To Date%',
  'R4 an inverted range is refused');
select pg_temp.ok(pg_temp.err(format('select fn_bulk_unallocate_bank_transactions(%L, gen_random_uuid(), date ''2026-03-01'', date ''2026-03-31'', null, ''[]'')',
  pg_temp.co_a())) like '%select at least one transaction%',
  'R5 an empty selection is refused');
select pg_temp.as_service();
select pg_temp.ok(pg_temp.err(format('select fn_bulk_unallocate_bank_transactions(%L, gen_random_uuid(), date ''2026-03-01'', date ''2026-03-31'', null, %L)',
  pg_temp.co_a(), pg_temp.items('mid'))) like '%permission denied%',
  'R6 the service role cannot execute (there would be no accountable actor)');
select pg_temp.as_admin();
select pg_temp.ok((select count(*) from bank_unallocation_runs) = 0 and (select source from bu_state) = pg_temp.source_fingerprint()
  and not exists (select 1 from ae_bank_transactions where retained_gl_account is not null),
  'R7 no refusal wrote anything');

-- =====================================================================
-- X. Execution
-- =====================================================================
-- The stale row: its GL changes after the preview was taken.
create temp table bu_items as select pg_temp.items('from', 'mid', 'to', 'before', 'after', 'posted', 'reconciled', 'manual', 'split',
  'billmatched', 'supplier', 'open', 'stale', 'failme', 'savings', 'otherco') as items;
grant select on bu_items to authenticated;
update ae_bank_transactions set suggested_gl_account = '6100' where id = pg_temp.t('stale');
update bu_state set source = pg_temp.source_fingerprint(),
  untouched = (select string_agg(t::text, '|' order by t.id) from ae_bank_transactions t where t.description in ('before', 'after', 'posted', 'reconciled', 'manual', 'split', 'billmatched', 'supplier', 'open', 'stale', 'failme', 'savings', 'otherco'));

select pg_temp.as_user('editor');
insert into bu_result
select fn_bulk_unallocate_bank_transactions(pg_temp.co_a(), '5f400000-0000-4000-8000-0000000011ff', date '2026-03-01', date '2026-03-31',
  pg_temp.bank('BU-A1'), (select items from bu_items));
select pg_temp.as_admin();

select pg_temp.ok(pg_temp.outcome('from') = 'unallocated' and pg_temp.outcome('mid') = 'unallocated' and pg_temp.outcome('to') = 'unallocated',
  'X1 every eligible row in the range (both boundaries included) is unallocated');
select pg_temp.ok((select bool_and(suggested_gl_account is null and allocation_status = 'Unallocated' and allocation_type is null
  and allocation_method is null and rule_id is null and is_allocated = false and is_manual_override = true)
  from ae_bank_transactions where id in (pg_temp.t('from'), pg_temp.t('mid'), pg_temp.t('to'))),
  'X2 … returned to Unallocated: no allocation, not allocated, not Ready to Post');
select pg_temp.ok((select retained_gl_account from ae_bank_transactions where id = pg_temp.t('from')) = '6100'
  and (select retained_gl_account from ae_bank_transactions where id = pg_temp.t('mid')) = '6200'
  and (select retained_gl_account from ae_bank_transactions where id = pg_temp.t('to')) = '6100',
  'X3 … and each keeps the GL account it had, beside it, for the next review');
select pg_temp.ok((select bool_and(gl_account = 'Source 9999' and suggested_vat_code = 'S15') from ae_bank_transactions where id in (pg_temp.t('from'), pg_temp.t('mid'), pg_temp.t('to'))),
  'X4 the imported source account and the VAT treatment are not touched');
select pg_temp.ok((select bool_and(not fn_bank_transaction_is_claimable_by_rule(t)) from ae_bank_transactions t where id in (pg_temp.t('from'), pg_temp.t('mid'), pg_temp.t('to'))),
  'X5 neither the AI-allocated nor the rule-allocated row can be re-claimed automatically');
select pg_temp.ok(pg_temp.outcome('before') = 'skipped' and pg_temp.reason('before') = 'Outside the selected date range.'
  and pg_temp.outcome('after') = 'skipped' and pg_temp.reason('after') = 'Outside the selected date range.',
  'X6 ids outside the range are refused even when submitted');
select pg_temp.ok(pg_temp.outcome('savings') = 'skipped' and pg_temp.reason('savings') = 'Not on the selected bank account.',
  'X7 an id on another bank account is refused when a bank account was chosen');
select pg_temp.ok(pg_temp.outcome('otherco') = 'skipped' and pg_temp.reason('otherco') = 'Transaction not found in this company.',
  'X8 another company''s transaction id is refused');
select pg_temp.ok(pg_temp.outcome('posted') = 'skipped' and pg_temp.reason('posted') like 'Posted to the general ledger%'
  and pg_temp.outcome('reconciled') = 'skipped' and pg_temp.outcome('manual') = 'skipped' and pg_temp.outcome('split') = 'skipped'
  and pg_temp.outcome('billmatched') = 'skipped' and pg_temp.outcome('supplier') = 'skipped'
  and pg_temp.outcome('open') = 'skipped' and pg_temp.reason('open') = 'Already unallocated.',
  'X9 protected rows are re-checked on the server and skipped with their reason');
select pg_temp.ok(pg_temp.outcome('stale') = 'skipped' and pg_temp.reason('stale') like 'Changed since the preview%',
  'X10 a row changed after the preview is skipped, never unallocated on a stale picture');
select pg_temp.ok((select untouched from bu_state) = (select string_agg(t::text, '|' order by t.id) from ae_bank_transactions t
  where t.description in ('before', 'after', 'posted', 'reconciled', 'manual', 'split', 'billmatched', 'supplier', 'open', 'stale', 'failme', 'savings', 'otherco')),
  'X11 every skipped or failed row — inside and outside the range — is byte-for-byte unchanged');
select pg_temp.ok((select source from bu_state) = pg_temp.source_fingerprint()
  and (select txn_count from bu_state) = (select count(*) from ae_bank_transactions),
  'X12 no transaction was deleted and no date, amount, description, reference, source, posting or match column changed');
select pg_temp.ok((select count(*) from ae_allocation_history where transaction_id in (pg_temp.t('from'), pg_temp.t('mid'), pg_temp.t('to'))
  and new_status = 'Unallocated' and new_gl_account is null and performed_by = pg_temp.email('editor')) = 3
  and (select previous_gl_account from ae_allocation_history where transaction_id = pg_temp.t('mid') order by id desc limit 1) = '6200'
  and not exists (select 1 from ae_allocation_history where transaction_id = pg_temp.t('failme')),
  'X13 one allocation-history row per unallocated transaction, with the previous GL and the session actor');

-- =====================================================================
-- N. No accounting created
-- =====================================================================
select pg_temp.ok((select accounting from bu_state) = pg_temp.accounting_fingerprint(),
  'N1 no journal, journal line, GL transaction, bill, payment, receipt, split, posting batch or reconciliation was created or changed');

-- =====================================================================
-- F. Failure isolation
-- =====================================================================
select pg_temp.ok(pg_temp.outcome('failme') = 'failed' and pg_temp.reason('failme') like '%BU synthetic failure%',
  'F1 a row that fails is reported as failed with the reason — never as unallocated');
select pg_temp.ok((select suggested_gl_account = '6100' and allocation_status = 'Allocated' and allocation_type = 'G' and is_allocated and retained_gl_account is null
  from ae_bank_transactions where id = pg_temp.t('failme')),
  'F2 … and is left exactly as it was (its own sub-transaction rolled back), while the others committed');

-- =====================================================================
-- A. Audit
-- =====================================================================
select pg_temp.ok((select r.result->>'requested' = '16' and r.result->>'unallocated' = '3' and r.result->>'failed' = '1' and r.result->>'skipped' = '12' from bu_result r),
  'A1 the result counts every requested row once: 3 unallocated, 12 skipped, 1 failed');
select pg_temp.ok((select actor_user_id = pg_temp.uid('editor') and actor_label = pg_temp.email('editor') and company_id = pg_temp.co_a()
  and bank_account_id = pg_temp.bank('BU-A1') and date_from = '2026-03-01' and date_to = '2026-03-31'
  and requested_count = 16 and unallocated_count = 3 and skipped_count = 12 and failed_count = 1 and executed_at is not null
  and id = (select (result->>'runId')::bigint from bu_result)
  from bank_unallocation_runs where request_key = '5f400000-0000-4000-8000-0000000011ff'),
  'A2 the run records company, bank account, range, the session''s actor, the time and the counts');
select pg_temp.ok((select count(*) from bank_unallocation_run_items i join bank_unallocation_runs r on r.id = i.run_id
  where r.request_key = '5f400000-0000-4000-8000-0000000011ff') = 16
  and (select previous_gl_account = '6200' and previous_gl_account_name = 'Motor Vehicle Expenses' and previous_allocation_status = 'Allocated'
       and previous_allocation_type = 'G' and previous_rule_id is not null and outcome = 'unallocated'
       from bank_unallocation_run_items where transaction_id = pg_temp.t('mid'))
  and (select previous_allocation_method = 'Future AI' and previous_is_manual_override = false from bank_unallocation_run_items where transaction_id = pg_temp.t('from'))
  and (select outcome = 'failed' and reason like '%BU synthetic failure%' from bank_unallocation_run_items where transaction_id = pg_temp.t('failme'))
  and (select outcome = 'skipped' and reason like 'Posted to the general ledger%' from bank_unallocation_run_items where transaction_id = pg_temp.t('posted')),
  'A3 one item per transaction: outcome, reason, previous allocation state and the retained GL code and name');
select pg_temp.ok(pg_temp.err('update bank_unallocation_runs set unallocated_count = 0') like '%append-only%'
  and pg_temp.err('delete from bank_unallocation_run_items') like '%append-only%'
  and pg_temp.err('truncate bank_unallocation_runs cascade') like '%append-only%',
  'A4 the audit cannot be modified, deleted or truncated — even by an administrator session');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('insert into bank_unallocation_runs (company_id, request_key, date_from, date_to, requested_count, unallocated_count, skipped_count, failed_count, actor_user_id, actor_label) values (%L, gen_random_uuid(), date ''2026-03-01'', date ''2026-03-01'', 0, 0, 0, 0, %L, %L)',
  pg_temp.co_a(), pg_temp.uid('viewer'), 'forged')) like '%permission denied%',
  'A5 a user cannot write a run directly (no forged actor)');
select pg_temp.ok((select count(*) from bank_unallocation_runs) = 1, 'A6 an editor of the company can read the run');
select pg_temp.as_user('outsider');
select pg_temp.ok((select count(*) from bank_unallocation_runs) = 0 and (select count(*) from bank_unallocation_run_items) = 0,
  'A7 another company''s user cannot read it');

-- =====================================================================
-- D. Duplicate execution
-- =====================================================================
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('select fn_bulk_unallocate_bank_transactions(%L, %L, date ''2026-03-01'', date ''2026-03-31'', null, %L)',
  pg_temp.co_a(), '5f400000-0000-4000-8000-0000000011ff', pg_temp.items('failme'))) like '%already been executed%',
  'D1 the same preview cannot be executed twice');
select pg_temp.as_admin();
select pg_temp.ok((select count(*) from bank_unallocation_runs) = 1
  and (select suggested_gl_account from ae_bank_transactions where id = pg_temp.t('failme')) = '6100',
  'D2 … and the refused repeat changed nothing');

-- =====================================================================
-- S. The ordinary allocation write still works
-- =====================================================================
drop trigger bu_fail_one on ae_bank_transactions;
select pg_temp.as_user('editor');
update ae_bank_transactions set suggested_gl_account = '6100', allocation_type = 'G', allocation_status = 'Allocated', allocation_method = 'Manual'
  where id = pg_temp.t('mid');
select pg_temp.as_admin();
select pg_temp.ok((select is_allocated and allocation_status = 'Allocated' from ae_bank_transactions where id = pg_temp.t('mid')),
  'S1 an unallocated transaction can be allocated again through the ordinary write path');
select pg_temp.as_user('editor');
insert into bu_result
select fn_bulk_unallocate_bank_transactions(pg_temp.co_a(), gen_random_uuid(), date '2026-03-19', date '2026-03-19', null, pg_temp.items('failme'));
select pg_temp.as_admin();
select pg_temp.ok((select retained_gl_account = '6100' and suggested_gl_account is null and not is_allocated from ae_bank_transactions where id = pg_temp.t('failme'))
  and (select count(*) from bank_unallocation_runs) = 2,
  'S2 a single-day, single-transaction run works the same way');

rollback;
