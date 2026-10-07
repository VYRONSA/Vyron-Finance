-- Phase SD-1 — database tests for migration 0112 (supplier capture review workflow).
--
-- LOCAL / SYNTHETIC DATA ONLY. Everything runs in ONE transaction that is
-- rolled back at the end. Never run against a shared or production database.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/supplier_capture_review_workflow.test.sql
--
-- Sections:
--   R  retention: a captured supplier document and its history cannot be deleted or altered
--   S  storage: the stored file cannot be deleted through the storage API either
--   V  corrections reset validation; conversion needs a fresh verdict
--   L  reviewer line changes (add / correct / remove) and their limits
--   M  manual entry: Queued/Failed -> ManualEntry -> NeedsReview
--   K  conversion links only the Draft created for the capture (incl. credit notes)
--   I  isolation and permissions on the new functions
--   H  no accounting record is touched

\set ON_ERROR_STOP 1
set client_min_messages = notice;
begin;

-- ---------------------------------------------------------------------
-- Helpers (as in supplier_capture_security_hardening.test.sql)
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
  raise exception 'SD1_TEST_ROLLBACK';
exception when others then
  if sqlerrm = 'SD1_TEST_ROLLBACK' then return null; end if;
  raise notice '  (error: %)', sqlerrm;
  return sqlerrm;
end $$;

create function pg_temp.affected(p_sql text) returns integer language plpgsql as $$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  raise exception 'SD1_TEST_ROLLBACK:%', n;
exception when others then
  if sqlerrm like 'SD1_TEST_ROLLBACK:%' then return split_part(sqlerrm, ':', 2)::integer; end if;
  raise notice '  (refused: %)', sqlerrm;
  return -1;
end $$;

create function pg_temp.co_a() returns uuid language sql immutable as $$ select '5e000000-0000-4000-8000-0000000000a1'::uuid $$;
create function pg_temp.co_b() returns uuid language sql immutable as $$ select '5e000000-0000-4000-8000-0000000000b1'::uuid $$;
create function pg_temp.uid(p_name text) returns uuid language sql immutable as $$
  select (case p_name
    when 'member'   then '5e000000-0000-4000-8000-000000000101'
    when 'viewer'   then '5e000000-0000-4000-8000-000000000102'
    when 'editor'   then '5e000000-0000-4000-8000-000000000104'
    when 'approver' then '5e000000-0000-4000-8000-000000000106'
    when 'deleter'  then '5e000000-0000-4000-8000-000000000108'
    when 'owner_b'  then '5e000000-0000-4000-8000-000000000107'
  end)::uuid
$$;
create function pg_temp.email(p_name text) returns text language sql immutable as $$ select 'sd1-' || p_name || '@synthetic.test' $$;

create function pg_temp.as_user(p_name text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"%s"}', pg_temp.uid(p_name), pg_temp.email(p_name)), true);
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
    coalesce((select string_agg(p::text, '|' order by p.id) from ae_purchase_bill_lines p), '') || '#' ||
    coalesce((select string_agg(s::text, '|' order by s.id) from supplier_payments s), '') || '#' ||
    coalesce((select string_agg(a::text, '|' order by a.id) from supplier_payment_allocations a), ''))
$$;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select pg_temp.uid(n), pg_temp.email(n), 'authenticated', 'authenticated'
from unnest(array['member','viewer','editor','approver','deleter','owner_b']) as n;

insert into organisations (id, name) values
  ('5e000000-0000-4000-8000-0000000000aa', 'SD1 Org A'), ('5e000000-0000-4000-8000-0000000000bb', 'SD1 Org B');
insert into companies (id, organisation_id, name, base_currency_code) values
  (pg_temp.co_a(), '5e000000-0000-4000-8000-0000000000aa', 'SD1 Company A', 'ZAR'),
  (pg_temp.co_b(), '5e000000-0000-4000-8000-0000000000bb', 'SD1 Company B', 'ZAR');

insert into permission_roles (company_id, role_key, name) values
  (pg_temp.co_a(), 'sd1_member', 'member'), (pg_temp.co_a(), 'sd1_viewer', 'viewer'),
  (pg_temp.co_a(), 'sd1_editor', 'editor'), (pg_temp.co_a(), 'sd1_approver', 'approver'),
  (pg_temp.co_a(), 'sd1_deleter', 'deleter'), (pg_temp.co_b(), 'sd1_owner_b', 'owner b');
