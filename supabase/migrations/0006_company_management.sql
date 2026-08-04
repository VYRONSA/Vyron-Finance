-- Company Management module: Company Setup, Financial Years, Branches,
-- Departments, Cost Centres, Currencies, Tax Configuration.
--
-- Financial Year period math is ported field-for-field from
-- `accounting/period_manager.py` (FINANCIAL_YEAR_START_MONTH = 3, the
-- South African tax year) — see server/services/financial-year-service.ts
-- for the TS port of `get_financial_year`/`get_financial_period`.
-- Branches (org-level, distinct from `ae_bank_accounts.branch`'s bank
-- branch code), Departments, Cost Centres, and multi-currency have no
-- reference-app equivalent — confirmed by research, genuinely new master
-- data. Tax Configuration's seed values are ported 1:1 from
-- `accounting_engine/vat_codes.py`'s VAT_CODES/VAT_RATES.

-- `0001_platform_foundation.sql` gave `organisations`/`organisation_members`
-- SELECT-only policies — no authenticated user could ever create their
-- own organisation, which blocks Company Setup's "first company bootstraps
-- an organisation" flow entirely (see server/services/company-service.ts).
-- Both policies below are scoped narrowly to avoid privilege escalation:
-- anyone signed in may create a brand-new (empty) organisation, and may
-- only self-insert a membership row into an organisation that currently
-- has zero members — i.e. only immediately after creating it, never into
-- an existing organisation they weren't already invited to.
create policy "authenticated users can create an organisation" on organisations for insert with check (auth.uid() is not null);
create policy "users can join an organisation with no existing members as its owner" on organisation_members
  for insert
  with check (
    user_id = auth.uid()
    and not exists (select 1 from organisation_members om where om.organisation_id = organisation_members.organisation_id)
  );

-- Global reference data — currency codes are universal facts, not
-- tenant data, so this table is not company-scoped and carries no
-- user_can_access_company() policy; it's read-only reference data (no
-- insert/update/delete policy at all -> default deny, only migrations
-- can write to it).
create table currencies (
  code text primary key,
  name text not null,
  symbol text not null default ''
);

alter table currencies enable row level security;
create policy "any authenticated user can read currencies" on currencies for select using (auth.uid() is not null);

insert into currencies (code, name, symbol) values
  ('ZAR', 'South African Rand', 'R'),
  ('USD', 'US Dollar', '$'),
  ('GBP', 'British Pound', '£'),
  ('EUR', 'Euro', '€'),
  ('AUD', 'Australian Dollar', 'A$'),
  ('CAD', 'Canadian Dollar', 'C$'),
  ('CHF', 'Swiss Franc', 'CHF'),
  ('JPY', 'Japanese Yen', '¥'),
  ('CNY', 'Chinese Yuan', '¥'),
  ('INR', 'Indian Rupee', '₹'),
  ('AED', 'UAE Dirham', 'د.إ'),
  ('BWP', 'Botswana Pula', 'P'),
  ('NAD', 'Namibian Dollar', 'N$'),
  ('MZN', 'Mozambican Metical', 'MT'),
  ('ZMW', 'Zambian Kwacha', 'ZK');

alter table companies
  add column registration_number text not null default '',
  add column address text not null default '',
  add column financial_year_start_month int not null default 3 check (financial_year_start_month between 1 and 12),
  add column base_currency_code text not null default 'ZAR' references currencies (code);

create table company_currencies (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  currency_code text not null references currencies (code),
  is_active boolean not null default true,
  unique (company_id, currency_code)
);

alter table company_currencies enable row level security;
create policy "members can access their company's currencies" on company_currencies for all using (user_can_access_company(company_id));

create table financial_years (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  year_label text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'Open' check (status in ('Open', 'Closed')),
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, year_label)
);

-- At most one current financial year per company.
create unique index financial_years_one_current_idx on financial_years (company_id) where is_current;
create index financial_years_company_id_idx on financial_years (company_id);

alter table financial_years enable row level security;
create policy "members can access their company's financial years" on financial_years for all using (user_can_access_company(company_id));

create table branches (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  code text not null default '',
  address text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table departments (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  code text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table cost_centres (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  code text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index branches_company_id_idx on branches (company_id);
create index departments_company_id_idx on departments (company_id);
create index cost_centres_company_id_idx on cost_centres (company_id);

alter table branches enable row level security;
alter table departments enable row level security;
alter table cost_centres enable row level security;
create policy "members can access their company's branches" on branches for all using (user_can_access_company(company_id));
create policy "members can access their company's departments" on departments for all using (user_can_access_company(company_id));
create policy "members can access their company's cost centres" on cost_centres for all using (user_can_access_company(company_id));

create table vat_treatments (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  code text not null,
  name text not null,
  rate numeric(5, 2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

create index vat_treatments_company_id_idx on vat_treatments (company_id);

alter table vat_treatments enable row level security;
create policy "members can access their company's VAT treatments" on vat_treatments for all using (user_can_access_company(company_id));

-- Seeds the 6 South African VAT treatments ported from
-- `accounting_engine/vat_codes.py` — called explicitly by
-- company-service.ts's createCompany() right after a new company is
-- inserted, not a trigger, so the seeding step stays visible/testable in
-- application code rather than hidden in the database.
create function seed_company_defaults(p_company_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into vat_treatments (company_id, code, name, rate) values
    (p_company_id, 'Standard Rated', 'Standard Rated', 15.00),
    (p_company_id, 'Zero Rated', 'Zero Rated', 0.00),
    (p_company_id, 'Exempt', 'Exempt', 0.00),
    (p_company_id, 'No VAT', 'No VAT', 0.00),
    (p_company_id, 'Fuel VAT', 'Fuel VAT', 0.00),
    (p_company_id, 'Import VAT', 'Import VAT', 15.00);
$$;
