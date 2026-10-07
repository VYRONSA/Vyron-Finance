-- Phase SD-3D — database tests for migration 0115 (supplier statement reconciliation).
--
-- LOCAL / SYNTHETIC DATA ONLY. One transaction, rolled back at the end.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/supplier_statement_reconciliation.test.sql
--
-- Sections:
--   G  explicit grants
--   R  a run can only be recorded for a ready statement, its CONFIRMED supplier,
--      base currency and its own figures — and D = S − P = Explained + Unexplained
--   I  runs, items and decisions are immutable
--   W  the decision writer: session actor, permission, state, same company,
--      same confirmed supplier, append-only revocation
--   S  'Reconciled' is the server's; a reconciled statement can be reopened
--   L  RLS: company isolation and permission-based reading
--   H  accounting untouched; no 0115 function writes an accounting table

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
  raise exception 'SD3D_TEST_ROLLBACK';
exception when others then
  if sqlerrm = 'SD3D_TEST_ROLLBACK' then return null; end if;
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

create function pg_temp.co_a() returns uuid language sql immutable as $$ select '5e000000-0000-4000-8000-0000000005a1'::uuid $$;
create function pg_temp.co_b() returns uuid language sql immutable as $$ select '5e000000-0000-4000-8000-0000000005b1'::uuid $$;
create function pg_temp.uid(p_name text) returns uuid language sql immutable as $$
  select (case p_name
    when 'member' then '5e000000-0000-4000-8000-000000000501'
    when 'viewer' then '5e000000-0000-4000-8000-000000000502'
    when 'editor' then '5e000000-0000-4000-8000-000000000504'
    when 'owner_b' then '5e000000-0000-4000-8000-000000000507'
  end)::uuid
$$;
create function pg_temp.email(p_name text) returns text language sql immutable as $$ select 'sd3d-' || p_name || '@synthetic.test' $$;
create function pg_temp.hash(p_name text) returns text language sql immutable as $$ select encode(sha256(convert_to(p_name, 'UTF8')), 'hex') $$;
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
    coalesce((select string_agg(o::text, '|' order by o.id) from opening_balance_entries o), '') || '#' ||
    coalesce((select string_agg(x::text, '|' order by x.id) from ae_suppliers x), ''))
$$;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select pg_temp.uid(n), pg_temp.email(n), 'authenticated', 'authenticated' from unnest(array['member','viewer','editor','owner_b']) n;
insert into organisations (id, name) values ('5e000000-0000-4000-8000-0000000005aa', 'SD3D Org A'), ('5e000000-0000-4000-8000-0000000005bb', 'SD3D Org B');
insert into companies (id, organisation_id, name, base_currency_code) values
  (pg_temp.co_a(), '5e000000-0000-4000-8000-0000000005aa', 'SD3D Company A', 'ZAR'),
  (pg_temp.co_b(), '5e000000-0000-4000-8000-0000000005bb', 'SD3D Company B', 'ZAR');
insert into permission_roles (company_id, role_key, name) values
  (pg_temp.co_a(), 'sd3d_member', 'm'), (pg_temp.co_a(), 'sd3d_viewer', 'v'), (pg_temp.co_a(), 'sd3d_editor', 'e'), (pg_temp.co_b(), 'sd3d_owner_b', 'o');
insert into role_permissions (role_id, permission_key)
select pr.id, 'Purchasing:' || a from permission_roles pr
cross join lateral unnest(case pr.role_key when 'sd3d_viewer' then array['View'] when 'sd3d_editor' then array['View','Edit']
  when 'sd3d_owner_b' then array['View','Create','Edit','Reject','Approve'] else array[]::text[] end) a
where pr.role_key like 'sd3d_%';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.uid(replace(pr.role_key, 'sd3d_', '')), pr.company_id, pr.id, 'sd3d-test' from permission_roles pr where pr.role_key like 'sd3d_%';

