-- Phase SD-3G — database tests for migration 0117 (DOCUMENT reconciliation).
--
-- LOCAL / SYNTHETIC DATA ONLY. One transaction, rolled back at the end.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/supplier_statement_document_reconciliation.test.sql
--
-- Sections:
--   G  grants: the redefined guards stay uncallable by any API role
--   Y  Ready: an unread PAYMENT value never blocks; unread invoice, debit-note,
--      credit-note and unknown-type values still do; the payment line itself
--      is kept exactly as read
--   B  runs on the document basis: own date, no opening balance, D = S − P and
--      D = Explained + Unexplained still enforced; the balance basis keeps its
--      own-closing-balance rule
--   V  item vocabulary: Out of Scope and the zero-padded tier, nothing else
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
  raise exception 'SD3G_TEST_ROLLBACK';
exception when others then
  if sqlerrm = 'SD3G_TEST_ROLLBACK' then return null; end if;
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

create function pg_temp.co_a() returns uuid language sql immutable as $$ select '5f300000-0000-4000-8000-0000000003a1'::uuid $$;
create function pg_temp.uid(p_name text) returns uuid language sql immutable as $$
  select (case p_name when 'editor' then '5f300000-0000-4000-8000-000000000301' when 'viewer' then '5f300000-0000-4000-8000-000000000302' end)::uuid
$$;
create function pg_temp.email(p_name text) returns text language sql immutable as $$ select 'sd3g-' || p_name || '@synthetic.test' $$;
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
    coalesce((select string_agg(o::text, '|' order by o.id) from opening_balance_entries o), '') || '#' ||
    coalesce((select string_agg(x::text, '|' order by x.id) from ae_suppliers x), ''))
$$;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select pg_temp.uid(n), pg_temp.email(n), 'authenticated', 'authenticated' from unnest(array['editor', 'viewer']) n;
insert into organisations (id, name) values ('5f300000-0000-4000-8000-0000000003aa', 'SD3G Org A');
insert into companies (id, organisation_id, name, base_currency_code) values (pg_temp.co_a(), '5f300000-0000-4000-8000-0000000003aa', 'SD3G Company A', 'ZAR');
insert into permission_roles (company_id, role_key, name) values (pg_temp.co_a(), 'sd3g_editor', 'e'), (pg_temp.co_a(), 'sd3g_viewer', 'v');
insert into role_permissions (role_id, permission_key)
select pr.id, 'Purchasing:' || a from permission_roles pr
cross join lateral unnest(case pr.role_key when 'sd3g_editor' then array['View', 'Edit'] else array['View'] end) a
where pr.role_key like 'sd3g_%';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.uid(replace(pr.role_key, 'sd3g_', '')), pr.company_id, pr.id, 'sd3g-test' from permission_roles pr where pr.role_key like 'sd3g_%';

insert into ae_suppliers (company_id, name, supplier_code) values (pg_temp.co_a(), 'Document Recon Supplier', 'DRS');
create function pg_temp.sup() returns bigint language sql security definer as $$ select id from ae_suppliers where supplier_code = 'DRS' $$;

insert into documents (company_id, entity_type, entity_id, category, filename, storage_path, mime_type, size_bytes, uploaded_by, content_sha256)
select pg_temp.co_a(), 'Supplier', 0, 'Statement', f, pg_temp.co_a() || '/Supplier/0/' || f, 'application/pdf', 1, 'fixture', pg_temp.hash(f)
from unnest(array['g-pay.pdf', 'g-inv.pdf', 'g-unknown.pdf', 'g-cn.pdf', 'g-dn.pdf', 'g-ready.pdf']) f;
create function pg_temp.doc(p text) returns bigint language sql security definer as $$ select id from documents where filename = p $$;

insert into supplier_statements (company_id, document_id, content_sha256, source_type, status, uploaded_by, statement_date, opening_balance, closing_balance,
  validation_status, supplier_id, supplier_confirmed_by, supplier_confirmed_at)
