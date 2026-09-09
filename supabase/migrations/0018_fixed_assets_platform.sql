-- Fixed Assets & Asset Intelligence Platform (Module 11).
--
-- "No duplicate accounting logic." Confirmed by research before writing
-- anything here: `chart_of_accounts.account_type`/`normal_balance` are
-- independent columns with no CHECK tying them together, and
-- `balance-sheet-engine.ts`/`income-statement-engine.ts` group PURELY by
-- `account_type` — a contra-asset (Accumulated Depreciation: Asset type,
-- Credit normal balance) already flows through both engines correctly
-- with zero code changes. Every lifecycle event that moves money reuses
-- the ONE Posting Engine (`postApprovedJournals`) via either a real
-- `posting_rules` row (Acquisition/Improvement/Revaluation Increase/
-- Impairment — all simple two-line gross-amount events) or a bespoke
-- pure line-builder for the two events too structurally different for
-- the standard one-gross-amount-split rule (a Depreciation Run posts one
-- consolidated journal across many assets; a Disposal clears three
-- independent balances — cost, accumulated depreciation, accumulated
-- impairment — against proceeds and a plugged gain/loss) — same
-- precedent as `vat-engine.ts::buildVatSettlementJournalLines`.
--
-- This is `seed_company_defaults()`'s 6th definition — extended, not
-- forked, per every prior migration's own convention.

