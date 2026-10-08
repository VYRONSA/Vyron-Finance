-- Phase SD-3C — database tests for migration 0114 (supplier statements).
--
-- LOCAL / SYNTHETIC DATA ONLY. Everything runs in ONE transaction that is
-- rolled back at the end. Never run against a shared or production database.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/supplier_statements.test.sql
--
-- Sections:
--   G  explicit grants (tables and functions, per role)
--   U  upload: who may create a statement, and in what state
--   F  system-owned columns cannot be changed by a user
--   T  status transitions and their permissions
--   C  supplier confirmation: reviewer-only, session-stamped, same company
--   L  lines: permissions, states, unread values, provenance, re-validation
--   E  events: immutable; user writer (session actor) and system writer
--   R  RLS: company isolation and permission-based reading
--   D  retention: a statement original cannot be deleted or altered
--   A  audited access: statement views/downloads now recorded (0113 + 0114)
--   S  ae_suppliers.our_account_number
--   H  no accounting record is touched

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

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'SD3C_TEST_ROLLBACK';
exception when others then
  if sqlerrm = 'SD3C_TEST_ROLLBACK' then return null; end if;
  raise notice '  (error: %)', sqlerrm;
  return sqlerrm;
end $$;

-- Runs a statement and KEEPS its effect (unlike err()); returns the error or null.
create function pg_temp.run(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  raise notice '  (error: %)', sqlerrm;
  return sqlerrm;
end $$;

create function pg_temp.co_a() returns uuid language sql immutable as $$ select '5e000000-0000-4000-8000-0000000004a1'::uuid $$;
create function pg_temp.co_b() returns uuid language sql immutable as $$ select '5e000000-0000-4000-8000-0000000004b1'::uuid $$;
create function pg_temp.uid(p_name text) returns uuid language sql immutable as $$
  select (case p_name
    when 'member'   then '5e000000-0000-4000-8000-000000000401'
    when 'viewer'   then '5e000000-0000-4000-8000-000000000402'
    when 'creator'  then '5e000000-0000-4000-8000-000000000403'
    when 'editor'   then '5e000000-0000-4000-8000-000000000404'
    when 'rejecter' then '5e000000-0000-4000-8000-000000000405'
    when 'owner_b'  then '5e000000-0000-4000-8000-000000000407'
  end)::uuid
$$;
create function pg_temp.email(p_name text) returns text language sql immutable as $$ select 'sd3c-' || p_name || '@synthetic.test' $$;
create function pg_temp.hash(p_name text) returns text language sql immutable as $$ select encode(sha256(convert_to(p_name, 'UTF8')), 'hex') $$;

create function pg_temp.as_user(p_name text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"%s"}', pg_temp.uid(p_name), pg_temp.email(p_name)), true);
  perform set_config('request.jwt.claim.sub', pg_temp.uid(p_name)::text, true);
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
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

create function pg_temp.accounting_fingerprint() returns text language sql security definer as $$
  select md5(
    coalesce((select string_agg(j::text, '|' order by j.id) from ae_journals j), '') || '#' ||
    coalesce((select string_agg(l::text, '|' order by l.id) from ae_journal_lines l), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from gl_transactions g), '') || '#' ||
    coalesce((select string_agg(b::text, '|' order by b.id) from ae_imported_bills b), '') || '#' ||
    coalesce((select string_agg(p::text, '|' order by p.id) from ae_purchase_bill_lines p), '') || '#' ||
    coalesce((select string_agg(s::text, '|' order by s.id) from supplier_payments s), '') || '#' ||
    coalesce((select string_agg(a::text, '|' order by a.id) from supplier_payment_allocations a), '') || '#' ||
    coalesce((select string_agg(o::text, '|' order by o.id) from opening_balance_entries o), ''))
$$;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select pg_temp.uid(n), pg_temp.email(n), 'authenticated', 'authenticated'
from unnest(array['member','viewer','creator','editor','rejecter','owner_b']) as n;

insert into organisations (id, name) values
  ('5e000000-0000-4000-8000-0000000004aa', 'SD3C Org A'), ('5e000000-0000-4000-8000-0000000004bb', 'SD3C Org B');
insert into companies (id, organisation_id, name, base_currency_code) values
  (pg_temp.co_a(), '5e000000-0000-4000-8000-0000000004aa', 'SD3C Company A', 'ZAR'),
  (pg_temp.co_b(), '5e000000-0000-4000-8000-0000000004bb', 'SD3C Company B', 'ZAR');

insert into permission_roles (company_id, role_key, name) values
  (pg_temp.co_a(), 'sd3c_member', 'member'), (pg_temp.co_a(), 'sd3c_viewer', 'viewer'),
  (pg_temp.co_a(), 'sd3c_creator', 'creator'), (pg_temp.co_a(), 'sd3c_editor', 'editor'),
  (pg_temp.co_a(), 'sd3c_rejecter', 'rejecter'), (pg_temp.co_b(), 'sd3c_owner_b', 'owner b');
