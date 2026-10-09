-- Database tests for migration 0120 (Bulk Unpost and Unallocate POSTED
-- Bank Transactions).
--
-- LOCAL / SYNTHETIC DATA ONLY. One transaction, rolled back at the end.
-- Postings are created with the REAL posting functions
-- (fn_post_bank_transactions, fn_post_rule_engine_journal), so the
-- journals being reversed have exactly the production shape.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/bank_transaction_bulk_unposting.test.sql
--
-- Sections:
--   G  grants
--   P  preview: transaction-date range (inclusive), bank filter, every exclusion, permissions
--   X  execution (Select All): journals reversed atomically, codes retained, nothing else touched
--   L  ledger: reversal mirrors the original at its own date; balances per account and period
--   I  individual selection: a journal is reversed whole or not at all
--   E  edit + repost through the normal posting function; balances correct afterwards
--   D  duplicates: same request refused; already-unposted / already-reversed never reversed again
--   S  stale previews and concurrent change
--   F  a failing journal is rolled back on its own and reported as failed
--   A  audit: actor from the session, references, immutable
--   R  refusals: permissions, cross-company, invalid input
--   U  0119 unallocation clears a retained customer / supplier

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
  raise exception 'UP_TEST_ROLLBACK';
exception when others then
  if sqlerrm = 'UP_TEST_ROLLBACK' then return null; end if;
  raise notice '  (error: %)', sqlerrm;
  return sqlerrm;
end $$;

create function pg_temp.co_a() returns uuid language sql immutable as $$ select '5f400000-0000-4000-8000-0000000012a1'::uuid $$;
create function pg_temp.co_b() returns uuid language sql immutable as $$ select '5f400000-0000-4000-8000-0000000012b1'::uuid $$;
create function pg_temp.uid(p_name text) returns uuid language sql immutable as $$
  select (case p_name
    when 'editor' then '5f400000-0000-4000-8000-000000001201'
    when 'viewer' then '5f400000-0000-4000-8000-000000001202'
    when 'bankonly' then '5f400000-0000-4000-8000-000000001203'
    when 'outsider' then '5f400000-0000-4000-8000-000000001204' end)::uuid
$$;
create function pg_temp.email(p_name text) returns text language sql immutable as $$ select 'up-' || p_name || '@synthetic.test' $$;
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

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select pg_temp.uid(n), pg_temp.email(n), 'authenticated', 'authenticated' from unnest(array['editor', 'viewer', 'bankonly', 'outsider']) n;
insert into organisations (id, name) values ('5f400000-0000-4000-8000-0000000012aa', 'UP Org');
insert into companies (id, organisation_id, name, base_currency_code) values
  (pg_temp.co_a(), '5f400000-0000-4000-8000-0000000012aa', 'UP Company A', 'ZAR'),
  (pg_temp.co_b(), '5f400000-0000-4000-8000-0000000012aa', 'UP Company B', 'ZAR');
insert into permission_roles (company_id, role_key, name) values
  (pg_temp.co_a(), 'up_editor', 'e'), (pg_temp.co_a(), 'up_viewer', 'v'), (pg_temp.co_a(), 'up_bankonly', 'b'), (pg_temp.co_b(), 'up_outsider', 'o');
insert into role_permissions (role_id, permission_key)
select pr.id, k from permission_roles pr
cross join lateral unnest(case pr.role_key
  when 'up_viewer' then array['Banking:View', 'GeneralLedger:View']
  when 'up_bankonly' then array['Banking:View', 'Banking:Edit']
  else array['Banking:View', 'Banking:Edit', 'GeneralLedger:View', 'GeneralLedger:Reverse'] end) k
where pr.role_key like 'up_%';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.uid(replace(pr.role_key, 'up_', '')), pr.company_id, pr.id, 'up-test' from permission_roles pr where pr.role_key like 'up_%';

insert into chart_of_accounts (company_id, account_code, description, account_type, normal_balance)
select co, a.code, a.name, a.kind, a.nb
  from unnest(array[pg_temp.co_a(), pg_temp.co_b()]) co,
  (values ('1000', 'Bank Cheque', 'Asset', 'Debit'), ('1010', 'Bank Savings', 'Asset', 'Debit'), ('1100', 'Debtors Control', 'Asset', 'Debit'),
          ('2000', 'Creditors Control', 'Liability', 'Credit'), ('9500', 'VAT Control', 'Liability', 'Credit'),
          ('6100', 'Bank Charges', 'Expense', 'Debit'), ('6200', 'Motor Vehicle Expenses', 'Expense', 'Debit')) a(code, name, kind, nb);
insert into ae_bank_accounts (company_id, account_number, account_name, gl_account) values
  (pg_temp.co_a(), 'UP-A1', 'UP Cheque', '1000'), (pg_temp.co_a(), 'UP-A2', 'UP Savings', '1010'), (pg_temp.co_b(), 'UP-B1', 'UP B Cheque', '1000');
create function pg_temp.bank(p text) returns bigint language sql security definer as $$ select id from ae_bank_accounts where account_number = p $$;
insert into financial_years (company_id, year_label, start_date, end_date, status, lock_date) values
  (pg_temp.co_a(), 'FY2025', date '2025-02-21', date '2026-02-20', 'Closed', null),
  (pg_temp.co_a(), 'FY2026', date '2026-02-21', date '2027-02-20', 'Open', date '2026-02-25'),
  (pg_temp.co_b(), 'FY2026', date '2026-03-01', date '2027-02-28', 'Open', null);
insert into customers (company_id, customer_code, name) values (pg_temp.co_a(), 'CUST-001', 'UP Customer');
insert into ae_suppliers (company_id, name, supplier_code) values (pg_temp.co_a(), 'UP Supplier', 'SUP-001');
insert into ae_imported_bills (company_id, invoice_number) values (pg_temp.co_a(), 'UP-INV-1');
insert into banking_rules (company_id, rule_type, name) values (pg_temp.co_a(), 'GL', 'UP Rule');
insert into bank_reconciliations (company_id, bank_account_id, statement_date, statement_closing_balance)
values (pg_temp.co_a(), pg_temp.bank('UP-A1'), date '2026-03-31', 0);
create function pg_temp.customer() returns bigint language sql security definer as $$ select id from customers where customer_code = 'CUST-001' $$;
create function pg_temp.supplier() returns bigint language sql security definer as $$ select id from ae_suppliers where supplier_code = 'SUP-001' $$;

-- p_kind: 'G' (GL p_target), 'C' customer, 'S' supplier.
create function pg_temp.txn(p_company uuid, p_bank text, p_date date, p_desc text, p_kind text, p_target text, p_debit numeric, p_credit numeric)
returns bigint language sql as $$
  insert into ae_bank_transactions (company_id, transaction_date, reference, description, import_description, beneficiary, debit, credit,
    bank_account, bank_account_id, gl_account, allocation_status, suggested_gl_account, allocation_type, allocation_method,
    matched_customer_id, matched_supplier_id, is_manual_override, suggested_vat_code, source_occurrence, entry_source)
  values (p_company, p_date, 'REF-' || p_desc, p_desc, p_desc, 'Payee ' || p_desc, p_debit, p_credit,
    p_bank, pg_temp.bank(p_bank), 'Source 9999', 'Allocated',
    case when p_kind = 'G' then p_target end, p_kind, 'Manual',
    case when p_kind = 'C' then pg_temp.customer() end, case when p_kind = 'S' then pg_temp.supplier() end,
    true, 'S15', 1, 'Imported')
  returning id
