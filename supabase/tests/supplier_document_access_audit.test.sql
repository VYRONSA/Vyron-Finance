-- Phase SD-3B — database tests for migration 0113 (supplier document access audit).
--
-- LOCAL / SYNTHETIC DATA ONLY. Everything runs in ONE transaction that is
-- rolled back at the end. Never run against a shared or production database.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/supplier_document_access_audit.test.sql
--
-- Sections:
--   G  explicit grants: table privileges and function EXECUTE, per role
--   W  the writer records views and downloads for the session's user
--   A  the actor cannot be supplied or spoofed
--   P  permissions and company isolation of the writer
--   F  a refused write records nothing (atomic; the viewer then serves nothing)
--   R  RLS on reading the audit
--   I  immutability: no update, delete or truncate — even for the owner
--   T  statement-original foundation: shape present, recording refused until 0114
--   S  storage: supplier originals cannot be read directly from the Storage API
--   H  no accounting record is touched

\set ON_ERROR_STOP 1
set client_min_messages = notice;
begin;

-- ---------------------------------------------------------------------
-- Helpers (as in supplier_capture_review_workflow.test.sql)
-- ---------------------------------------------------------------------
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
  raise exception 'SD3B_TEST_ROLLBACK';
exception when others then
  if sqlerrm = 'SD3B_TEST_ROLLBACK' then return null; end if;
  raise notice '  (error: %)', sqlerrm;
  return sqlerrm;
end $$;

create function pg_temp.affected(p_sql text) returns integer language plpgsql as $$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  raise exception 'SD3B_TEST_ROLLBACK:%', n;
exception when others then
  if sqlerrm like 'SD3B_TEST_ROLLBACK:%' then return split_part(sqlerrm, ':', 2)::integer; end if;
  raise notice '  (refused: %)', sqlerrm;
  return -1;
end $$;

create function pg_temp.co_a() returns uuid language sql immutable as $$ select '5e000000-0000-4000-8000-0000000003a1'::uuid $$;
create function pg_temp.co_b() returns uuid language sql immutable as $$ select '5e000000-0000-4000-8000-0000000003b1'::uuid $$;
create function pg_temp.uid(p_name text) returns uuid language sql immutable as $$
  select (case p_name
    when 'member'  then '5e000000-0000-4000-8000-000000000301'
    when 'viewer'  then '5e000000-0000-4000-8000-000000000302'
    when 'viewer2' then '5e000000-0000-4000-8000-000000000303'
    when 'owner_b' then '5e000000-0000-4000-8000-000000000307'
  end)::uuid
$$;
create function pg_temp.email(p_name text) returns text language sql immutable as $$ select 'sd3b-' || p_name || '@synthetic.test' $$;

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
    coalesce((select string_agg(a::text, '|' order by a.id) from supplier_payment_allocations a), ''))
$$;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select pg_temp.uid(n), pg_temp.email(n), 'authenticated', 'authenticated'
from unnest(array['member','viewer','viewer2','owner_b']) as n;

insert into organisations (id, name) values
  ('5e000000-0000-4000-8000-0000000003aa', 'SD3B Org A'), ('5e000000-0000-4000-8000-0000000003bb', 'SD3B Org B');
insert into companies (id, organisation_id, name, base_currency_code) values
  (pg_temp.co_a(), '5e000000-0000-4000-8000-0000000003aa', 'SD3B Company A', 'ZAR'),
  (pg_temp.co_b(), '5e000000-0000-4000-8000-0000000003bb', 'SD3B Company B', 'ZAR');

insert into permission_roles (company_id, role_key, name) values
  (pg_temp.co_a(), 'sd3b_member', 'member'), (pg_temp.co_a(), 'sd3b_viewer', 'viewer'),
  (pg_temp.co_a(), 'sd3b_viewer2', 'viewer2'), (pg_temp.co_b(), 'sd3b_owner_b', 'owner b');
