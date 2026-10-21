-- 0121 POSTCHECK — READ-ONLY. Expect latest 0121, 3 triggers, 6 functions, table present, allocations 0, counts unchanged vs precheck.
--   supabase db query --linked -f ../release-0121/postcheck-0121.sql
select
  (select max(version) from supabase_migrations.schema_migrations) as latest,
  (select count(*) from pg_trigger where tgname in ('ae_journals_sales_invoice_single_live','sales_invoices_journal_link_guard','sales_invoices_sign_guard')) as triggers_0121,
  (select count(*) from pg_proc where proname in ('fn_allocate_sales_credit_note','fn_credit_note_available','fn_guard_sales_invoice_journal','fn_guard_sales_invoice_journal_link','fn_guard_sales_invoice_sign','fn_sales_journal_is_live')) as fns_0121,
  (select count(*) from sales_credit_note_allocations) as allocations,
  has_function_privilege('anon', 'fn_allocate_sales_credit_note(uuid,bigint,bigint,numeric,uuid)', 'execute') as alloc_granted_anon,
  (select count(*) from sales_invoices) as sales_invoices_all,
  (select count(*) from ae_journals) as journals_all;