$$;
create function pg_temp.t(p_desc text) returns bigint language sql security definer as $$ select id from ae_bank_transactions where description = p_desc $$;
create function pg_temp.row(p_desc text) returns ae_bank_transactions language sql security definer as $$ select * from ae_bank_transactions where description = p_desc $$;
create function pg_temp.jid(p_desc text) returns bigint language sql security definer as $$ select journal_id from ae_bank_transactions where description = p_desc $$;

-- The balanced line group Post to Accounting builds for one transaction
-- (journal-service.ts::buildJournalLinesForTransaction), VAT split when vat > 0.
create function pg_temp.lines_for(p_id bigint) returns jsonb language sql security definer as $$
  select case when t.debit > 0 then
      case when coalesce(t.vat, 0) > 0 then jsonb_build_array(
          jsonb_build_object('transactionId', t.id, 'accountCode', tgt.code, 'debit', t.debit - t.vat, 'credit', 0, 'description', t.description),
          jsonb_build_object('transactionId', t.id, 'accountCode', '9500', 'debit', t.vat, 'credit', 0, 'description', 'VAT — ' || t.description),
          jsonb_build_object('transactionId', t.id, 'accountCode', ba.gl_account, 'debit', 0, 'credit', t.debit, 'description', t.description))
      else jsonb_build_array(
          jsonb_build_object('transactionId', t.id, 'accountCode', tgt.code, 'debit', t.debit, 'credit', 0, 'description', t.description),
          jsonb_build_object('transactionId', t.id, 'accountCode', ba.gl_account, 'debit', 0, 'credit', t.debit, 'description', t.description)) end
    else jsonb_build_array(
          jsonb_build_object('transactionId', t.id, 'accountCode', ba.gl_account, 'debit', t.credit, 'credit', 0, 'description', t.description),
          jsonb_build_object('transactionId', t.id, 'accountCode', tgt.code, 'debit', 0, 'credit', t.credit, 'description', t.description)) end
  from ae_bank_transactions t
  join ae_bank_accounts ba on ba.id = t.bank_account_id
  cross join lateral (select case t.allocation_type when 'C' then '1100' when 'S' then '2000' else t.suggested_gl_account end as code) tgt
  where t.id = p_id
$$;
-- Post to Accounting for the given transactions (all of one date) through
-- the real atomic function; returns the journal id.
create function pg_temp.post(variadic p_desc text[]) returns bigint language plpgsql security definer as $$
declare
  v_ids bigint[];
  v_co uuid;
  v_date date;
  v_lines jsonb := '[]'::jsonb;
  v_id bigint;
  v_out jsonb;
begin
  select array_agg(id order by id), min(company_id::text)::uuid, min(transaction_date) into v_ids, v_co, v_date
    from ae_bank_transactions where description = any(p_desc);
  foreach v_id in array v_ids loop v_lines := v_lines || pg_temp.lines_for(v_id); end loop;
  v_out := fn_post_bank_transactions(v_co, v_ids, jsonb_build_array(jsonb_build_object(
    'journalNumber', fn_bank_unposting_next_number(v_co, 'JR'), 'journalDate', v_date, 'journalType', 'Bank Transactions',
    'description', 'Bank transactions posted for ' || v_date, 'reference', '', 'financialYearLabel', 'FY' || extract(year from v_date + 306),
    'financialPeriod', ((extract(month from v_date)::int + 9) % 12) + 1, 'transactionIds', to_jsonb(v_ids), 'lines', v_lines)),
    fn_bank_unposting_next_number(v_co, 'PB'), v_date, 'up-test');
  if jsonb_array_length(v_out->'journals') <> 1 then raise exception 'fixture posting failed for %', p_desc; end if;
  return (v_out->'journals'->0->>'id')::bigint;
end $$;