insert into role_permissions (role_id, permission_key)
select pr.id, 'Purchasing:' || a
from permission_roles pr
cross join lateral unnest(case pr.role_key
  when 'sd3c_viewer'   then array['View']
  when 'sd3c_creator'  then array['View','Create']
  when 'sd3c_editor'   then array['View','Edit']
  when 'sd3c_rejecter' then array['View','Reject']
  when 'sd3c_owner_b'  then array['View','Create','Edit','Reject','Approve']
  else array[]::text[] end) as a
where pr.role_key like 'sd3c_%';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.uid(replace(pr.role_key, 'sd3c_', '')), pr.company_id, pr.id, 'sd3c-test'
from permission_roles pr where pr.role_key like 'sd3c_%';

insert into ae_suppliers (company_id, name, supplier_code) values
  (pg_temp.co_a(), 'Statement Supplier A', 'SC3A'), (pg_temp.co_a(), 'Statement Supplier A2', 'SC3A2'), (pg_temp.co_b(), 'Statement Supplier B', 'SC3B');
create function pg_temp.sup(p_code text) returns bigint language sql security definer as $$ select id from ae_suppliers where supplier_code = p_code $$;

insert into documents (company_id, entity_type, entity_id, category, filename, storage_path, mime_type, size_bytes, uploaded_by, content_sha256)
select c, 'Supplier', 0, cat, f, c || '/Supplier/0/' || f, 'application/pdf', 1000, 'fixture', pg_temp.hash(f)
from (values (pg_temp.co_a(), 'Statement', 's-review.pdf'), (pg_temp.co_a(), 'Statement', 's-queued.pdf'),
             (pg_temp.co_a(), 'Statement', 's-failed.pdf'), (pg_temp.co_a(), 'Statement', 's-new.pdf'),
             (pg_temp.co_a(), 'Statement', 's-new2.pdf'), (pg_temp.co_a(), 'Invoice', 'not-a-statement.pdf'),
             (pg_temp.co_a(), 'Statement', 's-plain.pdf'), (pg_temp.co_b(), 'Statement', 's-b.pdf')) as t(c, cat, f);
create function pg_temp.doc(p_name text) returns bigint language sql security definer as $$ select id from documents where filename = p_name $$;

insert into storage.buckets (id, name) values ('documents', 'documents') on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) select 'documents', storage_path from documents where company_id in (pg_temp.co_a(), pg_temp.co_b());

-- Statements created by the server (as the processing would leave them).
insert into supplier_statements (company_id, document_id, content_sha256, source_type, status, uploaded_by,
  extraction_method, statement_date, opening_balance, closing_balance, validation_status, validated_at, supplier_id, supplier_match_tier,
  account_number_extracted, extraction_snapshot)
values
  (pg_temp.co_a(), pg_temp.doc('s-review.pdf'), pg_temp.hash('s-review.pdf'), 'pdf-text', 'NeedsReview', 'fixture',
   'layout', date '2026-09-30', 100, 250, 'Pass', now(), pg_temp.sup('SC3A'), 'vat', '000123', '{"header":{},"lines":[]}'),
  (pg_temp.co_a(), pg_temp.doc('s-queued.pdf'), pg_temp.hash('s-queued.pdf'), 'pdf', 'Queued', 'fixture',
   null, null, null, null, 'Pending', null, null, null, null, null),
  (pg_temp.co_a(), pg_temp.doc('s-failed.pdf'), pg_temp.hash('s-failed.pdf'), 'pdf', 'Failed', 'fixture',
   null, null, null, null, 'Pending', null, null, null, null, null),
  (pg_temp.co_b(), pg_temp.doc('s-b.pdf'), pg_temp.hash('s-b.pdf'), 'pdf-text', 'NeedsReview', 'fixture',
   'layout', date '2026-09-30', 0, 10, 'Pass', now(), pg_temp.sup('SC3B'), 'vat', null, null);
create function pg_temp.st(p_name text) returns bigint language sql security definer as $$
  select s.id from supplier_statements s join documents d on d.id = s.document_id where d.filename = p_name
$$;
create function pg_temp.status(p_name text) returns text language sql security definer as $$ select status from supplier_statements where id = pg_temp.st(p_name) $$;
create function pg_temp.vstatus(p_name text) returns text language sql security definer as $$ select validation_status from supplier_statements where id = pg_temp.st(p_name) $$;

insert into supplier_statement_lines (company_id, statement_id, line_order, page_number, row_on_page, transaction_date, reference_text,
  description, transaction_type, debit, credit, running_balance, raw_text, unresolved_fields)
values
  (pg_temp.co_a(), pg_temp.st('s-review.pdf'), 1, 1, 3, date '2026-09-02', '0001042', 'Invoice', 'invoice', 200, null, 300, '02/09/2026 0001042 Invoice 200.00 300.00', '{}'),
  (pg_temp.co_a(), pg_temp.st('s-review.pdf'), 2, 1, 4, date '2026-09-15', 'PMT 77', 'Payment', 'payment', null, 50, 250, '15/09/2026 PMT 77 Payment 50.00 250.00', '{}'),
  (pg_temp.co_a(), pg_temp.st('s-review.pdf'), 3, 2, 1, null, 'INV 9', 'Smudged', 'unknown', null, null, null, '??/09/2026 INV 9 Smudged 1 2?4.00', '{transaction_date,debit}'),
  (pg_temp.co_b(), pg_temp.st('s-b.pdf'), 1, 1, 1, date '2026-09-03', 'B-1', 'Invoice', 'invoice', 10, null, 10, 'B row', '{}');
