-- Down script for 0106_sales_document_particulars.sql.
--
-- Drops the three added columns and their check constraints. No amount,
-- journal or document number is affected — `reason` and
-- `payment_terms_days` are particulars ABOUT a document, never inputs to
-- what it is worth.
--
-- What is lost, and it is a tax record: the stated reason on every credit
-- and debit note issued since 0106 was applied (VAT Act s21(3)). Export
-- `select id, invoice_number, reason from sales_invoices where reason <> ''`
-- before running this if those documents are still within the five-year
-- retention period.
--
-- Due dates themselves live in `sales_invoices.due_date` and are NOT
-- dropped here, so dropping `payment_terms_days` loses only the record of
-- what each due date was derived from — no invoice becomes undated and no
-- ageing bucket moves.

alter table sales_invoices
  drop constraint if exists sales_invoices_payment_terms_days_check;
alter table companies
  drop constraint if exists companies_default_payment_terms_days_check;

alter table sales_invoices
  drop column if exists reason,
  drop column if exists payment_terms_days;

alter table companies
  drop column if exists default_payment_terms_days;
