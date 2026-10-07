-- Phase SD-0 — database tests for migration 0111 (supplier capture security hardening).
-- Kept current with 0112 (SD-1): where SD-1 deliberately widened what a
-- reviewer may correct, or made captured documents undeletable, the
-- expectation says so. The SD-1 rules themselves are tested in
-- supplier_capture_review_workflow.test.sql.
--
-- LOCAL / SYNTHETIC DATA ONLY. Everything runs in ONE transaction that is
-- rolled back at the end. Never run against a shared or production database.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/supplier_capture_security_hardening.test.sql
--
-- Each check prints "PASS: ..." as a NOTICE; the first failure aborts the run
-- with "FAIL: ...". Sections:
--   A  security-definer functions from 0107–0110 are service-role only
--   B  company membership alone cannot read or modify capture records
--   C  Purchasing View / Create / Edit / Reject / Approve each allow exactly their part
--   D  wrong-company access is denied
--   E  event actors cannot be spoofed
--   F  event records cannot be modified, deleted or truncated
--   G  the server (service-role) processing path still works
--   H  no accounting record is touched

\set ON_ERROR_STOP 1
set client_min_messages = notice;
begin;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'PASS: %', label;
end $$;

-- The error a statement raises, or null when it succeeds (its writes are
-- rolled back either way).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'SD0_TEST_ROLLBACK';
exception when others then
  if sqlerrm = 'SD0_TEST_ROLLBACK' then return null; end if;
  raise notice '  (error: %)', sqlerrm;
  return sqlerrm;
end $$;

-- Rows a statement affected, rolled back afterwards. -1 when it raised.
create function pg_temp.affected(p_sql text) returns integer language plpgsql as $$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  raise exception 'SD0_TEST_ROLLBACK:%', n;
exception when others then
  if sqlerrm like 'SD0_TEST_ROLLBACK:%' then return split_part(sqlerrm, ':', 2)::integer; end if;
  raise notice '  (refused: %)', sqlerrm;
  return -1;
end $$;

create function pg_temp.scalar(p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  return v;
end $$;

create function pg_temp.co_a() returns uuid language sql immutable as $$ select '5d000000-0000-4000-8000-0000000000a1'::uuid $$;
create function pg_temp.co_b() returns uuid language sql immutable as $$ select '5d000000-0000-4000-8000-0000000000b1'::uuid $$;

create function pg_temp.uid(p_name text) returns uuid language sql immutable as $$
  select (case p_name
    when 'member'   then '5d000000-0000-4000-8000-000000000101'
    when 'viewer'   then '5d000000-0000-4000-8000-000000000102'
    when 'creator'  then '5d000000-0000-4000-8000-000000000103'
    when 'editor'   then '5d000000-0000-4000-8000-000000000104'
    when 'rejecter' then '5d000000-0000-4000-8000-000000000105'
    when 'approver' then '5d000000-0000-4000-8000-000000000106'
    when 'owner_b'  then '5d000000-0000-4000-8000-000000000107'
  end)::uuid
$$;
create function pg_temp.email(p_name text) returns text language sql immutable as $$ select 'sd0-' || p_name || '@synthetic.test' $$;

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

create function pg_temp.accounting_fingerprint() returns text language sql as $$
  select md5(
    coalesce((select string_agg(j::text, '|' order by j.id) from ae_journals j), '') || '#' ||
    coalesce((select string_agg(l::text, '|' order by l.id) from ae_journal_lines l), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from gl_transactions g), '') || '#' ||
    coalesce((select string_agg(b::text, '|' order by b.id) from ae_imported_bills b), '') || '#' ||
    coalesce((select string_agg(p::text, '|' order by p.id) from ae_purchase_bill_lines p), '') || '#' ||
    coalesce((select string_agg(s::text, '|' order by s.id) from supplier_payments s), '') || '#' ||
    coalesce((select string_agg(a::text, '|' order by a.id) from supplier_payment_allocations a), '') || '#' ||
    coalesce((select string_agg(s::text, '|' order by s.id) from ae_suppliers s), ''))
$$;

-- ---------------------------------------------------------------------
-- Fixtures: two companies; in A, one user per permission profile; in B,
-- one user with every Purchasing permission.
-- ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select pg_temp.uid(n), pg_temp.email(n), 'authenticated', 'authenticated'
from unnest(array['member','viewer','creator','editor','rejecter','approver','owner_b']) as n;

insert into organisations (id, name) values
  ('5d000000-0000-4000-8000-0000000000aa', 'SD0 Org A'),
  ('5d000000-0000-4000-8000-0000000000bb', 'SD0 Org B');
insert into companies (id, organisation_id, name, base_currency_code) values
  (pg_temp.co_a(), '5d000000-0000-4000-8000-0000000000aa', 'SD0 Company A', 'ZAR'),
  (pg_temp.co_b(), '5d000000-0000-4000-8000-0000000000bb', 'SD0 Company B', 'ZAR');

-- Custom roles, so each profile holds exactly the permissions under test.
insert into permission_roles (company_id, role_key, name) values
  (pg_temp.co_a(), 'sd0_member',   'SD0 member only'),
  (pg_temp.co_a(), 'sd0_viewer',   'SD0 viewer'),
  (pg_temp.co_a(), 'sd0_creator',  'SD0 creator'),
  (pg_temp.co_a(), 'sd0_editor',   'SD0 editor'),
  (pg_temp.co_a(), 'sd0_rejecter', 'SD0 rejecter'),
  (pg_temp.co_a(), 'sd0_approver', 'SD0 approver'),
  (pg_temp.co_b(), 'sd0_all',      'SD0 all purchasing');