insert into role_permissions (role_id, permission_key)
select pr.id, 'Purchasing:' || a
from permission_roles pr
cross join lateral unnest(case pr.role_key
  when 'sd3b_viewer'  then array['View']
  when 'sd3b_viewer2' then array['View']
  when 'sd3b_owner_b' then array['View','Create','Edit','Reject','Approve','Delete']
  else array[]::text[] end) as a
where pr.role_key like 'sd3b_%';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.uid(replace(pr.role_key, 'sd3b_', '')), pr.company_id, pr.id, 'sd3b-test'
from permission_roles pr where pr.role_key like 'sd3b_%';

insert into documents (company_id, entity_type, entity_id, category, filename, storage_path, mime_type, size_bytes, uploaded_by, content_sha256)
select c, 'Supplier', 0, 'Invoice', f, c || '/Supplier/0/' || f, 'application/pdf', 1000, 'fixture', 'sha-' || f
from (values (pg_temp.co_a(), 'a-cap1.pdf'), (pg_temp.co_a(), 'a-cap2.pdf'), (pg_temp.co_a(), 'a-plain.pdf'),
             (pg_temp.co_b(), 'b-cap.pdf')) as t(c, f);
create function pg_temp.doc(p_name text) returns bigint language sql security definer as $$ select id from documents where filename = p_name $$;

insert into storage.buckets (id, name) values ('documents', 'documents') on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) select 'documents', storage_path from documents where company_id in (pg_temp.co_a(), pg_temp.co_b());

insert into supplier_invoice_captures (company_id, document_id, status, uploaded_by)
values (pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), 'NeedsReview', 'fixture'),
       (pg_temp.co_a(), pg_temp.doc('a-cap2.pdf'), 'Queued', 'fixture'),
       (pg_temp.co_b(), pg_temp.doc('b-cap.pdf'), 'NeedsReview', 'fixture');
create function pg_temp.cap(p_name text) returns bigint language sql security definer as $$
  select c.id from supplier_invoice_captures c join documents d on d.id = c.document_id where d.filename = p_name
$$;
create function pg_temp.events() returns bigint language sql security definer as $$ select count(*) from supplier_document_access_events $$;

-- record(company, document, capture, statement, action) as SQL text, for err()/direct calls
create function pg_temp.rec(p_co uuid, p_doc bigint, p_cap bigint, p_stmt bigint, p_action text) returns text language sql immutable as $$
  select format('select fn_record_supplier_document_access(%L::uuid, %s, %s, %s, %L)',
    p_co, coalesce(p_doc::text, 'null'), coalesce(p_cap::text, 'null'), coalesce(p_stmt::text, 'null'), p_action)
$$;

create temp table sd3b_state as select pg_temp.accounting_fingerprint() as accounting_before;
grant select on sd3b_state to authenticated, service_role, anon;

-- =====================================================================
-- G. Explicit grants
-- =====================================================================
select pg_temp.ok(
  not has_table_privilege('anon', 'supplier_document_access_events', 'select')
  and not has_table_privilege('anon', 'supplier_document_access_events', 'insert')
  and not has_table_privilege('anon', 'supplier_document_access_events', 'update')
  and not has_table_privilege('anon', 'supplier_document_access_events', 'delete')
  and not has_table_privilege('anon', 'supplier_document_access_events', 'truncate'),
  'G1 anon has no privilege at all on the access audit');
select pg_temp.ok(
  has_table_privilege('authenticated', 'supplier_document_access_events', 'select')
  and not has_table_privilege('authenticated', 'supplier_document_access_events', 'insert')
  and not has_table_privilege('authenticated', 'supplier_document_access_events', 'update')
  and not has_table_privilege('authenticated', 'supplier_document_access_events', 'delete')
  and not has_table_privilege('authenticated', 'supplier_document_access_events', 'truncate')
  and not has_table_privilege('authenticated', 'supplier_document_access_events', 'references')
  and not has_table_privilege('authenticated', 'supplier_document_access_events', 'trigger'),
  'G2 signed-in users may only SELECT (RLS decides which rows)');
