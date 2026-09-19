-- Down script for 0104_document_payment_details.sql.
--
-- Drops the three presentation-only columns and any text captured in
-- them. Nothing else depends on them (no index, constraint, view,
-- function or posting path), so this is safe — but the footer and
-- payment-instruction text is lost, and every bank account's
-- show-on-documents choice is forgotten.

alter table companies
  drop column if exists invoice_footer,
  drop column if exists payment_instructions;

alter table ae_bank_accounts
  drop column if exists show_on_documents;