-- Range 2026-03-01 .. 2026-03-31 unless stated.
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-10', 'g1', 'G', '6100', 115, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-10', 'c1', 'C', null, 0, 200);
select pg_temp.txn(pg_temp.co_a(), 'UP-A2', date '2026-03-10', 's1', 'S', null, 300, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-01', 'from', 'G', '6200', 101, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-31', 'to', 'G', '6100', 104, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-04-01', 'after', 'G', '6100', 105, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-12', 'rule1', 'G', '6200', 112, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-14', 'recon', 'G', '6100', 114, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-14', 'recomp', 'G', '6200', 214, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-15', 'split', 'G', '6100', 115, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-16', 'billm', 'S', null, 116, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-17', 'genj', 'G', '6100', 117, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-18', 'nojournal', 'G', '6100', 118, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-19', 'manual', 'G', '6100', 119, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-02-24', 'locked', 'G', '6100', 103, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-20', 'revd', 'G', '6100', 120, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-21', 'failme', 'G', '6100', 121, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-22', 'stale', 'G', '6100', 122, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-23', 'unposted', 'G', '6100', 123, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-03-24', 'solo', 'G', '6200', 124, 0);
select pg_temp.txn(pg_temp.co_a(), 'UP-A1', date '2026-02-20', 'closed', 'G', '6100', 220, 0);
select pg_temp.txn(pg_temp.co_b(), 'UP-B1', date '2026-03-10', 'otherco', 'G', '6100', 310, 0);
update ae_bank_transactions set vat = 15 where description = 'g1';
update ae_bank_transactions set matched_bill_id = (select id from ae_imported_bills where invoice_number = 'UP-INV-1') where description = 'billm';
update ae_bank_transactions set suggested_gl_account = null, allocation_type = null, is_split = true where description = 'split';
insert into bank_transaction_splits (bank_transaction_id, company_id, line_order, amount, description, gl_account)
select pg_temp.t('split'), pg_temp.co_a(), n, a, 'split ' || n, g from (values (1, 60, '6100'), (2, 55, '6200')) v(n, a, g);

-- failme first, so the posting batch it would have opened is the one
-- rolled back (F).
select pg_temp.post('failme');
select pg_temp.post('g1', 'c1', 's1');
select pg_temp.post('from');
select pg_temp.post('to');
select pg_temp.post('after');
select pg_temp.post('recon', 'recomp');
select pg_temp.post('billm');
select pg_temp.post('locked');
select pg_temp.post('revd');
select pg_temp.post('stale');
select pg_temp.post('solo');
select pg_temp.post('closed');
select pg_temp.post('otherco');
-- The split's journal: one bank line, one line per split.
select fn_post_bank_transactions(pg_temp.co_a(), array[pg_temp.t('split')], jsonb_build_array(jsonb_build_object(
  'journalNumber', fn_bank_unposting_next_number(pg_temp.co_a(), 'JR'), 'journalDate', '2026-03-15', 'journalType', 'Bank Transactions',
  'description', 'split', 'reference', '', 'financialYearLabel', 'FY2026', 'financialPeriod', 1, 'transactionIds', jsonb_build_array(pg_temp.t('split')),
  'lines', jsonb_build_array(
    jsonb_build_object('transactionId', pg_temp.t('split'), 'accountCode', '6100', 'debit', 60, 'credit', 0, 'description', 'split 1'),
    jsonb_build_object('transactionId', pg_temp.t('split'), 'accountCode', '6200', 'debit', 55, 'credit', 0, 'description', 'split 2'),
    jsonb_build_object('transactionId', pg_temp.t('split'), 'accountCode', '1000', 'debit', 0, 'credit', 115, 'description', 'split')))),
  fn_bank_unposting_next_number(pg_temp.co_a(), 'PB'), date '2026-03-15', 'up-test');
-- A Banking Rule posting (one journal per transaction) via the real function.
update ae_bank_transactions set is_manual_override = false, allocation_method = null, allocation_status = 'Unallocated', suggested_gl_account = null, allocation_type = null where description = 'rule1';
select fn_post_rule_engine_journal(pg_temp.co_a(), pg_temp.t('rule1'), jsonb_build_object(
    'journalDate', '2026-03-12', 'financialYearLabel', 'FY2026', 'financialPeriod', 1, 'description', 'rule1',
    'lines', jsonb_build_array(
      jsonb_build_object('accountCode', '6200', 'debit', 112, 'credit', 0, 'description', 'rule1'),
      jsonb_build_object('accountCode', '1000', 'debit', 0, 'credit', 112, 'description', 'rule1'))),
  'up-test', date '2026-03-12',
  jsonb_build_object('ruleId', (select id from banking_rules where name = 'UP Rule'), 'suggestedGlAccount', '6200', 'allocationStatus', 'Allocated'));
-- Generate Journal: linked to a Draft journal, never flagged posted.
insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, status, total_debit, total_credit)
values (pg_temp.co_a(), 'UP-GEN', date '2026-03-17', 'Bank Transactions', 'generated', '', 'bank_transactions_bulk', 'Draft', 117, 117);
update ae_bank_transactions set journal_id = (select id from ae_journals where journal_number = 'UP-GEN') where description = 'genj';
-- Posted flag without a journal.
update ae_bank_transactions set posted_flag = true, posted_at = now() where description = 'nojournal';
-- A posted Cashbook entry.
insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, source_id, status, total_debit, total_credit)
values (pg_temp.co_a(), 'UP-CB', date '2026-03-19', 'Cashbook', 'cashbook', '', 'cashbook_entry', pg_temp.t('manual'), 'Posted', 119, 119);
update ae_bank_transactions set entry_source = 'Manual', capture_status = 'Posted', journal_id = (select id from ae_journals where journal_number = 'UP-CB') where description = 'manual';
-- Reconciled after posting.
update ae_bank_transactions set reconciliation_id = (select id from bank_reconciliations where company_id = pg_temp.co_a()) where description = 'recon';
-- Already reversed through GL > Journals (the reversal exists; the row was never unlinked — today's behaviour).
insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, source_id, status, total_debit, total_credit, reversal_of_journal_id)
select pg_temp.co_a(), 'UP-REV', current_date, 'Reversal', 'Reversal', '', 'journal_reversal', pg_temp.jid('revd'), 'Approved', 120, 120, pg_temp.jid('revd');
update ae_journals set is_reversed = true, reversed_by_journal_id = (select id from ae_journals where journal_number = 'UP-REV') where id = pg_temp.jid('revd');

create temp table up_journal_of as select description, journal_id from ae_bank_transactions where journal_id is not null;
create function pg_temp.orig(p_desc text) returns bigint language sql as $$ select journal_id from up_journal_of where description = p_desc $$;

-- Balances per account per month, the measure of "the ledger is right".
create function pg_temp.balances() returns table (account_code text, month date, net numeric) language sql security definer as $$
  select c.account_code, date_trunc('month', g.posting_date)::date, sum(g.debit - g.credit)
    from gl_transactions g join chart_of_accounts c on c.id = g.account_id
    where g.company_id = '5f400000-0000-4000-8000-0000000012a1'
    group by 1, 2
$$;
create function pg_temp.bal(p_code text, p_month date) returns numeric language sql as $$
  select coalesce((select net from pg_temp.balances() where account_code = p_code and month = p_month), 0)
$$;
create function pg_temp.ledger_balanced() returns boolean language sql security definer as $$
  select coalesce(sum(debit), 0) = coalesce(sum(credit), 0) from gl_transactions
$$;
-- Everything accounting except journals / ledger rows / batches (checked precisely below).
create function pg_temp.subledger_fingerprint() returns text language sql security definer as $$
  select md5(
    coalesce((select string_agg(b::text, '|' order by b.id) from ae_imported_bills b), '') || '#' ||
    coalesce((select string_agg(s::text, '|' order by s.id) from supplier_payments s), '') || '#' ||
    coalesce((select string_agg(a::text, '|' order by a.id) from supplier_payment_allocations a), '') || '#' ||
    coalesce((select string_agg(r::text, '|' order by r.id) from customer_receipts r), '') || '#' ||
    coalesce((select string_agg(x::text, '|' order by x.id) from bank_transaction_splits x), '') || '#' ||
    coalesce((select string_agg(c::text, '|' order by c.id) from bank_reconciliations c), '') || '#' ||
    coalesce((select string_agg(f::text, '|' order by f.id) from financial_years f), '') || '#' ||
    coalesce((select string_agg(k::text, '|' order by k.id) from customers k), '') || '#' ||
    coalesce((select string_agg(u::text, '|' order by u.id) from ae_suppliers u), ''))
$$;
-- The columns unposting must never change on ANY transaction.
create function pg_temp.source_fingerprint() returns text language sql security definer as $$
  select md5(string_agg(concat_ws('|', id, company_id, transaction_date, reference, description, import_description, beneficiary,
    debit, credit, balance, vat, bank_account, bank_account_id, gl_account, import_batch, source_filename, source_occurrence,
    reconciliation_id, entry_source, is_split, suggested_vat_code, matched_merchant_id, matched_bill_id,
    review_status, review_hold, created_at), '#' order by id))
  from ae_bank_transactions
$$;
create temp table up_before as
  select pg_temp.subledger_fingerprint() as subledger, pg_temp.source_fingerprint() as source,
         (select count(*) from ae_bank_transactions) as txn_count,
         (select count(*) from ae_journals) as journal_count,
         (select count(*) from gl_transactions) as gl_count,
         (select count(*) from posting_batches) as batch_count;
create temp table up_bal_before as select * from pg_temp.balances();
create temp table up_journals_before as select * from ae_journals;
create temp table up_gl_before as select * from gl_transactions;
create temp table up_txn_before as select * from ae_bank_transactions;

create temp table up_preview as select * from fn_preview_bank_unposting(pg_temp.co_a(), date '2026-03-01', date '2026-03-31', null, 5001) limit 0;
create temp table up_result (label text, result jsonb);
grant select, insert, delete on up_preview, up_result to authenticated;
grant select on up_before, up_journal_of to authenticated;