create or replace function seed_company_defaults(p_company_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rule_id bigint;
begin
  insert into vat_treatments (company_id, code, name, rate, vat_type) values
    (p_company_id, 'Standard Rated', 'Standard Rated', 15.00, 'Standard'),
    (p_company_id, 'Zero Rated', 'Zero Rated', 0.00, 'ZeroRated'),
    (p_company_id, 'Exempt', 'Exempt', 0.00, 'Exempt'),
    (p_company_id, 'No VAT', 'No VAT', 0.00, 'OutsideScope'),
    (p_company_id, 'Fuel VAT', 'Fuel VAT', 0.00, 'ZeroRated'),
    (p_company_id, 'Import VAT', 'Import VAT', 15.00, 'Import');

  insert into chart_of_accounts (company_id, account_code, description, account_type, category, normal_balance, is_control_account)
  values
    (p_company_id, '1000', 'Bank', 'Asset', 'Current Asset', 'Debit', false),
    (p_company_id, '1100', 'Debtors', 'Asset', 'Current Asset', 'Debit', true),
    (p_company_id, '1500', 'Inventory', 'Asset', 'Current Asset', 'Debit', true),
    (p_company_id, '1600', 'Fixed Assets - Cost', 'Asset', 'Non-current Asset', 'Debit', true),
    (p_company_id, '1650', 'Accumulated Depreciation', 'Asset', 'Non-current Asset', 'Credit', true),
    (p_company_id, '1660', 'Accumulated Impairment', 'Asset', 'Non-current Asset', 'Credit', true),
    (p_company_id, '2000', 'Creditors', 'Liability', 'Current Liability', 'Credit', true),
    (p_company_id, '2050', 'Goods Received Not Invoiced', 'Liability', 'Current Liability', 'Credit', true),
    (p_company_id, '2100', 'VAT Input', 'Asset', 'Current Asset', 'Debit', false),
    (p_company_id, '2200', 'VAT Output', 'Liability', 'Current Liability', 'Credit', false),
    (p_company_id, '2300', 'VAT Control', 'Liability', 'Current Liability', 'Credit', true),
    (p_company_id, '3000', 'Retained Income', 'Equity', 'Equity', 'Credit', false),
    (p_company_id, '3100', 'Revaluation Surplus', 'Equity', 'Equity', 'Credit', false),
    (p_company_id, '4000', 'Sales', 'Income', 'Operating Income', 'Credit', false),
    (p_company_id, '4100', 'Sales Returns', 'Income', 'Operating Income', 'Debit', false),
    (p_company_id, '5000', 'Purchases', 'Cost of Sales', 'Cost of Sales', 'Debit', false),
    (p_company_id, '5010', 'Cost of Sales', 'Cost of Sales', 'Cost of Sales', 'Debit', false),
    (p_company_id, '6100', 'Bank Charges', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6200', 'Interest Received', 'Other Income', 'Other Income', 'Credit', false),
    (p_company_id, '6250', 'Profit on Disposal of Assets', 'Other Income', 'Other Income', 'Credit', false),
    (p_company_id, '6300', 'Inventory Adjustments', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6400', 'VAT Adjustments', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6500', 'Depreciation Expense', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6600', 'Loss on Disposal of Assets', 'Other Expense', 'Other Expense', 'Debit', false),
    (p_company_id, '6700', 'Impairment Loss', 'Other Expense', 'Other Expense', 'Debit', false),
    (p_company_id, '9999', 'Suspense', 'Equity', 'Suspense', 'Debit', false);

  -- Sales Invoice: DR Debtors (gross), CR Sales (net), CR VAT Output (vat)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Sales Invoice', 'Customer sales invoice') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'debtors', '1100', 'gross'),
    (v_rule_id, 1, 'Credit', 'sales', '4000', 'net'),
    (v_rule_id, 2, 'Credit', 'vat_output', '2200', 'vat');

  -- Customer Credit Note: DR Sales Returns (net), DR VAT Output (vat), CR Debtors (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Customer Credit Note', 'Customer credit note') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'sales_returns', '4100', 'net'),
    (v_rule_id, 1, 'Debit', 'vat_output', '2200', 'vat'),
    (v_rule_id, 2, 'Credit', 'debtors', '1100', 'gross');

  -- Customer Receipt: DR Bank (gross), CR Debtors (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Customer Receipt', 'Receipt from a customer') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'bank', '1000', 'gross'),
    (v_rule_id, 1, 'Credit', 'debtors', '1100', 'gross');

  -- Supplier Invoice: DR Expense (net, dynamic per-bill), DR VAT Input (vat), CR Creditors (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Supplier Invoice', 'Supplier bill') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'dynamic_expense', null, 'net'),
    (v_rule_id, 1, 'Debit', 'vat_input', '2100', 'vat'),
    (v_rule_id, 2, 'Credit', 'creditors', '2000', 'gross');

  -- Supplier Credit Note: DR Creditors (gross), CR Expense (net, dynamic), CR VAT Input (vat)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Supplier Credit Note', 'Supplier credit note') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'creditors', '2000', 'gross'),
    (v_rule_id, 1, 'Credit', 'dynamic_expense', null, 'net'),
    (v_rule_id, 2, 'Credit', 'vat_input', '2100', 'vat');

  -- Supplier Payment: DR Creditors (gross), CR Bank (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Supplier Payment', 'Payment to a supplier') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'creditors', '2000', 'gross'),
    (v_rule_id, 1, 'Credit', 'bank', '1000', 'gross');

  -- Bank Charges: DR Bank Charges (gross), CR Bank (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Bank Charges', 'Bank charges / fees') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'bank_charges', '6100', 'gross'),
    (v_rule_id, 1, 'Credit', 'bank', '1000', 'gross');

  -- Interest Received: DR Bank (gross), CR Interest Received (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Interest Received', 'Interest received') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'bank', '1000', 'gross'),
    (v_rule_id, 1, 'Credit', 'interest_received', '6200', 'gross');

  -- Goods Received: DR Inventory (gross), CR GRNI Clearing (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Goods Received', 'Goods received into inventory, not yet billed') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'inventory', '1500', 'gross'),
    (v_rule_id, 1, 'Credit', 'grni_clearing', '2050', 'gross');

  -- Inventory Bill: DR GRNI Clearing (net), DR VAT Input (vat), CR Creditors (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Inventory Bill', 'Supplier bill for goods already received into inventory') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'grni_clearing', '2050', 'net'),
    (v_rule_id, 1, 'Debit', 'vat_input', '2100', 'vat'),
    (v_rule_id, 2, 'Credit', 'creditors', '2000', 'gross');

  -- Inventory Issue: DR Cost of Sales (gross), CR Inventory (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Inventory Issue', 'Cost of goods sold on a sales invoice') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'cost_of_sales', '5010', 'gross'),
    (v_rule_id, 1, 'Credit', 'inventory', '1500', 'gross');

  -- Inventory Return: DR Inventory (gross), CR Cost of Sales (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Inventory Return', 'Stock restocked from a customer credit note') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'inventory', '1500', 'gross'),
    (v_rule_id, 1, 'Credit', 'cost_of_sales', '5010', 'gross');

  -- Inventory Adjustment Increase: DR Inventory (gross), CR Inventory Adjustments (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Inventory Adjustment Increase', 'Stock adjustment increasing quantity on hand') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'inventory', '1500', 'gross'),
    (v_rule_id, 1, 'Credit', 'inventory_adjustment', '6300', 'gross');

  -- Inventory Adjustment Decrease: DR Inventory Adjustments (gross), CR Inventory (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Inventory Adjustment Decrease', 'Stock adjustment decreasing quantity on hand') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'inventory_adjustment', '6300', 'gross'),
    (v_rule_id, 1, 'Credit', 'inventory', '1500', 'gross');

  -- VAT Adjustment Increase: DR vat_account (dynamic: 2100 or 2200, gross), CR VAT Adjustments (6400, gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'VAT Adjustment Increase', 'Manual correction increasing a VAT Input or VAT Output balance') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'vat_account', null, 'gross'),
    (v_rule_id, 1, 'Credit', 'vat_adjustment', '6400', 'gross');

  -- VAT Adjustment Decrease: DR VAT Adjustments (6400, gross), CR vat_account (dynamic, gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'VAT Adjustment Decrease', 'Manual correction decreasing a VAT Input or VAT Output balance') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'vat_adjustment', '6400', 'gross'),
    (v_rule_id, 1, 'Credit', 'vat_account', null, 'gross');

  -- Reverse Charge Self-Assessment: DR VAT Input (gross = notional VAT), CR VAT Output (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Reverse Charge Self-Assessment', 'Self-assessed VAT on imported services under the reverse charge mechanism') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'vat_input', '2100', 'gross'),
    (v_rule_id, 1, 'Credit', 'vat_output', '2200', 'gross');

  -- Asset Acquisition: DR Fixed Assets - Cost (gross), CR payment_account (dynamic: Bank or Creditors, gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Asset Acquisition', 'A fixed asset is acquired') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'asset_cost', '1600', 'gross'),
    (v_rule_id, 1, 'Credit', 'payment_account', null, 'gross');

  -- Asset Improvement: DR Fixed Assets - Cost (gross), CR payment_account (dynamic, gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Asset Improvement', 'Capitalised improvement to an existing fixed asset') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'asset_cost', '1600', 'gross'),
    (v_rule_id, 1, 'Credit', 'payment_account', null, 'gross');

  -- Asset Revaluation Increase: DR Fixed Assets - Cost (gross), CR Revaluation Surplus (gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Asset Revaluation Increase', 'A fixed asset''s carrying value is revalued upward') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'asset_cost', '1600', 'gross'),
    (v_rule_id, 1, 'Credit', 'revaluation_surplus', '3100', 'gross');

  -- Asset Impairment: DR Impairment Loss (gross), CR Accumulated Impairment (gross)
  -- — also the path a downward revaluation takes in this platform (a
  -- decrease below cost is modelled as an impairment, not a reversal of
  -- a prior surplus — a disclosed simplification, see the Fixed Assets
  -- status section of docs/MIGRATION_ROADMAP.md).
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Asset Impairment', 'A fixed asset''s carrying value is written down') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'impairment_loss', '6700', 'gross'),
    (v_rule_id, 1, 'Credit', 'accumulated_impairment', '1660', 'gross');
end;
$$;

do $$
declare
  v_company record;
  v_rule_id bigint;
begin
  for v_company in select id from companies loop
    insert into chart_of_accounts (company_id, account_code, description, account_type, category, normal_balance, is_control_account)
    select v_company.id, x.account_code, x.description, x.account_type, x.category, x.normal_balance, x.is_control_account
    from (values
      ('1600', 'Fixed Assets - Cost', 'Asset', 'Non-current Asset', 'Debit', true),
      ('1650', 'Accumulated Depreciation', 'Asset', 'Non-current Asset', 'Credit', true),
      ('1660', 'Accumulated Impairment', 'Asset', 'Non-current Asset', 'Credit', true),
      ('3100', 'Revaluation Surplus', 'Equity', 'Equity', 'Credit', false),
      ('6250', 'Profit on Disposal of Assets', 'Other Income', 'Other Income', 'Credit', false),
      ('6500', 'Depreciation Expense', 'Expense', 'Operating Expense', 'Debit', false),
      ('6600', 'Loss on Disposal of Assets', 'Other Expense', 'Other Expense', 'Debit', false),
      ('6700', 'Impairment Loss', 'Other Expense', 'Other Expense', 'Debit', false)
    ) as x(account_code, description, account_type, category, normal_balance, is_control_account)
    where not exists (
      select 1 from chart_of_accounts coa where coa.company_id = v_company.id and coa.account_code = x.account_code
    );

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Asset Acquisition') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Asset Acquisition', 'A fixed asset is acquired') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'asset_cost', '1600', 'gross'),
        (v_rule_id, 1, 'Credit', 'payment_account', null, 'gross');
    end if;

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Asset Improvement') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Asset Improvement', 'Capitalised improvement to an existing fixed asset') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'asset_cost', '1600', 'gross'),
        (v_rule_id, 1, 'Credit', 'payment_account', null, 'gross');
    end if;

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Asset Revaluation Increase') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Asset Revaluation Increase', 'A fixed asset''s carrying value is revalued upward') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'asset_cost', '1600', 'gross'),
        (v_rule_id, 1, 'Credit', 'revaluation_surplus', '3100', 'gross');
    end if;

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Asset Impairment') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Asset Impairment', 'A fixed asset''s carrying value is written down') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'impairment_loss', '6700', 'gross'),
        (v_rule_id, 1, 'Credit', 'accumulated_impairment', '1660', 'gross');
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Asset Classes — a real, lightweight master table (defaults for
-- depreciation method/useful life). Category/Group are kept as free-text
-- classification fields directly on `fixed_assets` rather than two more
-- full CRUD master tables — a disclosed scope decision, not an omission.
-- ---------------------------------------------------------------------

create table asset_classes (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  code text not null default '',
  default_depreciation_method text not null default 'StraightLine' check (default_depreciation_method in ('StraightLine', 'DiminishingBalance', 'UnitsOfProduction', 'Custom')),
  default_useful_life_months integer not null default 60,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

alter table asset_classes enable row level security;
create policy "members can access their company's asset classes" on asset_classes for all using (user_can_access_company(company_id));

-- ---------------------------------------------------------------------
-- The Asset Register.
-- ---------------------------------------------------------------------

create table fixed_assets (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  asset_number text not null,
  description text not null,
  asset_class_id bigint references asset_classes (id) on delete set null,
  category text not null default '',
  asset_group text not null default '',
  purchase_date date,
  in_service_date date,
  cost numeric(14, 2) not null default 0,
  residual_value numeric(14, 2) not null default 0,
  useful_life_months integer not null default 60,
  depreciation_method text not null default 'StraightLine' check (depreciation_method in ('StraightLine', 'DiminishingBalance', 'UnitsOfProduction', 'Custom')),
  diminishing_balance_rate_percent numeric(6, 3) not null default 0,
  units_of_production_life_units numeric(14, 2) not null default 0,
  units_of_production_units_to_date numeric(14, 2) not null default 0,
  accumulated_depreciation numeric(14, 2) not null default 0,
  accumulated_impairment numeric(14, 2) not null default 0,
  supplier_id bigint references ae_suppliers (id) on delete set null,
  branch_id bigint references branches (id) on delete set null,
  department_id bigint references departments (id) on delete set null,
  cost_centre_id bigint references cost_centres (id) on delete set null,
  project_id bigint references projects (id) on delete set null,
  location text not null default '',
  custodian text not null default '',
  status text not null default 'Draft' check (status in ('Draft', 'Active', 'Idle', 'UnderMaintenance', 'Disposed', 'WrittenOff', 'Retired')),
  status_changed_at timestamptz not null default now(),
  serial_number text not null default '',
  warranty_expiry_date date,
  insurance_provider text not null default '',
  insurance_policy_number text not null default '',
  insurance_expiry_date date,
  image_url text not null default '',
  document_url text not null default '',
  acquisition_journal_id bigint references ae_journals (id) on delete set null,
  created_by text not null default 'System',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, asset_number)
);

create index fixed_assets_company_status_idx on fixed_assets (company_id, status);
alter table fixed_assets enable row level security;
create policy "members can access their company's fixed assets" on fixed_assets for all using (user_can_access_company(company_id));

-- Full lifecycle history — Acquisition/Capitalisation/Improvement/
-- Transfer/Revaluation/Impairment/Disposal/WriteOff/Retirement. Every
-- event that moves money carries a real `journal_id`; Transfer/
-- Capitalisation are dimensional/status changes with no GL effect and
-- have a null `journal_id` by design, not by omission.
create table asset_lifecycle_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  asset_id bigint not null references fixed_assets (id) on delete cascade,
  event_type text not null check (event_type in (
    'Acquisition', 'Capitalisation', 'Improvement', 'Transfer', 'Revaluation',
    'Impairment', 'Disposal', 'WriteOff', 'Retirement'
  )),
  event_date date not null,
  description text not null default '',
  amount numeric(14, 2) not null default 0,
  journal_id bigint references ae_journals (id) on delete set null,
  metadata jsonb not null default '{}',
  performed_by text not null default 'System',
  created_at timestamptz not null default now()
);

create index asset_lifecycle_events_asset_id_idx on asset_lifecycle_events (asset_id);
alter table asset_lifecycle_events enable row level security;
create policy "members can access their company's asset lifecycle events" on asset_lifecycle_events for all using (user_can_access_company(company_id));

-- Depreciation Runs — one consolidated journal per run (real accounting
-- practice; see the migration's own header comment on why this isn't a
-- `posting_rules` event), with a per-asset breakdown in
-- `depreciation_run_lines` doubling as the required "audit history."
create table depreciation_runs (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  run_date date not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'Draft' check (status in ('Draft', 'Posted')),
  total_amount numeric(14, 2) not null default 0,
  journal_id bigint references ae_journals (id) on delete set null,
  created_by text not null default 'System',
  created_at timestamptz not null default now()
);

alter table depreciation_runs enable row level security;
create policy "members can access their company's depreciation runs" on depreciation_runs for all using (user_can_access_company(company_id));

create table depreciation_run_lines (
  id bigint generated always as identity primary key,
  run_id bigint not null references depreciation_runs (id) on delete cascade,
  asset_id bigint not null references fixed_assets (id) on delete cascade,
  depreciation_amount numeric(14, 2) not null default 0,
  accumulated_depreciation_after numeric(14, 2) not null default 0,
  net_book_value_after numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index depreciation_run_lines_run_id_idx on depreciation_run_lines (run_id);
create index depreciation_run_lines_asset_id_idx on depreciation_run_lines (asset_id);
alter table depreciation_run_lines enable row level security;
create policy "members can access their company's depreciation run lines" on depreciation_run_lines for all using (
  exists (select 1 from depreciation_runs r where r.id = run_id and user_can_access_company(r.company_id))
);

-- Asset Intelligence findings — same rich reason/evidence/recommended-
-- action/resolution shape as VAT/Banking Exceptions and Audit Findings.
-- Every one of the 10 signal types is asset-specific (never company-
-- wide), so a plain unique constraint is sufficient for idempotency —
-- unlike `executive_alerts`/`audit_findings`, there's no NULL-related-id
-- case to special-case here.
create table asset_findings (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  asset_id bigint not null references fixed_assets (id) on delete cascade,
  finding_type text not null check (finding_type in (
    'OverdueReplacement', 'Underutilisation', 'HighMaintenanceRisk', 'WarrantyExpiry', 'InsuranceExpiry',
    'UnusualDepreciation', 'ImpairmentIndicator', 'IdleAsset', 'HighValueAsset', 'CapitalisationAnomaly'
  )),
  confidence numeric(5, 2) not null default 0,
  reason text not null default '',
  evidence text not null default '',
  suggested_action text not null default '',
  status text not null default 'Open' check (status in ('Open', 'Resolved', 'Dismissed')),
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  unique (company_id, asset_id, finding_type, status)
);

create index asset_findings_company_status_idx on asset_findings (company_id, status);
alter table asset_findings enable row level security;
create policy "members can access their company's asset findings" on asset_findings for all using (user_can_access_company(company_id));

-- ---------------------------------------------------------------------
-- Auditor Workspace integration — "Auditor Workspace consumes asset
-- evidence." One new `audit_findings.finding_type` value, `AssetRisk`,
-- for `audit-intelligence-service.ts` to compose high-severity Asset
-- Findings into (real composition of the existing table — see that
-- migration's own comment on why a new Intelligence table was never
-- created for Module 10's own signal sources either).
-- ---------------------------------------------------------------------

alter table audit_findings drop constraint audit_findings_finding_type_check;
alter table audit_findings add constraint audit_findings_finding_type_check check (finding_type in (
  'DuplicatePayments', 'DuplicateSuppliers', 'DuplicateCustomers', 'DuplicateJournals', 'DuplicateVatClaims',
  'SequenceGaps', 'PostingDateTests', 'CutoffTests', 'BenfordAnalysis', 'LargeJournalTests',
  'WeekendPosting', 'HolidayPosting', 'ManualJournalReview', 'SuspenseAccountReview',
  'NegativeInventory', 'NegativeCash', 'AgedReconcilingItems', 'OrphanTransactions',
  'MaterialMisstatement', 'ControlWeakness', 'FraudIndicator', 'ComplianceRisk', 'UnusualTrend',
  'HighRiskJournal', 'HighRiskUser', 'RelatedPartyIndicator', 'GoingConcernRisk', 'RevenueManipulationIndicator',
  'AssetRisk'
));
