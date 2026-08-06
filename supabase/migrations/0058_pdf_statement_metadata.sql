-- Pilot Review Round 1 - PDF Bank Statement Import, Product Review Board's
-- Final Outstanding Requirement. Adds statement-level metadata to
-- ae_import_batches (previously only ever tracked file/row-count summary
-- data, never per-statement facts like the account, period, or balances)
-- so the PDF import pipeline can:
--   1. reconcile a statement's own opening/closing balance against the
--      transactions actually extracted from it (balance_reconciles),
--   2. detect a duplicate statement re-upload (same bank account + same
--      period already on file) BEFORE committing any transactions, not
--      just rely on the existing per-transaction natural-key constraint
--      (0004_import_centre.sql) catching duplicates one row at a time.
-- Nullable throughout: every existing import type (CSV/XLSX/OFX/QIF) and
-- every historical batch simply has no statement metadata, which is
-- exactly what "not applicable to this format" should look like - no
-- backfill, no fabricated values.

alter table ae_import_batches
  add column bank_account_id bigint references ae_bank_accounts (id) on delete set null,
  add column statement_account_holder text,
  add column statement_account_number text,
  add column statement_period_start date,
  add column statement_period_end date,
  add column statement_opening_balance numeric,
  add column statement_closing_balance numeric,
  add column balance_reconciles boolean;

-- Powers "has this exact statement already been imported?" - one lookup
-- by (company, bank account, period) before a PDF statement is committed.
create index ae_import_batches_statement_period_idx
  on ae_import_batches (company_id, bank_account_id, statement_period_start, statement_period_end)
  where bank_account_id is not null;