-- Make exactly one journal fail mid-way (F).
create function pg_temp.fail_one() returns trigger language plpgsql as $$
begin
  if new.description = 'failme' and old.posted_flag and not new.posted_flag then
    raise exception 'UP synthetic failure while unposting';
  end if;
  return new;
end $$;
create trigger up_fail_one before update on ae_bank_transactions for each row execute function pg_temp.fail_one();

create function pg_temp.items(variadic p_desc text[]) returns jsonb language sql security definer as $$
  select jsonb_agg(jsonb_build_object('id', t.id, 'journalId', t.journal_id, 'glAccount', coalesce(t.suggested_gl_account, ''),
           'customerId', case when t.allocation_type = 'C' then t.matched_customer_id end,
           'supplierId', case when t.allocation_type = 'S' then t.matched_supplier_id end) order by t.id)
  from ae_bank_transactions t where t.description = any(p_desc)
$$;
create function pg_temp.run(p_label text, p_from date, p_to date, p_bank text, p_items jsonb, p_key uuid default gen_random_uuid()) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  v := fn_bulk_unpost_bank_transactions(pg_temp.co_a(), p_key, p_from, p_to, case when p_bank is null then null else pg_temp.bank(p_bank) end, p_items);
  insert into up_result values (p_label, v);
  return v;
end $$;
create function pg_temp.outcome(p_label text, p_desc text) returns text language sql security definer as $$
  select i->>'outcome' from up_result r, jsonb_array_elements(r.result->'items') i
  where r.label = p_label and (i->>'transactionId')::bigint = pg_temp.t(p_desc)
$$;
create function pg_temp.reason(p_label text, p_desc text) returns text language sql security definer as $$
  select i->>'reason' from up_result r, jsonb_array_elements(r.result->'items') i
  where r.label = p_label and (i->>'transactionId')::bigint = pg_temp.t(p_desc)
$$;
create function pg_temp.pv(p_desc text) returns text language sql as $$
  select coalesce(exclusion_reason, 'ELIGIBLE') from up_preview where id = pg_temp.t(p_desc)
$$;

select pg_temp.ok((select count(*) from ae_bank_transactions where posted_flag) = 19 and pg_temp.ledger_balanced(),
  'fixture: 19 posted transactions through the real posting functions; ledger balanced');

-- =====================================================================
-- G. Grants
-- =====================================================================
select pg_temp.ok(has_function_privilege('authenticated', 'fn_bulk_unpost_bank_transactions(uuid,uuid,date,date,bigint,jsonb)', 'execute')
  and not has_function_privilege('anon', 'fn_bulk_unpost_bank_transactions(uuid,uuid,date,date,bigint,jsonb)', 'execute')
  and not has_function_privilege('service_role', 'fn_bulk_unpost_bank_transactions(uuid,uuid,date,date,bigint,jsonb)', 'execute'),
  'G1 the writer is for signed-in users only (the actor comes from the session)');
select pg_temp.ok(has_function_privilege('authenticated', 'fn_preview_bank_unposting(uuid,date,date,bigint,int)', 'execute')
  and not has_function_privilege('anon', 'fn_preview_bank_unposting(uuid,date,date,bigint,int)', 'execute')
  and not has_function_privilege('service_role', 'fn_preview_bank_unposting(uuid,date,date,bigint,int)', 'execute'),
  'G2 the preview is for signed-in users only');
select pg_temp.ok(not has_function_privilege('authenticated', 'fn_bank_unposting_next_number(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'fn_bank_unposting_next_number(uuid,text)', 'execute'),
  'G3 the numbering helper is internal');
select pg_temp.ok(not has_table_privilege('authenticated', 'bank_unallocation_runs', 'insert')
  and not has_table_privilege('authenticated', 'bank_unallocation_run_items', 'update')
  and not has_table_privilege('service_role', 'bank_unallocation_run_items', 'insert'),
  'G4 nobody writes the audit directly');
select pg_temp.ok(
  (select count(*) from pg_constraint where conrelid = 'ae_bank_transactions'::regclass and contype = 'f' and confrelid = 'ae_suppliers'::regclass) = 1
  and (select count(*) from pg_constraint where conrelid = 'ae_bank_transactions'::regclass and contype = 'f' and confrelid = 'customers'::regclass) = 1,
  'G5 one relationship each to suppliers and customers, so PostgREST embeds (Transaction Explorer, Report Centre) stay unambiguous');

-- =====================================================================
-- P. Preview
-- =====================================================================
select pg_temp.as_user('editor');
insert into up_preview select * from fn_preview_bank_unposting(pg_temp.co_a(), date '2026-03-01', date '2026-03-31', null, 5001);
select pg_temp.ok((select count(*) from up_preview where id = pg_temp.t('from')) = 1 and (select count(*) from up_preview where id = pg_temp.t('to')) = 1,
  'P1 both boundary dates are included (transaction_date, inclusive)');
select pg_temp.ok((select count(*) from up_preview where id in (pg_temp.t('after'), pg_temp.t('closed'), pg_temp.t('otherco'))) = 0,
  'P2 outside the range and other companies are not listed');
select pg_temp.ok((select count(*) from up_preview where id = pg_temp.t('unposted')) = 0,
  'P3 an allocated but unposted transaction is not offered for reversal');
select pg_temp.ok(pg_temp.pv('g1') = 'ELIGIBLE' and pg_temp.pv('c1') = 'ELIGIBLE' and pg_temp.pv('s1') = 'ELIGIBLE'
  and pg_temp.pv('from') = 'ELIGIBLE' and pg_temp.pv('to') = 'ELIGIBLE' and pg_temp.pv('rule1') = 'ELIGIBLE'
  and pg_temp.pv('failme') = 'ELIGIBLE' and pg_temp.pv('stale') = 'ELIGIBLE' and pg_temp.pv('solo') = 'ELIGIBLE',
  'P4 GL, customer, supplier, Post to Accounting and Banking Rule postings are eligible');
select pg_temp.ok((select customer_code from up_preview where id = pg_temp.t('c1')) = 'CUST-001'
  and (select supplier_code from up_preview where id = pg_temp.t('s1')) = 'SUP-001'
  and (select gl_account_code || '|' || gl_account_name from up_preview where id = pg_temp.t('g1')) = '6100|Bank Charges'
  and (select journal_transaction_count from up_preview where id = pg_temp.t('g1')) = 3
  and (select journal_source_type from up_preview where id = pg_temp.t('rule1')) = 'bank_transaction_rule_engine',
  'P5 the preview shows the codes to retain and the journal each transaction is on');
select pg_temp.ok(pg_temp.pv('recon') like 'Included in a bank reconciliation%'
  and pg_temp.pv('recomp') like 'Posted together on journal % with transaction #% (2026-03-14), which cannot be unposted: Included in a bank reconciliation%',
  'P6 reconciled is excluded, and so is every companion on its journal');
select pg_temp.ok(pg_temp.pv('split') like 'Split across several accounts%', 'P7 split excluded');
select pg_temp.ok(pg_temp.pv('billm') like 'Matched to a supplier bill%', 'P8 bill-matched excluded');
select pg_temp.ok(pg_temp.pv('genj') like 'Linked to a journal but not posted from Banking%', 'P9 Generate Journal (linked, not posted) excluded');
select pg_temp.ok(pg_temp.pv('nojournal') like 'Marked posted but linked to no journal%', 'P10 posted without a journal excluded');
select pg_temp.ok(pg_temp.pv('manual') like 'Manual cashbook entry%', 'P11 manual cashbook excluded');
select pg_temp.ok(pg_temp.pv('revd') like 'Journal % has already been reversed%', 'P13 a journal already reversed is never reversed again');
delete from up_preview;
insert into up_preview select * from fn_preview_bank_unposting(pg_temp.co_a(), date '2026-02-01', date '2026-02-28', null, 5001);
select pg_temp.ok(pg_temp.pv('closed') like 'Financial year FY2025 is closed%', 'P14 closed financial year respected');
select pg_temp.ok(pg_temp.pv('locked') like '2026-02-24 is on or before the FY2026 lock date (2026-02-25)%', 'P12 lock date respected');
delete from up_preview;
insert into up_preview select * from fn_preview_bank_unposting(pg_temp.co_a(), date '2026-03-01', date '2026-03-31', pg_temp.bank('UP-A1'), 5001);
select pg_temp.ok((select count(*) from up_preview where id = pg_temp.t('s1')) = 0
  and pg_temp.pv('g1') like 'Posted together on journal % with 1 transaction(s) outside this preview%'
  and pg_temp.pv('c1') like 'Posted together on journal % with 1 transaction(s) outside this preview%'
  and pg_temp.pv('solo') = 'ELIGIBLE',
  'P15 bank filter: a journal shared with another bank account is excluded whole, with the reason');
delete from up_preview;
select pg_temp.ok(pg_temp.err($q$ select * from fn_preview_bank_unposting(pg_temp.co_a(), date '2026-03-31', date '2026-03-01', null, 10) $q$) like '%From Date cannot be later%',
  'P16 an inverted range is refused');
select pg_temp.as_user('bankonly');
select pg_temp.ok(pg_temp.err($q$ select * from fn_preview_bank_unposting(pg_temp.co_a(), date '2026-03-01', date '2026-03-31', null, 10) $q$) like '%GeneralLedger:Reverse are required%',
  'P17 Banking:Edit alone cannot preview a reversal');
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.err($q$ select * from fn_preview_bank_unposting(pg_temp.co_a(), date '2026-03-01', date '2026-03-31', null, 10) $q$) is not null,
  'P18 a viewer cannot preview');
