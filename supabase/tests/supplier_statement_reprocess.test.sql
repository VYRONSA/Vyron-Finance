-- Phase SD-3G — database tests for migration 0118 (statement reprocess).
--
-- LOCAL / SYNTHETIC DATA ONLY. One transaction, rolled back at the end.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/supplier_statement_reprocess.test.sql
--
-- Sections:
--   G  grants: the access recorder stays signed-in-users only
--   A  the 'reprocess' access: statements only, Purchasing:Edit, the statement's
--      own original, actor from the session; view/download unchanged
--   E  the 'Reprocessed' event: written by the server; a user cannot forge it
--   H  accounting untouched

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
  raise exception 'SD3G_RP_TEST_ROLLBACK';
exception when others then
  if sqlerrm = 'SD3G_RP_TEST_ROLLBACK' then return null; end if;
  raise notice '  (error: %)', sqlerrm;
  return sqlerrm;
end $$;
create function pg_temp.run(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  raise notice '  (error: %)', sqlerrm;
  return sqlerrm;
end $$;

create function pg_temp.co_a() returns uuid language sql immutable as $$ select '5f400000-0000-4000-8000-0000000004a1'::uuid $$;
create function pg_temp.uid(p_name text) returns uuid language sql immutable as $$
  select (case p_name when 'editor' then '5f400000-0000-4000-8000-000000000401' when 'viewer' then '5f400000-0000-4000-8000-000000000402' end)::uuid
$$;
create function pg_temp.email(p_name text) returns text language sql immutable as $$ select 'sd3g-rp-' || p_name || '@synthetic.test' $$;
create function pg_temp.hash(p_name text) returns text language sql immutable as $$ select encode(sha256(convert_to(p_name, 'UTF8')), 'hex') $$;
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
create function pg_temp.accounting_fingerprint() returns text language sql security definer as $$
  select md5(
    coalesce((select string_agg(j::text, '|' order by j.id) from ae_journals j), '') || '#' ||
    coalesce((select string_agg(l::text, '|' order by l.id) from ae_journal_lines l), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from gl_transactions g), '') || '#' ||
    coalesce((select string_agg(b::text, '|' order by b.id) from ae_imported_bills b), '') || '#' ||
    coalesce((select string_agg(s::text, '|' order by s.id) from supplier_payments s), '') || '#' ||
    coalesce((select string_agg(a::text, '|' order by a.id) from supplier_payment_allocations a), '') || '#' ||
    coalesce((select string_agg(t::text, '|' order by t.id) from ae_bank_transactions t), '') || '#' ||
    coalesce((select string_agg(x::text, '|' order by x.id) from ae_suppliers x), '') || '#' ||
    coalesce((select string_agg(d::text, '|' order by d.id) from documents d), ''))
$$;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select pg_temp.uid(n), pg_temp.email(n), 'authenticated', 'authenticated' from unnest(array['editor', 'viewer']) n;
insert into organisations (id, name) values ('5f400000-0000-4000-8000-0000000004aa', 'SD3G RP Org');
insert into companies (id, organisation_id, name, base_currency_code) values (pg_temp.co_a(), '5f400000-0000-4000-8000-0000000004aa', 'SD3G RP Company', 'ZAR');
insert into permission_roles (company_id, role_key, name) values (pg_temp.co_a(), 'rp_editor', 'e'), (pg_temp.co_a(), 'rp_viewer', 'v');
insert into role_permissions (role_id, permission_key)
select pr.id, 'Purchasing:' || a from permission_roles pr
cross join lateral unnest(case pr.role_key when 'rp_editor' then array['View', 'Edit'] else array['View'] end) a
where pr.role_key like 'rp_%';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.uid(replace(pr.role_key, 'rp_', '')), pr.company_id, pr.id, 'sd3g-rp-test' from permission_roles pr where pr.role_key like 'rp_%';

insert into documents (company_id, entity_type, entity_id, category, filename, storage_path, mime_type, size_bytes, uploaded_by, content_sha256)
select pg_temp.co_a(), 'Supplier', 0, 'Statement', f, pg_temp.co_a() || '/Supplier/0/' || f, 'application/pdf', 1, 'fixture', pg_temp.hash(f)
from unnest(array['rp-gourmet.pdf', 'rp-other.pdf']) f;
create function pg_temp.doc(p text) returns bigint language sql security definer as $$ select id from documents where filename = p $$;
insert into supplier_statements (company_id, document_id, content_sha256, source_type, status, uploaded_by)
values (pg_temp.co_a(), pg_temp.doc('rp-gourmet.pdf'), pg_temp.hash('rp-gourmet.pdf'), 'pdf-text', 'NeedsReview', 'f'),
       (pg_temp.co_a(), pg_temp.doc('rp-other.pdf'), pg_temp.hash('rp-other.pdf'), 'pdf-text', 'NeedsReview', 'f');
create function pg_temp.st(p text) returns bigint language sql security definer as $$ select s.id from supplier_statements s join documents d on d.id = s.document_id where d.filename = p $$;

