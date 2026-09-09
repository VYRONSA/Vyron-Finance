-- Customer Management (Commercial Platform, Module 1).
--
-- Genuinely new — neither reference backend has a customer concept at
-- all (Supplier Reconciliation's `ae_suppliers` is the closest existing
-- analog and is what Module 2, Supplier Management, will extend rather
-- than duplicate). Customer Financial Information (aging, lifetime
-- sales, open quotes/orders/invoices) and Customer Intelligence are
-- deliberately NOT computed here: they require the Sales module (Module
-- 3, not yet built) as their data source. Building fabricated zeros now
-- would misrepresent "no data source yet" as "this customer owes
-- nothing" — the honest-boundaries UI shows those sections as visibly
-- pending, not silently wrong.

create table customers (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  customer_code text not null,
  name text not null,
  customer_type text not null default 'Company' check (customer_type in ('Company', 'Individual')),
  customer_group text not null default '',
  industry text not null default '',
  vat_number text not null default '',
  registration_number text not null default '',
  credit_limit numeric(14, 2) not null default 0,
  payment_terms_days integer not null default 30,
  currency_code text references currencies (code),
  price_list text not null default '',
  sales_rep text not null default '',
  is_active boolean not null default true,
  risk_rating text not null default 'Low' check (risk_rating in ('Low', 'Medium', 'High')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, customer_code)
);

create index customers_company_id_idx on customers (company_id);

alter table customers enable row level security;
create policy "members can access their company's customers" on customers for all using (user_can_access_company(company_id));

create table customer_contacts (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customers (id) on delete cascade,
  name text not null,
  email text not null default '',
  phone text not null default '',
  mobile text not null default '',
  position text not null default '',
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index customer_contacts_customer_id_idx on customer_contacts (customer_id);

alter table customer_contacts enable row level security;
create policy "members can access their customer's contacts" on customer_contacts for all using (
  exists (select 1 from customers c where c.id = customer_id and user_can_access_company(c.company_id))
);

create table customer_addresses (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customers (id) on delete cascade,
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

create index customer_addresses_customer_id_idx on customer_addresses (customer_id);

alter table customer_addresses enable row level security;
create policy "members can access their customer's addresses" on customer_addresses for all using (
  exists (select 1 from customers c where c.id = customer_id and user_can_access_company(c.company_id))
);