select pg_temp.as_user('outsider');
select pg_temp.ok(pg_temp.err($q$ select * from fn_preview_bank_unposting(pg_temp.co_a(), date '2026-03-01', date '2026-03-31', null, 10) $q$) is not null,
  'P19 another company''s user cannot preview');

-- =====================================================================
-- R. Refusals on the writer (nothing written)
-- =====================================================================
select pg_temp.as_user('bankonly');
select pg_temp.ok(pg_temp.err($q$ select fn_bulk_unpost_bank_transactions(pg_temp.co_a(), gen_random_uuid(), date '2026-03-01', date '2026-03-31', null, pg_temp.items('solo')) $q$)
  like '%GeneralLedger:Reverse are required%', 'R1 Banking:Edit alone cannot reverse a posting');
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.err($q$ select fn_bulk_unpost_bank_transactions(pg_temp.co_a(), gen_random_uuid(), date '2026-03-01', date '2026-03-31', null, pg_temp.items('solo')) $q$) is not null,
  'R2 a viewer cannot reverse');
select pg_temp.as_user('outsider');
select pg_temp.ok(pg_temp.err($q$ select fn_bulk_unpost_bank_transactions(pg_temp.co_a(), gen_random_uuid(), date '2026-03-01', date '2026-03-31', null, pg_temp.items('solo')) $q$) is not null,
  'R3 another company''s user cannot reverse');
select pg_temp.as_service();
select pg_temp.ok(pg_temp.err($q$ select fn_bulk_unpost_bank_transactions(pg_temp.co_a(), gen_random_uuid(), date '2026-03-01', date '2026-03-31', null, pg_temp.items('solo')) $q$) is not null,
  'R4 the service role cannot reverse (no session actor)');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err($q$ select fn_bulk_unpost_bank_transactions(pg_temp.co_a(), gen_random_uuid(), date '2026-03-01', date '2026-03-31', null, '[{"id": 1}]'::jsonb) $q$)
  like '%numeric id and journalId%', 'R5 an item without its journal is refused');
select pg_temp.ok(pg_temp.err($q$ select fn_bulk_unpost_bank_transactions(pg_temp.co_a(), gen_random_uuid(), date '2026-03-01', date '2026-03-31', pg_temp.bank('UP-B1'), pg_temp.items('solo')) $q$)
  like '%does not belong to this company%', 'R6 another company''s bank account is refused');
select pg_temp.ok(pg_temp.err($q$ select fn_bulk_unpost_bank_transactions(pg_temp.co_a(), gen_random_uuid(), date '2026-03-31', date '2026-03-01', null, pg_temp.items('solo')) $q$)
  like '%From Date cannot be later%', 'R7 an inverted range is refused');
select pg_temp.as_admin();
select pg_temp.ok((select count(*) from ae_journals) = (select journal_count from up_before)
  and (select count(*) from gl_transactions) = (select gl_count from up_before)
  and (select count(*) from bank_unallocation_runs) = 0, 'R8 refusals wrote nothing');

-- =====================================================================
-- S (part 1). A stale preview: the GL shown is no longer the GL.
-- =====================================================================
create temp table up_stale_items as select pg_temp.items('stale') as items;
grant select on up_stale_items to authenticated;
update ae_bank_transactions set suggested_gl_account = '6200' where description = 'stale';

-- =====================================================================
-- X. Execution — "Select All" of the full-range preview's eligible rows
-- =====================================================================
select pg_temp.as_user('editor');
insert into up_preview select * from fn_preview_bank_unposting(pg_temp.co_a(), date '2026-03-01', date '2026-03-31', null, 5001);
select pg_temp.run('all', date '2026-03-01', date '2026-03-31', null,
  (select jsonb_agg(jsonb_build_object('id', p.id, 'journalId', p.journal_id, 'glAccount', coalesce(p.gl_account_code, ''),
            'customerId', p.customer_id, 'supplierId', p.supplier_id) order by p.id)
     from up_preview p where p.exclusion_reason is null and p.id <> pg_temp.t('stale'))
  || (select items from up_stale_items));
select pg_temp.as_admin();

select pg_temp.ok(pg_temp.outcome('all', 'g1') = 'unposted' and pg_temp.outcome('all', 'c1') = 'unposted' and pg_temp.outcome('all', 's1') = 'unposted'
  and pg_temp.outcome('all', 'from') = 'unposted' and pg_temp.outcome('all', 'to') = 'unposted' and pg_temp.outcome('all', 'rule1') = 'unposted'
  and pg_temp.outcome('all', 'solo') = 'unposted',
  'X1 every eligible selected transaction is unposted');