insert into role_permissions (role_id, permission_key)
select pr.id, 'Purchasing:' || a
from permission_roles pr
cross join lateral unnest(case pr.role_key
  when 'sd1_viewer'   then array['View']
  when 'sd1_editor'   then array['View','Edit']
  when 'sd1_approver' then array['View','Create','Approve']
  when 'sd1_deleter'  then array['View','Create','Edit','Delete']
  when 'sd1_owner_b'  then array['View','Create','Edit','Reject','Approve','Delete']
  else array[]::text[] end) as a
where pr.role_key like 'sd1_%';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.uid(replace(pr.role_key, 'sd1_', '')), pr.company_id, pr.id, 'sd1-test'
from permission_roles pr where pr.role_key like 'sd1_%';

insert into ae_suppliers (company_id, name, supplier_code) values
  (pg_temp.co_a(), 'Alpha Supplies', 'S1A'), (pg_temp.co_a(), 'Alpha Two', 'S1A2'), (pg_temp.co_b(), 'Bravo Supplies', 'S1B');
create function pg_temp.sup(p_code text) returns bigint language sql security definer as $$ select id from ae_suppliers where supplier_code = p_code $$;

insert into documents (company_id, entity_type, entity_id, category, filename, storage_path, mime_type, size_bytes, uploaded_by, content_sha256)
select c, 'Supplier', 0, 'Invoice', f, c || '/Supplier/0/' || f, 'application/pdf', 1000, 'fixture', 'sha-' || f
from (values (pg_temp.co_a(), 'r-review.pdf'), (pg_temp.co_a(), 'r-queued.pdf'), (pg_temp.co_a(), 'r-failed.pdf'),
             (pg_temp.co_a(), 'r-credit.pdf'), (pg_temp.co_a(), 'r-plain.pdf'), (pg_temp.co_b(), 'r-b.pdf')) as t(c, f);
create function pg_temp.doc(p_file text) returns bigint language sql security definer as $$ select id from documents where filename = p_file $$;

-- Stored files (the storage service's own table; stand-in in the sandbox).
insert into storage.buckets (id, name) values ('documents', 'documents') on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) select 'documents', storage_path from documents where company_id in (pg_temp.co_a(), pg_temp.co_b());

insert into supplier_invoice_captures (company_id, document_id, status, uploaded_by, supplier_name_extracted, invoice_number,
  invoice_date, subtotal, vat_amount, total, supplier_id, supplier_match_tier, validation_status, validated_at, document_type,
  extraction_snapshot)
values
  (pg_temp.co_a(), pg_temp.doc('r-review.pdf'), 'NeedsReview', 'fixture', 'Alpha Supplies', 'INV-500', date '2026-09-01',
   1000, 150, 1150, pg_temp.sup('S1A'), 'vat', 'Pass', now(), 'Invoice',
   '{"header":{"invoiceNumber":"INV-500","total":1150},"lines":[],"invoiceNumbersSeen":["INV-500"],"declaredLineCount":1}'),
  (pg_temp.co_a(), pg_temp.doc('r-queued.pdf'), 'Queued', 'fixture', null, null, null, null, null, null, null, null, 'Pending', null, null, null),
  (pg_temp.co_a(), pg_temp.doc('r-failed.pdf'), 'Failed', 'fixture', null, null, null, null, null, null, null, null, 'Pending', null, null, null),
  (pg_temp.co_a(), pg_temp.doc('r-credit.pdf'), 'NeedsReview', 'fixture', 'Alpha Supplies', 'CN-77', date '2026-09-02',
   500, 75, 575, pg_temp.sup('S1A'), 'vat', 'Review', now(), 'Credit Note', null),
  (pg_temp.co_b(), pg_temp.doc('r-b.pdf'), 'NeedsReview', 'fixture', 'Bravo Supplies', 'B-1', date '2026-09-01',
   100, 15, 115, pg_temp.sup('S1B'), 'vat', 'Pass', now(), 'Invoice', null);
create function pg_temp.cap(p_file text) returns bigint language sql security definer as $$
  select c.id from supplier_invoice_captures c join documents d on d.id = c.document_id where d.filename = p_file
$$;
create function pg_temp.vstatus(p_file text) returns text language sql security definer as $$
  select validation_status from supplier_invoice_captures where id = pg_temp.cap(p_file)
$$;

insert into supplier_invoice_capture_lines (company_id, capture_id, line_order, description, quantity, unit_price, vat_rate_percent, vat_amount, line_total,
  gl_account_suggested, gl_account_source, vat_code_suggested, vat_code_source, line_confidence)