select pg_temp.ok(
  has_table_privilege('service_role', 'supplier_document_access_events', 'select')
  and not has_table_privilege('service_role', 'supplier_document_access_events', 'insert')
  and not has_table_privilege('service_role', 'supplier_document_access_events', 'update')
  and not has_table_privilege('service_role', 'supplier_document_access_events', 'delete')
  and not has_table_privilege('service_role', 'supplier_document_access_events', 'truncate'),
  'G3 the service role may read the audit but cannot write it directly');
select pg_temp.ok(
  (select relrowsecurity from pg_class where oid = 'supplier_document_access_events'::regclass),
  'G4 row level security is enabled on the access audit');
select pg_temp.ok(
  has_function_privilege('authenticated', 'fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text)', 'execute')
  and not has_function_privilege('anon', 'fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text)', 'execute')
  and not has_function_privilege('service_role', 'fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text)', 'execute'),
  'G5 only signed-in users can call the writer (not anon; not the service role, which has no user to record)');
select pg_temp.ok(
  not has_function_privilege('anon', 'fn_supplier_document_access_events_stamp()', 'execute')
  and not has_function_privilege('authenticated', 'fn_supplier_document_access_events_stamp()', 'execute')
  and not has_function_privilege('service_role', 'fn_supplier_document_access_events_stamp()', 'execute')
  and not has_function_privilege('anon', 'fn_supplier_document_access_events_immutable()', 'execute')
  and not has_function_privilege('authenticated', 'fn_supplier_document_access_events_immutable()', 'execute')
  and not has_function_privilege('service_role', 'fn_supplier_document_access_events_immutable()', 'execute'),
  'G6 the trigger functions are not callable by any API role');
select pg_temp.ok(
  has_function_privilege('authenticated', 'fn_storage_object_is_audited_original(text)', 'execute')
  and has_function_privilege('service_role', 'fn_storage_object_is_audited_original(text)', 'execute')
  and not has_function_privilege('anon', 'fn_storage_object_is_audited_original(text)', 'execute'),
  'G7 the storage predicate is callable by signed-in users (the policy needs it) but not by anon');
select pg_temp.ok(
  has_function_privilege('authenticated', 'fn_document_is_audited_original(bigint)', 'execute')
  and has_function_privilege('service_role', 'fn_document_is_audited_original(bigint)', 'execute')
  and not has_function_privilege('anon', 'fn_document_is_audited_original(bigint)', 'execute'),
  'G7b the document-id predicate likewise (the generic document routes call it)');
select pg_temp.ok(
  (select prosecdef from pg_proc where oid = 'fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text)'::regprocedure)
  and (select proconfig::text like '%search_path=public, pg_temp%' from pg_proc where oid = 'fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text)'::regprocedure),
  'G8 the writer is SECURITY DEFINER with a pinned search_path');

-- =====================================================================
-- W. The writer
-- =====================================================================
select pg_temp.as_user('viewer');
select pg_temp.ok(fn_record_supplier_document_access(pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), null, 'view') > 0,
  'W1 a user with Purchasing:View records a VIEW of a capture original');
select pg_temp.ok(fn_record_supplier_document_access(pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), null, 'download') > 0,
  'W2 ... and a DOWNLOAD');
select pg_temp.as_admin();
select pg_temp.ok((
  select count(*) = 2
     and bool_and(company_id = pg_temp.co_a())
     and bool_and(document_id = pg_temp.doc('a-cap1.pdf'))
     and bool_and(capture_id = pg_temp.cap('a-cap1.pdf'))
     and bool_and(statement_id is null)
     and bool_and(actor_user_id = pg_temp.uid('viewer'))
     and bool_and(actor_label = pg_temp.email('viewer'))
     and bool_and(occurred_at = now())
     and array_agg(action order by id) = array['view', 'download']
  from supplier_document_access_events),
  'W3 each row holds company, document, capture, action, the session user (id + email) and the time');

