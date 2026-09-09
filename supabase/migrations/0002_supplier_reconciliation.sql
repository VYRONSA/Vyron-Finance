-- Supplier Reconciliation module (Migration Roadmap Module 1).
-- Ported field-for-field from the reference implementation's
-- `accounting_engine/models.py` + `accounting_engine/schema.py` (the
-- "current/primary" stack, not the legacy `matching/`+`database/`
-- tables `recovery/status.py` currently reads — see
-- docs/MIGRATION_ROADMAP.md for that distinction). Column names are
-- snake_case Postgres equivalents of the Python dataclass fields, kept
-- 1:1 so this stays a faithful port.

create table ae_suppliers (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  alternative_names text[] not null default '{}',
  default_gl_account text,
  default_vat_code text,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now(),
  modified_at timestamptz
);

create table ae_imported_bills (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  supplier_id bigint references ae_suppliers (id) on delete set null,
  supplier_name text not null default '',
  invoice_number text not null,
  document_type text not null default 'Bill' check (document_type in ('Bill', 'Credit Note')),
  invoice_date date,
  due_date date,
  vat numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  outstanding numeric(14, 2) not null default 0,
  import_batch text not null default '',
  status text not null default 'Open',
  source_filename text not null default '',
  gl_account text,
  vat_code text,
  created_at timestamptz not null default now()
);

create table ae_bank_transactions (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  transaction_date date,
  reference text not null default '',
  description text not null default '',
  beneficiary text not null default '',
  debit numeric(14, 2) not null default 0,
  credit numeric(14, 2) not null default 0,
  balance numeric(14, 2),
  bank_account text not null default '',
  vat numeric(14, 2),
  gl_account text not null default '',
  notes text not null default '',
  import_batch text not null default '',
  source_filename text not null default '',

  -- Matching Engine / Allocation Engine fields. 'Allocated' is an
  -- Allocation-Engine-only outcome (known supplier, no bill, but usable
  -- supplier defaults) layered on top of the Matching Engine's own
  -- three-way Matched/Suggested/Unmatched(->Unallocated) status.
  allocation_status text not null default 'Unallocated' check (allocation_status in ('Matched', 'Allocated', 'Suggested', 'Unallocated')),
  matched_supplier_id bigint references ae_suppliers (id) on delete set null,
  matched_bill_id bigint references ae_imported_bills (id) on delete set null,
  confidence_score numeric(5, 2),
  rules_triggered text[] not null default '{}',
  match_reason text not null default '',
  required_action text,
  suggested_gl_account text,
  suggested_vat_code text,
  allocation_method text check (allocation_method in ('Matched Bill', 'Supplier Default', 'Manual', 'Future AI')),
  allocation_reason text not null default '',
  is_manual_override boolean not null default false,
  override_reason text,
  override_date timestamptz,
  posted_flag boolean not null default false,
  journal_id bigint,

  created_at timestamptz not null default now()
);

-- One immutable row per Matching Engine decision — never updated/deleted.
create table ae_match_history (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  transaction_id bigint not null references ae_bank_transactions (id) on delete cascade,
  previous_status text,
  new_status text not null,
  confidence numeric(5, 2),
  rules_triggered text[] not null default '{}',
  reason text not null default '',
  performed_by text not null default 'System',
  created_at timestamptz not null default now()
);

-- One immutable row per Allocation Engine decision or manual override.
create table ae_allocation_history (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  transaction_id bigint not null references ae_bank_transactions (id) on delete cascade,
  previous_status text,
  new_status text not null,
  previous_gl_account text,
  new_gl_account text,
  previous_vat_code text,
  new_vat_code text,
  confidence numeric(5, 2),
  allocation_method text not null default '',
  allocation_reason text not null default '',
  is_manual_override boolean not null default false,
  override_reason text,
  performed_by text not null default 'System',
  created_at timestamptz not null default now()
);

-- Accounting Work Queue — Suggested/Unallocated transactions surfaced for
-- human review.
create table ae_work_items (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  work_type text not null,
  source_module text not null,
  source_record_id bigint not null,
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High')),
  status text not null default 'New' check (status in ('New', 'In Review', 'Resolved', 'Closed')),
  assigned_to text,
  confidence numeric(5, 2),
  summary text not null default '',
  recommendation text not null default '',
  resolution text,
  resolution_date timestamptz,
  supplier_name text not null default '',
  amount numeric(14, 2) not null default 0,
  transaction_date date,
  reference text not null default '',
  description text not null default '',
  invoice_number text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index ae_suppliers_company_id_idx on ae_suppliers (company_id);
create index ae_imported_bills_company_id_idx on ae_imported_bills (company_id);
create index ae_imported_bills_supplier_id_idx on ae_imported_bills (supplier_id);
create index ae_bank_transactions_company_id_idx on ae_bank_transactions (company_id);
create index ae_bank_transactions_allocation_status_idx on ae_bank_transactions (company_id, allocation_status);
create index ae_match_history_transaction_id_idx on ae_match_history (transaction_id);
create index ae_allocation_history_transaction_id_idx on ae_allocation_history (transaction_id);
create index ae_work_items_company_status_idx on ae_work_items (company_id, status);

alter table ae_suppliers enable row level security;
alter table ae_imported_bills enable row level security;
alter table ae_bank_transactions enable row level security;
alter table ae_match_history enable row level security;
alter table ae_allocation_history enable row level security;
alter table ae_work_items enable row level security;

-- Every table below shares the same shape of policy: a member of the
-- owning organisation may read/write rows for that company. History
-- tables use the same policy despite being logically append-only — the
-- repository layer, not RLS, enforces "insert-only" for those.
create policy "members can access their company's suppliers" on ae_suppliers for all using (user_can_access_company(company_id));
create policy "members can access their company's imported bills" on ae_imported_bills for all using (user_can_access_company(company_id));
create policy "members can access their company's bank transactions" on ae_bank_transactions for all using (user_can_access_company(company_id));
create policy "members can access their company's match history" on ae_match_history for all using (user_can_access_company(company_id));
create policy "members can access their company's allocation history" on ae_allocation_history for all using (user_can_access_company(company_id));
create policy "members can access their company's work items" on ae_work_items for all using (user_can_access_company(company_id));