insert into role_permissions (role_id, permission_key)
select pr.id, 'Purchasing:' || a
from permission_roles pr
cross join lateral unnest(case pr.role_key
  when 'sd0_viewer'   then array['View']
  when 'sd0_creator'  then array['View','Create']
  when 'sd0_editor'   then array['View','Edit']
  when 'sd0_rejecter' then array['View','Reject']
  when 'sd0_approver' then array['View','Create','Approve']
  when 'sd0_all'      then array['View','Create','Edit','Reject','Approve','Delete']
  else array[]::text[] end) as a
where pr.role_key like 'sd0_%';

insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.uid(replace(pr.role_key, 'sd0_', '')), pr.company_id, pr.id, 'sd0-test'
from permission_roles pr where pr.role_key in ('sd0_member','sd0_viewer','sd0_creator','sd0_editor','sd0_rejecter','sd0_approver');
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.uid('owner_b'), pr.company_id, pr.id, 'sd0-test' from permission_roles pr where pr.role_key = 'sd0_all';

insert into ae_suppliers (company_id, name, supplier_code) values
  (pg_temp.co_a(), 'Alpha Supplies', 'ALPHA'),
  (pg_temp.co_a(), 'Alpha Second Supplier', 'ALPHA2'),
  (pg_temp.co_b(), 'Bravo Supplies', 'BRAVO');
create function pg_temp.sup(p_code text) returns bigint language sql security definer as $$ select id from ae_suppliers where supplier_code = p_code $$;

insert into documents (company_id, entity_type, entity_id, category, filename, storage_path, mime_type, size_bytes, uploaded_by, content_sha256)
select c, 'Supplier', 0, 'Invoice', f, c || '/Supplier/0/' || f, 'application/pdf', 1000, 'fixture', 'sha-' || f
from (values (pg_temp.co_a(), 'a-review.pdf'), (pg_temp.co_a(), 'a-blocked.pdf'), (pg_temp.co_a(), 'a-queued.pdf'),
             (pg_temp.co_a(), 'a-new-1.pdf'), (pg_temp.co_a(), 'a-new-2.pdf'),
             (pg_temp.co_b(), 'b-review.pdf'), (pg_temp.co_b(), 'b-new.pdf')) as t(c, f);
create function pg_temp.doc(p_file text) returns bigint language sql security definer as $$ select id from documents where filename = p_file $$;

insert into ae_imported_bills (company_id, supplier_id, supplier_name, invoice_number, total, outstanding, origin, posting_status) values
  (pg_temp.co_a(), pg_temp.sup('ALPHA'), 'Alpha Supplies', 'SD0-A-1', 1150, 1150, 'Purchasing', 'Draft'),
  (pg_temp.co_b(), pg_temp.sup('BRAVO'), 'Bravo Supplies', 'SD0-B-1', 500, 500, 'Purchasing', 'Draft');
create function pg_temp.bill(p_number text) returns bigint language sql security definer as $$ select id from ae_imported_bills where invoice_number = p_number $$;

-- Captures, written as the server would.
insert into supplier_invoice_captures (company_id, document_id, status, uploaded_by, supplier_name_extracted, invoice_number,
  invoice_date, subtotal, vat_amount, total, supplier_id, supplier_match_tier, validation_status, duplicate_status, duplicate_reason)
values
  (pg_temp.co_a(), pg_temp.doc('a-review.pdf'),  'NeedsReview', 'fixture', 'Alpha Supplies', 'INV-100', date '2026-09-01', 1000, 150, 1150, pg_temp.sup('ALPHA'), 'vat', 'Pass', 'None', ''),
  (pg_temp.co_a(), pg_temp.doc('a-blocked.pdf'), 'NeedsReview', 'fixture', 'Alpha Supplies', 'INV-100', date '2026-09-01', 1000, 150, 1150, pg_temp.sup('ALPHA'), 'vat', 'Pass', 'Blocked', 'same supplier and invoice number'),
  (pg_temp.co_a(), pg_temp.doc('a-queued.pdf'),  'Queued',      'fixture', null, null, null, null, null, null, null, null, 'Pending', 'None', ''),
  (pg_temp.co_b(), pg_temp.doc('b-review.pdf'),  'NeedsReview', 'fixture', 'Bravo Supplies', 'B-1', date '2026-09-01', 100, 15, 115, pg_temp.sup('BRAVO'), 'vat', 'Pass', 'None', '');
create function pg_temp.cap(p_file text) returns bigint language sql security definer as $$
  select c.id from supplier_invoice_captures c join documents d on d.id = c.document_id where d.filename = p_file
$$;

insert into supplier_invoice_capture_lines (company_id, capture_id, line_order, description, quantity, unit_price, vat_rate_percent, vat_amount, line_total, gl_account_suggested, vat_code_suggested)
values
  (pg_temp.co_a(), pg_temp.cap('a-review.pdf'), 0, 'Maize meal 10kg', 10, 100, 15, 150, 1000, '5100', 'Standard Rated'),
  (pg_temp.co_a(), pg_temp.cap('a-queued.pdf'), 0, 'Pending line', 1, 1, 15, 0.15, 1, null, null);