insert into ae_suppliers (company_id, name, supplier_code) values
  (pg_temp.co_a(), 'Recon Supplier A', 'RSA'), (pg_temp.co_a(), 'Recon Supplier A2', 'RSA2'), (pg_temp.co_b(), 'Recon Supplier B', 'RSB');
create function pg_temp.sup(p text) returns bigint language sql security definer as $$ select id from ae_suppliers where supplier_code = p $$;

insert into ae_imported_bills (company_id, supplier_id, supplier_name, invoice_number, invoice_date, total, document_type, origin, posting_status)
values (pg_temp.co_a(), pg_temp.sup('RSA'), 'Recon Supplier A', '0001042', date '2026-09-03', 100, 'Bill', 'Purchasing', 'Posted'),
       (pg_temp.co_a(), pg_temp.sup('RSA2'), 'Recon Supplier A2', 'OTHER-1', date '2026-09-03', 50, 'Bill', 'Purchasing', 'Posted'),
       (pg_temp.co_b(), pg_temp.sup('RSB'), 'Recon Supplier B', 'B-1', date '2026-09-03', 70, 'Bill', 'Purchasing', 'Posted');
create function pg_temp.bill(p text) returns bigint language sql security definer as $$ select id from ae_imported_bills where invoice_number = p $$;
insert into supplier_payments (company_id, supplier_id, payment_number, payment_date, amount, status)
values (pg_temp.co_a(), pg_temp.sup('RSA'), 'SP-1', date '2026-09-10', 40, 'Posted');

insert into documents (company_id, entity_type, entity_id, category, filename, storage_path, mime_type, size_bytes, uploaded_by, content_sha256)
select c, 'Supplier', 0, 'Statement', f, c || '/Supplier/0/' || f, 'application/pdf', 1, 'fixture', pg_temp.hash(f)
from (values (pg_temp.co_a(), 'r-ready.pdf'), (pg_temp.co_a(), 'r-review.pdf'), (pg_temp.co_a(), 'r-unconf.pdf'), (pg_temp.co_a(), 'r-usd.pdf'), (pg_temp.co_b(), 'r-b.pdf')) t(c, f);
create function pg_temp.doc(p text) returns bigint language sql security definer as $$ select id from documents where filename = p $$;

insert into supplier_statements (company_id, document_id, content_sha256, source_type, status, uploaded_by, statement_date, opening_balance, closing_balance,
  validation_status, supplier_id, supplier_confirmed_by, supplier_confirmed_at, currency_code)
values
  (pg_temp.co_a(), pg_temp.doc('r-ready.pdf'), pg_temp.hash('r-ready.pdf'), 'pdf-text', 'Ready', 'f', date '2026-09-30', 0, 100, 'Pass', pg_temp.sup('RSA'), 'reviewer', now(), null),
  (pg_temp.co_a(), pg_temp.doc('r-review.pdf'), pg_temp.hash('r-review.pdf'), 'pdf-text', 'NeedsReview', 'f', date '2026-09-30', 0, 100, 'Pass', pg_temp.sup('RSA'), 'reviewer', now(), null),
  (pg_temp.co_a(), pg_temp.doc('r-unconf.pdf'), pg_temp.hash('r-unconf.pdf'), 'pdf-text', 'Ready', 'f', date '2026-09-30', 0, 100, 'Pass', pg_temp.sup('RSA'), null, null, null),
  (pg_temp.co_a(), pg_temp.doc('r-usd.pdf'), pg_temp.hash('r-usd.pdf'), 'pdf-text', 'Ready', 'f', date '2026-09-30', 0, 100, 'Pass', pg_temp.sup('RSA'), 'reviewer', now(), 'USD'),
  (pg_temp.co_b(), pg_temp.doc('r-b.pdf'), pg_temp.hash('r-b.pdf'), 'pdf-text', 'Ready', 'f', date '2026-09-30', 0, 70, 'Pass', pg_temp.sup('RSB'), 'reviewer', now(), null);
