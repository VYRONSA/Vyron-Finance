-- Phase 31C — fixes a real data-integrity gap introduced by making
-- `ae_bank_transactions.description` accountant-editable (Phase 31A/31B):
-- the bank-import dedup mechanism (`ingestBankTransactionIdempotent`)
-- relies on `ae_bank_transactions_natural_key`
-- (company_id, bank_account, transaction_date, reference, debit, credit,
-- description — migration 0004), which used the LIVE description column.
-- Once an accountant edits a transaction's description, re-importing the
-- original source statement no longer matches that row's natural key,
-- so the dedup INSERT succeeds instead of being rejected — silently
-- creating a genuine duplicate transaction.
--
-- Investigated first (do not just drop description from the key):
-- production data (company 8d276630-42ee-4673-a308-e5dcaa7252fa, all 181
-- rows entry_source='Imported', reference='' on every single row) has
-- TWO real pairs of genuinely distinct transactions that share the exact
-- same (bank_account, transaction_date, debit, credit, reference='')
-- tuple and are ONLY distinguished today by description:
--   2025-03-15 / debit 100000.00 — "...000024403 Ren Renumeration" vs
--                                   "...000024404 Mam Mama Yama"
--   2025-03-29 / debit 112134.57 — "...000024492 Thr Three Streams Fish"
--                                   vs "...000024494 Thr Three Streams Fish"
-- Dropping description from the key (unique(company_id, bank_account,
-- transaction_date, reference, debit, credit)) would make these
-- collide — confirmed unsafe, not hypothetical.
--
-- Fix: `import_description` is a NEW column, a snapshot of description
-- taken ONLY at insert time and never updated again afterward (the
-- application code enforces this — see `import-repository.ts`'s
-- `ingestBankTransactionIdempotent` and `cashbook-repository.ts`'s
-- `createManualTransaction`, the only two insert paths for this table).
-- The natural key is rebuilt against this immutable snapshot instead of
-- the now-editable live `description` — mathematically identical
-- disambiguation power to the original constraint (same 7 logical
-- values), just immune to a later accounting-workflow edit. The
-- constraint's own NAME is kept unchanged so the existing
-- `isDuplicateNaturalKey` error-classification helper
-- (`transaction-explorer-repository.ts`) continues to recognise it
-- without any further code change.
--
-- Backfill is exact and lossless for the existing 181 rows: no accountant
-- has ever been able to edit `description` before this migration ships
-- (Phase 31A/31B were never deployed), so every row's current
-- `description` value IS its original, as-imported value, unmodified.

alter table ae_bank_transactions
  add column import_description text not null default '';

update ae_bank_transactions
  set import_description = description;

alter table ae_bank_transactions
  drop constraint ae_bank_transactions_natural_key;

alter table ae_bank_transactions
  add constraint ae_bank_transactions_natural_key
  unique (company_id, bank_account, transaction_date, reference, debit, credit, import_description);