insert into supplier_invoice_capture_events (company_id, capture_id, event_type, detail, performed_by) values
  (pg_temp.co_a(), pg_temp.cap('a-review.pdf'), 'ValidationEvaluated', '{"status":"Pass"}', 'fixture-system'),
  (pg_temp.co_b(), pg_temp.cap('b-review.pdf'), 'ValidationEvaluated', '{"status":"Pass"}', 'fixture-system');

insert into supplier_line_mappings (company_id, supplier_id, description_normalised, supplier_sku_normalised, gl_account, vat_code)
values (pg_temp.co_a(), pg_temp.sup('ALPHA'), 'maize meal 10kg', '', '5100', 'Standard Rated');

insert into ai_extraction_attempts (company_id, capture_id, attempt_number, outcome, provider_request_made)
values (pg_temp.co_a(), pg_temp.cap('a-review.pdf'), 1, 'extracted', true);

-- The C5 fixture Draft (the bill a conversion creates) is part of the
-- fixture, so it is in the baseline.
insert into ae_imported_bills (company_id, supplier_id, supplier_name, invoice_number, total, outstanding, origin, posting_status)
values (pg_temp.co_a(), pg_temp.sup('ALPHA'), 'Alpha Supplies', 'INV-100', 1150, 1150, 'Purchasing', 'Draft');
create temp table sd0_state as select pg_temp.accounting_fingerprint() as accounting_before;
grant select on sd0_state to authenticated, anon, service_role;

-- =====================================================================
-- A. Security-definer functions are service-role only.
-- =====================================================================
create temp table sd0_fns (sig text);
insert into sd0_fns values
  ('fn_ai_resolve_daily_cap(uuid,text)'),
  ('fn_ai_reserve_request(uuid,text,timestamptz,integer)'),
  ('fn_ai_release_request(uuid,text,timestamptz)'),
  ('fn_ai_classification_release_reservation(uuid,text,timestamptz)'),
  ('fn_ai_extraction_record_attempt(uuid,bigint,bigint,integer,text,boolean,text,text,integer,text,jsonb,integer,text,text,timestamptz,text,boolean)'),
  ('fn_ai_extraction_gate(uuid,bigint,timestamptz,text)'),
  ('fn_ai_certification_open_run(uuid,text,integer,text)'),
  ('fn_ai_certification_reserve_call(bigint)'),
  ('fn_ai_certification_close_run(bigint)'),
  ('fn_ai_certification_read_evidence(bigint)'),
  ('fn_ai_certification_record_evidence(bigint,uuid,text,text,text,text,text,text,integer,integer,integer,jsonb,text,integer,text,jsonb,text,jsonb,integer,integer)'),
  ('fn_supplier_invoice_capture_record_system_event(uuid,bigint,text,jsonb,text)');

do $$
declare
  r record;
begin
  for r in select sig, to_regprocedure(sig) as oid from sd0_fns loop
    perform pg_temp.ok(r.oid is not null, format('A0 %s exists', r.sig));
    perform pg_temp.ok(not has_function_privilege('anon', r.oid, 'execute'), format('A1 anon cannot execute %s', r.sig));
    perform pg_temp.ok(not has_function_privilege('authenticated', r.oid, 'execute'), format('A1 authenticated cannot execute %s', r.sig));
    perform pg_temp.ok(has_function_privilege('service_role', r.oid, 'execute'), format('A1 service_role can execute %s', r.sig));
    perform pg_temp.ok(not has_function_privilege('public', r.oid, 'execute'), format('A1 PUBLIC holds no EXECUTE on %s', r.sig));
  end loop;
end $$;

select pg_temp.ok(
  not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and (p.proname like 'fn\_ai\_%' or p.proname like 'fn\_supplier\_invoice\_capture\_%')
      and has_function_privilege('anon', p.oid, 'execute')),
  'A2 no AI or supplier-capture SECURITY DEFINER function is executable by anon');

-- Behavioural: a fully-privileged signed-in user still cannot call them.
select pg_temp.as_user('approver');
select pg_temp.ok(pg_temp.err(format('select fn_ai_reserve_request(%L, %L)', pg_temp.co_a(), 'supplier-invoice-extraction')) like 'permission denied%',
  'A3 a signed-in user cannot reserve AI budget');
select pg_temp.ok(pg_temp.err(format('select fn_ai_release_request(%L, %L)', pg_temp.co_a(), 'transaction-classification')) like 'permission denied%',
  'A3 a signed-in user cannot release AI budget');
select pg_temp.ok(pg_temp.err(format(
    'select fn_ai_extraction_record_attempt(%L, %s, null, 1, %L, true, null, null, 401, null, null, null, %L, %L)',
    pg_temp.co_a(), pg_temp.cap('a-review.pdf'), 'provider_error', 'attacker', 'auth')) like 'permission denied%',
  'A3 a signed-in user cannot record a fake provider failure (cannot open the shared circuit)');
select pg_temp.ok(pg_temp.err(format('select fn_ai_extraction_gate(%L, %s)', pg_temp.co_a(), pg_temp.cap('a-review.pdf'))) like 'permission denied%',
  'A3 a signed-in user cannot open the extraction gate');
select pg_temp.ok(pg_temp.err(format('select fn_ai_certification_open_run(%L, %L, 1000)', pg_temp.co_a(), 'attacker')) like 'permission denied%',
  'A3 a signed-in user cannot open a certification run');