create function pg_temp.st(p text) returns bigint language sql security definer as $$ select s.id from supplier_statements s join documents d on d.id = s.document_id where d.filename = p $$;
create function pg_temp.status(p text) returns text language sql security definer as $$ select status from supplier_statements where id = pg_temp.st(p) $$;

insert into supplier_statement_lines (company_id, statement_id, line_order, transaction_date, reference_text, transaction_type, debit)
values (pg_temp.co_a(), pg_temp.st('r-ready.pdf'), 1, date '2026-09-03', '0001042', 'invoice', 100),
       (pg_temp.co_a(), pg_temp.st('r-review.pdf'), 1, date '2026-09-03', '0001042', 'invoice', 100),
       (pg_temp.co_b(), pg_temp.st('r-b.pdf'), 1, date '2026-09-03', 'B-1', 'invoice', 70);
create function pg_temp.line(p text) returns bigint language sql security definer as $$ select id from supplier_statement_lines where statement_id = pg_temp.st(p) and line_order = 1 $$;

-- A run as the server would record it.
create function pg_temp.run_sql(p_statement text, p_supplier text, p_closing numeric, p_d numeric, p_e numeric, p_u numeric) returns text language sql immutable as $$
  select format($f$insert into supplier_statement_reconciliations (company_id, statement_id, run_number, engine_version, basis, supplier_id, as_at_date,
    window_from, window_to, statement_opening, statement_closing, precisia_balance_before_window, precisia_balance_at, difference, explained_amount,
    explained_by_reviewer_amount, unexplained_amount, category_summary, input_snapshot, input_fingerprint, created_by)
    select s.company_id, s.id, (select coalesce(max(run_number), 0) + 1 from supplier_statement_reconciliations where statement_id = s.id), 'sd3d-1',
      'supplier-ledger-document-date', pg_temp.sup(%L), date '2026-09-30', date '2026-09-01', date '2026-09-30', 0, %s, 0, %s - %s, %s, %s, 0, %s,
      '{}', '{}', repeat('a', 64), 'server'
    from supplier_statements s where s.id = pg_temp.st(%L)$f$, p_supplier, p_closing, p_closing, p_d, p_d, p_e, p_u, p_statement)
$$;

create temp table sd3d_state as select pg_temp.accounting_fingerprint() as before;
grant select on sd3d_state to authenticated, service_role, anon;

-- =====================================================================
-- G. Grants
-- =====================================================================
select pg_temp.ok((select bool_and(not has_table_privilege('anon', t, p)) from unnest(array['supplier_statement_reconciliations','supplier_statement_reconciliation_items','supplier_statement_resolutions']) t,
  unnest(array['select','insert','update','delete','truncate']) p), 'G1 anon has nothing on any reconciliation table');
select pg_temp.ok((select bool_and(has_table_privilege('authenticated', t, 'select') and not has_table_privilege('authenticated', t, 'insert')
  and not has_table_privilege('authenticated', t, 'update') and not has_table_privilege('authenticated', t, 'delete') and not has_table_privilege('authenticated', t, 'truncate'))
  from unnest(array['supplier_statement_reconciliations','supplier_statement_reconciliation_items','supplier_statement_resolutions']) t),
  'G2 signed-in users can only READ runs, items and decisions');
select pg_temp.ok(has_table_privilege('service_role', 'supplier_statement_reconciliations', 'insert') and has_table_privilege('service_role', 'supplier_statement_reconciliation_items', 'insert')
  and not has_table_privilege('service_role', 'supplier_statement_reconciliations', 'update') and not has_table_privilege('service_role', 'supplier_statement_reconciliations', 'delete')
  and not has_table_privilege('service_role', 'supplier_statement_resolutions', 'insert'),
  'G3 the server inserts runs/items only (never updates or deletes); decisions only via their writer');