select pg_temp.ok((select (result->>'requested')::int = 9 and (result->>'unposted')::int = 7 and (result->>'skipped')::int = 1
  and (result->>'failed')::int = 1 and (result->>'reversedJournals')::int = 5 from up_result where label = 'all'),
  'X2 counts: 9 requested = 7 unposted (5 journals) + 1 skipped + 1 failed');
select pg_temp.ok(not r.posted_flag and r.posted_at is null and r.journal_id is null and r.posting_batch_id is null
  and r.allocation_status = 'Unallocated' and r.allocation_type is null and r.allocation_method is null and r.rule_id is null
  and r.suggested_gl_account is null and not r.is_allocated and r.is_manual_override and r.suggested_vat_code = 'S15'
  and r.retained_gl_account = '6100' and r.retained_customer_id is null and r.retained_supplier_id is null,
  'X3 GL row: unposted, unallocated, GL 6100 retained, VAT code kept, protected from automatic re-allocation')
  from pg_temp.row('g1') r;
select pg_temp.ok(not r.posted_flag and r.journal_id is null and not r.is_allocated and r.matched_customer_id is null
  and r.retained_customer_id = pg_temp.customer() and r.retained_gl_account is null and r.allocation_type is null,
  'X4 customer row: customer CUST-001 retained, no longer the active allocation') from pg_temp.row('c1') r;
select pg_temp.ok(not r.posted_flag and r.journal_id is null and not r.is_allocated and r.matched_supplier_id is null
  and r.retained_supplier_id = pg_temp.supplier() and r.allocation_type is null,
  'X5 supplier row: supplier SUP-001 retained, no longer the active allocation') from pg_temp.row('s1') r;
select pg_temp.ok(r.retained_gl_account = '6200' and not r.posted_flag and r.journal_id is null and r.rule_id is null and r.is_manual_override,
  'X6 Banking Rule row: unposted; the rule cannot claim it again') from pg_temp.row('rule1') r;
select pg_temp.ok(pg_temp.source_fingerprint() = (select source from up_before) and (select count(*) from ae_bank_transactions) = (select txn_count from up_before),
  'X7 no transaction''s date, amount, description, reference, source, VAT, reconciliation or identity changed; none deleted');
select pg_temp.ok(not exists (
    select 1 from ae_bank_transactions t join up_txn_before b on b.id = t.id
    where t.description not in ('g1', 'c1', 's1', 'from', 'to', 'rule1', 'solo', 'stale') and t::text <> b::text),
  'X8 every transaction not unposted is byte-for-byte unchanged (incl. the failed and the excluded ones)');
select pg_temp.ok(pg_temp.subledger_fingerprint() = (select subledger from up_before),
  'X9 bills, payments, receipts, splits, reconciliations, periods, customers and suppliers unchanged');
select pg_temp.ok((select count(*) from ae_allocation_history h where h.transaction_id in (select pg_temp.t(d) from unnest(array['g1', 'c1', 's1', 'from', 'to', 'rule1', 'solo']) d)
  and h.new_status = 'Unallocated' and h.allocation_reason like 'Bulk unposted (run %') = 7,
  'X10 one allocation-history row per unposted transaction');

-- =====================================================================
-- L. Ledger
-- =====================================================================
create temp table up_reversed as
  select o.id as original_id, r.id as reversal_id from ae_journals o join ae_journals r on r.reversal_of_journal_id = o.id and r.source_type = 'journal_reversal'
  where o.id in (select pg_temp.orig(d) from unnest(array['g1', 'from', 'to', 'rule1', 'solo']) d);
select pg_temp.ok((select count(*) from up_reversed) = 5, 'L1 one reversal journal per reversed journal');
select pg_temp.ok(not exists (
    select 1 from up_reversed x join ae_journals o on o.id = x.original_id join ae_journals r on r.id = x.reversal_id
    where not (o.is_reversed and o.reversed_by_journal_id = r.id and r.source_id = o.id and r.journal_type = 'Reversal'
           and r.status = 'Posted' and r.journal_date = o.journal_date and r.total_debit = o.total_credit and r.total_credit = o.total_debit
           and r.posting_batch_id is not null)),
  'L2 each reversal: Posted, dated at the ORIGINAL journal date, linked both ways, totals swapped');
select pg_temp.ok(not exists (
    select 1 from up_reversed x
    join gl_transactions og on og.journal_id = x.original_id
    join ae_journal_lines ol on ol.id = og.journal_line_id
    left join ae_journal_lines rl on rl.journal_id = x.reversal_id and rl.line_order = ol.line_order and rl.account_code = ol.account_code
    left join gl_transactions rg on rg.journal_line_id = rl.id
    where rg.id is null or rg.account_id <> og.account_id or rg.debit <> og.credit or rg.credit <> og.debit
       or rg.posting_date <> og.posting_date or rg.financial_year_label <> og.financial_year_label or rg.financial_period <> og.financial_period)
  and (select count(*) from gl_transactions where journal_id in (select reversal_id from up_reversed))
    = (select count(*) from gl_transactions where journal_id in (select original_id from up_reversed)),
  'L3 every original ledger row has exactly one mirror row: same account, date and period, debit/credit swapped');
select pg_temp.ok(not exists (select 1 from ae_journals j join up_journals_before b on b.id = j.id
    where j.id not in (select original_id from up_reversed) and j::text <> b::text)
  and not exists (select 1 from ae_journals j join up_journals_before b on b.id = j.id
    where j.id in (select original_id from up_reversed)
      and (to_jsonb(j) - 'is_reversed' - 'reversed_by_journal_id') <> (to_jsonb(b) - 'is_reversed' - 'reversed_by_journal_id')),
  'L4 no existing journal changed except the reversed flag and link on the originals');
select pg_temp.ok(not exists (select 1 from gl_transactions g left join up_gl_before b on b.id = g.id
    where b.id is null and g.journal_id not in (select reversal_id from up_reversed))
  and not exists (select 1 from up_gl_before b left join gl_transactions g on g.id = b.id where g.id is null or g::text <> b::text),
  'L5 no ledger row was edited or deleted; the only new ledger rows are the reversals');
select pg_temp.ok(pg_temp.ledger_balanced() and not exists (
    select 1 from gl_transactions g where g.journal_id in (select reversal_id from up_reversed) group by g.journal_id having sum(g.debit) <> sum(g.credit)),
  'L6 the ledger and every reversal balance');
select pg_temp.ok(not exists (
    select 1 from up_bal_before b
    left join pg_temp.balances() a on a.account_code = b.account_code and a.month = b.month
    where coalesce(a.net, 0) <> b.net - coalesce((
      select sum(g.debit - g.credit) from up_gl_before g join chart_of_accounts c on c.id = g.account_id
      where g.journal_id in (select original_id from up_reversed) and c.account_code = b.account_code and date_trunc('month', g.posting_date)::date = b.month), 0)),
  'L7 every account, every month: balance = before minus exactly the reversed postings');