select pg_temp.ok(pg_temp.err('select * from fn_ai_certification_read_evidence(1)') like 'permission denied%',
  'A3 a signed-in user cannot read certification evidence');
select pg_temp.as_anon();
select pg_temp.ok(pg_temp.err(format('select fn_ai_resolve_daily_cap(%L, %L)', pg_temp.co_a(), 'supplier-invoice-extraction')) like 'permission denied%',
  'A3 anon cannot call the AI budget functions');
-- (anon cannot see suppliers, so a placeholder id: EXECUTE is checked before the body runs)
select pg_temp.ok(pg_temp.err(format('select fn_upsert_supplier_line_mapping(%L, 0, %L, %L, %L, %L, null)',
    pg_temp.co_a(), 'x', '', '9999', 'Exempt')) like 'permission denied%',
  'A4 anon cannot call the learned-mapping upsert');
select pg_temp.as_service();
select pg_temp.ok(pg_temp.err(format('select fn_ai_resolve_daily_cap(%L, %L)', pg_temp.co_a(), 'supplier-invoice-extraction')) is null,
  'A5 the service role still can');
select pg_temp.as_admin();

-- =====================================================================
-- B. Company membership alone is not enough.
-- =====================================================================
select pg_temp.as_user('member');
select pg_temp.ok(user_can_access_company(pg_temp.co_a()), 'B0 the member-only user IS a member of company A');
select pg_temp.ok((select count(*) from supplier_invoice_captures) = 0, 'B1 a member without Purchasing:View sees no captures');
select pg_temp.ok((select count(*) from supplier_invoice_capture_lines) = 0, 'B1 ... no capture lines');
select pg_temp.ok((select count(*) from supplier_invoice_capture_events) = 0, 'B1 ... no capture events');
select pg_temp.ok((select count(*) from supplier_line_mappings) = 0, 'B1 ... no learned mappings');
select pg_temp.ok((select count(*) from ai_extraction_attempts) = 0, 'B1 ... no extraction attempts');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set invoice_number = %L where id = %s', 'HACK', pg_temp.cap('a-review.pdf'))) <= 0,
  'B2 a member cannot correct a capture');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, bill_id = %s where id = %s', 'Converted', pg_temp.bill('SD0-A-1'), pg_temp.cap('a-review.pdf'))) <= 0,
  'B2 a member cannot link a bill or mark a capture converted');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set duplicate_status = %L where id = %s', 'None', pg_temp.cap('a-blocked.pdf'))) <= 0,
  'B2 a member cannot clear a duplicate block');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_captures (company_id, document_id) values (%L, %s)', pg_temp.co_a(), pg_temp.doc('a-new-1.pdf'))) = -1,
  'B3 a member cannot create a capture');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_capture_lines (company_id, capture_id, line_order, description) values (%L, %s, 9, %L)', pg_temp.co_a(), pg_temp.cap('a-review.pdf'), 'x')) = -1,
  'B3 a member cannot add a capture line');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_capture_events (company_id, capture_id, event_type, performed_by) values (%L, %s, %L, %L)', pg_temp.co_a(), pg_temp.cap('a-review.pdf'), 'FieldCorrected', 'someone')) = -1,
  'B3 a member cannot insert a capture event');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_record_event(%L, %s, %L)', pg_temp.co_a(), pg_temp.cap('a-review.pdf'), 'FieldCorrected')) is not null,
  'B3 a member cannot record a capture event through the writer');
select pg_temp.ok(pg_temp.err(format('select fn_upsert_supplier_line_mapping(%L, %s, %L, %L, %L, %L, null)', pg_temp.co_a(), pg_temp.sup('ALPHA'), 'maize meal 10kg', '', '9999', 'Exempt')) is not null,
  'B3 a member cannot seed or overwrite a learned GL mapping');
select pg_temp.ok(pg_temp.affected(format('delete from supplier_invoice_captures where id = %s', pg_temp.cap('a-review.pdf'))) <= 0,
  'B4 a member cannot delete a capture');
select pg_temp.as_admin();
select pg_temp.ok((select invoice_number = 'INV-100' and status = 'NeedsReview' and bill_id is null from supplier_invoice_captures where id = pg_temp.cap('a-review.pdf')),
  'B5 the capture is unchanged after every member attempt');
select pg_temp.ok((select gl_account = '5100' from supplier_line_mappings where company_id = pg_temp.co_a()),
  'B5 the learned mapping is unchanged');

-- Anonymous callers have no table access at all.
select pg_temp.as_anon();
select pg_temp.ok(pg_temp.err('select count(*) from supplier_invoice_captures') like 'permission denied%', 'B6 anon cannot read captures');
select pg_temp.ok(pg_temp.err('select count(*) from supplier_invoice_capture_events') like 'permission denied%', 'B6 anon cannot read capture events');
select pg_temp.as_admin();

-- =====================================================================
-- C. Purchasing permissions.
-- =====================================================================
-- C1 View
select pg_temp.as_user('viewer');
select pg_temp.ok((select count(*) from supplier_invoice_captures) = 3, 'C1 Purchasing:View reads company A''s captures (and only A''s)');
select pg_temp.ok((select count(*) from supplier_invoice_capture_lines) = 2, 'C1 ... and their lines');
select pg_temp.ok((select count(*) from supplier_invoice_capture_events) = 1, 'C1 ... and their events');
select pg_temp.ok((select count(*) from ai_extraction_attempts) = 1, 'C1 ... and extraction attempts');
select pg_temp.ok((select count(*) from supplier_line_mappings) = 1, 'C1 ... and learned mappings');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set invoice_number = %L where id = %s', 'X', pg_temp.cap('a-review.pdf'))) <= 0,
  'C1 View alone cannot correct');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_captures (company_id, document_id) values (%L, %s)', pg_temp.co_a(), pg_temp.doc('a-new-1.pdf'))) = -1,
  'C1 View alone cannot upload');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_capture_lines set gl_account_confirmed = %L where capture_id = %s', '9999', pg_temp.cap('a-review.pdf'))) <= 0,
  'C1 View alone cannot correct lines');