create function pg_temp.line(p_name text, p_order integer) returns bigint language sql security definer as $$
  select id from supplier_statement_lines where statement_id = pg_temp.st(p_name) and line_order = p_order
$$;

create temp table sd3c_state as select pg_temp.accounting_fingerprint() as accounting_before;
grant select on sd3c_state to authenticated, service_role, anon;

-- =====================================================================
-- G. Explicit grants
-- =====================================================================
select pg_temp.ok((
  select bool_and(not has_table_privilege('anon', t, p))
  from unnest(array['supplier_statements','supplier_statement_lines','supplier_statement_events']) t,
       unnest(array['select','insert','update','delete','truncate','references','trigger']) p),
  'G1 anon has no privilege on any statement table');
select pg_temp.ok(
  has_table_privilege('authenticated', 'supplier_statements', 'select') and has_table_privilege('authenticated', 'supplier_statements', 'insert')
  and has_table_privilege('authenticated', 'supplier_statements', 'update') and not has_table_privilege('authenticated', 'supplier_statements', 'delete')
  and not has_table_privilege('authenticated', 'supplier_statements', 'truncate'),
  'G2 signed-in users: statements select/insert/update only — never delete or truncate (RLS + guard decide the rest)');
select pg_temp.ok(
  has_table_privilege('authenticated', 'supplier_statement_lines', 'select') and has_table_privilege('authenticated', 'supplier_statement_lines', 'insert')
  and has_table_privilege('authenticated', 'supplier_statement_lines', 'update') and has_table_privilege('authenticated', 'supplier_statement_lines', 'delete')
  and not has_table_privilege('authenticated', 'supplier_statement_lines', 'truncate'),
  'G3 signed-in users: lines select/insert/update/delete, no truncate');
select pg_temp.ok(
  has_table_privilege('authenticated', 'supplier_statement_events', 'select')
  and not has_table_privilege('authenticated', 'supplier_statement_events', 'insert')
  and not has_table_privilege('authenticated', 'supplier_statement_events', 'update')
  and not has_table_privilege('authenticated', 'supplier_statement_events', 'delete'),
  'G4 signed-in users: events are read-only (written through functions)');
select pg_temp.ok(
  has_table_privilege('service_role', 'supplier_statements', 'insert') and has_table_privilege('service_role', 'supplier_statements', 'update')
  and not has_table_privilege('service_role', 'supplier_statements', 'delete') and not has_table_privilege('service_role', 'supplier_statements', 'truncate')
  and has_table_privilege('service_role', 'supplier_statement_lines', 'delete')
  and has_table_privilege('service_role', 'supplier_statement_events', 'select')
  and not has_table_privilege('service_role', 'supplier_statement_events', 'insert')
  and not has_table_privilege('service_role', 'supplier_statement_events', 'update'),
  'G5 service role: explicit, and it cannot delete a statement or write events directly');
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where oid in
  ('supplier_statements'::regclass, 'supplier_statement_lines'::regclass, 'supplier_statement_events'::regclass)),
  'G6 RLS is enabled on every statement table');
select pg_temp.ok(
  has_function_privilege('authenticated', 'fn_supplier_statement_record_event(uuid,bigint,text,jsonb)', 'execute')
  and not has_function_privilege('anon', 'fn_supplier_statement_record_event(uuid,bigint,text,jsonb)', 'execute')
  and not has_function_privilege('service_role', 'fn_supplier_statement_record_event(uuid,bigint,text,jsonb)', 'execute')
  and has_function_privilege('service_role', 'fn_supplier_statement_record_system_event(uuid,bigint,text,jsonb,text)', 'execute')
  and not has_function_privilege('authenticated', 'fn_supplier_statement_record_system_event(uuid,bigint,text,jsonb,text)', 'execute')
  and not has_function_privilege('anon', 'fn_supplier_statement_record_system_event(uuid,bigint,text,jsonb,text)', 'execute'),
  'G7 user writer for signed-in users only; system writer for the service role only');
select pg_temp.ok((
  select bool_and(not has_function_privilege(r, f, 'execute'))
  from unnest(array['anon','authenticated','service_role']) r,
       unnest(array['fn_supplier_statement_guard()','fn_supplier_statement_line_guard()','fn_supplier_statement_events_immutable()']) f),
  'G8 trigger functions are callable by no API role');
select pg_temp.ok(
  has_function_privilege('authenticated', 'fn_supplier_statement_mark_unvalidated(bigint)', 'execute')
  and not has_function_privilege('anon', 'fn_supplier_statement_mark_unvalidated(bigint)', 'execute')
  and not has_function_privilege('anon', 'fn_document_is_statement_original(bigint)', 'execute')
  and has_function_privilege('authenticated', 'fn_document_is_statement_original(bigint)', 'execute'),
  'G9 helper functions: no anonymous execution');

