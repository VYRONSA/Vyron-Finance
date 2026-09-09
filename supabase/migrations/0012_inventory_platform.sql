-- Inventory Platform (Commercial Platform, Module 5 — non-manufacturing).
--
-- Genuinely new — no reference-app equivalent, no manufacturing (that
-- belongs to VYRON COST; this migration only prepares the Integration
-- Centre layer for it, per the Product Review Board's explicit
-- instruction). Stock Master, Warehouses, real FIFO costing via
-- `stock_cost_layers`, and one unified `inventory_transactions` table
-- (Receipt/Issue/Transfer/Adjustment/StockTake/Return/WriteOff/
-- OpeningBalance via a `transaction_type` discriminator — the same "one
-- document, one discriminator column" shape `ae_imported_bills` and
-- `sales_invoices` already established, not a parallel per-type table
-- set).
--
-- "One Business Object" — Sales/Purchasing line tables are extended with
-- a nullable `stock_item_id`, NOT duplicated. A line with a stock item
-- is a real inventory movement; a line without one stays a free-text
-- service/note line exactly as before. This is what makes "Sales should
-- automatically reduce inventory" and "Purchasing should automatically
-- update inventory" real without inventing parallel sales/purchase
-- concepts inside the Inventory module itself.
--
-- Accounting integration, all through the one Posting Engine, no
-- dynamic per-item GL accounts (perpetual inventory convention: item
-- detail lives in the inventory sub-ledger below, Inventory/COGS/GRNI
-- stay single control accounts, the same "Debtors"/"Creditors" pattern
-- General Ledger already established):
--   Goods Received       -> DR Inventory        / CR GRNI Clearing
--   Inventory Bill        -> DR GRNI Clearing (net) / DR VAT Input (vat) / CR Creditors (gross)
--                            (a Bill whose Purchase Order carries stock
--                            items clears GRNI instead of re-expensing
--                            through 'Supplier Invoice' — see
--                            `purchase-bill-service.ts`)
--   Inventory Issue        -> DR COGS            / CR Inventory   (Sales Invoice approval, stock lines)
--   Inventory Return        -> DR Inventory        / CR COGS       (Sales Credit Note, when restocked)
--   Inventory Adjustment Increase -> DR Inventory  / CR Inventory Adjustments
--   Inventory Adjustment Decrease -> DR Inventory Adjustments / CR Inventory
-- Transfers and Opening Balances never post (same "no accounting impact"
-- precedent as Sales Orders/Deliveries/GRNs — a transfer doesn't change
-- what the company owns in total, and an opening balance is a
-- data-conversion fact, not a transaction, mirroring how this codebase
-- has never fabricated an "Opening Balance Equity" account nobody asked
-- for).
--
-- `seed_company_defaults()` has no existing backfill mechanism for
-- already-existing companies (confirmed: no later migration before this
-- one ever needed to add rows to `chart_of_accounts`/`posting_rules` for
-- companies created under an earlier schema version). This migration
-- both extends that function for future companies AND backfills the new
-- accounts/rules onto every company that already exists, idempotently.