select pg_temp.co_a(), pg_temp.doc(f), pg_temp.hash(f), 'pdf-text', s, 'f', date '2026-10-06', o, c, 'Review', pg_temp.sup(), 'reviewer', now()
from (values ('g-pay.pdf', 'NeedsReview', null::numeric, 197556.79::numeric), ('g-inv.pdf', 'NeedsReview', null, 100), ('g-unknown.pdf', 'NeedsReview', null, 100),
             ('g-cn.pdf', 'NeedsReview', null, 100), ('g-dn.pdf', 'NeedsReview', null, 100), ('g-ready.pdf', 'Ready', null, 197556.79)) t(f, s, o, c);
create function pg_temp.st(p text) returns bigint language sql security definer as $$ select s.id from supplier_statements s join documents d on d.id = s.document_id where d.filename = p $$;
create function pg_temp.status(p text) returns text language sql security definer as $$ select status from supplier_statements where id = pg_temp.st(p) $$;

-- Every statement has a fully read invoice; then one unread line of the type under test.
insert into supplier_statement_lines (company_id, statement_id, line_order, transaction_date, reference_text, transaction_type, debit, credit, raw_text, unresolved_fields)
select pg_temp.co_a(), pg_temp.st(f), 1, date '2026-10-01', '000000002291553', 'invoice', 14855.77, null, '01/10/2026 000000002291553 R 14 855,77', '{}'
from unnest(array['g-pay.pdf', 'g-inv.pdf', 'g-unknown.pdf', 'g-cn.pdf', 'g-dn.pdf', 'g-ready.pdf']) f;
insert into supplier_statement_lines (company_id, statement_id, line_order, transaction_date, reference_text, transaction_type, debit, credit, raw_text, unresolved_fields)
values
  (pg_temp.co_a(), pg_temp.st('g-pay.pdf'), 2, date '2026-09-09', '000000002252489', 'payment', null, null, '09/09/2026 000000002252489 Payment -R 26 766,18 ???', array['credit']),
  (pg_temp.co_a(), pg_temp.st('g-pay.pdf'), 3, date '2026-09-09', '000000002252489', 'payment', null, null, '09/09/2026 000000002252489 Payment -R 26 766,18 ???', array['credit']),
  (pg_temp.co_a(), pg_temp.st('g-inv.pdf'), 2, date '2026-09-23', '000000002288086', 'invoice', null, null, '23/09/2026 000000002288086 R 3? 725,76', array['debit']),
  (pg_temp.co_a(), pg_temp.st('g-unknown.pdf'), 2, date '2026-09-23', '000000002288087', 'unknown', null, null, '23/09/2026 000000002288087 ?', array['debit']),
  (pg_temp.co_a(), pg_temp.st('g-cn.pdf'), 2, date '2026-09-23', 'CN000311', 'credit-note', null, null, '23/09/2026 CN000311 ?', array['credit']),
  (pg_temp.co_a(), pg_temp.st('g-dn.pdf'), 2, null, 'DN0042', 'debit-note', 50, null, '?? DN0042 50,00', array['transaction_date']);

create function pg_temp.run_sql(p_basis text, p_opening numeric, p_closing numeric, p_p numeric, p_e numeric, p_u numeric, p_date text default '2026-10-06') returns text language sql immutable as $$
  select format($f$insert into supplier_statement_reconciliations (company_id, statement_id, run_number, engine_version, basis, supplier_id, as_at_date,
    window_from, window_to, statement_opening, statement_closing, precisia_balance_before_window, precisia_balance_at, difference, explained_amount,
    explained_by_reviewer_amount, unexplained_amount, category_summary, input_snapshot, input_fingerprint, created_by)
    select s.company_id, s.id, (select coalesce(max(run_number), 0) + 1 from supplier_statement_reconciliations where statement_id = s.id), 'sd3g-1',
      %L, pg_temp.sup(), date %L, date '2025-08-01', date %L, %s, %s, %s, %s, %s - %s, %s, 0, %s, '{}', '{}', repeat('b', 64), 'server'
    from supplier_statements s where s.id = pg_temp.st('g-ready.pdf')$f$, p_basis, p_date, p_date, p_opening, p_closing, p_opening, p_p, p_closing, p_p, p_e, p_u)
