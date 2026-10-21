-- Database tests for migration 0121 (sales posting integrity and
-- credit-note allocation).
--
-- LOCAL / SYNTHETIC DATA ONLY. One transaction, rolled back at the end.
-- Needs 0121 applied to the target database.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/sales_posting_integrity.test.sql
--
-- Sections:
--   G  grants
--   J  one live journal per sales document (the INV-3611 double posting)
--   L  no re-linking a document away from its live journal
--   S  sales documents are stored with non-negative figures
--   A  credit-note allocation: CN-3607 -> INV-3576 (R343.39), CN-3406 -> INV-3353 (R10.00)
--   I  idempotency: the same request key never allocates twice
--   O  over-allocation, wrong customer, wrong status, wrong type
--   R  refusals: permissions, cross-company, invalid input, direct writes

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
  raise exception 'SP_TEST_ROLLBACK';
exception when others then
  if sqlerrm = 'SP_TEST_ROLLBACK' then return null; end if;
  raise notice '  (error: %)', sqlerrm;
  return sqlerrm;
end $$;

create function pg_temp.co_a() returns uuid language sql immutable as $$ select '5f400000-0000-4000-8000-0000000021a1'::uuid $$;
create function pg_temp.co_b() returns uuid language sql immutable as $$ select '5f400000-0000-4000-8000-0000000021b1'::uuid $$;
create function pg_temp.uid(p_name text) returns uuid language sql immutable as $$
  select (case p_name
    when 'editor' then '5f400000-0000-4000-8000-000000002101'
    when 'viewer' then '5f400000-0000-4000-8000-000000002102'
    when 'editonly' then '5f400000-0000-4000-8000-000000002103'
    when 'outsider' then '5f400000-0000-4000-8000-000000002104' end)::uuid