values
  (pg_temp.co_a(), pg_temp.cap('r-review.pdf'), 0, 'Widget', 10, 100, 15, 150, 1000, '5100', 'supplier-default', 'Standard Rated', 'supplier-default', 90),
  (pg_temp.co_a(), pg_temp.cap('r-credit.pdf'), 0, 'Returned', 5, 100, 15, 75, 500, '5100', 'supplier-default', 'Standard Rated', 'supplier-default', 90);

insert into supplier_invoice_capture_events (company_id, capture_id, event_type, detail, performed_by)
values (pg_temp.co_a(), pg_temp.cap('r-review.pdf'), 'ValidationEvaluated', '{}', 'fixture');

-- Draft documents, as `createPurchaseBill` would create them for the two captures.
insert into ae_imported_bills (company_id, supplier_id, supplier_name, invoice_number, document_type, total, outstanding, origin, posting_status) values
  (pg_temp.co_a(), pg_temp.sup('S1A'), 'Alpha Supplies', 'INV-500', 'Bill', 1150, 1150, 'Purchasing', 'Draft'),
  (pg_temp.co_a(), pg_temp.sup('S1A'), 'Alpha Supplies', 'CN-77', 'Credit Note', 575, 575, 'Purchasing', 'Draft'),
  (pg_temp.co_a(), pg_temp.sup('S1A'), 'Alpha Supplies', 'CN-77-AS-BILL', 'Bill', 575, 575, 'Purchasing', 'Draft'),
  (pg_temp.co_a(), pg_temp.sup('S1A2'), 'Alpha Two', 'INV-500', 'Bill', 1150, 1150, 'Purchasing', 'Draft'),
  (pg_temp.co_a(), pg_temp.sup('S1A'), 'Alpha Supplies', 'INV-500-POSTED', 'Bill', 1150, 1150, 'Purchasing', 'Posted');
create function pg_temp.bill(p_supplier text, p_number text, p_type text default 'Bill') returns bigint language sql security definer as $$
  select id from ae_imported_bills where supplier_id = pg_temp.sup(p_supplier) and invoice_number = p_number and document_type = p_type
$$;

create temp table sd1_state as select pg_temp.accounting_fingerprint() as accounting_before;

-- =====================================================================
-- R. Retention of captured supplier documents
-- =====================================================================
select pg_temp.as_user('deleter');
select pg_temp.ok(pg_temp.affected(format('delete from documents where id = %s', pg_temp.doc('r-review.pdf'))) = -1,
  'R1 a user holding Purchasing:Delete cannot delete a captured invoice''s document');
select pg_temp.ok(pg_temp.affected(format('delete from documents where id = %s', pg_temp.doc('r-plain.pdf'))) = 1,
  'R2 ... while an ordinary, uncaptured document is still deleted as before');
select pg_temp.ok(pg_temp.affected(format('update documents set storage_path = %L where id = %s', 'elsewhere.pdf', pg_temp.doc('r-review.pdf'))) = -1,
  'R3 a captured document''s stored path cannot be repointed');
select pg_temp.ok(pg_temp.affected(format('update documents set content_sha256 = %L where id = %s', 'forged', pg_temp.doc('r-review.pdf'))) = -1,
  'R3 ... nor its content hash');
select pg_temp.ok(pg_temp.affected(format('update documents set is_current = false where id = %s', pg_temp.doc('r-review.pdf'))) = 1,
  'R4 versioning still works (is_current may still flip)');
select pg_temp.as_service();
select pg_temp.ok(pg_temp.err(format('delete from documents where id = %s', pg_temp.doc('r-queued.pdf'))) like '%retained as accounting evidence%',
  'R5 the service role cannot delete it either');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.err(format('delete from documents where id = %s', pg_temp.doc('r-review.pdf'))) like '%retained as accounting evidence%',
  'R5 ... nor the database owner');
select pg_temp.ok(pg_temp.err(format('delete from supplier_invoice_capture_events where capture_id = %s', pg_temp.cap('r-review.pdf'))) like '%append-only%',
  'R6 its audit history stays immutable');
select pg_temp.ok(pg_temp.err(format('delete from companies where id = %L', pg_temp.co_b())) is null,
  'R7 deleting a whole company (a foreign-key cascade) still works');

-- =====================================================================
-- S. Storage
-- =====================================================================
select pg_temp.as_user('deleter');
select pg_temp.ok(pg_temp.affected(format('delete from storage.objects where bucket_id = %L and name = %L', 'documents', pg_temp.co_a() || '/Supplier/0/r-review.pdf')) = 0,
  'S1 the stored file of a captured invoice cannot be deleted through the storage API');
