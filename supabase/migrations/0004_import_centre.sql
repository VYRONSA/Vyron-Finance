-- Import Centre module (Migration Roadmap Module 3). Ported from the
-- reference implementation's CSV-only import pipeline:
--   import_centre/xero_csv_parser.py      -> Bills / Credit Notes CSV
--   bank_import/bank_statement_parser.py  -> Standard VYRON bank statement CSV
--   accounting_engine/imported_bill_service.py::ingest_transactions
--   accounting_engine/bank_transaction_service.py::ingest_transactions
-- Both services rely on SQLite `INSERT OR IGNORE` keyed on a natural-key
-- tuple, falling back to a `SELECT` on conflict, to make re-ingesting the
-- same batch a no-op. Postgres needs an explicit unique constraint to get
-- the same idempotency via `ON CONFLICT (...) DO NOTHING`.

-- One row per uploaded file, real import history for the Import Centre UI
-- and the Bank Account detail page's Recent Imports panel — neither the
-- reference app nor 0002/0003 persisted this; `import_batch` was always a
-- bare string column on the row itself with nothing tracking the file it
-- came from.
create table ae_import_batches (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  batch_id text not null,
  import_type text not null check (import_type in ('bills', 'bank_transactions')),
  source_filename text not null default '',
  row_count integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  exception_count integer not null default 0,
  imported_by text not null default 'System',
  created_at timestamptz not null default now()
);

create index ae_import_batches_company_id_idx on ae_import_batches (company_id, created_at desc);

alter table ae_import_batches enable row level security;
create policy "members can access their company's import batches" on ae_import_batches for all using (user_can_access_company(company_id));

-- Idempotent re-ingest for Bills / Credit Notes: XeroCsvParser's natural
-- key is (supplier, invoice_number) per company — re-importing the same
-- file (or an overlapping one) must not create duplicate bills.
alter table ae_imported_bills
  add constraint ae_imported_bills_natural_key unique (company_id, supplier_name, invoice_number);

-- Idempotent re-ingest for bank statement transactions: BankStatementParser
-- has no single natural-key column, so the reference app's duplicate
-- detector groups on the full (bank_account, transaction_date, reference,
-- debit, credit, description) tuple — the same tuple becomes the unique
-- constraint here. Nullable transaction_date is fine for the constraint;
-- Postgres treats distinct NULLs as non-equal, matching the reference
-- app's own tolerance for statements missing a parsed date.
alter table ae_bank_transactions
  add constraint ae_bank_transactions_natural_key unique (company_id, bank_account, transaction_date, reference, debit, credit, description);