$$;
create function pg_temp.email(p_name text) returns text language sql immutable as $$ select 'sp-' || p_name || '@synthetic.test' $$;
create function pg_temp.as_user(p_name text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated","email":"%s"}', pg_temp.uid(p_name), pg_temp.email(p_name)), true);
  perform set_config('request.jwt.claim.sub', pg_temp.uid(p_name)::text, true);
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
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
select pg_temp.uid(n), pg_temp.email(n), 'authenticated', 'authenticated' from unnest(array['editor', 'viewer', 'editonly', 'outsider']) n;
insert into organisations (id, name) values ('5f400000-0000-4000-8000-0000000021aa', 'SP Org');
insert into companies (id, organisation_id, name, base_currency_code) values
  (pg_temp.co_a(), '5f400000-0000-4000-8000-0000000021aa', 'SP Company A', 'ZAR'),
  (pg_temp.co_b(), '5f400000-0000-4000-8000-0000000021aa', 'SP Company B', 'ZAR');
insert into permission_roles (company_id, role_key, name) values
  (pg_temp.co_a(), 'sp_editor', 'e'), (pg_temp.co_a(), 'sp_viewer', 'v'), (pg_temp.co_a(), 'sp_editonly', 'x'), (pg_temp.co_b(), 'sp_outsider', 'o');
insert into role_permissions (role_id, permission_key)
select pr.id, k from permission_roles pr
cross join lateral unnest(case pr.role_key
  when 'sp_viewer' then array['Sales:View']
  when 'sp_editonly' then array['Sales:View', 'Sales:Edit']
  else array['Sales:View', 'Sales:Edit', 'Sales:Approve'] end) k
where pr.role_key like 'sp_%';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.uid(replace(pr.role_key, 'sp_', '')), pr.company_id, pr.id, 'sp-test' from permission_roles pr where pr.role_key like 'sp_%';

insert into customers (company_id, customer_code, name) values
  (pg_temp.co_a(), 'SCOOP', 'What''s The Scoop'), (pg_temp.co_a(), 'N1', 'N1 Restaurant Suppliers'), (pg_temp.co_a(), 'OTHER', 'Other Customer'),
  (pg_temp.co_b(), 'BCUST', 'Company B Customer');
create function pg_temp.cust(p text) returns bigint language sql security definer as $$ select id from customers where customer_code = p $$;

create function pg_temp.doc(p_co uuid, p_cust text, p_no text, p_type text, p_status text, p_net numeric, p_vat numeric, p_outstanding numeric)
returns bigint language sql security definer as $$
  insert into sales_invoices (company_id, customer_id, invoice_number, document_type, invoice_date, status, subtotal, vat_amount, total, outstanding)
  values (p_co, pg_temp.cust(p_cust), p_no, p_type, date '2026-08-06', p_status, p_net, p_vat, p_net + p_vat, p_outstanding)
  returning id
$$;
create function pg_temp.id(p_no text) returns bigint language sql security definer as $$ select id from sales_invoices where invoice_number = p_no $$;
create function pg_temp.outst(p_no text) returns numeric language sql security definer as $$ select outstanding from sales_invoices where invoice_number = p_no $$;
create function pg_temp.journal(p_source bigint, p_number text, p_status text) returns bigint language sql security definer as $$
  insert into ae_journals (company_id, journal_number, journal_date, journal_type, source_type, source_id, status)
  values (pg_temp.co_a(), p_number, date '2026-08-10', 'Invoice', 'sales_invoice', p_source, p_status)
  returning id
$$;
create function pg_temp.alloc(p_cn text, p_inv text, p_amount numeric, p_key uuid) returns jsonb language sql as $$
  select fn_allocate_sales_credit_note(pg_temp.co_a(), pg_temp.id(p_cn), pg_temp.id(p_inv), p_amount, p_key)
$$;

-- CN-3607 as PRECISIA stores it after 0121 (positive); the two What's The Scoop invoices.
select pg_temp.doc(pg_temp.co_a(), 'SCOOP', 'CN-3607', 'Credit Note', 'Posted', 298.60, 44.79, 343.39);
select pg_temp.doc(pg_temp.co_a(), 'SCOOP', 'INV-3576', 'Invoice', 'Posted', 1389.20, 208.38, 1597.58);
select pg_temp.doc(pg_temp.co_a(), 'SCOOP', 'INV-3624', 'Invoice', 'Posted', 1985.70, 297.86, 2283.56);
-- N1's invoice with R1,646 of CN-3406 already applied by the original import.
select pg_temp.doc(pg_temp.co_a(), 'N1', 'INV-3353', 'Invoice', 'Posted', 48423.00, 7263.45, 54040.45);
-- CN-3406 exactly as the pre-0121 importer stored it: NEGATIVE, R10 of credit left.
-- Written with the sign guard switched off, the way such rows came to exist.
alter table sales_invoices disable trigger sales_invoices_sign_guard;
select pg_temp.doc(pg_temp.co_a(), 'N1', 'CN-3406', 'Credit Note', 'Posted', -1440.00, -216.00, -10.00);
alter table sales_invoices enable trigger sales_invoices_sign_guard;
-- Other documents for the refusals.
select pg_temp.doc(pg_temp.co_a(), 'SCOOP', 'CN-DRAFT', 'Credit Note', 'Submitted', 100, 15, 115);
select pg_temp.doc(pg_temp.co_a(), 'SCOOP', 'INV-DRAFT', 'Invoice', 'Draft', 100, 15, 115);
select pg_temp.doc(pg_temp.co_a(), 'SCOOP', 'CN-BIG', 'Credit Note', 'Posted', 434.78, 65.22, 500.00);
select pg_temp.doc(pg_temp.co_a(), 'SCOOP', 'INV-SMALL', 'Invoice', 'Posted', 86.96, 13.04, 100.00);
select pg_temp.doc(pg_temp.co_a(), 'SCOOP', 'DN-1', 'Debit Note', 'Posted', 86.96, 13.04, 100.00);
select pg_temp.doc(pg_temp.co_a(), 'OTHER', 'INV-OTHER', 'Invoice', 'Posted', 86.96, 13.04, 100.00);
select pg_temp.doc(pg_temp.co_b(), 'BCUST', 'B-CN', 'Credit Note', 'Posted', 86.96, 13.04, 100.00);
select pg_temp.doc(pg_temp.co_b(), 'BCUST', 'B-INV', 'Invoice', 'Posted', 86.96, 13.04, 100.00);

-- ---------------------------------------------------------------------
-- G  grants
-- ---------------------------------------------------------------------
select pg_temp.ok(has_function_privilege('authenticated', 'fn_allocate_sales_credit_note(uuid,bigint,bigint,numeric,uuid)', 'execute'), 'G1 signed-in users may call the allocation function');
select pg_temp.ok(not has_function_privilege('anon', 'fn_allocate_sales_credit_note(uuid,bigint,bigint,numeric,uuid)', 'execute'), 'G2 anonymous callers may not');
select pg_temp.ok(not has_table_privilege('authenticated', 'sales_credit_note_allocations', 'insert')
  and not has_table_privilege('authenticated', 'sales_credit_note_allocations', 'update')
  and not has_table_privilege('authenticated', 'sales_credit_note_allocations', 'delete'), 'G3 allocations cannot be written directly, only through the function');

-- ---------------------------------------------------------------------
-- J  one live journal per sales document
-- ---------------------------------------------------------------------
select pg_temp.journal(pg_temp.id('INV-3576'), 'SP-J1', 'Approved');
select pg_temp.ok(pg_temp.err($$select pg_temp.journal(pg_temp.id('INV-3576'), 'SP-J2', 'Approved')$$) like 'PRECISIA_SALES_JOURNAL_EXISTS%', 'J1 a second live journal for the same document is refused (the INV-3611 double posting)');
select pg_temp.ok(pg_temp.err($$select pg_temp.journal(pg_temp.id('INV-3576'), 'SP-J2', 'Posted')$$) like 'PRECISIA_SALES_JOURNAL_EXISTS%', 'J2 ... whatever status it is created in');
select pg_temp.ok((select count(*) from ae_journals where company_id = pg_temp.co_a() and source_type = 'sales_invoice' and source_id = pg_temp.id('INV-3576')) = 1, 'J3 and nothing was written');
update ae_journals set status = 'Posted' where journal_number = 'SP-J1';
select pg_temp.ok((select status from ae_journals where journal_number = 'SP-J1') = 'Posted', 'J4 the one live journal still moves Approved -> Posted');
select pg_temp.journal(pg_temp.id('INV-3576'), 'SP-J3', 'Cancelled');
select pg_temp.ok(pg_temp.err($$update ae_journals set status = 'Approved' where journal_number = 'SP-J3'$$) like 'PRECISIA_SALES_JOURNAL_EXISTS%', 'J5 a cancelled journal cannot be revived beside the live one');
update ae_journals set is_reversed = true where journal_number = 'SP-J1';
select pg_temp.journal(pg_temp.id('INV-3576'), 'SP-J4', 'Approved');
select pg_temp.ok(true, 'J6 once the live journal is reversed, a new one may be created (approved correction: reverse, then post again)');
insert into ae_journals (company_id, journal_number, journal_date, source_type, source_id, status) values
  (pg_temp.co_a(), 'SP-B1', date '2026-08-10', 'bank_transactions_post', 999, 'Posted'), (pg_temp.co_a(), 'SP-B2', date '2026-08-10', 'bank_transactions_post', 999, 'Posted');
select pg_temp.ok(true, 'J7 other source types are not affected');
-- The production INV-3611 state: two live journals that already exist.
alter table ae_journals disable trigger ae_journals_sales_invoice_single_live;
select pg_temp.journal(pg_temp.id('INV-3624'), 'SP-D1', 'Posted');
select pg_temp.journal(pg_temp.id('INV-3624'), 'SP-D2', 'Posted');
alter table ae_journals enable trigger ae_journals_sales_invoice_single_live;
update ae_journals set description = 'touched' where journal_number in ('SP-D1', 'SP-D2');
update ae_journals set status = 'Posted' where journal_number = 'SP-D2';
select pg_temp.ok(true, 'J8 an existing duplicate pair (INV-3611) is left alone: edits that keep them as they are still work');
update ae_journals set is_reversed = true where journal_number = 'SP-D1';
select pg_temp.ok((select is_reversed from ae_journals where journal_number = 'SP-D1'), 'J9 ... and the extra one can be reversed by an approved correction');

-- ---------------------------------------------------------------------
-- L  no re-linking a document away from its live journal
-- ---------------------------------------------------------------------
select pg_temp.journal(pg_temp.id('INV-SMALL'), 'SP-L1', 'Approved');
update sales_invoices set journal_id = (select id from ae_journals where journal_number = 'SP-L1') where invoice_number = 'INV-SMALL';
select pg_temp.ok(true, 'L1 a document with no journal can be linked');
select pg_temp.ok(pg_temp.err($$update sales_invoices set journal_id = (select id from ae_journals where journal_number = 'SP-J4') where invoice_number = 'INV-SMALL'$$) like 'PRECISIA_SALES_JOURNAL_RELINK%', 'L2 it cannot be re-linked while that journal is live (the overwrite that hid JR001436)');
update ae_journals set status = 'Cancelled' where journal_number = 'SP-L1';
update sales_invoices set journal_id = null where invoice_number = 'INV-SMALL';
select pg_temp.ok((select journal_id from sales_invoices where invoice_number = 'INV-SMALL') is null, 'L3 once the journal is no longer live, the link can be changed');

-- ---------------------------------------------------------------------
-- S  non-negative sales documents
-- ---------------------------------------------------------------------
select pg_temp.ok(pg_temp.err($$select pg_temp.doc(pg_temp.co_a(), 'SCOOP', 'CN-NEG', 'Credit Note', 'Draft', -298.60, -44.79, -343.39)$$) like 'PRECISIA_SALES_NEGATIVE_AMOUNT%', 'S1 a credit note with negative figures cannot be written (the Xero import defect)');
select pg_temp.ok(pg_temp.err($$update sales_invoices set vat_amount = -1 where invoice_number = 'INV-SMALL'$$) like 'PRECISIA_SALES_NEGATIVE_AMOUNT%', 'S2 nor can an amount be changed to negative');
update sales_invoices set outstanding = outstanding where invoice_number = 'CN-3406';
select pg_temp.ok(true, 'S3 an existing negative credit note is not blocked from other updates (its correction is a separate procedure)');

-- ---------------------------------------------------------------------
-- A  allocation
-- ---------------------------------------------------------------------
create temp table sp_counts as
  select (select count(*) from ae_journals where company_id = pg_temp.co_a()) as journals,
         (select count(*) from ae_journal_lines l join ae_journals j on j.id = l.journal_id where j.company_id = pg_temp.co_a()) as lines;
grant select on sp_counts to authenticated;

select pg_temp.as_user('editor');
create temp table sp_r1 as select pg_temp.alloc('CN-3607', 'INV-3576', 343.39, 'a0000000-0000-4000-8000-000000000001') as r;
select pg_temp.as_admin();
select pg_temp.ok((select (r->>'replayed')::boolean = false and (r->>'amount')::numeric = 343.39 and (r->>'invoiceOutstanding')::numeric = 1254.19 and (r->>'creditNoteOutstanding')::numeric = 0 from sp_r1),
  'A1 CN-3607 -> INV-3576 R343.39: the result reports both new balances');
select pg_temp.ok(pg_temp.outst('CN-3607') = 0 and pg_temp.outst('INV-3576') = 1254.19, 'A2 CN-3607 fully applied; INV-3576 now R1,254.19 — exactly Xero''s amount due');
select pg_temp.ok((select count(*) = 1 from sales_credit_note_allocations where company_id = pg_temp.co_a() and credit_note_id = pg_temp.id('CN-3607') and invoice_id = pg_temp.id('INV-3576') and amount = 343.39 and performed_by = 'sp-editor@synthetic.test'),
  'A3 one allocation row, attributed to the signed-in user');
select pg_temp.ok((select count(*) = 1 from automation_audit_log a join sales_credit_note_allocations s on s.audit_id = a.id
  where a.action_type = 'SalesCreditNoteAllocated' and a.document_id = pg_temp.id('CN-3607') and a.performed_by = 'sp-editor@synthetic.test'
    and (a.changes->'invoice'->>'outstandingBefore')::numeric = 1597.58 and (a.changes->'invoice'->>'outstandingAfter')::numeric = 1254.19
    and (a.changes->'creditNote'->>'outstandingBefore')::numeric = 343.39 and (a.changes->'creditNote'->>'outstandingAfter')::numeric = 0),
  'A4 one audit entry with both documents'' balances before and after, linked to the allocation');
select pg_temp.ok((select journals = (select count(*) from ae_journals where company_id = pg_temp.co_a())
  and lines = (select count(*) from ae_journal_lines l join ae_journals j on j.id = l.journal_id where j.company_id = pg_temp.co_a()) from sp_counts),
  'A5 no journal or journal line is created: applying a posted credit note only matches two open items');
select pg_temp.ok(pg_temp.outst('INV-3624') = 2283.56, 'A6 INV-3624 (the other candidate) is untouched');

select pg_temp.as_user('editor');
create temp table sp_r2 as select pg_temp.alloc('CN-3406', 'INV-3353', 10.00, 'a0000000-0000-4000-8000-000000000002') as r;
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.outst('CN-3406') = 0 and pg_temp.outst('INV-3353') = 54030.45,
  'A7 legacy negative CN-3406 -> INV-3353 R10.00: credit note fully applied, INV-3353 now R54,030.45 — exactly Xero''s amount due');