select pg_temp.ok(has_function_privilege('authenticated', 'fn_supplier_statement_record_resolution(uuid,bigint,text,bigint,text,bigint,bigint,text)', 'execute')
  and not has_function_privilege('anon', 'fn_supplier_statement_record_resolution(uuid,bigint,text,bigint,text,bigint,bigint,text)', 'execute')
  and not has_function_privilege('service_role', 'fn_supplier_statement_record_resolution(uuid,bigint,text,bigint,text,bigint,bigint,text)', 'execute'),
  'G4 the decision writer: signed-in users only (it needs a session actor)');
select pg_temp.ok((select bool_and(not has_function_privilege(r, f, 'execute')) from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['fn_supplier_statement_reconciliation_immutable()','fn_supplier_statement_reconciliation_insert_guard()','fn_supplier_statement_reconciliation_item_guard()']) f),
  'G5 trigger functions are callable by no API role');
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where oid in ('supplier_statement_reconciliations'::regclass, 'supplier_statement_reconciliation_items'::regclass, 'supplier_statement_resolutions'::regclass)),
  'G6 RLS on every reconciliation table');

-- =====================================================================
-- R. Recording runs
-- =====================================================================
select pg_temp.as_service();
select pg_temp.ok(pg_temp.run(pg_temp.run_sql('r-ready.pdf', 'RSA', 100, 0, 0, 0)) is null, 'R1 the server records a run for a Ready statement and its confirmed supplier');
select pg_temp.ok(pg_temp.err(pg_temp.run_sql('r-review.pdf', 'RSA', 100, 0, 0, 0)) like '%only a ready statement%', 'R2 refused for a statement still in review');
select pg_temp.ok(pg_temp.err(pg_temp.run_sql('r-unconf.pdf', 'RSA', 100, 0, 0, 0)) like '%CONFIRMED supplier%', 'R3 refused when the supplier was only proposed');
select pg_temp.ok(pg_temp.err(pg_temp.run_sql('r-ready.pdf', 'RSA2', 100, 0, 0, 0)) like '%CONFIRMED supplier%', 'R4 refused against any supplier other than the confirmed one');
select pg_temp.ok(pg_temp.err(pg_temp.run_sql('r-usd.pdf', 'RSA', 100, 0, 0, 0)) like '%unsupported currency%', 'R5 refused for an unsupported currency (no exchange rate is ever applied)');
select pg_temp.ok(pg_temp.err(pg_temp.run_sql('r-ready.pdf', 'RSA', 99, 0, 0, 0)) like '%own closing balance%', 'R6 refused unless the run uses the statement''s own closing balance');
select pg_temp.ok(pg_temp.err(pg_temp.run_sql('r-ready.pdf', 'RSA', 100, 10, 4, 5)) like '%identity%', 'R7 D = Explained + Unexplained is enforced to the cent (no hidden adjustment)');
select pg_temp.ok(pg_temp.err(replace(pg_temp.run_sql('r-ready.pdf', 'RSA', 100, 10, 10, 0), '100 - 10', '100 - 11')) like '%difference%', 'R8 D = S − P is enforced');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(pg_temp.run_sql('r-ready.pdf', 'RSA', 100, 0, 0, 0)) like '%permission denied%', 'R9 a user cannot write a run directly');
select pg_temp.as_service();
select pg_temp.ok(pg_temp.run(format($f$insert into supplier_statement_reconciliation_items (company_id, reconciliation_id, item_order, category, sub_status, effect_on_difference, explained, message)
  values (%L, (select max(id) from supplier_statement_reconciliations), 1, 'Matched', 'exact', 0, true, 'm')$f$, pg_temp.co_a())) is null, 'R10 the server records the run''s items');
