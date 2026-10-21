-- RELEASE FREEZE VERIFICATION — READ-ONLY (SELECT only, writes nothing). Metanoia Hospitality.
-- ENVIRONMENT: PRODUCTION gnvhzckxryuttsqnvriv. Replace __FREEZE_START_UTC__ with the moment the freeze was announced
-- (e.g. 2026-10-22 06:00:00+00), then from release-0120:
--   supabase db query --linked -f ../release-0121/freeze-verify-0121.sql
-- Run it (a) right after the freeze starts, (b) immediately before each production step, (c) at the end of the window.
-- Expected during the freeze: every *_since_freeze count = 0 (except work done by the release itself, which is listed
-- by the step's own postcheck), approved_unposted = JR001233, JR001234 only, financial_years = 1.
with f as (select '__FREEZE_START_UTC__'::timestamptz as t, '45b3d2a0-3973-4587-a043-0e05d8d9bff3'::uuid as co)
select
  (select t from f) as freeze_start,
  now() as checked_at,
  (select count(*) from ae_journals j, f where j.company_id = f.co and j.created_at >= f.t) as journals_created_since_freeze,
  (select count(*) from ae_journals j, f where j.company_id = f.co and j.posted_at >= f.t) as journals_posted_since_freeze,
  (select json_agg(x) from (select j.journal_number, j.source_type, j.status, j.created_at from ae_journals j, f
                             where j.company_id = f.co and (j.created_at >= f.t or j.posted_at >= f.t) order by j.id) x) as journals_detail,
  (select count(*) from sales_invoices s, f where s.company_id = f.co and s.created_at >= f.t) as sales_documents_created_since_freeze,
  (select count(*) from sales_invoices s, f where s.company_id = f.co
     and (s.submitted_at >= f.t or s.approved_at >= f.t or s.posted_at >= f.t or s.cancelled_at >= f.t)) as sales_documents_changed_status_since_freeze,
  (select count(*) from ae_imported_bills x, f where x.company_id = f.co and x.created_at >= f.t) as bills_created_since_freeze,
  (select count(*) from ae_imported_bills x, f where x.company_id = f.co
     and (x.submitted_at >= f.t or x.approved_at >= f.t or x.posted_at >= f.t or x.cancelled_at >= f.t)) as bills_changed_status_since_freeze,
  (select json_agg(x) from (select id, invoice_number, status, posting_status, journal_id from ae_imported_bills
                             where company_id = (select co from f) and id in (63, 69) order by id) x) as supplier_credit_notes_63_69,
  (select count(*) from customers c, f where c.company_id = f.co and c.created_at >= f.t) as customers_created_since_freeze,
  (select count(*) from financial_years y, f where y.company_id = f.co) as financial_years,
  (select count(*) from financial_years y, f where y.company_id = f.co and y.created_at >= f.t) as financial_years_created_since_freeze,
  (select json_agg(journal_number order by id) from ae_journals where company_id = (select co from f) and status = 'Approved') as approved_unposted;