-- =====================================================================
-- A. The actor cannot be supplied or spoofed
-- =====================================================================
select pg_temp.ok((
  select not exists (
    select 1 from unnest(proargnames) n
    where n ilike '%actor%' or n ilike '%user%' or n ilike '%performed%' or n ilike '%by%')
  from pg_proc where oid = 'fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text)'::regprocedure),
  'A1 the writer has no parameter through which a caller could name an actor');
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_document_access_events (company_id, document_id, capture_id, action, actor_user_id, actor_label) values (%L, %s, %s, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), 'view', pg_temp.uid('viewer2'), pg_temp.email('viewer2'))) like '%permission denied%',
  'A2 a signed-in user cannot insert an audit row directly (and so cannot name another actor)');
select pg_temp.as_service();
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_document_access_events (company_id, document_id, capture_id, action, actor_user_id, actor_label) values (%L, %s, %s, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), 'view', pg_temp.uid('viewer2'), pg_temp.email('viewer2'))) like '%permission denied%',
  'A3 the service role cannot insert one directly either');
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), null, 'view')) like '%permission denied%',
  'A4 the service role cannot call the writer (it has no session user to record)');
-- Even the table owner, inserting directly while a session is present,
-- gets the SESSION's actor, not the one it wrote.
select pg_temp.as_admin();
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated","email":"%s"}', pg_temp.uid('viewer'), pg_temp.email('viewer')), true);
select set_config('request.jwt.claim.sub', pg_temp.uid('viewer')::text, true);
insert into supplier_document_access_events (company_id, document_id, capture_id, action, actor_user_id, actor_label, occurred_at)
values (pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), 'view', pg_temp.uid('viewer2'), 'forged@synthetic.test', timestamptz '2001-01-01');
select pg_temp.ok((
  select actor_user_id = pg_temp.uid('viewer') and actor_label = pg_temp.email('viewer') and occurred_at = now()
  from supplier_document_access_events order by id desc limit 1),
  'A5 a privileged insert naming another actor and a back-dated time is re-stamped with the session''s actor and now()');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_document_access_events (company_id, document_id, capture_id, action, actor_user_id, actor_label) values (%L, %s, %s, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), 'view', pg_temp.uid('viewer2'), 'forged')) like '%signed-in user%',
  'A6 with no session at all, not even the owner can write an audit row');
select pg_temp.as_anon();
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), null, 'view')) like '%permission denied%',
  'A7 anon cannot call the writer');

-- =====================================================================
-- P. Permissions and company isolation
-- =====================================================================
select pg_temp.as_admin();
create temp table sd3b_count as select pg_temp.events() as n;
grant select on sd3b_count to authenticated, service_role, anon;

select pg_temp.as_user('member');
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), null, 'view')) like '%Purchasing:View is required%',
  'P1 a company member WITHOUT Purchasing:View cannot record (so the viewer will not serve) a view');
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), null, 'download')) like '%Purchasing:View is required%',
  'P2 ... nor a download');
select pg_temp.as_user('owner_b');
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), null, 'view')) like '%Purchasing:View is required%',
  'P3 another company''s owner cannot record against company A, whatever they hold at home');
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_b(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), null, 'download')) like '%is not the original of capture%',
  'P4 ... nor reach company A''s document by naming their own company in the call');
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_b(), pg_temp.doc('b-cap.pdf'), pg_temp.cap('a-cap1.pdf'), null, 'view')) like '%is not the original of capture%',
  'P5 ... nor pair their own document with company A''s capture');
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_a(), pg_temp.doc('a-cap2.pdf'), pg_temp.cap('a-cap1.pdf'), null, 'view')) like '%is not the original of capture%',
  'P6 a document that is not the named capture''s original is refused, even within the same company');
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_a(), pg_temp.doc('a-plain.pdf'), pg_temp.cap('a-cap1.pdf'), null, 'view')) like '%is not the original of capture%',
  'P7 an ordinary company document cannot be passed off as a capture original');
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_a(), pg_temp.doc('b-cap.pdf'), pg_temp.cap('b-cap.pdf'), null, 'view')) like '%is not the original of capture%',
  'P8 a company A viewer cannot record (and so cannot be served) company B''s original');
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), null, 'print')) like '%view or download%',
  'P9 the action must be view or download');
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), null, null, 'view')) like '%exactly one capture or one statement%',
  'P10 an access must name a capture or a statement');
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), 1, 'view')) like '%exactly one capture or one statement%',
  'P11 ... and not both');