select pg_temp.ok(pg_temp.err(format($f$insert into supplier_statement_reconciliation_items (company_id, reconciliation_id, item_order, category, sub_status, effect_on_difference, explained, message)
  values (%L, (select max(id) from supplier_statement_reconciliations), 2, 'Matched', 'exact', 0, true, 'm')$f$, pg_temp.co_b())) like '%does not belong%', 'R11 an item cannot be attached to another company''s run');
select pg_temp.ok(pg_temp.err(format($f$insert into supplier_statement_reconciliation_items (company_id, reconciliation_id, item_order, category, sub_status, effect_on_difference, explained, message)
  values (%L, (select max(id) from supplier_statement_reconciliations), 3, 'Balancing Adjustment', 'x', 0, true, 'm')$f$, pg_temp.co_a())) like '%category_check%', 'R12 there is no "adjustment" category — only the classifications');

-- =====================================================================
-- I. Immutability
-- =====================================================================
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.err('update supplier_statement_reconciliations set unexplained_amount = 0') like '%append-only%'
  and pg_temp.err('delete from supplier_statement_reconciliations') like '%append-only%'
  and pg_temp.err('truncate supplier_statement_reconciliations') is not null, 'I1 a run cannot be edited, deleted or truncated — not even by the owner');
select pg_temp.ok(pg_temp.err('update supplier_statement_reconciliation_items set explained = false') like '%append-only%'
  and pg_temp.err('delete from supplier_statement_reconciliation_items') like '%append-only%', 'I2 nor its items');

-- =====================================================================
-- W. Decisions
-- =====================================================================
create function pg_temp.res(p_co uuid, p_st text, p_action text, p_line bigint, p_type text, p_ref bigint, p_revokes bigint, p_reason text) returns text language sql as $$
  select format('select fn_supplier_statement_record_resolution(%L::uuid, %s, %L, %s, %L, %s, %s, %L)', p_co, pg_temp.st(p_st), p_action,
    coalesce(p_line::text, 'null'), p_type, coalesce(p_ref::text, 'null'), coalesce(p_revokes::text, 'null'), p_reason)
$$;
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.run(pg_temp.res(pg_temp.co_a(), 'r-ready.pdf', 'manual-link', pg_temp.line('r-ready.pdf'), 'bill', pg_temp.bill('0001042'), null, 'Supplier quotes our PO number')) is null,
  'W1 an editor links a line to the supplier''s bill, with a reason');
select pg_temp.as_admin();
select pg_temp.ok((select performed_by = pg_temp.email('editor') from supplier_statement_resolutions order by id desc limit 1), 'W2 the decision carries the session user');
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.err(pg_temp.res(pg_temp.co_a(), 'r-ready.pdf', 'explained', pg_temp.line('r-ready.pdf'), null, null, null, 'looks fine')) like '%Purchasing:Edit%', 'W3 view-only cannot record decisions');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(pg_temp.res(pg_temp.co_a(), 'r-ready.pdf', 'manual-link', pg_temp.line('r-ready.pdf'), 'bill', pg_temp.bill('OTHER-1'), null, 'wrong supplier')) like '%does not belong to this statement''s supplier%',
  'W4 a link to ANOTHER supplier''s bill is refused');
select pg_temp.ok(pg_temp.err(pg_temp.res(pg_temp.co_a(), 'r-ready.pdf', 'manual-link', pg_temp.line('r-ready.pdf'), 'bill', pg_temp.bill('B-1'), null, 'other company')) like '%does not belong%',
  'W5 a link to another company''s bill is refused');
select pg_temp.ok(pg_temp.err(pg_temp.res(pg_temp.co_a(), 'r-ready.pdf', 'explained', pg_temp.line('r-review.pdf'), null, null, null, 'other statement')) like '%not a transaction of this statement%',
  'W6 a line of another statement is refused');
