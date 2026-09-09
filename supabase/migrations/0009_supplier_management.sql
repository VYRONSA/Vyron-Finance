-- Supplier Management (Commercial Platform, Module 2).
--
-- Extends the real, already-live `ae_suppliers` table (Supplier
-- Reconciliation, 0002_supplier_reconciliation.sql) rather than creating
-- a competing table — the same "one source of truth" discipline General
-- Ledger followed by extending `ae_journals` instead of replacing it.
-- Every new column is additive with a safe default, so Matching Engine,
-- Allocation Engine, Import Centre, and Supplier Reconciliation keep
-- working completely unmodified. Age Analysis, Outstanding Bills, and
-- Purchase History are genuinely real for this module (unlike Customer
-- Management's honestly-pending Financial Information) because the data
-- source — `ae_imported_bills`, linked via `supplier_id` — already
-- exists and is already populated by Import Centre.

alter table ae_suppliers
  add column supplier_code text not null default '',
  add column supplier_category text not null default '',
  add column supplier_type text not null default 'Company' check (supplier_type in ('Company', 'Individual')),
  add column bank_name text not null default '',
  add column bank_account_number text not null default '',
  add column bank_branch_code text not null default '',
  add column vat_number text not null default '',
  add column tax_number text not null default '',
  add column risk_rating text not null default 'Low' check (risk_rating in ('Low', 'Medium', 'High')),
  add column payment_terms_days integer not null default 30;

create table supplier_contacts (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references ae_suppliers (id) on delete cascade,
  name text not null,
  email text not null default '',
  phone text not null default '',
  mobile text not null default '',
  position text not null default '',
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index supplier_contacts_supplier_id_idx on supplier_contacts (supplier_id);

alter table supplier_contacts enable row level security;
create policy "members can access their supplier's contacts" on supplier_contacts for all using (
  exists (select 1 from ae_suppliers s where s.id = supplier_id and user_can_access_company(s.company_id))
);

create table supplier_addresses (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references ae_suppliers (id) on delete cascade,
  address_type text not null check (address_type in ('Billing', 'Delivery', 'Postal', 'Physical')),
  line1 text not null default '',
  line2 text not null default '',
  city text not null default '',
  region text not null default '',
  postal_code text not null default '',
  country text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index supplier_addresses_supplier_id_idx on supplier_addresses (supplier_id);

alter table supplier_addresses enable row level security;
create policy "members can access their supplier's addresses" on supplier_addresses for all using (
  exists (select 1 from ae_suppliers s where s.id = supplier_id and user_can_access_company(s.company_id))
);