-- =====================================================================
-- U. Upload
-- =====================================================================
select pg_temp.as_user('creator');
select pg_temp.ok(pg_temp.run(format(
  'insert into supplier_statements (company_id, document_id, content_sha256, source_type, uploaded_by) values (%L, %s, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.doc('s-new.pdf'), pg_temp.hash('s-new.pdf'), 'pdf', 'forged-uploader')) is null,
  'U1 Purchasing:Create can register an uploaded statement');
select pg_temp.as_admin();
select pg_temp.ok((select uploaded_by = pg_temp.email('creator') and status = 'Queued' from supplier_statements where id = pg_temp.st('s-new.pdf')),
  'U2 ... it starts Queued and the uploader is the session user, whatever the caller wrote');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_statements (company_id, document_id, content_sha256, source_type, uploaded_by) values (%L, %s, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.doc('s-new2.pdf'), pg_temp.hash('s-new2.pdf'), 'pdf', 'x')) is not null,
  'U3 without Purchasing:Create a statement cannot be registered');
select pg_temp.as_user('creator');
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_statements (company_id, document_id, content_sha256, source_type, status, uploaded_by) values (%L, %s, %L, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.doc('s-new2.pdf'), pg_temp.hash('s-new2.pdf'), 'pdf', 'Ready', 'x')) like '%must start Queued%',
  'U4 a new statement cannot start in any other state');
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_statements (company_id, document_id, content_sha256, source_type, uploaded_by, closing_balance, supplier_id) values (%L, %s, %L, %L, %L, 1, %s)',
  pg_temp.co_a(), pg_temp.doc('s-new2.pdf'), pg_temp.hash('s-new2.pdf'), 'pdf', 'x', pg_temp.sup('SC3A'))) like '%must start Queued with no results%',
  'U5 ... nor arrive carrying results (balances, supplier)');
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_statements (company_id, document_id, content_sha256, source_type, uploaded_by) values (%L, %s, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.doc('not-a-statement.pdf'), pg_temp.hash('not-a-statement.pdf'), 'pdf', 'x')) like '%not a supplier statement%',
  'U6 a document filed as something else cannot become a statement');
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_statements (company_id, document_id, content_sha256, source_type, uploaded_by) values (%L, %s, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.doc('s-new2.pdf'), pg_temp.hash('different bytes'), 'pdf', 'x')) like '%not a supplier statement%',
  'U7 the statement must carry the stored file''s own hash');
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_statements (company_id, document_id, content_sha256, source_type, uploaded_by) values (%L, %s, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.doc('s-b.pdf'), pg_temp.hash('s-b.pdf'), 'pdf', 'x')) is not null,
  'U8 another company''s document cannot be registered in this company');
select pg_temp.as_user('owner_b');
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_statements (company_id, document_id, content_sha256, source_type, uploaded_by) values (%L, %s, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.doc('s-new2.pdf'), pg_temp.hash('s-new2.pdf'), 'pdf', 'x')) is not null,
  'U9 a user of another company cannot register a statement here');
select pg_temp.as_user('creator');
select pg_temp.ok(pg_temp.err(format('delete from supplier_statements where id = %s', pg_temp.st('s-new.pdf'))) like '%permission denied%',
  'U10 nobody deletes a statement');

-- =====================================================================
-- F. System-owned columns
-- =====================================================================
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set validation_status = ''Pass'' where id = %s', pg_temp.st('s-queued.pdf'))) like '%cannot be changed by a user%',
  'F1 a user cannot set the validation result');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set extraction_snapshot = ''{}'' where id = %s', pg_temp.st('s-review.pdf'))) like '%cannot be changed by a user%',
  'F2 ... or rewrite the extraction snapshot');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set account_number_extracted = ''999'' where id = %s', pg_temp.st('s-review.pdf'))) like '%cannot be changed by a user%',
  'F3 ... or what was read off the page');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set source_type = ''csv'' where id = %s', pg_temp.st('s-review.pdf'))) like '%cannot be changed by a user%',
  'F4 ... or what kind of file it is');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set document_id = %s where id = %s', pg_temp.doc('s-new2.pdf'), pg_temp.st('s-review.pdf'))) like '%identity%',
  'F5 ... or which original it is');

-- =====================================================================
-- T. Transitions
-- =====================================================================
select pg_temp.as_user('viewer');
select pg_temp.run(format('update supplier_statements set status = ''ManualEntry'' where id = %s', pg_temp.st('s-queued.pdf')));
select pg_temp.ok(pg_temp.status('s-queued.pdf') = 'Queued',
  'T1 view-only cannot start manual entry (RLS: the row is not updatable)');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = ''ManualEntry'' where id = %s', pg_temp.st('s-review.pdf'))) like '%only a queued or failed%',
  'T2 manual entry only from Queued or Failed');
select pg_temp.ok(pg_temp.run(format('update supplier_statements set status = ''ManualEntry'' where id = %s', pg_temp.st('s-failed.pdf'))) is null,
  'T3 an editor enters a failed statement by hand');
select pg_temp.as_admin();
select pg_temp.ok((select manual_entry and extraction_method = 'manual' and validation_status = 'Pending' from supplier_statements where id = pg_temp.st('s-failed.pdf')),
  'T4 ... recorded as manual entry, unvalidated');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = ''NeedsReview'', closing_balance = 5 where id = %s', pg_temp.st('s-failed.pdf'))) like '%cannot also edit%',
  'T5 a status change cannot smuggle in an edit');