select pg_temp.ok(pg_temp.err(pg_temp.res(pg_temp.co_a(), 'r-ready.pdf', 'explained', pg_temp.line('r-ready.pdf'), null, null, null, '  ')) like '%reason is required%', 'W7 a reason is required');
select pg_temp.ok(pg_temp.err(pg_temp.res(pg_temp.co_a(), 'r-review.pdf', 'explained', pg_temp.line('r-review.pdf'), null, null, null, 'early')) like '%ready or reconciled%', 'W8 decisions only on a ready or reconciled statement');
select pg_temp.ok(pg_temp.err(pg_temp.res(pg_temp.co_a(), 'r-unconf.pdf', 'explained', null, 'opening-difference', null, null, 'x y z')) like '%not confirmed%', 'W9 nor on one whose supplier is unconfirmed');
select pg_temp.ok(pg_temp.err(pg_temp.res(pg_temp.co_b(), 'r-b.pdf', 'explained', null, 'opening-difference', null, null, 'cross')) like '%Purchasing:Edit%', 'W10 nor in another company');
select pg_temp.ok(pg_temp.err(pg_temp.res(pg_temp.co_a(), 'r-ready.pdf', 'manual-link', pg_temp.line('r-ready.pdf'), null, null, null, 'no target')) like '%resolutions_shape%', 'W11 a link must name both sides');
select pg_temp.ok(pg_temp.run(pg_temp.res(pg_temp.co_a(), 'r-ready.pdf', 'explained', null, 'opening-difference', null, null, 'Pre-migration balance')) is null, 'W12 an explanation of the opening difference');
select pg_temp.ok(pg_temp.run(pg_temp.res(pg_temp.co_a(), 'r-ready.pdf', 'explained', null, 'supplier-payment', (select id from supplier_payments where payment_number = 'SP-1'), null, 'Paid after statement')) is null,
  'W13 an explanation of a PRECISIA record (the supplier''s own payment)');
select pg_temp.as_admin();
create temp table sd3d_res as select max(id) as last_id, min(id) as first_id from supplier_statement_resolutions;
grant select on sd3d_res to authenticated;
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.run(pg_temp.res(pg_temp.co_a(), 'r-ready.pdf', 'revoke', null, null, null, (select first_id from sd3d_res), 'Linked the wrong bill')) is null, 'W14 a decision is withdrawn by a revocation (a new row)');
select pg_temp.ok(pg_temp.err(pg_temp.res(pg_temp.co_a(), 'r-ready.pdf', 'revoke', null, null, null, (select first_id from sd3d_res), 'again')) like '%live decision%', 'W15 a revoked decision cannot be revoked twice');
select pg_temp.as_admin();
select pg_temp.ok((select count(*) = 4 and bool_or(action = 'revoke') from supplier_statement_resolutions where statement_id = pg_temp.st('r-ready.pdf'))
  and exists (select 1 from supplier_statement_resolutions where id = (select first_id from sd3d_res)), 'W16 the withdrawn decision is still there (history is kept)');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(pg_temp.res(pg_temp.co_a(), 'r-ready.pdf', 'revoke', null, null, null, (select max(id) from supplier_statement_resolutions), 'revoke the revoke')) like '%live decision%', 'W17 a revocation itself cannot be revoked');
select pg_temp.ok(pg_temp.err(format('insert into supplier_statement_resolutions (company_id, statement_id, action, reason, performed_by, precisia_ref_type) values (%L, %s, %L, %L, %L, %L)',
  pg_temp.co_a(), pg_temp.st('r-ready.pdf'), 'explained', 'forged', 'someone-else', 'opening-difference')) like '%permission denied%', 'W18 a decision cannot be inserted directly (and so cannot name another actor)');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.err('update supplier_statement_resolutions set reason = ''x''') like '%append-only%' and pg_temp.err('delete from supplier_statement_resolutions') like '%append-only%',
  'W19 decisions are immutable even for the owner');
select pg_temp.ok(pg_temp.err(format('delete from supplier_statement_lines where id = %s', pg_temp.line('r-ready.pdf'))) is not null, 'W20 a line carrying decisions cannot be deleted');

