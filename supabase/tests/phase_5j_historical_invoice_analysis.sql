-- Phase 5J — historical Sales document analysis. READ ONLY.
--
-- Every statement below is a SELECT. Nothing is inserted, updated or
-- deleted, and no migration is applied. Safe to run against production;
-- it is the query set whose ANSWERS decide whether any historical
-- migration is needed, and that decision has not been taken.
--
-- Why it exists as a script rather than a result: the Phase 5J work was
-- done locally, and the local database holds no sales documents at all
-- (verified: `select count(*) from sales_invoices` = 0). The population
-- that matters lives in the production tenant, which this phase is
-- forbidden to touch. So the analysis is written, not run.
--
-- Run with:  psql "$CONNECTION" -f phase_5j_historical_invoice_analysis.sql
--
-- What to do with the answers is in docs/INVOICING_ACCOUNTING_5J.md,
-- section "Historical data". In short: NOTHING here is to be migrated
-- without a separate approved decision. The new calculation applies to
-- documents created after the change; existing documents keep the
-- figures they were issued with, which is what a tax record requires.

\echo '=== 1. Population by document type and status ==='
select
  document_type,
  status,
  count(*) as documents,
  sum(total) as total_value,
  sum(outstanding) as outstanding_value
from sales_invoices
group by rollup (document_type, status)
order by document_type nulls last, status nulls last;

\echo ''
\echo '=== 2. Documents whose header VAT does not match one flat rate on the subtotal ==='
-- Pre-5J, `vat_amount` was always `subtotal * header rate`. Any row where
-- that does not hold was written by some other path (the Xero import,
-- which stores Xero''s own figures) and must not be re-derived.
select
  i.id, i.invoice_number, i.document_type, i.status, i.vat_treatment_code,
  i.subtotal, i.vat_amount, i.total,
  t.rate as treatment_rate,
  round(i.subtotal * t.rate / 100, 2) as vat_if_recomputed,
  i.vat_amount - round(i.subtotal * t.rate / 100, 2) as difference
from sales_invoices i
left join vat_treatments t
  on t.company_id = i.company_id and t.code = i.vat_treatment_code
where abs(i.vat_amount - round(i.subtotal * coalesce(t.rate, 0) / 100, 2)) > 0.01
order by abs(i.vat_amount - round(i.subtotal * coalesce(t.rate, 0) / 100, 2)) desc
limit 200;

\echo ''
\echo '=== 3. Documents that WOULD change if the new per-line logic were applied to them ==='
-- The exposure, quantified. A row here has per-line VAT codes or
-- discounts that the old header-only calculation ignored. DO NOT
-- recalculate these: the figures they hold are the figures on the
-- document the customer received and on the journal already posted.
with line_roll as (
  select
    l.invoice_id,
    sum(round(l.quantity * l.unit_price - l.discount, 2)) as new_subtotal,
    sum(l.discount) as discount_total,
    count(*) filter (where l.vat_code is not null and l.vat_code <> '') as lines_with_own_vat_code,
    count(*) filter (where l.discount <> 0) as lines_with_discount
  from sales_invoice_lines l
  group by l.invoice_id
)
select
  i.id, i.invoice_number, i.document_type, i.status,
  r.lines_with_own_vat_code, r.lines_with_discount,
  i.subtotal as stored_subtotal,
  r.new_subtotal as subtotal_under_5j_logic,
  r.new_subtotal - i.subtotal as subtotal_difference,
  r.discount_total
from sales_invoices i
join line_roll r on r.invoice_id = i.id
where r.lines_with_own_vat_code > 0
   or r.lines_with_discount > 0
order by abs(r.new_subtotal - i.subtotal) desc
limit 200;

\echo ''
\echo '=== 3b. Summary count for section 3 ==='
with line_roll as (
  select
    l.invoice_id,
    count(*) filter (where l.vat_code is not null and l.vat_code <> '') as with_vat_code,
    count(*) filter (where l.discount <> 0) as with_discount
  from sales_invoice_lines l group by l.invoice_id
)
select
  count(*) filter (where r.with_vat_code > 0) as invoices_with_line_vat_codes,
  count(*) filter (where r.with_discount > 0) as invoices_with_line_discounts,
  count(*) filter (where r.with_discount > 0 and i.status = 'Posted') as posted_with_discounts,
  count(*) as invoices_with_lines
from sales_invoices i join line_roll r on r.invoice_id = i.id;

\echo ''
\echo '=== 4. Xero-imported documents — the discount UNIT ambiguity ==='
-- Xero''s CSV `Discount` column is a PERCENTAGE; it was copied verbatim
-- into `sales_invoice_lines.discount`, which every other document in this
-- system treats as a money AMOUNT. Rows below hold a percentage in an
-- amount column. Phase 5J stops NEW imports doing this (the discount is
-- derived from Xero''s own LineAmount instead), but deliberately does not
-- rewrite what is already there — see the doc.
-- Harmless today: nothing read `discount`. It becomes material the moment
-- anything recalculates these documents, which is why they must not be.
select
  i.id, i.invoice_number, i.status, i.notes,
  l.description, l.quantity, l.unit_price, l.discount as stored_discount,
  round(l.quantity * l.unit_price, 2) as line_gross,
  l.net_amount,
  round(l.quantity * l.unit_price, 2) - l.net_amount as implied_discount_amount