select pg_temp.ok(pg_temp.run(format('update supplier_statements set status = ''NeedsReview'' where id = %s', pg_temp.st('s-failed.pdf'))) is null
              and pg_temp.status('s-failed.pdf') = 'NeedsReview',
  'T6 submitting a manual entry puts it in review');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = ''Ready'' where id = %s', pg_temp.st('s-failed.pdf'))) like '%must validate%',
  'T7 an unvalidated statement cannot be marked ready');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = ''Ready'' where id = %s', pg_temp.st('s-review.pdf'))) like '%confirm the supplier%',
  'T8 a statement whose supplier was only PROPOSED (even by VAT number) cannot be marked ready');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = ''Processing'' where id = %s', pg_temp.st('s-queued.pdf'))) like '%cannot be set by a user%',
  'T9 processing states belong to the system');
select pg_temp.as_user('rejecter');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = ''ManualEntry'' where id = %s', pg_temp.st('s-queued.pdf'))) is not null,
  'T10 Reject alone cannot edit or move a statement forward');

-- =====================================================================
-- C. Supplier confirmation
-- =====================================================================
select pg_temp.as_user('viewer');
select pg_temp.run(format('update supplier_statements set supplier_confirmed_at = now() where id = %s', pg_temp.st('s-review.pdf')));
select pg_temp.ok((select supplier_confirmed_at is null from supplier_statements where id = pg_temp.st('s-review.pdf')),
  'C1 view-only cannot confirm a supplier (RLS: the row is not updatable)');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.run(format('update supplier_statements set supplier_confirmed_at = now(), supplier_confirmed_by = %L where id = %s',
  'someone-else@synthetic.test', pg_temp.st('s-review.pdf'))) is null,
  'C2 an editor confirms the proposed supplier');
select pg_temp.as_admin();
select pg_temp.ok((select supplier_confirmed_by = pg_temp.email('editor') and supplier_confirmed_at is not null and supplier_match_tier = 'vat'
                   from supplier_statements where id = pg_temp.st('s-review.pdf')),
  'C3 ... the confirmer is the session user, not the name the caller wrote');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.run(format('update supplier_statements set supplier_id = %s where id = %s', pg_temp.sup('SC3A2'), pg_temp.st('s-review.pdf'))) is null,
  'C4 changing the supplier is allowed in review ...');
select pg_temp.as_admin();
select pg_temp.ok((select supplier_confirmed_at is null and supplier_confirmed_by is null and supplier_match_tier = 'manual'
                   from supplier_statements where id = pg_temp.st('s-review.pdf')),
  'C5 ... but a different supplier is NOT confirmed by being chosen; it is a manual choice awaiting confirmation');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set supplier_id = %s, supplier_confirmed_at = now() where id = %s', pg_temp.sup('SC3B'), pg_temp.st('s-review.pdf'))) like '%does not belong to this company%',
  'C6 another company''s supplier cannot be chosen or confirmed');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set supplier_match_tier = ''vat'' where id = %s', pg_temp.st('s-review.pdf'))) like '%recorded by the system%',
  'C7 the match tier cannot be forged');
select pg_temp.ok(pg_temp.run(format('update supplier_statements set supplier_id = %s, supplier_confirmed_at = now() where id = %s', pg_temp.sup('SC3A'), pg_temp.st('s-review.pdf'))) is null,
  'C8 choosing and confirming in one explicit action is allowed');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set supplier_confirmed_by = %L where id = %s', 'forger', pg_temp.st('s-review.pdf'))) like '%recorded by the system%',
  'C9 the confirmer cannot be rewritten afterwards');
select pg_temp.as_admin();
select pg_temp.ok((select validation_status = 'Pass' from supplier_statements where id = pg_temp.st('s-review.pdf')),
  'C10 confirming a supplier does not disturb the arithmetic validation');

-- =====================================================================
-- L. Lines
-- =====================================================================
select pg_temp.as_user('viewer');
select pg_temp.run(format('update supplier_statement_lines set debit = 1 where id = %s', pg_temp.line('s-review.pdf', 1)));
select pg_temp.ok((select debit = 200 from supplier_statement_lines where id = pg_temp.line('s-review.pdf', 1)),
  'L1 view-only cannot correct a line (RLS: the row is not updatable)');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statement_lines set raw_text = ''x'' where id = %s', pg_temp.line('s-review.pdf', 1))) like '%provenance%',
  'L2 a line''s raw text and page position are provenance, never edited');
select pg_temp.ok(pg_temp.err(format('update supplier_statement_lines set unresolved_fields = ''{}'' where id = %s', pg_temp.line('s-review.pdf', 3))) like '%not by editing the list%',
  'L3 unread values cannot be waved away — only corrected');
select pg_temp.ok(pg_temp.run(format('update supplier_statement_lines set debit = 1234.00 where id = %s', pg_temp.line('s-review.pdf', 3))) is null,
  'L4 an editor corrects the unreadable amount against the original');
select pg_temp.as_admin();
select pg_temp.ok((select unresolved_fields = '{transaction_date}' and corrected and raw_text like '??/09/2026%'
                   from supplier_statement_lines where id = pg_temp.line('s-review.pdf', 3)),
  'L5 ... the amount is no longer unread, the date still is, and the raw text is kept');