-- =====================================================================
-- S. Status
-- =====================================================================
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = ''Reconciled'' where id = %s', pg_temp.st('r-ready.pdf'))) like '%cannot be set by a user%', 'S1 only the server marks a statement Reconciled');
select pg_temp.as_service();
update supplier_statements set status = 'Reconciled' where id = pg_temp.st('r-ready.pdf');
select pg_temp.ok(pg_temp.status('r-ready.pdf') = 'Reconciled', 'S2 (the server marks it Reconciled after a run)');
select pg_temp.ok(pg_temp.run(pg_temp.run_sql('r-ready.pdf', 'RSA', 100, 0, 0, 0)) is null, 'S3a (the server reruns it)');
select pg_temp.ok((select max(run_number) from supplier_statement_reconciliations where statement_id = pg_temp.st('r-ready.pdf')) = 2
              and (select count(*) from supplier_statement_reconciliations where statement_id = pg_temp.st('r-ready.pdf')) = 2,
  'S3 a reconciled statement can be reconciled again (run 2); run 1 is kept');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set closing_balance = 1 where id = %s', pg_temp.st('r-ready.pdf'))) like '%only a statement in review%', 'S4 a reconciled statement is not edited in place');
select pg_temp.run(format('update supplier_statements set status = ''NeedsReview'' where id = %s', pg_temp.st('r-ready.pdf')));
select pg_temp.ok(pg_temp.status('r-ready.pdf') = 'NeedsReview',
  'S5 it is reopened for review instead');
select pg_temp.as_admin();
select pg_temp.ok((select count(*) from supplier_statement_reconciliations where statement_id = pg_temp.st('r-ready.pdf')) = 2, 'S6 reopening keeps every run');

-- =====================================================================
-- L. RLS
-- =====================================================================
select pg_temp.as_service();
select pg_temp.run(pg_temp.run_sql('r-b.pdf', 'RSB', 70, 0, 0, 0));
select pg_temp.as_user('viewer');
select pg_temp.ok((select count(*) from supplier_statement_reconciliations) = 2 and not exists (select 1 from supplier_statement_reconciliations where company_id <> pg_temp.co_a())
  and (select count(*) from supplier_statement_resolutions) = 4, 'L1 Purchasing:View reads its own company''s runs and decisions only');
select pg_temp.as_user('member');
select pg_temp.ok((select count(*) from supplier_statement_reconciliations) = 0 and (select count(*) from supplier_statement_resolutions) = 0, 'L2 a member without Purchasing:View reads none');
select pg_temp.as_user('owner_b');
select pg_temp.ok((select count(*) from supplier_statement_reconciliations) = 1, 'L3 another company sees only its own run');
select pg_temp.as_anon();
select pg_temp.ok(pg_temp.err('select count(*) from supplier_statement_reconciliations') like '%permission denied%', 'L4 anon reads nothing');

-- =====================================================================
-- H. Accounting untouched
-- =====================================================================
select pg_temp.as_admin();
select pg_temp.ok((select before from sd3d_state) = pg_temp.accounting_fingerprint(),
  'H1 journals, ledger, bills, payments, allocations, bank transactions, opening balances and suppliers are byte-for-byte unchanged');
select pg_temp.ok(not exists (
  select 1 from pg_proc where proname in ('fn_supplier_statement_record_resolution', 'fn_supplier_statement_reconciliation_insert_guard', 'fn_supplier_statement_reconciliation_item_guard', 'fn_supplier_statement_reconciliation_immutable')
    and prosrc ~* '(insert into|update|delete from)\s+(ae_journals|ae_journal_lines|gl_transactions|ae_imported_bills|supplier_payments|supplier_payment_allocations|ae_bank_transactions|opening_balance_entries|ae_suppliers)'),
  'H2 no 0115 function writes to an accounting table');

rollback;