from sales_invoices i
join sales_invoice_lines l on l.invoice_id = i.id
where i.notes like 'Migrated from Xero%'
  and l.discount <> 0
order by i.id, l.line_order
limit 200;

\echo ''
\echo '=== 5. Due dates: how much of AR is un-ageable ==='
-- A null due date puts the whole balance in "Current" forever
-- (`shared/aging.ts`). Phase 5J derives a due date for NEW documents from
-- payment terms; existing rows are left exactly as issued.
select
  count(*) as documents,
  count(*) filter (where due_date is null) as no_due_date,
  count(*) filter (where due_date is null and outstanding > 0) as no_due_date_and_outstanding,
  coalesce(sum(outstanding) filter (where due_date is null and outstanding > 0), 0) as outstanding_never_ageing,
  count(*) filter (where due_date < invoice_date) as due_before_invoice_date
from sales_invoices
where status = 'Posted';

\echo ''
\echo '=== 6. Credit and debit notes: the s21(3) particulars ==='
select
  document_type,
  count(*) as notes,
  count(*) filter (where original_invoice_id is null) as missing_original_invoice,
  count(*) filter (where coalesce(reason, '') = '') as missing_reason,
  count(*) filter (where original_invoice_id is null and coalesce(reason, '') = '') as missing_both
from sales_invoices
where document_type in ('Credit Note', 'Debit Note')
group by document_type;

\echo ''
\echo '=== 7. Invoice numbering: format conformance and duplicates ==='
-- The unique index on (company_id, invoice_number) means there should be
-- no duplicates; this confirms it, and shows how many numbers do not fit
-- the generated format (imported ones), which the 0105 counter skips past
-- rather than colliding with.
select
  company_id,
  document_type,
  count(*) as documents,
  count(*) filter (
    where invoice_number ~ ('^' || case document_type
      when 'Invoice' then 'INV' when 'Credit Note' then 'CN' when 'Debit Note' then 'DN' end || '[0-9]+$')
  ) as conforming_numbers,
  count(distinct invoice_number) as distinct_numbers,
  max(invoice_number) as highest_number
from sales_invoices
group by company_id, document_type
order by company_id, document_type;

\echo ''
\echo '=== 8. Journals posted in a different period from their document date ==='
-- Phase 5J dates a sales journal with the DOCUMENT date; before it, the
-- journal took the APPROVAL date, so revenue and output VAT could land in
-- the wrong VAT period. This quantifies the existing exposure. It does
-- NOT fix it — re-dating a posted journal is a correction with its own
-- approval, not a side effect of a code change.
select
  i.id, i.invoice_number, i.document_type, i.invoice_date,
  j.journal_date, j.journal_date - i.invoice_date as days_apart,
  to_char(i.invoice_date, 'YYYY-MM') as document_period,
  to_char(j.journal_date, 'YYYY-MM') as posted_period,
  i.total, i.vat_amount
from sales_invoices i
join ae_journals j on j.id = i.journal_id
where to_char(i.invoice_date, 'YYYY-MM') <> to_char(j.journal_date, 'YYYY-MM')
order by abs(j.journal_date - i.invoice_date) desc
limit 200;

\echo ''
\echo '=== 8b. Value landing in the wrong VAT period, by period ==='
select
  to_char(i.invoice_date, 'YYYY-MM') as document_period,
  to_char(j.journal_date, 'YYYY-MM') as posted_period,
  count(*) as documents,
  sum(i.vat_amount) as vat_in_wrong_period
from sales_invoices i
join ae_journals j on j.id = i.journal_id
where to_char(i.invoice_date, 'YYYY-MM') <> to_char(j.journal_date, 'YYYY-MM')
group by 1, 2
order by 1, 2;

\echo ''
\echo '=== 9. Stored figures that do not internally reconcile ==='
-- subtotal + vat should equal total on every row, and outstanding should
-- never exceed total or go negative. Neither is enforced by a constraint.
select
  id, invoice_number, document_type, status,
  subtotal, vat_amount, total, outstanding,
  round(subtotal + vat_amount - total, 2) as total_mismatch
from sales_invoices
where abs(subtotal + vat_amount - total) > 0.01
   or outstanding < 0
   or outstanding > total + 0.01
order by abs(subtotal + vat_amount - total) desc
limit 200;

\echo ''
\echo '=== 10. Lines that do not reconcile to their own header ==='
select
  i.id, i.invoice_number, i.status,
  i.subtotal as header_subtotal,
  round(sum(l.net_amount), 2) as sum_of_line_nets,
  i.vat_amount as header_vat,
  round(sum(l.vat_amount), 2) as sum_of_line_vat,
  i.total as header_total,
  round(sum(l.line_total), 2) as sum_of_line_totals
from sales_invoices i
join sales_invoice_lines l on l.invoice_id = i.id
group by i.id, i.invoice_number, i.status, i.subtotal, i.vat_amount, i.total
having abs(i.subtotal - sum(l.net_amount)) > 0.01
    or abs(i.vat_amount - sum(l.vat_amount)) > 0.01
order by abs(i.subtotal - sum(l.net_amount)) desc
limit 200;