select pg_temp.ok(pg_temp.bal('6100', date '2026-03-01') = (select net from up_bal_before where account_code = '6100' and month = date '2026-03-01') - 100 - 104
  and pg_temp.bal('9500', date '2026-03-01') = (select net from up_bal_before where account_code = '9500' and month = date '2026-03-01') - 15
  and pg_temp.bal('1100', date '2026-03-01') = (select net from up_bal_before where account_code = '1100' and month = date '2026-03-01') + 200
  and pg_temp.bal('2000', date '2026-03-01') = (select net from up_bal_before where account_code = '2000' and month = date '2026-03-01') - 300
  and pg_temp.bal('6100', date '2026-04-01') = (select net from up_bal_before where account_code = '6100' and month = date '2026-04-01'),
  'L8 March nets the reversed amounts (GL, VAT, debtors, creditors); April untouched');
select pg_temp.ok((select count(*) from posting_batches) = (select batch_count from up_before) + 1
  and (select journal_count from posting_batches order by id desc limit 1) = 5
  and (select transaction_count from posting_batches order by id desc limit 1) = (select count(*) from gl_transactions where journal_id in (select reversal_id from up_reversed))
  and (select count(distinct posting_batch_id) from ae_journals where id in (select reversal_id from up_reversed)) = 1,
  'L9 one posting batch for the run; the failed journal''s batch was rolled back');

-- =====================================================================
-- F. The failing journal
-- =====================================================================
select pg_temp.ok(pg_temp.outcome('all', 'failme') = 'failed' and pg_temp.reason('all', 'failme') like '%UP synthetic failure%',
  'F1 the failing journal is reported failed, with the database reason');
select pg_temp.ok(r.posted_flag and r.journal_id = pg_temp.orig('failme') and r.suggested_gl_account = '6100' and r.retained_gl_account is null
  and not exists (select 1 from ae_journals where reversal_of_journal_id = pg_temp.orig('failme'))
  and not (select is_reversed from ae_journals where id = pg_temp.orig('failme')),
  'F2 nothing of it changed: still posted, still allocated, no reversal, original not flagged') from pg_temp.row('failme') r;
drop trigger up_fail_one on ae_bank_transactions;

-- =====================================================================
-- S (part 2). Stale and concurrent change
-- =====================================================================
select pg_temp.ok(pg_temp.outcome('all', 'stale') = 'skipped' and pg_temp.reason('all', 'stale') like 'Changed since the preview%'
  and (select posted_flag and journal_id = pg_temp.orig('stale') from ae_bank_transactions where description = 'stale')
  and not exists (select 1 from ae_journals where reversal_of_journal_id = pg_temp.orig('stale')),
  'S1 a transaction changed since the preview is skipped and left posted');
-- Concurrent reversal of the same journal through GL > Journals between preview and execution.
select pg_temp.as_admin();
update ae_bank_transactions set suggested_gl_account = '6100' where description = 'stale';
create temp table up_s2_items as select pg_temp.items('stale') as items;
grant select on up_s2_items to authenticated;
insert into ae_journals (company_id, journal_number, journal_date, journal_type, description, reference, source_type, source_id, status, total_debit, total_credit, reversal_of_journal_id)
values (pg_temp.co_a(), 'UP-REV2', current_date, 'Reversal', 'Reversal', '', 'journal_reversal', pg_temp.orig('stale'), 'Approved', 122, 122, pg_temp.orig('stale'));
select pg_temp.as_user('editor');
select pg_temp.run('concurrent', date '2026-03-01', date '2026-03-31', null, (select items from up_s2_items));
select pg_temp.ok(pg_temp.outcome('concurrent', 'stale') = 'skipped' and pg_temp.reason('concurrent', 'stale') like 'Journal % has already been reversed%',
  'S2 a journal reversed elsewhere after the preview is not reversed a second time');
select pg_temp.as_admin();
delete from ae_journals where journal_number = 'UP-REV2';

-- =====================================================================
-- I. Individual selection: whole journal or nothing
-- =====================================================================
-- Post the three unposted rows back as one shared journal (as Post to Accounting would), then pick only one.
update ae_bank_transactions set allocation_type = 'G', suggested_gl_account = retained_gl_account, allocation_status = 'Allocated', allocation_method = 'Manual'
  where description = 'g1';
update ae_bank_transactions set allocation_type = 'C', matched_customer_id = retained_customer_id, allocation_status = 'Allocated', allocation_method = 'Manual'
  where description = 'c1';
update ae_bank_transactions set allocation_type = 'S', matched_supplier_id = retained_supplier_id, allocation_status = 'Allocated', allocation_method = 'Manual'
  where description = 's1';
select pg_temp.ok((select bool_and(is_allocated and journal_id is null) from ae_bank_transactions where description in ('g1', 'c1', 's1')),
  'E1 the retained GL, customer and supplier can be chosen again in the normal allocation write');
-- Edit: g1 moves from 6100 to 6200 before reposting.
update ae_bank_transactions set suggested_gl_account = '6200' where description = 'g1';
create temp table up_repost as select pg_temp.post('g1', 'c1', 's1') as journal_id;
select pg_temp.ok((select bool_and(posted_flag and journal_id = (select journal_id from up_repost)) from ae_bank_transactions where description in ('g1', 'c1', 's1')),
  'E2 the edited transactions repost through the normal Post to Accounting function');
-- Banking Rule transaction reposts through Post to Accounting (its rule journal is reversed, so no longer live).
update ae_bank_transactions set allocation_type = 'G', suggested_gl_account = retained_gl_account, allocation_status = 'Allocated', allocation_method = 'Manual'
  where description = 'rule1';
select pg_temp.post('rule1');
select pg_temp.ok((select posted_flag from ae_bank_transactions where description = 'rule1'), 'E3 the Banking Rule transaction reposts too');
select pg_temp.ok(pg_temp.ledger_balanced()
  and pg_temp.bal('6100', date '2026-03-01') = (select net from up_bal_before where account_code = '6100' and month = date '2026-03-01') - 100 - 104
  and pg_temp.bal('6200', date '2026-03-01') = (select net from up_bal_before where account_code = '6200' and month = date '2026-03-01') + 100 - 101 - 124
  and pg_temp.bal('9500', date '2026-03-01') = (select net from up_bal_before where account_code = '9500' and month = date '2026-03-01')
  and pg_temp.bal('1100', date '2026-03-01') = (select net from up_bal_before where account_code = '1100' and month = date '2026-03-01')
  and pg_temp.bal('2000', date '2026-03-01') = (select net from up_bal_before where account_code = '2000' and month = date '2026-03-01')
  and pg_temp.bal('1000', date '2026-03-01') = (select net from up_bal_before where account_code = '1000' and month = date '2026-03-01') + 101 + 104 + 124
  and pg_temp.bal('1010', date '2026-03-01') = (select net from up_bal_before where account_code = '1010' and month = date '2026-03-01'),
  'E4 after reposting, March holds exactly the reposted amounts once (100 moved 6100 -> 6200; still-unposted rows out)');