-- ---------------------------------------------------------------------
-- Warehouses — no single existing table matches exactly (mirrors
-- `branches`' company_id/code/name/is_active shape, plus `is_default`
-- borrowed from the address tables' pattern).
-- ---------------------------------------------------------------------

create table warehouses (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  code text not null,
  name text not null,
  address text not null default '',
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

create index warehouses_company_id_idx on warehouses (company_id);

alter table warehouses enable row level security;
create policy "members can access their company's warehouses" on warehouses for all using (user_can_access_company(company_id));

create table warehouse_locations (
  id bigint generated always as identity primary key,
  warehouse_id bigint not null references warehouses (id) on delete cascade,
  code text not null,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (warehouse_id, code)
);

create index warehouse_locations_warehouse_id_idx on warehouse_locations (warehouse_id);

alter table warehouse_locations enable row level security;
create policy "members can access their warehouse's locations" on warehouse_locations for all using (
  exists (select 1 from warehouses w where w.id = warehouse_id and user_can_access_company(w.company_id))
);

-- ---------------------------------------------------------------------
-- Stock Items (Stock Master). `quantity_on_hand`/`average_cost` are
-- maintained running totals (updated by the service layer alongside
-- every inventory transaction), the same "maintained counter, not
-- recomputed from history on every read" convention
-- `sales_order_lines.delivered_quantity` already established — real
-- FIFO cost (the next unit's cost) is instead derived on demand from
-- `stock_cost_layers` below, since that genuinely does need the ledger.
-- Serial/Lot/Expiry are configuration flags here; the actual per-unit
-- values are captured on `inventory_transaction_lines` when a movement
-- involves an item that requires them — line-level capture, not a full
-- separate serial-unit status registry (see MIGRATION_ROADMAP.md for
-- the disclosed boundary).
-- ---------------------------------------------------------------------

create table stock_items (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  stock_code text not null,
  barcode text not null default '',
  description text not null,
  long_description text not null default '',
  category text not null default '',
  subcategory text not null default '',
  brand text not null default '',
  unit_of_measure text not null default 'Each',
  alternative_unit text not null default '',
  alternative_unit_factor numeric(14, 4) not null default 1,
  default_warehouse_id bigint references warehouses (id) on delete set null,
  default_location_id bigint references warehouse_locations (id) on delete set null,
  preferred_supplier_id bigint references ae_suppliers (id) on delete set null,
  selling_price numeric(14, 2) not null default 0,
  cost_price numeric(14, 2) not null default 0,
  quantity_on_hand numeric(14, 4) not null default 0,
  average_cost numeric(14, 2) not null default 0,
  minimum_stock numeric(14, 2) not null default 0,
  maximum_stock numeric(14, 2) not null default 0,
  reorder_level numeric(14, 2) not null default 0,
  safety_stock numeric(14, 2) not null default 0,
  tracks_serial_numbers boolean not null default false,
  tracks_lot_numbers boolean not null default false,
  has_expiry_date boolean not null default false,
  vat_treatment_code text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Inactive', 'Discontinued')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, stock_code)
);

create index stock_items_company_id_idx on stock_items (company_id);
create index stock_items_preferred_supplier_id_idx on stock_items (preferred_supplier_id);

alter table stock_items enable row level security;
create policy "members can access their company's stock items" on stock_items for all using (user_can_access_company(company_id));

-- Real FIFO ledger — consumed oldest-`received_date`-first on every
-- Issue/Transfer-out/Adjustment-decrease.
create table stock_cost_layers (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  stock_item_id bigint not null references stock_items (id) on delete cascade,
  warehouse_id bigint not null references warehouses (id),
  received_date date not null,
  quantity_remaining numeric(14, 4) not null,
  unit_cost numeric(14, 2) not null,
  created_at timestamptz not null default now()
);

create index stock_cost_layers_stock_item_id_idx on stock_cost_layers (stock_item_id);
create index stock_cost_layers_warehouse_id_idx on stock_cost_layers (warehouse_id);

alter table stock_cost_layers enable row level security;
create policy "members can access their company's stock cost layers" on stock_cost_layers for all using (user_can_access_company(company_id));

-- ---------------------------------------------------------------------
-- Inventory Transactions — the one unified movement ledger. Only
-- Receipt/Issue/Adjustment/Return/WriteOff/OpeningBalance ever carry a
-- `journal_id`; Transfer never does (no accounting impact — see header
-- comment).
-- ---------------------------------------------------------------------

create table inventory_transactions (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  transaction_type text not null check (transaction_type in ('Receipt', 'Issue', 'Transfer', 'Adjustment', 'StockTake', 'Return', 'WriteOff', 'OpeningBalance')),
  transaction_number text not null,
  transaction_date date not null,
  warehouse_id bigint not null references warehouses (id),
  destination_warehouse_id bigint references warehouses (id),
  status text not null default 'Draft' check (status in ('Draft', 'Submitted', 'Approved', 'Posted', 'Cancelled')),
  reference text not null default '',
  notes text not null default '',
  source_type text not null default '',
  source_id bigint,
  -- Only meaningful for transaction_type = 'Adjustment' — which of the
  -- two seeded posting rules ('Inventory Adjustment Increase'/
  -- 'Decrease') and which stock-movement direction (add a layer vs
  -- consume FIFO layers) applies. Null for every other type; kept as its
  -- own column rather than overloading `source_type` (which stays a
  -- genuine traceability link to an originating document).
  direction text check (direction in ('Increase', 'Decrease')),
  journal_id bigint references ae_journals (id) on delete set null,
  created_at timestamptz not null default now(),
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  posted_at timestamptz,
  cancelled_by text,
  cancelled_at timestamptz,
  unique (company_id, transaction_number)
);

create index inventory_transactions_company_id_idx on inventory_transactions (company_id);
create index inventory_transactions_warehouse_id_idx on inventory_transactions (warehouse_id);

alter table inventory_transactions enable row level security;
create policy "members can access their company's inventory transactions" on inventory_transactions for all using (user_can_access_company(company_id));

create table inventory_transaction_lines (
  id bigint generated always as identity primary key,
  transaction_id bigint not null references inventory_transactions (id) on delete cascade,
  line_order integer not null default 0,
  stock_item_id bigint not null references stock_items (id),
  quantity numeric(14, 4) not null,
  unit_cost numeric(14, 2) not null default 0,
  serial_number text not null default '',
  lot_number text not null default '',
  expiry_date date,
  notes text not null default ''
);

create index inventory_transaction_lines_transaction_id_idx on inventory_transaction_lines (transaction_id);
create index inventory_transaction_lines_stock_item_id_idx on inventory_transaction_lines (stock_item_id);

alter table inventory_transaction_lines enable row level security;
create policy "members can access their transaction's lines" on inventory_transaction_lines for all using (
  exists (select 1 from inventory_transactions t where t.id = transaction_id and user_can_access_company(t.company_id))
);

-- ---------------------------------------------------------------------
-- Stock Takes — counted vs system quantity; finalizing one creates a
-- real Inventory Adjustment transaction per variance line (see
-- `stock-take-service.ts`), never posts directly itself.
-- ---------------------------------------------------------------------

create table stock_takes (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  stock_take_number text not null,
  warehouse_id bigint not null references warehouses (id),
  count_date date not null,
  status text not null default 'Draft' check (status in ('Draft', 'Finalized', 'Cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  finalized_by text,
  finalized_at timestamptz,
  unique (company_id, stock_take_number)
);

create index stock_takes_company_id_idx on stock_takes (company_id);

alter table stock_takes enable row level security;
create policy "members can access their company's stock takes" on stock_takes for all using (user_can_access_company(company_id));

create table stock_take_lines (
  id bigint generated always as identity primary key,
  stock_take_id bigint not null references stock_takes (id) on delete cascade,
  stock_item_id bigint not null references stock_items (id),
  system_quantity numeric(14, 4) not null default 0,
  counted_quantity numeric(14, 4) not null default 0
);

create index stock_take_lines_stock_take_id_idx on stock_take_lines (stock_take_id);

alter table stock_take_lines enable row level security;
create policy "members can access their stock take's lines" on stock_take_lines for all using (
  exists (select 1 from stock_takes s where s.id = stock_take_id and user_can_access_company(s.company_id))
);

-- ---------------------------------------------------------------------
-- Integration Centre — the real connection-status registry for external
-- systems (VYRON COST initially). No actual synchronisation is
-- implemented in this module (there is no real VYRON COST API to call —
-- see MIGRATION_ROADMAP.md); this table exists so the UI can show a real
-- "Not Connected" status rather than a fabricated one, and so a future
-- module has a real place to write `last_synced_at` when a genuine
-- integration exists.
-- ---------------------------------------------------------------------

create table integration_connections (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  system_name text not null check (system_name in ('VYRON_COST')),
  status text not null default 'Not Connected' check (status in ('Not Connected', 'Connected', 'Error')),
  last_synced_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, system_name)
);

create index integration_connections_company_id_idx on integration_connections (company_id);

alter table integration_connections enable row level security;
create policy "members can access their company's integration connections" on integration_connections for all using (user_can_access_company(company_id));

-- ---------------------------------------------------------------------
-- "One Business Object" — Sales/Purchasing lines get an optional link to
-- a real stock item rather than a parallel inventory concept. Null for
-- every existing row (a free-text service/note line, exactly as before).
-- ---------------------------------------------------------------------

alter table sales_order_lines add column stock_item_id bigint references stock_items (id) on delete set null;
alter table sales_invoice_lines add column stock_item_id bigint references stock_items (id) on delete set null;
alter table delivery_lines add column stock_item_id bigint references stock_items (id) on delete set null;
alter table purchase_order_lines add column stock_item_id bigint references stock_items (id) on delete set null;
alter table goods_received_note_lines add column stock_item_id bigint references stock_items (id) on delete set null;

-- A GRN line needs its own real unit cost to value a Goods Received
-- inventory receipt — most naturally the originating PO line's price,
-- but a standalone GRN (no order_line_id) has no other source, so this
-- is captured directly rather than only working for PO-linked receipts.
alter table goods_received_note_lines add column unit_cost numeric(14, 2) not null default 0;

-- ---------------------------------------------------------------------
-- Chart of Accounts / Posting Rules — extend seed_company_defaults() for
-- future companies (full body copied from 0007_general_ledger.sql and
-- extended, since CREATE OR REPLACE FUNCTION requires the complete body,
-- not a diff), AND backfill every company that already exists —
-- genuinely new infrastructure this migration introduces, since no
-- earlier migration ever needed to add seed rows after a company was
-- already created.
-- ---------------------------------------------------------------------

create or replace function seed_company_defaults(p_company_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rule_id bigint;
begin
  insert into vat_treatments (company_id, code, name, rate) values
    (p_company_id, 'Standard Rated', 'Standard Rated', 15.00),
    (p_company_id, 'Zero Rated', 'Zero Rated', 0.00),
    (p_company_id, 'Exempt', 'Exempt', 0.00),
    (p_company_id, 'No VAT', 'No VAT', 0.00),
    (p_company_id, 'Fuel VAT', 'Fuel VAT', 0.00),
    (p_company_id, 'Import VAT', 'Import VAT', 15.00);

  insert into chart_of_accounts (company_id, account_code, description, account_type, category, normal_balance, is_control_account)
  values
    (p_company_id, '1000', 'Bank', 'Asset', 'Current Asset', 'Debit', false),
    (p_company_id, '1100', 'Debtors', 'Asset', 'Current Asset', 'Debit', true),
    (p_company_id, '1500', 'Inventory', 'Asset', 'Current Asset', 'Debit', true),
    (p_company_id, '2000', 'Creditors', 'Liability', 'Current Liability', 'Credit', true),
    (p_company_id, '2050', 'Goods Received Not Invoiced', 'Liability', 'Current Liability', 'Credit', true),
    (p_company_id, '2100', 'VAT Input', 'Asset', 'Current Asset', 'Debit', false),
    (p_company_id, '2200', 'VAT Output', 'Liability', 'Current Liability', 'Credit', false),
    (p_company_id, '3000', 'Retained Income', 'Equity', 'Equity', 'Credit', false),
    (p_company_id, '4000', 'Sales', 'Income', 'Operating Income', 'Credit', false),
    (p_company_id, '4100', 'Sales Returns', 'Income', 'Operating Income', 'Debit', false),
    (p_company_id, '5000', 'Purchases', 'Cost of Sales', 'Cost of Sales', 'Debit', false),
    (p_company_id, '5010', 'Cost of Sales', 'Cost of Sales', 'Cost of Sales', 'Debit', false),
    (p_company_id, '6100', 'Bank Charges', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6200', 'Interest Received', 'Other Income', 'Other Income', 'Credit', false),
    (p_company_id, '6300', 'Inventory Adjustments', 'Expense', 'Operating Expense', 'Debit', false),
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

  -- Inventory Bill: DR GRNI Clearing (net), DR VAT Input (vat), CR Creditors (gross) —
  -- clears what Goods Received capitalized, instead of re-expensing through Supplier Invoice
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Inventory Bill', 'Supplier bill for goods already received into inventory') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'grni_clearing', '2050', 'net'),
    (v_rule_id, 1, 'Debit', 'vat_input', '2100', 'vat'),
    (v_rule_id, 2, 'Credit', 'creditors', '2000', 'gross');

  -- Inventory Issue: DR Cost of Sales (gross), CR Inventory (gross) — COGS on a sales invoice's stock lines
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Inventory Issue', 'Cost of goods sold on a sales invoice') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'cost_of_sales', '5010', 'gross'),
    (v_rule_id, 1, 'Credit', 'inventory', '1500', 'gross');

  -- Inventory Return: DR Inventory (gross), CR Cost of Sales (gross) — restocked sales credit note
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
end;
$$;

-- Backfill: every company that already exists (created before this
-- migration) gets the new accounts/rules too, idempotently — see header
-- comment. Loops per-company since posting_rule_lines need each rule's
-- generated id.
do $$
declare
  v_company record;
  v_rule_id bigint;
begin
  for v_company in select id from companies loop
    insert into chart_of_accounts (company_id, account_code, description, account_type, category, normal_balance, is_control_account)
    select v_company.id, x.account_code, x.description, x.account_type, x.category, x.normal_balance, x.is_control_account
    from (values
      ('1500', 'Inventory', 'Asset', 'Current Asset', 'Debit', true),
      ('2050', 'Goods Received Not Invoiced', 'Liability', 'Current Liability', 'Credit', true),
      ('5010', 'Cost of Sales', 'Cost of Sales', 'Cost of Sales', 'Debit', false),
      ('6300', 'Inventory Adjustments', 'Expense', 'Operating Expense', 'Debit', false)
    ) as x(account_code, description, account_type, category, normal_balance, is_control_account)
    where not exists (
      select 1 from chart_of_accounts coa where coa.company_id = v_company.id and coa.account_code = x.account_code
    );

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Goods Received') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Goods Received', 'Goods received into inventory, not yet billed') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'inventory', '1500', 'gross'),
        (v_rule_id, 1, 'Credit', 'grni_clearing', '2050', 'gross');
    end if;

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Inventory Bill') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Inventory Bill', 'Supplier bill for goods already received into inventory') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'grni_clearing', '2050', 'net'),
        (v_rule_id, 1, 'Debit', 'vat_input', '2100', 'vat'),
        (v_rule_id, 2, 'Credit', 'creditors', '2000', 'gross');
    end if;

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Inventory Issue') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Inventory Issue', 'Cost of goods sold on a sales invoice') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'cost_of_sales', '5010', 'gross'),
        (v_rule_id, 1, 'Credit', 'inventory', '1500', 'gross');
    end if;

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Inventory Return') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Inventory Return', 'Stock restocked from a customer credit note') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'inventory', '1500', 'gross'),
        (v_rule_id, 1, 'Credit', 'cost_of_sales', '5010', 'gross');
    end if;

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Inventory Adjustment Increase') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Inventory Adjustment Increase', 'Stock adjustment increasing quantity on hand') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'inventory', '1500', 'gross'),
        (v_rule_id, 1, 'Credit', 'inventory_adjustment', '6300', 'gross');
    end if;

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Inventory Adjustment Decrease') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Inventory Adjustment Decrease', 'Stock adjustment decreasing quantity on hand') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'inventory_adjustment', '6300', 'gross'),
        (v_rule_id, 1, 'Credit', 'inventory', '1500', 'gross');
    end if;
  end loop;
end;
$$;