select pg_temp.ok(pg_temp.vstatus('s-review.pdf') = 'Pending',
  'L6 any line correction resets the statement''s validation');
select pg_temp.ok((select reference_text = '0001042' from supplier_statement_lines where id = pg_temp.line('s-review.pdf', 1)),
  'L7 references are stored exactly as printed (leading zeros kept)');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.run(format('update supplier_statement_lines set transaction_type = ''payment'' where id = %s', pg_temp.line('s-review.pdf', 3))) is null,
  'L8 the reviewer decides a line''s type');
select pg_temp.as_admin();
select pg_temp.ok((select type_source = 'reviewer' from supplier_statement_lines where id = pg_temp.line('s-review.pdf', 3)),
  'L9 ... and that is recorded as the reviewer''s decision');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statement_lines set type_source = ''printed'' where id = %s', pg_temp.line('s-review.pdf', 1))) like '%recorded by the system%',
  'L10 how a type was decided cannot be forged');
select pg_temp.ok(pg_temp.run(format(
  'insert into supplier_statement_lines (company_id, statement_id, line_order, transaction_date, reference_text, transaction_type, debit) values (%L, %s, 9, %L, %L, %L, 5)',
  pg_temp.co_a(), pg_temp.st('s-review.pdf'), '2026-09-20', '00077', 'invoice')) is null,
  'L11 an editor adds a line the reader missed');
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_statement_lines (company_id, statement_id, line_order, debit, raw_text) values (%L, %s, 10, 5, %L)',
  pg_temp.co_a(), pg_temp.st('s-review.pdf'), 'pretend it was read')) like '%no unread values%',
  'L12 a typed line cannot pretend to have been read from the page');
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_statement_lines (company_id, statement_id, line_order, debit) values (%L, %s, 11, 5)',
  pg_temp.co_a(), pg_temp.st('s-b.pdf'))) is not null,
  'L13 a line cannot be added to another company''s statement');
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_statement_lines (company_id, statement_id, line_order, debit) values (%L, %s, 12, 5)',
  pg_temp.co_b(), pg_temp.st('s-review.pdf'))) is not null,
  'L14 ... nor labelled as another company''s line');
select pg_temp.ok(pg_temp.err(format('update supplier_statement_lines set statement_id = %s where id = %s', pg_temp.st('s-failed.pdf'), pg_temp.line('s-review.pdf', 1))) like '%identity%',
  'L15 a line cannot be moved to another statement');
select pg_temp.ok(pg_temp.run(format('delete from supplier_statement_lines where statement_id = %s and line_order = 9', pg_temp.st('s-review.pdf'))) is null,
  'L16 an editor removes a line');
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_statement_lines (company_id, statement_id, line_order, debit) values (%L, %s, 13, 5)',
  pg_temp.co_a(), pg_temp.st('s-queued.pdf'))) like '%only a statement in review or manual entry%',
  'L17 lines change only while the statement is in review or manual entry');
select pg_temp.as_admin();
select pg_temp.ok((select generated is not null from (select attgenerated as generated from pg_attribute
                   where attrelid = 'supplier_statement_lines'::regclass and attname = 'amount' and attgenerated = 's') g)
              and (select amount = 200 from supplier_statement_lines where id = pg_temp.line('s-review.pdf', 1))
              and (select amount = -50 from supplier_statement_lines where id = pg_temp.line('s-review.pdf', 2)),
  'L18 amount is computed by the database (debit − credit), never supplied');

-- =====================================================================
-- E. Events
-- =====================================================================
select pg_temp.as_user('editor');
select pg_temp.ok(fn_supplier_statement_record_event(pg_temp.co_a(), pg_temp.st('s-review.pdf'), 'LineCorrected', '{"lines":[3]}') > 0,
  'E1 an editor records their correction');
select pg_temp.as_admin();
select pg_temp.ok((select performed_by = pg_temp.email('editor') from supplier_statement_events order by id desc limit 1),
  'E2 ... under their session identity');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_statement_record_event(%L, %s, %L, %L)', pg_temp.co_a(), pg_temp.st('s-review.pdf'), 'Extracted', '{}')) like '%system only%',
  'E3 a user cannot record a system event (e.g. "Extracted")');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_statement_record_event(%L, %s, %L, %L)', pg_temp.co_a(), pg_temp.st('s-review.pdf'), 'MarkedReady', '{}')) like '%requires a ready statement%',
  'E4 an event must match the statement''s actual state');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_statement_record_event(%L, %s, %L, %L)', pg_temp.co_b(), pg_temp.st('s-b.pdf'), 'LineCorrected', '{}')) like '%Purchasing:Edit is required%',
  'E5 a user cannot record events in another company');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_statement_record_event(%L, %s, %L, %L)', pg_temp.co_a(), pg_temp.st('s-b.pdf'), 'LineCorrected', '{}')) like '%does not exist in this company%',
  'E6 ... nor against another company''s statement by naming their own company');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_statement_record_system_event(%L, %s, %L, %L, %L)', pg_temp.co_a(), pg_temp.st('s-review.pdf'), 'Extracted', '{}', 'x')) like '%permission denied%',
  'E7 the system writer is not callable by users');