select pg_temp.as_user('editor');
select pg_temp.alloc('CN-BIG', 'INV-SMALL', 100.00, 'a0000000-0000-4000-8000-000000000003');
select pg_temp.alloc('CN-BIG', 'DN-1', 60.00, 'a0000000-0000-4000-8000-000000000004');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.outst('CN-BIG') = 340 and pg_temp.outst('INV-SMALL') = 0 and pg_temp.outst('DN-1') = 40, 'A8 one credit note can be split across documents, a debit note included');

-- ---------------------------------------------------------------------
-- I  idempotency
-- ---------------------------------------------------------------------
select pg_temp.as_user('editor');
create temp table sp_r3 as select pg_temp.alloc('CN-3607', 'INV-3576', 343.39, 'a0000000-0000-4000-8000-000000000001') as r;
select pg_temp.as_admin();
select pg_temp.ok((select (r->>'replayed')::boolean and (r->>'allocationId') = (select r->>'allocationId' from sp_r1) from sp_r3), 'I1 the same request again returns the first result, marked replayed');
select pg_temp.ok(pg_temp.outst('CN-3607') = 0 and pg_temp.outst('INV-3576') = 1254.19
  and (select count(*) from sales_credit_note_allocations where credit_note_id = pg_temp.id('CN-3607')) = 1
  and (select count(*) from automation_audit_log where action_type = 'SalesCreditNoteAllocated' and document_id = pg_temp.id('CN-3607')) = 1,
  'I2 ... and writes nothing: balances, allocations and audit unchanged');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'INV-3624', 1.00, 'a0000000-0000-4000-8000-000000000001')$$) like 'PRECISIA_CN_ALLOCATION_KEY_REUSED%', 'I3 reusing a key for a different allocation is refused');