select pg_temp.as_admin();

-- C2 Create
select pg_temp.as_user('creator');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_captures (company_id, document_id, uploaded_by) values (%L, %s, %L)', pg_temp.co_a(), pg_temp.doc('a-new-1.pdf'), 'someone-else@spoof.test')) = 1,
  'C2 Purchasing:Create uploads a new, empty capture');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_captures (company_id, document_id, status) values (%L, %s, %L)', pg_temp.co_a(), pg_temp.doc('a-new-1.pdf'), 'NeedsReview')) = -1,
  'C2 ... but not one that skips straight to review');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_captures (company_id, document_id, validation_status) values (%L, %s, %L)', pg_temp.co_a(), pg_temp.doc('a-new-1.pdf'), 'Pass')) = -1,
  'C2 ... nor one with a validation result');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_captures (company_id, document_id, bill_id) values (%L, %s, %s)', pg_temp.co_a(), pg_temp.doc('a-new-1.pdf'), pg_temp.bill('SD0-A-1'))) = -1,
  'C2 ... nor one already linked to a bill');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_captures (company_id, document_id, document_type) values (%L, %s, %L)', pg_temp.co_a(), pg_temp.doc('a-new-1.pdf'), 'Invoice')) = -1,
  'C2 ... nor one with a document type the system has not determined');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set invoice_number = %L where id = %s', 'X', pg_temp.cap('a-review.pdf'))) <= 0,
  'C2 Create alone cannot correct');
insert into supplier_invoice_captures (company_id, document_id, uploaded_by) values (pg_temp.co_a(), pg_temp.doc('a-new-2.pdf'), 'someone-else@spoof.test');
select pg_temp.as_admin();
select pg_temp.ok((select uploaded_by from supplier_invoice_captures where id = pg_temp.cap('a-new-2.pdf')) = pg_temp.email('creator'),
  'C2 uploaded_by is the session''s user, not the value the caller supplied');

-- C3 Edit
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.affected(format(
    'update supplier_invoice_captures set invoice_number = %L, invoice_date = %L, due_date = %L, order_reference = %L where id = %s',
    'INV-100A', '2026-09-02', '2026-10-02', 'PO-7', pg_temp.cap('a-review.pdf'))) = 1,
  'C3 Purchasing:Edit corrects the reviewable header fields');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set supplier_id = %s, supplier_match_tier = %L where id = %s', pg_temp.sup('ALPHA2'), 'manual', pg_temp.cap('a-review.pdf'))) = 1,
  'C3 ... and chooses a supplier (a manual match)');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set supplier_id = %s, supplier_match_tier = %L where id = %s', pg_temp.sup('ALPHA2'), 'vat', pg_temp.cap('a-review.pdf'))) = -1,
  'C3 ... but cannot record its own choice as a deterministic (VAT) match');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set supplier_id = %s, supplier_match_tier = %L where id = %s', pg_temp.sup('BRAVO'), 'manual', pg_temp.cap('a-review.pdf'))) = -1,
  'C3 ... nor pick another company''s supplier');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set validation_status = %L where id = %s', 'Pass', pg_temp.cap('a-queued.pdf'))) = -1,
  'C3 Edit cannot set a validation result');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set duplicate_status = %L, duplicate_reason = %L where id = %s', 'None', '', pg_temp.cap('a-blocked.pdf'))) = -1,
  'C3 Edit cannot clear a duplicate block');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set supplier_name_extracted = %L where id = %s', 'Someone Else', pg_temp.cap('a-review.pdf'))) = -1,
  'C3 Edit cannot change what was extracted (reviewed totals are correctable since SD-1; the extraction is not)');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L where id = %s', 'Cancelled', pg_temp.cap('a-review.pdf'))) = -1,
  'C3 Edit cannot reject (needs Purchasing:Reject)');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, bill_id = %s where id = %s', 'Converted', pg_temp.bill('SD0-A-1'), pg_temp.cap('a-review.pdf'))) = -1,
  'C3 Edit cannot convert (needs Create and Approve)');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L where id = %s', 'NeedsReview', pg_temp.cap('a-queued.pdf'))) = -1,
  'C3 Edit cannot move a capture through the extraction states');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set invoice_number = %L where id = %s', 'X', pg_temp.cap('a-queued.pdf'))) = -1,
  'C3 Edit cannot correct a capture that is not in review');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set company_id = %L where id = %s', pg_temp.co_b(), pg_temp.cap('a-review.pdf'))) <= 0,
  'C3 Edit cannot move a capture to another company');
