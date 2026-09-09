-- Product Review Board — Matching Platform (Module 14).
--
-- "A single imported transaction must support: Multiple GL Accounts,
-- Multiple Suppliers, Multiple Customers, Multiple VAT codes, Multiple
-- Projects, Multiple Cost Centres, Multiple Departments, Multiple
-- Branches." A real child table — `ae_bank_transactions` itself stays
-- exactly as-is (one gl_account/matched_supplier_id/etc. for the
-- unsplit case, unchanged); a transaction WITH splits is flagged
-- `is_split = true` and its splits live here instead, each carrying its
-- own dimensional set. `journal-service.ts` builds one GL-side journal
-- line PER split (still one balanced journal, same Posting Engine).

alter table ae_bank_transactions
  add column is_split boolean not null default false;

create table bank_transaction_splits (
  id bigint generated always as identity primary key,
  bank_transaction_id bigint not null references ae_bank_transactions (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  line_order int not null default 0,
  amount numeric(14, 2) not null check (amount > 0),
  description text not null default '',
  gl_account text not null default '',
  vat_code text not null default '',
  supplier_id bigint references ae_suppliers (id) on delete set null,
  customer_id bigint references customers (id) on delete set null,
  project_id bigint references projects (id) on delete set null,
  cost_centre_id bigint references cost_centres (id) on delete set null,
  department_id bigint references departments (id) on delete set null,
  branch_id bigint references branches (id) on delete set null,
  created_at timestamptz not null default now()
);

create index bank_transaction_splits_transaction_id_idx on bank_transaction_splits (bank_transaction_id);
alter table bank_transaction_splits enable row level security;
create policy "members can access their company's bank transaction splits" on bank_transaction_splits for all using (user_can_access_company(company_id));

-- Merchant merge — "Merge Merchants" per the Matching Platform directive.
-- A merge doesn't delete the losing merchant's history; it re-points
-- every bank transaction and alias to the surviving merchant, and
-- records what happened for the audit trail.
create table merchant_merges (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  surviving_merchant_id bigint not null references merchants (id) on delete cascade,
  merged_merchant_id bigint not null,
  merged_merchant_name text not null,
  transactions_repointed int not null default 0,
  performed_by text not null default 'System',
  performed_at timestamptz not null default now()
);

create index merchant_merges_company_id_idx on merchant_merges (company_id);
alter table merchant_merges enable row level security;
create policy "members can access their company's merchant merges" on merchant_merges for all using (user_can_access_company(company_id));

-- Customer/Supplier master-record merges — same pattern, for Duplicate
-- Detection's "merge" action on master data.
create table party_merges (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  party_type text not null check (party_type in ('Customer', 'Supplier')),
  surviving_party_id bigint not null,
  merged_party_id bigint not null,
  merged_party_name text not null,
  performed_by text not null default 'System',
  performed_at timestamptz not null default now()
);

create index party_merges_company_id_idx on party_merges (company_id);
alter table party_merges enable row level security;
create policy "members can access their company's party merges" on party_merges for all using (user_can_access_company(company_id));

-- Matching Overrides — the Audit Trail requirement: "Every override
-- records: User, Date, Old value, New value, Reason." A generic table
-- (not per-matching-type) since every matching type's override shape is
-- structurally the same (a field on some record changed, by whom, why).
create table matching_overrides (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  item_type text not null,
  item_id bigint not null,
  field_name text not null,
  old_value text,
  new_value text,
  reason text not null default '',
  performed_by text not null default 'System',
  performed_at timestamptz not null default now()
);

create index matching_overrides_company_item_idx on matching_overrides (company_id, item_type, item_id);
alter table matching_overrides enable row level security;
create policy "members can access their company's matching overrides" on matching_overrides for all using (user_can_access_company(company_id));