-- ---------------------------------------------------------------------
-- O  over-allocation and invalid pairs
-- ---------------------------------------------------------------------
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-3607', 'INV-3624', 0.01, gen_random_uuid())$$) like 'PRECISIA_CN_ALLOCATION_OVER%', 'O1 a fully applied credit note cannot be applied again');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-3406', 'INV-3353', 0.01, gen_random_uuid())$$) like 'PRECISIA_CN_ALLOCATION_OVER%', 'O2 ... nor can the legacy one');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'INV-3624', 340.01, gen_random_uuid())$$) like 'PRECISIA_CN_ALLOCATION_OVER%', 'O3 never more than the credit left');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'DN-1', 40.01, gen_random_uuid())$$) like 'PRECISIA_CN_ALLOCATION_OVER%', 'O4 never more than the invoice has outstanding');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'INV-OTHER', 1, gen_random_uuid())$$) like '%belong to different customers%', 'O5 never to another customer''s invoice');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-DRAFT', 'INV-3624', 1, gen_random_uuid())$$) like '%only a Posted credit note%', 'O6 only a Posted credit note');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'INV-DRAFT', 1, gen_random_uuid())$$) like '%only be applied to a Posted invoice%', 'O7 only to a Posted invoice');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('INV-3624', 'INV-3576', 1, gen_random_uuid())$$) like '%is not a credit note%', 'O8 the source must be a credit note');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'CN-3607', 1, gen_random_uuid())$$) like '%can only be applied to an invoice or debit note%', 'O9 the target cannot be another credit note');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'CN-BIG', 1, gen_random_uuid())$$) like 'PRECISIA_CN_ALLOCATION_INVALID%', 'O10 not to itself');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.outst('CN-BIG') = 340 and pg_temp.outst('INV-3624') = 2283.56 and pg_temp.outst('DN-1') = 40, 'O11 every refusal left every balance as it was');