select pg_temp.ok(pg_temp.affected(format(
    'update supplier_invoice_capture_lines set gl_account_confirmed = %L, vat_code_confirmed = %L, quantity = 11, is_excluded = false where capture_id = %s',
    '5200', 'Standard Rated', pg_temp.cap('a-review.pdf'))) = 1,
  'C3 Edit corrects a line (confirmations, quantity)');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_capture_lines set line_confidence = 1 where capture_id = %s', pg_temp.cap('a-review.pdf'))) = -1,
  'C3 ... but not the model''s own confidence');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_capture_lines set gl_account_suggested = %L where capture_id = %s', '9999', pg_temp.cap('a-review.pdf'))) = -1,
  'C3 ... nor the system''s suggestion');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_capture_lines set description = %L where capture_id = %s', 'x', pg_temp.cap('a-queued.pdf'))) = -1,
  'C3 ... nor lines of a capture that is not in review');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_capture_lines (company_id, capture_id, line_order, description) values (%L, %s, 5, %L)', pg_temp.co_a(), pg_temp.cap('a-queued.pdf'), 'x')) = -1,
  'C3 Edit cannot add lines to a capture that is not in review');
select pg_temp.ok(pg_temp.affected(format('delete from supplier_invoice_capture_lines where capture_id = %s', pg_temp.cap('a-queued.pdf'))) <= 0,
  'C3 Edit cannot delete lines of a capture that is not in review');
select pg_temp.ok(pg_temp.err(format('select fn_upsert_supplier_line_mapping(%L, %s, %L, %L, %L, %L, null)', pg_temp.co_a(), pg_temp.sup('ALPHA'), 'maize meal 10kg', '', '9999', 'Exempt')) is not null,
  'C3 Edit cannot write learned mappings (only an approved conversion can)');
select pg_temp.as_admin();

-- C4 Reject
select pg_temp.as_user('rejecter');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set invoice_number = %L where id = %s', 'X', pg_temp.cap('a-review.pdf'))) = -1,
  'C4 Reject alone cannot correct');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, invoice_number = %L where id = %s', 'Cancelled', 'X', pg_temp.cap('a-review.pdf'))) = -1,
  'C4 a rejection cannot carry edits with it');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L where id = %s', 'Cancelled', pg_temp.cap('a-blocked.pdf'))) = 1,
  'C4 Purchasing:Reject rejects a capture');
update supplier_invoice_captures set status = 'Cancelled' where id = pg_temp.cap('a-blocked.pdf');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L where id = %s', 'NeedsReview', pg_temp.cap('a-blocked.pdf'))) <= 0,
  'C4 a rejected capture cannot be reopened by a user');
select pg_temp.as_admin();

-- C5 Create + Approve (conversion)
-- (0112) conversion needs a fresh verdict and the Draft created for this capture (ALPHA / INV-100; C3's corrections were rolled back).
update supplier_invoice_captures set validation_status = 'Pass', validated_at = now() where id = pg_temp.cap('a-review.pdf');
select pg_temp.as_user('approver');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, bill_id = %s where id = %s', 'Converted', pg_temp.bill('SD0-B-1'), pg_temp.cap('a-review.pdf'))) = -1,
  'C5 conversion cannot link another company''s bill');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L where id = %s', 'Converted', pg_temp.cap('a-review.pdf'))) = -1,
  'C5 conversion requires a bill');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set bill_id = %s where id = %s', pg_temp.bill('SD0-A-1'), pg_temp.cap('a-review.pdf'))) = -1,
  'C5 a bill cannot be linked without converting');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, bill_id = %s, converted_by = %L, converted_at = %L where id = %s',
    'Converted', pg_temp.bill('INV-100'), 'someone-else@spoof.test', '2000-01-01', pg_temp.cap('a-review.pdf'))) = 1,
  'C5 Purchasing:Create + Approve converts a reviewed capture');
update supplier_invoice_captures set status = 'Converted', bill_id = pg_temp.bill('INV-100'), converted_by = 'someone-else@spoof.test', converted_at = '2000-01-01'
where id = pg_temp.cap('a-review.pdf');
select fn_upsert_supplier_line_mapping(pg_temp.co_a(), pg_temp.sup('ALPHA'), 'maize meal 10kg', '', '5200', 'Standard Rated', pg_temp.cap('a-review.pdf'));
select pg_temp.as_admin();
select pg_temp.ok((select converted_by = pg_temp.email('approver') and converted_at > now() - interval '1 minute'
                   from supplier_invoice_captures where id = pg_temp.cap('a-review.pdf')),
  'C5 converted_by / converted_at are the session''s user and the database clock, not the caller''s values');
select pg_temp.ok((select gl_account = '5200' and times_confirmed = 2 from supplier_line_mappings where company_id = pg_temp.co_a()),
  'C5 an approver''s conversion teaches the learned mapping');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set invoice_number = %L where id = %s', 'X', pg_temp.cap('a-review.pdf'))) = -1,
  'C5 a converted capture can no longer be edited');
select pg_temp.as_user('rejecter');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L where id = %s', 'Cancelled', pg_temp.cap('a-review.pdf'))) = -1,
  'C5 a converted capture cannot be rejected');
select pg_temp.as_admin();

-- A blocked duplicate cannot be converted, even by an approver.
insert into supplier_invoice_captures (company_id, document_id, status, supplier_id, invoice_number, validation_status, duplicate_status)
values (pg_temp.co_a(), pg_temp.doc('a-new-1.pdf'), 'NeedsReview', pg_temp.sup('ALPHA'), 'INV-100A', 'Pass', 'Blocked');
select pg_temp.as_user('approver');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, bill_id = %s where id = %s', 'Converted', pg_temp.bill('SD0-A-1'), pg_temp.cap('a-new-1.pdf'))) = -1,
  'C5 a blocked duplicate cannot be converted');