select pg_temp.as_service();
select pg_temp.ok(fn_supplier_statement_record_system_event(pg_temp.co_a(), pg_temp.st('s-review.pdf'), 'Extracted', '{"lines":3}', 'System') > 0,
  'E8 the server records system events');
select pg_temp.ok(pg_temp.err('update supplier_statement_events set detail = ''{}''') like '%permission denied%'
              and pg_temp.err('delete from supplier_statement_events') like '%permission denied%',
  'E9 the service role cannot edit or delete events');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.err('update supplier_statement_events set performed_by = ''x''') like '%append-only%'
              and pg_temp.err('delete from supplier_statement_events') like '%append-only%'
              and pg_temp.err('truncate supplier_statement_events') like '%append-only%',
  'E10 not even the owner can edit, delete or truncate the event history');

-- =====================================================================
-- R. RLS
-- =====================================================================
select pg_temp.as_user('viewer');
select pg_temp.ok((select count(*) from supplier_statements) > 0
              and not exists (select 1 from supplier_statements where company_id <> pg_temp.co_a())
              and not exists (select 1 from supplier_statement_lines where company_id <> pg_temp.co_a())
              and not exists (select 1 from supplier_statement_events where company_id <> pg_temp.co_a()),
  'R1 Purchasing:View reads its own company''s statements, lines and events — nothing else');
select pg_temp.as_user('member');
select pg_temp.ok((select count(*) from supplier_statements) = 0 and (select count(*) from supplier_statement_lines) = 0
              and (select count(*) from supplier_statement_events) = 0,
  'R2 a member without Purchasing:View reads none of it');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set closing_balance = 1 where id = %s', pg_temp.st('s-review.pdf'))) is null
              and (select closing_balance from supplier_statements where id = pg_temp.st('s-review.pdf')) is null,
  'R3 ... and cannot change it (no visible row is updated)');
select pg_temp.as_user('owner_b');
select pg_temp.ok((select count(*) from supplier_statements) = 1 and (select company_id from supplier_statements) = pg_temp.co_b(),
  'R4 another company sees only its own');
select pg_temp.as_anon();
select pg_temp.ok(pg_temp.err('select count(*) from supplier_statements') like '%permission denied%'
              and pg_temp.err('select count(*) from supplier_statement_lines') like '%permission denied%',
  'R5 anon reads nothing');

-- Reject is terminal.
select pg_temp.as_user('rejecter');
select pg_temp.ok(pg_temp.run(format('update supplier_statements set status = ''Rejected'' where id = %s', pg_temp.st('s-queued.pdf'))) is null,
  'T11 Purchasing:Reject rejects a statement');
select pg_temp.ok(fn_supplier_statement_record_event(pg_temp.co_a(), pg_temp.st('s-queued.pdf'), 'Rejected', '{}') > 0,
  'T12 ... and records it');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = ''ManualEntry'' where id = %s', pg_temp.st('s-queued.pdf'))) like '%rejected%',
  'T13 a rejected statement can no longer be changed');

-- Ready: everything in place.
-- SD-3G (0117): an unread value on a PAYMENT line no longer blocks Ready
-- (payments are out of scope for document reconciliation), so T14 needs the
-- unread line to be a document again — the reviewer types it as an invoice.
select pg_temp.as_user('editor');
select pg_temp.run(format('update supplier_statement_lines set transaction_type = ''invoice'' where id = %s', pg_temp.line('s-review.pdf', 3)));
select pg_temp.as_service();
update supplier_statements set validation_status = 'Pass', validated_at = now() where id = pg_temp.st('s-review.pdf');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = ''Ready'' where id = %s', pg_temp.st('s-review.pdf'))) like '%unreadable value%',
  'T14 a statement with an unread value cannot be ready, even when validation says Pass');
select pg_temp.ok(pg_temp.run(format('update supplier_statement_lines set transaction_date = %L where id = %s', '2026-09-20', pg_temp.line('s-review.pdf', 3))) is null,
  'T15 (the reviewer resolves the last unread value)');
select pg_temp.as_service();
update supplier_statements set validation_status = 'Pass', validated_at = now(), currency_code = 'USD' where id = pg_temp.st('s-review.pdf');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = ''Ready'' where id = %s', pg_temp.st('s-review.pdf'))) like '%unsupported currency%',
  'T16 a foreign-currency statement cannot be ready: unsupported currency, manual review required');
select pg_temp.as_service();
update supplier_statements set currency_code = 'ZAR' where id = pg_temp.st('s-review.pdf');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.run(format('update supplier_statements set status = ''Ready'' where id = %s', pg_temp.st('s-review.pdf'))) is null
              and pg_temp.status('s-review.pdf') = 'Ready',
  'T17 validated, supplier confirmed, base currency, nothing unread: Ready');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set closing_balance = 1 where id = %s', pg_temp.st('s-review.pdf'))) like '%only a statement in review%',
  'T18 a ready statement is not edited in place ...');