create function pg_temp.access_sql(p_document text, p_statement text, p_action text, p_capture bigint default null) returns text language sql immutable as $$
  select format('select fn_record_supplier_document_access(%L, %s, %s, %s, %L)', pg_temp.co_a(), pg_temp.doc(p_document),
    coalesce(p_capture::text, 'null'), case when p_statement is null then 'null' else pg_temp.st(p_statement)::text end, p_action)
$$;

create temp table rp_state as select pg_temp.accounting_fingerprint() as before;
grant select on rp_state to authenticated, service_role;

-- =====================================================================
-- G. Grants
-- =====================================================================
select pg_temp.ok(has_function_privilege('authenticated', 'fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text)', 'execute')
  and not has_function_privilege('anon', 'fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text)', 'execute')
  and not has_function_privilege('service_role', 'fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text)', 'execute'),
  'G1 the access recorder is still for signed-in users only (it needs a session actor)');

-- =====================================================================
-- A. The 'reprocess' access
-- =====================================================================
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.run(pg_temp.access_sql('rp-gourmet.pdf', 'rp-gourmet.pdf', 'reprocess')) is null,
  'A1 a reviewer with Purchasing:Edit records a reprocess of the statement''s own original');
select pg_temp.as_admin();
select pg_temp.ok((select action = 'reprocess' and actor_user_id = pg_temp.uid('editor') and actor_label = pg_temp.email('editor') and statement_id = pg_temp.st('rp-gourmet.pdf') and capture_id is null
  from supplier_document_access_events order by id desc limit 1),
  'A2 … recorded permanently with the session''s actor, the statement and the document');
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.err(pg_temp.access_sql('rp-gourmet.pdf', 'rp-gourmet.pdf', 'reprocess')) like '%Purchasing:Edit is required%',
  'A3 a view-only user cannot reprocess');
select pg_temp.ok(pg_temp.run(pg_temp.access_sql('rp-gourmet.pdf', 'rp-gourmet.pdf', 'view')) is null,
  'A4 … but can still view (view/download unchanged)');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(pg_temp.access_sql('rp-gourmet.pdf', null, 'reprocess', 1)) like '%only a supplier statement can be reprocessed%',
  'A5 a capture (invoice) cannot be "reprocessed" through this action');
select pg_temp.ok(pg_temp.err(pg_temp.access_sql('rp-other.pdf', 'rp-gourmet.pdf', 'reprocess')) like '%is not the original of statement%',
  'A6 only the statement''s OWN original can be reprocessed');
select pg_temp.ok(pg_temp.err(pg_temp.access_sql('rp-gourmet.pdf', 'rp-gourmet.pdf', 'replace')) like '%view, download or reprocess%',
  'A7 no other access action exists (nothing replaces an original)');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.err('delete from supplier_document_access_events where action = ''reprocess''') is not null
  and (select count(*) from supplier_document_access_events where action = 'reprocess') = 1,
  'A8 the reprocess record cannot be deleted');
select pg_temp.ok(pg_temp.err(format('insert into supplier_document_access_events (company_id, document_id, statement_id, action, actor_user_id, actor_label) values (%L, %s, %s, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.doc('rp-gourmet.pdf'), pg_temp.st('rp-gourmet.pdf'), 'rewrite', pg_temp.uid('editor'), 'x')) is not null
  and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'supplier_document_access_events_action_check')
      = 'CHECK ((action = ANY (ARRAY[''view''::text, ''download''::text, ''reprocess''::text])))',
  'A9 the table itself refuses any other action (view, download, reprocess only)');

-- =====================================================================
-- E. The 'Reprocessed' event
-- =====================================================================
select pg_temp.as_service();
select pg_temp.ok(pg_temp.run(format('select fn_supplier_statement_record_system_event(%L, %s, %L, %L::jsonb, %L)', pg_temp.co_a(), pg_temp.st('rp-gourmet.pdf'), 'Reprocessed',
  '{"from":"NeedsReview","previous":{"transactions":473}}', pg_temp.email('editor'))) is null,
  'E1 the server records a Reprocessed event (with what it replaced)');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_statement_record_system_event(%L, %s, %L, %L::jsonb, %L)', pg_temp.co_a(), pg_temp.st('rp-gourmet.pdf'), 'Rewritten', '{}', 'x')) like '%event_type_check%',
  'E2 no other new event type exists');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_statement_record_event(%L, %s, %L, %L::jsonb)', pg_temp.co_a(), pg_temp.st('rp-gourmet.pdf'), 'Reprocessed', '{}')) is not null,
  'E3 a user cannot write a Reprocessed event directly');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.err('delete from supplier_statement_events where event_type = ''Reprocessed''') is not null,
  'E4 the Reprocessed event is permanent');

-- =====================================================================
-- H. Accounting untouched
-- =====================================================================
select pg_temp.ok(pg_temp.accounting_fingerprint() = (select before from rp_state),
  'H1 no journal, GL row, bill, payment, allocation, bank transaction, supplier or document changed');
select pg_temp.ok((select prosrc !~* '(insert|update|delete)\s+(into\s+)?(ae_journals|ae_journal_lines|gl_transactions|ae_imported_bills|supplier_payments|supplier_payment_allocations|ae_bank_transactions|documents)\b'
  from pg_proc where proname = 'fn_record_supplier_document_access'),
  'H2 the access recorder writes no accounting table and never a document');

rollback;