select pg_temp.as_admin();

-- =====================================================================
-- D. Wrong company.
-- =====================================================================
select pg_temp.as_user('owner_b');
select pg_temp.ok((select count(*) from supplier_invoice_captures where company_id = pg_temp.co_a()) = 0, 'D1 company B''s user sees none of company A''s captures');
select pg_temp.ok((select count(*) from supplier_invoice_capture_events where company_id = pg_temp.co_a()) = 0, 'D1 ... nor its events');
select pg_temp.ok((select count(*) from supplier_invoice_captures) = 1, 'D1 ... while seeing company B''s own capture');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set invoice_number = %L where id = %s', 'X', pg_temp.cap('a-new-2.pdf'))) <= 0,
  'D2 company B''s user cannot modify company A''s capture');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_captures (company_id, document_id) values (%L, %s)', pg_temp.co_a(), pg_temp.doc('a-new-2.pdf'))) = -1,
  'D3 company B''s user cannot create a capture in company A');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_captures (company_id, document_id) values (%L, %s)', pg_temp.co_b(), pg_temp.doc('a-new-2.pdf'))) = -1,
  'D3 ... nor a company B capture of company A''s document');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_record_event(%L, %s, %L)', pg_temp.co_a(), pg_temp.cap('a-new-2.pdf'), 'FieldCorrected')) is not null,
  'D4 company B''s user cannot record an event on company A''s capture');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_record_event(%L, %s, %L)', pg_temp.co_b(), pg_temp.cap('a-new-2.pdf'), 'FieldCorrected')) is not null,
  'D4 ... even by naming their own company with company A''s capture id');
select pg_temp.ok(pg_temp.err(format('select fn_upsert_supplier_line_mapping(%L, %s, %L, %L, %L, %L, null)', pg_temp.co_a(), pg_temp.sup('ALPHA'), 'maize meal 10kg', '', '9999', 'Exempt')) is not null,
  'D5 company B''s user cannot write company A''s learned mappings');
select pg_temp.as_admin();

-- =====================================================================
-- E. Event actors cannot be spoofed.
-- =====================================================================
select pg_temp.ok(
  (select array_agg(n order by n) from unnest((select proargnames from pg_proc where oid = 'fn_supplier_invoice_capture_record_event(uuid,bigint,text,jsonb)'::regprocedure)) n)
  = array['p_capture_id','p_company_id','p_detail','p_event_type'],
  'E1 the user event writer has no actor parameter at all');

update supplier_invoice_captures set status = 'NeedsReview' where id = pg_temp.cap('a-new-2.pdf');
select pg_temp.as_user('editor');
select fn_supplier_invoice_capture_record_event(pg_temp.co_a(), pg_temp.cap('a-new-2.pdf'), 'FieldCorrected', '{"fields":["invoiceNumber"]}');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_record_event(%L, %s, %L, %L, %L)',
    pg_temp.co_a(), pg_temp.cap('a-new-2.pdf'), 'FieldCorrected', '{}', 'ceo@spoof.test')) is not null,
  'E2 passing an actor to the user writer is refused (no such function)');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_record_system_event(%L, %s, %L, %L, %L)',
    pg_temp.co_a(), pg_temp.cap('a-new-2.pdf'), 'FieldCorrected', '{}', 'ceo@spoof.test')) like 'permission denied%',
  'E3 a signed-in user cannot use the system writer to name an actor');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_capture_events (company_id, capture_id, event_type, performed_by) values (%L, %s, %L, %L)',
    pg_temp.co_a(), pg_temp.cap('a-new-2.pdf'), 'FieldCorrected', 'ceo@spoof.test')) = -1,
  'E4 a signed-in user cannot insert an event row directly');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_record_event(%L, %s, %L)', pg_temp.co_a(), pg_temp.cap('a-new-2.pdf'), 'ExtractionSucceeded')) like '%recorded by the system only%',
  'E5 a user cannot record a system-only event type');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_record_event(%L, %s, %L)', pg_temp.co_a(), pg_temp.cap('a-new-2.pdf'), 'ConvertedToBill')) is not null,
  'E6 Edit cannot record a conversion');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_record_event(%L, %s, %L)', pg_temp.co_a(), pg_temp.cap('a-queued.pdf'), 'FieldCorrected')) is not null,
  'E6 a correction cannot be recorded against a capture that is not in review');
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_record_event(%L, %s, %L)', pg_temp.co_a(), pg_temp.cap('a-new-2.pdf'), 'FieldCorrected')) is not null,
  'E6 View alone cannot record a correction');
select pg_temp.as_user('rejecter');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_record_event(%L, %s, %L)', pg_temp.co_a(), pg_temp.cap('a-new-2.pdf'), 'Cancelled')) is not null,
  'E6 a rejection event requires the capture to actually be rejected');
select fn_supplier_invoice_capture_record_event(pg_temp.co_a(), pg_temp.cap('a-blocked.pdf'), 'Cancelled', '{}');
-- A session with no user (authenticated role, no sub) is refused.
select set_config('request.jwt.claims', '{"role":"authenticated"}', true), set_config('request.jwt.claim.sub', '', true);
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_record_event(%L, %s, %L)', pg_temp.co_a(), pg_temp.cap('a-new-2.pdf'), 'FieldCorrected')) like '%requires a signed-in user%',
  'E7 an event cannot be recorded without a signed-in user');