select pg_temp.as_user('viewer2');
select pg_temp.ok(fn_record_supplier_document_access(pg_temp.co_a(), pg_temp.doc('a-cap2.pdf'), pg_temp.cap('a-cap2.pdf'), null, 'view') > 0,
  'P12 any Purchasing:View holder can record their own view, of a capture in any state');
select pg_temp.as_user('owner_b');
select pg_temp.ok(fn_record_supplier_document_access(pg_temp.co_b(), pg_temp.doc('b-cap.pdf'), pg_temp.cap('b-cap.pdf'), null, 'download') > 0,
  'P13 company B records against its own original normally');

-- =====================================================================
-- F. A refused write records nothing
-- =====================================================================
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.events() = (select n from sd3b_count) + 2,
  'F1 of all the calls in P, only the two permitted ones (P12, P13) left a row: every refusal recorded nothing');
-- A failure inside the insert itself (here: no session user reaching the
-- stamp) rolls the whole call back too.
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_document_access_events (company_id, document_id, capture_id, action, actor_user_id, actor_label) values (%L, %s, %s, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), 'view', pg_temp.uid('viewer'), 'x')) is not null
  and pg_temp.events() = (select n from sd3b_count) + 2,
  'F2 a write that fails part-way leaves no row behind');
-- A capture that does not exist.
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), -1, null, 'view')) like '%is not the original of capture%',
  'F3 an unknown capture is refused (the viewer then serves nothing)');

-- =====================================================================
-- R. Reading the audit
-- =====================================================================
select pg_temp.as_user('viewer2');
select pg_temp.ok((select count(*) from supplier_document_access_events) > 0
              and not exists (select 1 from supplier_document_access_events where company_id <> pg_temp.co_a()),
  'R1 a Purchasing:View holder reads their company''s access history (everyone''s, not only their own) and nothing else');
select pg_temp.as_user('member');
select pg_temp.ok((select count(*) from supplier_document_access_events) = 0,
  'R2 a member without Purchasing:View reads none of it');
select pg_temp.as_user('owner_b');
select pg_temp.ok((select count(*) from supplier_document_access_events) = 1
              and (select company_id from supplier_document_access_events) = pg_temp.co_b(),
  'R3 another company sees only its own');
select pg_temp.as_anon();
select pg_temp.ok(pg_temp.err('select count(*) from supplier_document_access_events') like '%permission denied%',
  'R4 anon cannot read it');

-- =====================================================================
-- I. Immutability
-- =====================================================================
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.affected('update supplier_document_access_events set action = ''view''') = -1,
  'I1 a signed-in user cannot edit an audit row');
select pg_temp.ok(pg_temp.affected('delete from supplier_document_access_events') = -1,
  'I2 ... or delete one');
select pg_temp.ok(pg_temp.err('truncate supplier_document_access_events') like '%permission denied%',
  'I3 ... or truncate the table');
select pg_temp.as_service();
select pg_temp.ok(pg_temp.affected('update supplier_document_access_events set action = ''view''') = -1
              and pg_temp.affected('delete from supplier_document_access_events') = -1
              and pg_temp.err('truncate supplier_document_access_events') is not null,
  'I4 the service role cannot edit, delete or truncate it either');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.err(format('update supplier_document_access_events set actor_label = %L', 'rewritten')) like '%cannot be modified%',
  'I5 not even the table owner can rewrite an actor');
select pg_temp.ok(pg_temp.err('delete from supplier_document_access_events') like '%cannot be deleted%',
  'I6 ... or delete a recorded access');
select pg_temp.ok(pg_temp.err('truncate supplier_document_access_events') like '%cannot be truncated%',
  'I7 ... or truncate the history');