select pg_temp.ok(pg_temp.affected(format('delete from storage.objects where bucket_id = %L and name = %L', 'documents', pg_temp.co_a() || '/Supplier/0/r-plain.pdf')) = 1,
  'S2 ... while an ordinary file still can');
select pg_temp.as_user('member');
select pg_temp.ok(fn_storage_object_is_capture_evidence(pg_temp.co_a() || '/Supplier/0/r-review.pdf'),
  'S3 the evidence check answers for the caller''s own company');
select pg_temp.as_admin();
insert into organisations (id, name) values ('5e000000-0000-4000-8000-0000000000cc', 'SD1 Org C');
insert into companies (id, organisation_id, name) values ('5e000000-0000-4000-8000-0000000000c1', '5e000000-0000-4000-8000-0000000000cc', 'SD1 Company C');
insert into permission_roles (company_id, role_key, name) values ('5e000000-0000-4000-8000-0000000000c1', 'sd1_c', 'c');
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select pg_temp.uid('owner_b'), company_id, id, 'sd1-test' from permission_roles where role_key = 'sd1_c';
select pg_temp.as_user('owner_b');
select pg_temp.ok(not fn_storage_object_is_capture_evidence(pg_temp.co_a() || '/Supplier/0/r-review.pdf'),
  'S3 ... and reveals nothing about another company''s paths');
select pg_temp.as_admin();

-- =====================================================================
-- V. Corrections reset validation
-- =====================================================================
select pg_temp.as_user('editor');
update supplier_invoice_captures set total = 1150.00, subtotal = 1000, vat_amount = 150, currency_code = 'ZAR', document_type = 'Invoice'
where id = pg_temp.cap('r-review.pdf');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.vstatus('r-review.pdf') = 'Pending'
                  and (select validated_at is null from supplier_invoice_captures where id = pg_temp.cap('r-review.pdf')),
  'V1 a reviewer''s header correction (totals, type, currency) resets validation to Pending');
select pg_temp.ok((select extraction_snapshot->'header'->>'total' = '1150' from supplier_invoice_captures where id = pg_temp.cap('r-review.pdf')),
  'V2 the extraction as received is preserved in the snapshot');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set validation_status = %L where id = %s', 'Pass', pg_temp.cap('r-review.pdf'))) = -1,
  'V3 a reviewer cannot mark their own correction as validated');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set extraction_snapshot = %L where id = %s', '{}', pg_temp.cap('r-review.pdf'))) = -1,
  'V3 ... nor rewrite the extraction snapshot');
select pg_temp.as_user('approver');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, bill_id = %s where id = %s',
    'Converted', pg_temp.bill('S1A', 'INV-500'), pg_temp.cap('r-review.pdf'))) = -1,
  'V4 a corrected capture cannot be converted until it is validated again');
select pg_temp.as_service();
update supplier_invoice_captures set validation_status = 'Pass', validated_at = now() where id = pg_temp.cap('r-review.pdf');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.vstatus('r-review.pdf') = 'Pass', 'V5 the server records the new verdict');

-- =====================================================================
-- L. Reviewer line changes
-- =====================================================================
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.affected(format(
    'insert into supplier_invoice_capture_lines (company_id, capture_id, line_order, description, quantity, unit_price) values (%L, %s, 1, %L, 1, 50)',
    pg_temp.co_a(), pg_temp.cap('r-review.pdf'), 'Freight')) = 1,
  'L1 Edit adds a line the extraction missed');
