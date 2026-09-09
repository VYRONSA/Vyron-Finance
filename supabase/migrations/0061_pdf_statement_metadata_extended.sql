-- Pilot Review Round 1 - Final Certification round, real FNB PDF
-- statements. The Board's own header field list for PDF Bank Statement
-- Import (Account Holder, Account Number, Statement Number, Statement
-- Period, Statement Date, Opening Balance, Closing Balance, Credit
-- Limit, Available Balance, Interest information, VAT, Fees) has 6
-- fields ae_import_batches (0058) never had room for - confirmed as a
-- real gap once this round ran the FNB parsers against the actual PDF
-- bytes for both real statements supplied. Nullable throughout, same
-- "not applicable / not printed / not yet extracted" contract as 0058 -
-- no backfill, no fabricated values.

alter table ae_import_batches
  add column statement_number text,
  add column statement_credit_limit numeric,
  add column statement_available_balance numeric,
  add column statement_interest_summary text,
  add column statement_vat numeric,
  add column statement_fees numeric;