select pg_temp.as_admin();
select pg_temp.ok((select performed_by from supplier_invoice_capture_events where capture_id = pg_temp.cap('a-new-2.pdf') and event_type = 'FieldCorrected') = pg_temp.email('editor'),
  'E8 the recorded actor is the session''s user');
select pg_temp.ok((select performed_by from supplier_invoice_capture_events where capture_id = pg_temp.cap('a-blocked.pdf') and event_type = 'Cancelled') = pg_temp.email('rejecter'),
  'E8 ... for the rejection too');
select pg_temp.ok(not exists (select 1 from supplier_invoice_capture_events where performed_by like '%spoof%'),
  'E8 no spoofed actor reached the event history');

select pg_temp.as_service();
select fn_supplier_invoice_capture_record_system_event(pg_temp.co_a(), pg_temp.cap('a-new-2.pdf'), 'DuplicateEvaluated', '{"status":"None"}', 'Scheduler (cron)');
select fn_supplier_invoice_capture_record_system_event(pg_temp.co_a(), pg_temp.cap('a-new-2.pdf'), 'Requeued', '{}', '   ');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_record_system_event(%L, %s, %L, %L, %L)',
    pg_temp.co_b(), pg_temp.cap('a-new-2.pdf'), 'Requeued', '{}', 'x')) like '%does not exist in this company%',
  'E9 the system writer also refuses a capture from another company');
select pg_temp.as_admin();
select pg_temp.ok((select performed_by from supplier_invoice_capture_events where capture_id = pg_temp.cap('a-new-2.pdf') and event_type = 'DuplicateEvaluated') = 'Scheduler (cron)',
  'E9 the system writer records the server''s actor');
select pg_temp.ok((select performed_by from supplier_invoice_capture_events where capture_id = pg_temp.cap('a-new-2.pdf') and event_type = 'Requeued') = 'System',
  'E9 a blank system actor is recorded as System, never empty');

-- =====================================================================
-- F. Event history is immutable — for everyone.
-- =====================================================================
select pg_temp.as_user('owner_b');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_capture_events set performed_by = %L where capture_id = %s', 'x', pg_temp.cap('b-review.pdf'))) = -1,
  'F1 a signed-in user (with every Purchasing permission) cannot modify an event');
select pg_temp.ok(pg_temp.affected(format('delete from supplier_invoice_capture_events where capture_id = %s', pg_temp.cap('b-review.pdf'))) = -1,
  'F1 ... nor delete one');
select pg_temp.as_service();
select pg_temp.ok(pg_temp.err('update supplier_invoice_capture_events set performed_by = ''x''') like '%append-only%',
  'F2 the service role cannot modify an event');
select pg_temp.ok(pg_temp.err('delete from supplier_invoice_capture_events') like '%append-only%',
  'F2 ... nor delete one');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.err('update supplier_invoice_capture_events set detail = ''{}''') like '%append-only%',
  'F3 not even the database owner can modify an event');
select pg_temp.ok(pg_temp.err('delete from supplier_invoice_capture_events') like '%append-only%',
  'F3 ... nor delete one');
select pg_temp.ok(pg_temp.err('truncate supplier_invoice_capture_events') like '%append-only%',
  'F3 ... nor truncate the table');
select pg_temp.ok(pg_temp.err(format('delete from documents where id = %s', pg_temp.doc('b-review.pdf'))) like '%retained as accounting evidence%',
  'F4 (0112) the source document of a capture is retained: deleting it is refused, so its history cannot cascade away');

-- =====================================================================
-- G. The server path still works.
-- =====================================================================
select pg_temp.as_service();
select pg_temp.ok(pg_temp.affected(format(
    'update supplier_invoice_captures set status = %L, supplier_name_extracted = %L, total = 115, validation_status = %L, duplicate_status = %L, extraction_attempts = 1 where id = %s',
    'NeedsReview', 'Alpha Supplies', 'Review', 'Possible', pg_temp.cap('a-queued.pdf'))) = 1,
  'G1 the service role writes extraction, validation and duplicate results');
select pg_temp.ok(pg_temp.affected(format('delete from supplier_invoice_capture_lines where capture_id = %s', pg_temp.cap('a-queued.pdf'))) = 1,
  'G2 the service role replaces extracted lines (delete)');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_capture_lines (company_id, capture_id, line_order, description) values (%L, %s, 1, %L)', pg_temp.co_a(), pg_temp.cap('a-queued.pdf'), 'Extracted line')) = 1,
  'G2 ... (insert)');
select pg_temp.as_admin();

-- =====================================================================
-- H. Accounting untouched.
-- =====================================================================
select pg_temp.ok((select accounting_before from sd0_state) = pg_temp.accounting_fingerprint(),
  'H1 journals, ledger, bills, bill lines, supplier payments, allocations and suppliers are byte-for-byte unchanged (beyond the fixture Draft)');
select pg_temp.ok(not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal
      and t.tgname in ('supplier_invoice_captures_guard', 'supplier_invoice_capture_lines_guard',
                       'supplier_invoice_capture_events_immutable', 'supplier_invoice_capture_events_no_truncate')
      and c.relname not in ('supplier_invoice_captures', 'supplier_invoice_capture_lines', 'supplier_invoice_capture_events')),
  'H2 0111''s triggers sit only on the capture tables');

rollback;