select pg_temp.ok(pg_temp.err(format('delete from documents where id = %s', pg_temp.doc('a-cap1.pdf'))) is not null
              and exists (select 1 from documents where id = pg_temp.doc('a-cap1.pdf'))
              and exists (select 1 from pg_constraint
                          where conrelid = 'supplier_document_access_events'::regclass
                            and confrelid = 'documents'::regclass and contype = 'f' and confdeltype = 'a'),
  'I8 a viewed original cannot be deleted out from under its audit trail (retention, and the audit''s own NO ACTION key)');
select pg_temp.ok(pg_temp.affected(format('delete from companies where id = %L', pg_temp.co_b())) = 1,
  'I9 deleting a whole company still works (its audit goes with it, through the cascade)');

-- =====================================================================
-- T. Statement-original foundation
-- =====================================================================
select pg_temp.ok(
  exists (select 1 from information_schema.columns where table_name = 'supplier_document_access_events' and column_name = 'statement_id')
  and exists (select 1 from pg_constraint where conname = 'supplier_document_access_events_one_subject'),
  'T1 the audit already has a statement reference, with exactly-one-subject enforced');
select pg_temp.as_user('viewer');
-- (0114 replaced the writer: statements are now accepted, but only the
-- named statement's own original, in that company.)
select pg_temp.ok(pg_temp.err(pg_temp.rec(pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), null, -1, 'view')) ~ '(not available yet|not the original of statement)',
  'T2 a statement access naming no real statement of this document is refused (fail closed, nothing recorded)');
select pg_temp.as_admin();
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated","email":"%s"}', pg_temp.uid('viewer'), pg_temp.email('viewer')), true);
select set_config('request.jwt.claim.sub', pg_temp.uid('viewer')::text, true);
select pg_temp.ok(pg_temp.err(format(
  'insert into supplier_document_access_events (company_id, document_id, capture_id, statement_id, action, actor_user_id, actor_label) values (%L, %s, %s, 1, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.doc('a-cap1.pdf'), pg_temp.cap('a-cap1.pdf'), 'view', pg_temp.uid('viewer'), 'x')) like '%one_subject%',
  'T3 a row naming both a capture and a statement is impossible at the table itself');

-- =====================================================================
-- S. Storage
-- =====================================================================
select pg_temp.as_user('viewer');
select pg_temp.ok((select count(*) from storage.objects where name = pg_temp.co_a() || '/Supplier/0/a-cap1.pdf') = 0,
  'S1 a capture original cannot be read directly from the Storage API, even with Purchasing:View');
select pg_temp.ok((select count(*) from storage.objects where name = pg_temp.co_a() || '/Supplier/0/a-plain.pdf') = 1,
  'S2 every other company document is still readable exactly as before');
select pg_temp.as_user('member');
select pg_temp.ok((select count(*) from storage.objects where name = pg_temp.co_a() || '/Supplier/0/a-cap2.pdf') = 0,
  'S3 the gap 0113 closes: a member with NO Purchasing permission could read originals directly; now cannot');
select pg_temp.as_admin();
select pg_temp.ok(fn_storage_object_is_audited_original(pg_temp.co_a() || '/Supplier/0/a-cap1.pdf')
              and not fn_storage_object_is_audited_original(pg_temp.co_a() || '/Supplier/0/a-plain.pdf'),
  'S4 the predicate marks exactly the capture originals');
select pg_temp.ok(fn_document_is_audited_original(pg_temp.doc('a-cap1.pdf'))
              and not fn_document_is_audited_original(pg_temp.doc('a-plain.pdf')),
  'S5 ... and so does the by-id predicate the application uses');

-- =====================================================================
-- H. Accounting untouched
-- =====================================================================
select pg_temp.ok((select accounting_before from sd3b_state) = pg_temp.accounting_fingerprint(),
  'H1 journals, ledger, bills, bill lines, supplier payments and allocations are byte-for-byte unchanged');

rollback;
