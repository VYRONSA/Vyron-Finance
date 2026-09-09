-- Bank Accounts module (Migration Roadmap Module 2). Ported field-for-
-- field from the reference implementation's `ae_bank_accounts` table and
-- `accounting_engine/bank_account_service.py::get_summary_for_company`'s
-- aggregation query (statement_count, transaction_count, total_debits,
-- total_credits, last_import via LEFT JOIN on `ae_bank_transactions`).

create table ae_bank_accounts (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  account_number text not null,
  account_name text not null default '',
  bank_name text not null default '',
  account_type text not null default '',
  branch text not null default '',
  currency text not null default 'ZAR',
  status text not null default 'Active' check (status in ('Active', 'Inactive', 'Archived')),
  opening_balance numeric(14, 2) not null default 0,
  current_balance numeric(14, 2) not null default 0,
  last_reconciliation_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, account_number)
);

create index ae_bank_accounts_company_id_idx on ae_bank_accounts (company_id);

alter table ae_bank_accounts enable row level security;
create policy "members can access their company's bank accounts" on ae_bank_accounts for all using (user_can_access_company(company_id));

-- Every imported bank transaction belongs to exactly one bank account —
-- this column didn't exist when 0002 was written (Bank Accounts wasn't a
-- module yet); Module 1's matching/allocation logic never needed it,
-- since it operates on transactions directly, but Module 2's per-account
-- summaries and Recent Transactions view do.
alter table ae_bank_transactions
  add column bank_account_id bigint references ae_bank_accounts (id) on delete set null;

create index ae_bank_transactions_bank_account_id_idx on ae_bank_transactions (bank_account_id);