insert into supplier_invoice_capture_lines (company_id, capture_id, line_order, description, quantity, unit_price)
values (pg_temp.co_a(), pg_temp.cap('r-review.pdf'), 1, 'Freight', 1, 50);
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.vstatus('r-review.pdf') = 'Pending', 'L2 adding a line resets validation');
update supplier_invoice_captures set validation_status = 'Pass', validated_at = now() where id = pg_temp.cap('r-review.pdf');
select pg_temp.as_user('editor');
update supplier_invoice_capture_lines set line_total = 1000.00, quantity = 10 where capture_id = pg_temp.cap('r-review.pdf') and line_order = 0;
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.vstatus('r-review.pdf') = 'Pending', 'L3 correcting a printed line value resets validation');
update supplier_invoice_captures set validation_status = 'Pass', validated_at = now() where id = pg_temp.cap('r-review.pdf');
select pg_temp.as_user('editor');
delete from supplier_invoice_capture_lines where capture_id = pg_temp.cap('r-review.pdf') and line_order = 1;
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.vstatus('r-review.pdf') = 'Pending', 'L4 removing a line resets validation');
update supplier_invoice_captures set validation_status = 'Pass', validated_at = now() where id = pg_temp.cap('r-review.pdf');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.affected(format(
    'insert into supplier_invoice_capture_lines (company_id, capture_id, line_order, description, gl_account_suggested, gl_account_source) values (%L, %s, 7, %L, %L, %L)',
    pg_temp.co_a(), pg_temp.cap('r-review.pdf'), 'x', '9999', 'learned-mapping')) = -1,
  'L5 a reviewer cannot add a line dressed up as a system suggestion');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_capture_lines set vat_code_suggested = %L where capture_id = %s', 'Exempt', pg_temp.cap('r-review.pdf'))) = -1,
  'L5 ... nor alter a suggestion');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_capture_lines set capture_id = %s where capture_id = %s', pg_temp.cap('r-credit.pdf'), pg_temp.cap('r-review.pdf'))) = -1,
  'L6 a line cannot be moved to another capture');
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.affected(format('insert into supplier_invoice_capture_lines (company_id, capture_id, line_order, description) values (%L, %s, 8, %L)', pg_temp.co_a(), pg_temp.cap('r-review.pdf'), 'x')) = -1,
  'L7 View alone cannot add lines');
select pg_temp.ok(pg_temp.affected(format('delete from supplier_invoice_capture_lines where capture_id = %s', pg_temp.cap('r-review.pdf'))) <= 0,
  'L7 ... nor remove them');
select pg_temp.as_service();
update supplier_invoice_capture_lines set line_confidence = 80 where capture_id = pg_temp.cap('r-review.pdf');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.vstatus('r-review.pdf') = 'Pass', 'L8 the server''s own line writes do not reset the verdict it is about to write');

-- =====================================================================
-- M. Manual entry
-- =====================================================================
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L where id = %s', 'ManualEntry', pg_temp.cap('r-queued.pdf'))) <= 0,
  'M1 View alone cannot start a manual entry');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L where id = %s', 'ManualEntry', pg_temp.cap('r-review.pdf'))) = -1,
  'M2 a capture already in review is not re-entered by hand');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, invoice_number = %L where id = %s', 'ManualEntry', 'X', pg_temp.cap('r-queued.pdf'))) = -1,
  'M3 starting a manual entry carries no field edits with it');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L where id = %s', 'NeedsReview', pg_temp.cap('r-failed.pdf'))) = -1,
  'M7 a failed capture cannot skip manual entry and jump straight into review');
update supplier_invoice_captures set status = 'ManualEntry' where id = pg_temp.cap('r-queued.pdf');
update supplier_invoice_captures set status = 'ManualEntry' where id = pg_temp.cap('r-failed.pdf');
select fn_supplier_invoice_capture_record_event(pg_temp.co_a(), pg_temp.cap('r-queued.pdf'), 'ManualEntryStarted', '{"from":"Queued"}');
select pg_temp.as_admin();
select pg_temp.ok((select bool_and(status = 'ManualEntry' and manual_entry and validation_status = 'Pending')
                   from supplier_invoice_captures where id in (pg_temp.cap('r-queued.pdf'), pg_temp.cap('r-failed.pdf'))),
  'M4 Edit moves a Queued or a Failed capture into manual entry, marked as such');
select pg_temp.as_user('editor');
update supplier_invoice_captures set supplier_id = pg_temp.sup('S1A'), supplier_match_tier = 'manual', invoice_number = 'INV-900',
  invoice_date = '2026-09-03', subtotal = 200, vat_amount = 30, total = 230, document_type = 'Invoice'
where id = pg_temp.cap('r-queued.pdf');
insert into supplier_invoice_capture_lines (company_id, capture_id, line_order, description, quantity, unit_price, vat_rate_percent, gl_account_confirmed, vat_code_confirmed)
values (pg_temp.co_a(), pg_temp.cap('r-queued.pdf'), 0, 'Typed line', 2, 100, 15, '5100', 'Standard Rated');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set supplier_name_extracted = %L where id = %s', 'Typed', pg_temp.cap('r-queued.pdf'))) = -1,
  'M5 a manual entry still cannot write "extracted" values — nothing was extracted');
select pg_temp.as_user('approver');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, bill_id = %s where id = %s', 'Converted', pg_temp.bill('S1A', 'INV-500'), pg_temp.cap('r-queued.pdf'))) = -1,
  'M6 a manual entry cannot be converted before it is submitted for review');