$$;

create temp table sd3g_state as select pg_temp.accounting_fingerprint() as before;
grant select on sd3g_state to authenticated, service_role;

-- =====================================================================
-- G. Grants
-- =====================================================================
select pg_temp.ok((select bool_and(not has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r,
  unnest(array['fn_supplier_statement_guard()', 'fn_supplier_statement_reconciliation_insert_guard()']) f),
  'G1 the redefined guards are callable by no API role');
select pg_temp.ok((select count(*) from pg_trigger where tgfoid = 'fn_supplier_statement_guard()'::regprocedure and not tgisinternal) >= 1
  and (select count(*) from pg_trigger where tgfoid = 'fn_supplier_statement_reconciliation_insert_guard()'::regprocedure and not tgisinternal) = 1,
  'G2 both guards are still attached to their tables');

-- =====================================================================
-- Y. Ready
-- =====================================================================
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.run(format('update supplier_statements set status = %L where id = %s', 'Ready', pg_temp.st('g-pay.pdf'))) is null
  and pg_temp.status('g-pay.pdf') = 'Ready', 'Y1 unread PAYMENT values (repeated payment rows) do not block Ready');
select pg_temp.as_admin();
select pg_temp.ok((select count(*) = 2 and bool_and(unresolved_fields = array['credit'] and raw_text like '%Payment -R 26 766,18%' and not is_excluded)
  from supplier_statement_lines where statement_id = pg_temp.st('g-pay.pdf') and transaction_type = 'payment'),
  'Y2 the payment lines are kept exactly as read: not deleted, not excluded, still marked unread, raw text intact');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = %L where id = %s', 'Ready', pg_temp.st('g-inv.pdf'))) like '%invoice, debit-note or credit-note line%',
  'Y3 an unread INVOICE amount still blocks Ready');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = %L where id = %s', 'Ready', pg_temp.st('g-unknown.pdf'))) like '%must be resolved%',
  'Y4 an unread value on a line of unknown type still blocks Ready');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = %L where id = %s', 'Ready', pg_temp.st('g-cn.pdf'))) like '%must be resolved%',
  'Y5 an unread CREDIT NOTE amount still blocks Ready');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = %L where id = %s', 'Ready', pg_temp.st('g-dn.pdf'))) like '%must be resolved%',
  'Y6 an unread DEBIT NOTE date still blocks Ready');
select pg_temp.as_admin();
select pg_temp.ok((select count(*) from supplier_statements where id in (pg_temp.st('g-inv.pdf'), pg_temp.st('g-unknown.pdf'), pg_temp.st('g-cn.pdf'), pg_temp.st('g-dn.pdf')) and status = 'NeedsReview') = 4,
  'Y7 … and those statements are unchanged');
update supplier_statements set validation_status = 'Incomplete' where id = pg_temp.st('g-dn.pdf');
update supplier_statement_lines set unresolved_fields = '{}', transaction_date = date '2026-09-23' where statement_id = pg_temp.st('g-dn.pdf') and line_order = 2;
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statements set status = %L where id = %s', 'Ready', pg_temp.st('g-dn.pdf'))) like '%must validate%',
  'Y8 validation is still required (Incomplete never becomes Ready)');
select pg_temp.as_user('viewer');
select pg_temp.run(format('update supplier_statements set status = %L where id = %s', 'Ready', pg_temp.st('g-dn.pdf')));
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.status('g-dn.pdf') = 'NeedsReview', 'Y9 Purchasing:Edit is still required (a view-only user changes nothing)');

-- =====================================================================
-- B. Runs on the document basis
-- =====================================================================
select pg_temp.as_service();
-- S (documents on the statement) need not equal the statement's closing balance (197 556.79).
select pg_temp.ok(pg_temp.run(pg_temp.run_sql('supplier-statement-documents', 0, 14855.77, 14855.77, 0, 0)) is null,
  'B1 a document-basis run records Documents on Statement as S (not the closing balance)');