select pg_temp.ok(pg_temp.run(format('update supplier_statements set status = ''NeedsReview'' where id = %s', pg_temp.st('s-review.pdf'))) is null
              and pg_temp.status('s-review.pdf') = 'NeedsReview',
  'T19 ... it is reopened for review first');
select pg_temp.ok(pg_temp.run(format('update supplier_statements set closing_balance = 251 where id = %s', pg_temp.st('s-review.pdf'))) is null
              and pg_temp.vstatus('s-review.pdf') = 'Pending',
  'T20 a header correction resets validation');

-- =====================================================================
-- D. Retention
-- =====================================================================
select pg_temp.as_admin();
select pg_temp.ok(fn_document_is_audited_original(pg_temp.doc('s-review.pdf')) and fn_document_is_statement_original(pg_temp.doc('s-review.pdf'))
              and not fn_document_is_audited_original(pg_temp.doc('s-plain.pdf')),
  'D1 statement originals are audited originals; an unused document is not');
select pg_temp.ok(pg_temp.err(format('delete from documents where id = %s', pg_temp.doc('s-review.pdf'))) like '%retained as accounting evidence%',
  'D2 a statement original cannot be deleted');
select pg_temp.ok(pg_temp.err(format('update documents set storage_path = %L where id = %s', 'elsewhere.pdf', pg_temp.doc('s-review.pdf'))) like '%cannot be changed%',
  'D3 ... nor its content altered');
select pg_temp.as_user('editor');
select pg_temp.ok((select count(*) from storage.objects where name = pg_temp.co_a() || '/Supplier/0/s-review.pdf') = 0,
  'D4 its file cannot be read directly from Storage (only through the audited viewer)');
select pg_temp.run(format('delete from storage.objects where bucket_id = %L and name = %L', 'documents', pg_temp.co_a() || '/Supplier/0/s-review.pdf'));
select pg_temp.as_admin();
select pg_temp.ok(exists (select 1 from storage.objects where name = pg_temp.co_a() || '/Supplier/0/s-review.pdf'),
  'D5 its file cannot be deleted through the Storage API either');
select pg_temp.as_admin();
select pg_temp.ok((select count(*) from storage.objects where name = pg_temp.co_a() || '/Supplier/0/s-review.pdf') = 1,
  'D6 (the file is still there)');

-- =====================================================================
-- A. Audited access to statement originals
-- =====================================================================
select pg_temp.as_user('viewer');
select pg_temp.ok(fn_record_supplier_document_access(pg_temp.co_a(), pg_temp.doc('s-review.pdf'), null, pg_temp.st('s-review.pdf'), 'view') > 0,
  'A1 a statement view is now recorded');
select pg_temp.ok(pg_temp.err(format('select fn_record_supplier_document_access(%L, %s, null, %s, %L)', pg_temp.co_a(), pg_temp.doc('s-plain.pdf'), pg_temp.st('s-review.pdf'), 'view')) like '%not the original of statement%',
  'A2 a document that is not that statement''s original is refused');
select pg_temp.ok(pg_temp.err(format('select fn_record_supplier_document_access(%L, %s, null, %s, %L)', pg_temp.co_a(), pg_temp.doc('s-b.pdf'), pg_temp.st('s-b.pdf'), 'download')) like '%not the original of statement%',
  'A3 another company''s statement original is refused');
select pg_temp.as_user('member');
select pg_temp.ok(pg_temp.err(format('select fn_record_supplier_document_access(%L, %s, null, %s, %L)', pg_temp.co_a(), pg_temp.doc('s-review.pdf'), pg_temp.st('s-review.pdf'), 'view')) like '%Purchasing:View is required%',
  'A4 without Purchasing:View nothing is recorded (and so nothing is served)');
select pg_temp.as_admin();
select pg_temp.ok((select statement_id = pg_temp.st('s-review.pdf') and capture_id is null and actor_user_id = pg_temp.uid('viewer')
                   from supplier_document_access_events order by id desc limit 1)
              and exists (select 1 from pg_constraint where conname = 'supplier_document_access_events_statement_id_fkey'),
  'A5 the record names the statement (now a real foreign key) and the session user');

-- =====================================================================
-- S. Our account number at the supplier
-- =====================================================================
select pg_temp.ok(exists (select 1 from information_schema.columns where table_name = 'ae_suppliers' and column_name = 'our_account_number' and is_nullable = 'YES'),
  'S1 ae_suppliers.our_account_number exists and is optional');
select pg_temp.ok(pg_temp.err(format('update ae_suppliers set our_account_number = %L where id = %s', '   ', pg_temp.sup('SC3A'))) like '%our_account_number_length%',
  'S2 a blank account number is refused (null means none)');
select pg_temp.run(format('update ae_suppliers set our_account_number = %L where id = %s', '000123', pg_temp.sup('SC3A')));
select pg_temp.ok((select our_account_number = '000123' from ae_suppliers where id = pg_temp.sup('SC3A')),
  'S3 the account number is stored verbatim (leading zeros kept)');

-- =====================================================================
-- H. Accounting untouched
-- =====================================================================
select pg_temp.ok((select accounting_before from sd3c_state) = pg_temp.accounting_fingerprint(),
  'H1 journals, ledger, bills, bill lines, supplier payments, allocations and opening balances are byte-for-byte unchanged');

rollback;
