-- 0121 PRECHECK — READ-ONLY. Must show latest 0120, has0102 false, no 0121 objects, and only the KNOWN duplicate (INV-3611).
--   supabase db query --linked -f ../release-0121/precheck-0121.sql
select
  (select max(version) from supabase_migrations.schema_migrations) as latest,
  (select count(*) from supabase_migrations.schema_migrations) as history_count,
  (select bool_or(version = '0102') from supabase_migrations.schema_migrations) as has0102,
  to_regclass('public.sales_credit_note_allocations') is not null as table_0121_exists,
  (select count(*) from pg_trigger where tgname in ('ae_journals_sales_invoice_single_live','sales_invoices_journal_link_guard','sales_invoices_sign_guard')) as triggers_0121,
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in ('sales_invoices','ae_journals')) as other_triggers_on_tables,
  (select json_agg(d) from (select j.company_id, j.source_id, count(*) n from ae_journals j where j.source_type = 'sales_invoice' and not j.is_reversed and j.status not in ('Rejected','Cancelled') group by 1, 2 having count(*) > 1) d) as live_duplicate_sales_journals,
  (select json_agg(x) from (select company_id, document_type, count(*) n from sales_invoices where total < 0 or subtotal < 0 or vat_amount < 0 group by 1, 2) x) as negative_sales_documents,
  (select json_agg(x) from (select company_id, journal_number, journal_date, source_type, source_id from ae_journals where status = 'Approved') x) as approved_unposted_journals;