select pg_temp.as_user('editor');
update supplier_invoice_captures set status = 'NeedsReview' where id = pg_temp.cap('r-queued.pdf');
select fn_supplier_invoice_capture_record_event(pg_temp.co_a(), pg_temp.cap('r-queued.pdf'), 'SubmittedForReview', '{}');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_record_event(%L, %s, %L)', pg_temp.co_a(), pg_temp.cap('r-failed.pdf'), 'SubmittedForReview')) is not null,
  'M8 a SubmittedForReview event needs a capture that is actually in review');
select pg_temp.as_admin();
select pg_temp.ok((select status = 'NeedsReview' and validation_status = 'Pending' from supplier_invoice_captures where id = pg_temp.cap('r-queued.pdf')),
  'M9 a submitted manual entry is in review, awaiting validation');
select pg_temp.ok((select array_agg(event_type::text order by id) = array['ManualEntryStarted','SubmittedForReview']
                     and bool_and(performed_by = pg_temp.email('editor'))
                   from supplier_invoice_capture_events where capture_id = pg_temp.cap('r-queued.pdf')),
  'M10 the manual-entry history is recorded, attributed to the session''s user');

-- =====================================================================
-- K. Conversion links only the Draft created for the capture
-- =====================================================================
update supplier_invoice_captures set validation_status = 'Pass', validated_at = now() where id = pg_temp.cap('r-review.pdf');
select pg_temp.as_user('approver');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, bill_id = %s where id = %s',
    'Converted', pg_temp.bill('S1A2', 'INV-500'), pg_temp.cap('r-review.pdf'))) = -1,
  'K1 a Draft for a different supplier is refused');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, bill_id = %s where id = %s',
    'Converted', pg_temp.bill('S1A', 'INV-500-POSTED'), pg_temp.cap('r-review.pdf'))) = -1,
  'K2 a posted (not Draft) document is refused');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, bill_id = %s where id = %s',
    'Converted', pg_temp.bill('S1A', 'INV-500'), pg_temp.cap('r-review.pdf'))) = 1,
  'K3 the matching Draft bill is accepted');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, bill_id = %s where id = %s',
    'Converted', pg_temp.bill('S1A', 'CN-77-AS-BILL'), pg_temp.cap('r-credit.pdf'))) = -1,
  'K4 a CREDIT NOTE capture can never be linked to a Bill');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set status = %L, bill_id = %s where id = %s',
    'Converted', pg_temp.bill('S1A', 'CN-77', 'Credit Note'), pg_temp.cap('r-credit.pdf'))) = 1,
  'K5 ... only to its Draft supplier Credit Note');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.affected(format('update supplier_invoice_captures set document_type = %L where id = %s', 'Banana', pg_temp.cap('r-credit.pdf'))) = -1,
  'K6 the document type is one of the known kinds');
select pg_temp.as_admin();

-- =====================================================================
-- I. Isolation and permissions on the new functions
-- =====================================================================
select pg_temp.ok(not has_function_privilege('anon', 'fn_supplier_invoice_capture_mark_unvalidated(bigint)', 'execute')
              and not has_function_privilege('anon', 'fn_document_is_capture_evidence(bigint)', 'execute')
              and not has_function_privilege('anon', 'fn_storage_object_is_capture_evidence(text)', 'execute'),
  'I1 none of 0112''s functions is callable anonymously');
select pg_temp.as_user('viewer');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_mark_unvalidated(%s)', pg_temp.cap('r-credit.pdf'))) like '%Purchasing:Edit is required%',
  'I2 the validation reset cannot be called by a user without Purchasing:Edit');
select pg_temp.as_user('owner_b');
select pg_temp.ok(pg_temp.err(format('select fn_supplier_invoice_capture_mark_unvalidated(%s)', pg_temp.cap('r-failed.pdf'))) like '%Purchasing:Edit is required%',
  'I3 ... nor against another company''s capture, whatever the caller holds at home');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.vstatus('r-failed.pdf') = 'Pending' and pg_temp.vstatus('r-credit.pdf') = 'Review',
  'I4 neither attempt changed anything');

-- =====================================================================
-- H. Accounting untouched
-- =====================================================================
select pg_temp.ok((select accounting_before from sd1_state) = pg_temp.accounting_fingerprint(),
  'H1 journals, ledger, bills, bill lines, supplier payments and allocations are byte-for-byte unchanged');

rollback;