select pg_temp.ok(pg_temp.err(pg_temp.run_sql('supplier-statement-documents', 5, 14855.77, 14855.77, 0, 0)) like '%no opening balance%',
  'B2 a document-basis run has no opening balance');
select pg_temp.ok(pg_temp.err(pg_temp.run_sql('supplier-statement-documents', 0, 14855.77, 14855.77, 0, 0, '2026-10-05')) like '%own date%',
  'B3 the run uses the statement''s own date');
select pg_temp.ok(pg_temp.err(pg_temp.run_sql('supplier-statement-documents', 0, 14855.77, 0, 10, 5)) like '%identity%',
  'B4 D = Explained + Unexplained is still enforced to the cent');
select pg_temp.ok(pg_temp.err(replace(pg_temp.run_sql('supplier-statement-documents', 0, 100, 40, 60, 0), '100 - 40', '100 - 41')) like '%difference%',
  'B5 D = S − P is still enforced');
select pg_temp.ok(pg_temp.err(pg_temp.run_sql('supplier-ledger-document-date', 0, 14855.77, 14855.77, 0, 0)) like '%own closing balance%',
  'B6 a balance-basis run must still use the statement''s own closing balance');
select pg_temp.ok(pg_temp.run(pg_temp.run_sql('supplier-ledger-document-date', 0, 197556.79, 197556.79, 0, 0)) is null,
  'B7 … and is still accepted when it does (SD-3D runs remain valid)');
select pg_temp.ok(pg_temp.err(pg_temp.run_sql('supplier-payment-reconciliation', 0, 14855.77, 14855.77, 0, 0)) like '%basis_check%',
  'B8 no other basis exists (there is no payment reconciliation)');

-- =====================================================================
-- V. Item vocabulary
-- =====================================================================
create function pg_temp.item_sql(p_order int, p_category text, p_tier text) returns text language sql immutable as $$
  select format($f$insert into supplier_statement_reconciliation_items (company_id, reconciliation_id, item_order, category, sub_status, match_tier, effect_on_difference, explained, message)
    values (%L, (select min(id) from supplier_statement_reconciliations where statement_id = pg_temp.st('g-ready.pdf')), %s, %L, 's', %L, 0, true, 'm')$f$,
    pg_temp.co_a(), p_order, p_category, p_tier)
$$;
select pg_temp.ok(pg_temp.run(pg_temp.item_sql(1, 'Out of Scope', null)) is null, 'V1 "Out of Scope" (payments) is a recorded category');
select pg_temp.ok(pg_temp.run(pg_temp.item_sql(2, 'Matched', 'zero-padded')) is null, 'V2 the zero-padded match tier is recorded');
select pg_temp.ok(pg_temp.err(pg_temp.item_sql(3, 'Payment Reconciled', null)) like '%category_check%', 'V3 no other category was added');
select pg_temp.ok(pg_temp.err(pg_temp.item_sql(4, 'Matched', 'amount-only')) like '%match_tier_check%', 'V4 no other match tier was added (amount alone never matches)');
select pg_temp.ok(pg_temp.err(pg_temp.item_sql(5, 'Balancing Adjustment', null)) like '%category_check%', 'V5 there is still no adjustment category');

-- =====================================================================
-- H. Accounting untouched
-- =====================================================================
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.accounting_fingerprint() = (select before from sd3g_state),
  'H1 no journal, journal line, GL row, bill, payment, allocation, bank transaction, opening balance or supplier changed');
select pg_temp.ok((select bool_and(prosrc !~* '(insert|update|delete)\s+(into\s+)?(ae_journals|ae_journal_lines|gl_transactions|ae_imported_bills|supplier_payments|supplier_payment_allocations|ae_bank_transactions)')
  from pg_proc where proname in ('fn_supplier_statement_guard', 'fn_supplier_statement_reconciliation_insert_guard')),
  'H2 neither 0117 function writes an accounting table');

rollback;