-- ---------------------------------------------------------------------
-- R  refusals
-- ---------------------------------------------------------------------
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'INV-3624', 0, gen_random_uuid())$$) like 'PRECISIA_CN_ALLOCATION_INVALID%', 'R1 zero is refused');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'INV-3624', -5, gen_random_uuid())$$) like 'PRECISIA_CN_ALLOCATION_INVALID%', 'R2 a negative amount is refused');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'INV-3624', 1.005, gen_random_uuid())$$) like 'PRECISIA_CN_ALLOCATION_INVALID%', 'R3 fractions of a cent are refused');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'INV-3624', 1, null)$$) like 'PRECISIA_CN_ALLOCATION_INVALID%', 'R4 a request key is required');
select pg_temp.ok(pg_temp.err($$select fn_allocate_sales_credit_note(pg_temp.co_a(), pg_temp.id('B-CN'), pg_temp.id('B-INV'), 1, gen_random_uuid())$$) like 'PRECISIA_CN_ALLOCATION_NOT_FOUND%', 'R5 another company''s documents are not found under this company');
select pg_temp.ok(pg_temp.err($$select fn_allocate_sales_credit_note(pg_temp.co_b(), pg_temp.id('B-CN'), pg_temp.id('B-INV'), 1, gen_random_uuid())$$) like 'PRECISIA_CN_ALLOCATION_FORBIDDEN%', 'R6 and another company cannot be named directly');
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'INV-3624', 1, gen_random_uuid())$$) like 'PRECISIA_CN_ALLOCATION_FORBIDDEN%', 'R7 Sales:View alone is refused');
select pg_temp.as_user('editonly');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'INV-3624', 1, gen_random_uuid())$$) like 'PRECISIA_CN_ALLOCATION_FORBIDDEN%', 'R8 Sales:Edit without Sales:Approve is refused');
select pg_temp.as_user('outsider');
select pg_temp.ok(pg_temp.err($$select pg_temp.alloc('CN-BIG', 'INV-3624', 1, gen_random_uuid())$$) like 'PRECISIA_CN_ALLOCATION_FORBIDDEN%', 'R9 a member of another company is refused');
select pg_temp.ok((select count(*) from sales_credit_note_allocations) = 0, 'R10 and cannot see this company''s allocations');
select pg_temp.as_anon();
select pg_temp.ok(pg_temp.err($$select fn_allocate_sales_credit_note('5f400000-0000-4000-8000-0000000021a1', 1, 2, 1, gen_random_uuid())$$) is not null, 'R11 an anonymous caller is refused');
select pg_temp.as_user('editor');
select pg_temp.ok((select count(*) from sales_credit_note_allocations) = 4, 'R12 a member sees the company''s allocations');
select pg_temp.ok(pg_temp.err($$insert into sales_credit_note_allocations (company_id, credit_note_id, invoice_id, amount, request_key, performed_by) values (pg_temp.co_a(), pg_temp.id('CN-BIG'), pg_temp.id('INV-3624'), 1, gen_random_uuid(), 'x')$$) is not null, 'R13 a member cannot insert an allocation directly');
select pg_temp.ok(pg_temp.err($$update sales_credit_note_allocations set amount = 1$$) is not null, 'R14 ... nor change one');
select pg_temp.ok(pg_temp.err($$delete from sales_credit_note_allocations$$) is not null, 'R15 ... nor delete one');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.outst('CN-BIG') = 340 and pg_temp.outst('INV-3624') = 2283.56, 'R16 every refusal left every balance as it was');

rollback;