-- Now pick only g1 of the shared journal.
select pg_temp.as_user('editor');
select pg_temp.run('one', date '2026-03-01', date '2026-03-31', null, pg_temp.items('g1'));
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.outcome('one', 'g1') = 'skipped' and pg_temp.reason('one', 'g1') like 'Posted together on journal % with transaction #%, which is not in this selection%'
  and (select bool_and(posted_flag) from ae_bank_transactions where description in ('g1', 'c1', 's1'))
  and not exists (select 1 from ae_journals where reversal_of_journal_id = (select journal_id from up_repost)),
  'I1 selecting one transaction of a shared journal reverses nothing and says why');
-- Bank filter A1 cannot include s1 (UP-A2): refused whole even if s1 is sent.
select pg_temp.as_user('editor');
select pg_temp.run('filtered', date '2026-03-01', date '2026-03-31', 'UP-A1', pg_temp.items('g1', 'c1', 's1'));
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.outcome('filtered', 's1') = 'skipped' and pg_temp.reason('filtered', 's1') = 'Not on the selected bank account.'
  and pg_temp.outcome('filtered', 'g1') = 'skipped' and pg_temp.reason('filtered', 'g1') like '%which is being skipped (Not on the selected bank account.)%'
  and (select bool_and(posted_flag) from ae_bank_transactions where description in ('g1', 'c1', 's1')),
  'I2 a bank-account filter never reverses another account''s transaction, nor its journal companions');
select pg_temp.as_user('editor');
select pg_temp.run('three', date '2026-03-10', date '2026-03-10', null, pg_temp.items('g1', 'c1', 's1'));
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.outcome('three', 'g1') = 'unposted' and pg_temp.outcome('three', 'c1') = 'unposted' and pg_temp.outcome('three', 's1') = 'unposted'
  and (select retained_gl_account from ae_bank_transactions where description = 'g1') = '6200',
  'I3 selecting the whole journal (a one-day range) reverses it; the edited GL 6200 is what is retained now');

-- =====================================================================
-- D. Duplicates and double reversal
-- =====================================================================
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format($q$ select fn_bulk_unpost_bank_transactions(pg_temp.co_a(), %L::uuid, date '2026-03-01', date '2026-03-31', null, jsonb_build_array(jsonb_build_object('id', pg_temp.t('to'), 'journalId', pg_temp.orig('to')))) $q$,
    (select r.request_key from bank_unallocation_runs r order by r.id limit 1))) like '%PRECISIA_UNALLOCATION_DUPLICATE%',
  'D1 the same preview cannot be executed twice');
select pg_temp.run('again', date '2026-03-01', date '2026-03-31', null,
  (select jsonb_agg(jsonb_build_object('id', pg_temp.t(d), 'journalId', pg_temp.orig(d), 'glAccount', '6100')) from unnest(array['to']) d));
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.outcome('again', 'to') = 'skipped' and pg_temp.reason('again', 'to') like 'Not posted to the general ledger%'
  and (select count(*) from ae_journals where reversal_of_journal_id = pg_temp.orig('to')) = 1,
  'D2 an already-unposted transaction is never reversed again');

-- =====================================================================
-- A. Audit
-- =====================================================================
select pg_temp.as_user('editor');
select pg_temp.ok((select count(*) from bank_unallocation_runs where mode = 'unpost') = 6
  and (select bool_and(actor_user_id = pg_temp.uid('editor') and actor_label = pg_temp.email('editor')) from bank_unallocation_runs),
  'A1 every run is recorded with the actor from the session (readable with Banking:View)');
select pg_temp.ok((select r.date_from = date '2026-03-01' and r.date_to = date '2026-03-31' and r.bank_account_id is null
    and r.unposted_count = 7 and r.skipped_count = 1 and r.failed_count = 1 and r.unallocated_count = 0 and r.reversed_journal_count = 5
    and r.reversal_posting_batch_id is not null
  from bank_unallocation_runs r where r.id = (select (result->>'runId')::bigint from up_result where label = 'all')),
  'A2 the run records range, filter, counts and the reversal batch');
select pg_temp.ok((select i.outcome = 'unposted' and i.previous_posted_flag and i.previous_journal_id = pg_temp.orig('c1')
    and i.previous_journal_source_type = 'bank_transactions_post' and i.previous_journal_number is not null
    and i.reversal_journal_number is not null and i.previous_customer_code = 'CUST-001' and i.previous_allocation_type = 'C'
  from bank_unallocation_run_items i where i.transaction_id = pg_temp.t('c1') and i.run_id = (select (result->>'runId')::bigint from up_result where label = 'all'))
  and (select i.previous_supplier_code = 'SUP-001' from bank_unallocation_run_items i
       where i.transaction_id = pg_temp.t('s1') and i.run_id = (select (result->>'runId')::bigint from up_result where label = 'all'))
  and (select i.previous_gl_account = '6100' and i.previous_gl_account_name = 'Bank Charges' from bank_unallocation_run_items i
       where i.transaction_id = pg_temp.t('g1') and i.run_id = (select (result->>'runId')::bigint from up_result where label = 'all'))
  and (select i.outcome = 'failed' and i.reason like '%UP synthetic failure%' and i.reversal_journal_id is null from bank_unallocation_run_items i
       where i.transaction_id = pg_temp.t('failme') and i.run_id = (select (result->>'runId')::bigint from up_result where label = 'all')),
  'A3 each item records its original posting, allocation, codes, reversal reference and outcome');
select pg_temp.as_user('viewer');
select pg_temp.ok((select count(*) from bank_unallocation_runs) = 6, 'A4 Banking:View reads the audit');
select pg_temp.as_user('outsider');
select pg_temp.ok((select count(*) from bank_unallocation_runs) = 0 and (select count(*) from bank_unallocation_run_items) = 0,
  'A5 another company''s user reads none of it');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.err('update bank_unallocation_run_items set reason = ''x''') like '%append-only%'
  and pg_temp.err('delete from bank_unallocation_runs') like '%append-only%'
  and pg_temp.err('truncate bank_unallocation_run_items') like '%append-only%',
  'A6 the audit cannot be changed, deleted or truncated, even by an administrator');

-- =====================================================================
-- U. 0119 unallocation clears a retained customer / supplier
-- =====================================================================
update ae_bank_transactions set allocation_type = 'G', suggested_gl_account = '6100', allocation_status = 'Allocated', allocation_method = 'Manual'
  where description = 'c1';
select pg_temp.as_user('editor');
select fn_bulk_unallocate_bank_transactions(pg_temp.co_a(), gen_random_uuid(), date '2026-03-01', date '2026-03-31', null,
  jsonb_build_array(jsonb_build_object('id', pg_temp.t('c1'), 'glAccount', '6100')));
select pg_temp.as_admin();
select pg_temp.ok(r.retained_gl_account = '6100' and r.retained_customer_id is null and r.retained_supplier_id is null and not r.is_allocated,
  'U1 a later GL unallocation retains the GL and clears the older retained customer') from pg_temp.row('c1') r;
select pg_temp.ok((select mode from bank_unallocation_runs order by id desc limit 1) = 'unallocate'
  and (select unposted_count from bank_unallocation_runs order by id desc limit 1) = 0,
  'U2 0119 runs are recorded as unallocate runs');

select pg_temp.ok(pg_temp.ledger_balanced(), 'Z ledger balanced at the end');

rollback;
