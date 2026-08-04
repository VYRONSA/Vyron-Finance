-- Product Review Board — Workflow Completion Audit: Cashbook & Bank
-- Reconciliation.
--
-- "I cannot find a proper Cashbook Processing workflow... that should be
-- treated as a first-class workspace." Confirmed by research: the ONLY
-- bank-transaction object in this codebase is `ae_bank_transactions`
-- (imported by Import Centre). "One Business Object" — the Cashbook
-- REUSES this exact table for manual capture rather than forking a
-- parallel `cashbook_entries` table. What's genuinely new: a manual
-- capture workflow (Draft->Submitted->Approved->Posted, distinct from
-- the imported-data `review_status`), batching, a real journal-side
-- linkage for money movements not tied to any customer/supplier invoice
-- (a raw cash receipt/payment against a user-chosen GL account, or a
-- transfer between two of the company's own bank accounts), and a real
-- Bank Reconciliation session per bank account.

alter table ae_bank_transactions
  add column entry_source text not null default 'Imported' check (entry_source in ('Imported', 'Manual')),
  add column capture_status text check (capture_status in ('Draft', 'Submitted', 'Approved', 'Posted', 'Cancelled')),
  add column cashbook_batch_id bigint,
  add column reconciliation_id bigint,
  add column reversal_of_transaction_id bigint references ae_bank_transactions (id) on delete set null;

create index ae_bank_transactions_capture_status_idx on ae_bank_transactions (company_id, capture_status) where capture_status is not null;
create index ae_bank_transactions_reconciliation_id_idx on ae_bank_transactions (reconciliation_id) where reconciliation_id is not null;
create index ae_bank_transactions_cashbook_batch_id_idx on ae_bank_transactions (cashbook_batch_id) where cashbook_batch_id is not null;

-- Cashbook Batch — groups manually-captured entries (Receipts/Payments/
-- Transfers/Mixed) for one Approve-and-Post action across all of them.
create table cashbook_batches (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  batch_number text not null,
  batch_date date not null,
  batch_type text not null check (batch_type in ('Receipts', 'Payments', 'Transfers', 'Mixed')),
  status text not null default 'Draft' check (status in ('Draft', 'Approved', 'Posted')),
  notes text not null default '',
  created_by text not null default 'System',
  created_at timestamptz not null default now(),
  unique (company_id, batch_number)
);

create index cashbook_batches_company_id_idx on cashbook_batches (company_id);
alter table cashbook_batches enable row level security;
create policy "members can access their company's cashbook batches" on cashbook_batches for all using (user_can_access_company(company_id));

alter table ae_bank_transactions
  add constraint ae_bank_transactions_cashbook_batch_id_fkey foreign key (cashbook_batch_id) references cashbook_batches (id) on delete set null;

-- Bank Reconciliation — one session per bank account per statement
-- period. `ae_bank_transactions.reconciliation_id` (added above) marks
-- which session a transaction was cleared in; unreconciled transactions
-- dated on/before `statement_date` for the same bank account ARE the
-- outstanding items (deposits/payments) — no separate line-item table
-- needed, the existing object carries the link directly.
create table bank_reconciliations (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  bank_account_id bigint not null references ae_bank_accounts (id) on delete cascade,
  statement_date date not null,
  statement_closing_balance numeric(14, 2) not null,
  gl_closing_balance numeric(14, 2),
  difference numeric(14, 2),
  status text not null default 'InProgress' check (status in ('InProgress', 'Completed', 'Reopened')),
  month_end_locked boolean not null default false,
  notes text not null default '',
  created_by text not null default 'System',
  created_at timestamptz not null default now(),
  completed_by text,
  completed_at timestamptz,
  reopened_by text,
  reopened_at timestamptz,
  reopen_reason text not null default ''
);

create index bank_reconciliations_company_account_idx on bank_reconciliations (company_id, bank_account_id, statement_date desc);
alter table bank_reconciliations enable row level security;
create policy "members can access their company's bank reconciliations" on bank_reconciliations for all using (user_can_access_company(company_id));

alter table ae_bank_transactions
  add constraint ae_bank_transactions_reconciliation_id_fkey foreign key (reconciliation_id) references bank_reconciliations (id) on delete set null;

-- New posting rules — Cashbook Receipt/Payment move money against a
-- user-chosen GL account (not necessarily a customer/supplier), and Bank
-- Transfer moves money between two of the company's OWN bank accounts.
-- All three use dynamic (fixed_account_code = null) roles resolved at
-- posting time: `bank_account`/`bank_account_from`/`bank_account_to` per
-- the specific `ae_bank_accounts.gl_account`, `dynamic_income`/
-- `dynamic_expense` per the GL account the preparer assigned at capture
-- time (`ae_bank_transactions.gl_account`, the same real column Import
-- Centre/Transaction Explorer already use for this exact purpose).
--
-- `seed_company_defaults()`'s 8th definition — extended, not forked, so
-- every NEW company gets these 3 rules immediately; the `do $$` block
-- below backfills them idempotently for companies that already exist.
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

  -- Goods Received Reversal: DR GRNI Clearing (gross), CR Inventory (gross) —
  -- the exact inverse of 'Goods Received', for cancelling an un-billed GRN.
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Goods Received Reversal', 'Reversal of a cancelled goods received note') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'grni_clearing', '2050', 'gross'),
    (v_rule_id, 1, 'Credit', 'inventory', '1500', 'gross');

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

  -- Cashbook Receipt: DR bank_account (dynamic, gross), CR dynamic_income (net), CR VAT Output (vat)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Cashbook Receipt', 'A cash receipt captured directly in the Cashbook, not tied to a customer invoice') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'bank_account', null, 'gross'),
    (v_rule_id, 1, 'Credit', 'dynamic_income', null, 'net'),
    (v_rule_id, 2, 'Credit', 'vat_output', '2200', 'vat');

  -- Cashbook Payment: DR dynamic_expense (net), DR VAT Input (vat), CR bank_account (dynamic, gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Cashbook Payment', 'A cash payment captured directly in the Cashbook, not tied to a supplier bill') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'dynamic_expense', null, 'net'),
    (v_rule_id, 1, 'Debit', 'vat_input', '2100', 'vat'),
    (v_rule_id, 2, 'Credit', 'bank_account', null, 'gross');

  -- Bank Transfer: DR bank_account_to (dynamic, gross), CR bank_account_from (dynamic, gross)
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Bank Transfer', 'A transfer of funds between two of the company''s own bank accounts') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'bank_account_to', null, 'gross'),
    (v_rule_id, 1, 'Credit', 'bank_account_from', null, 'gross');
end;
$$;

do $$
declare
  v_company record;
  v_rule_id bigint;
begin
  for v_company in select id from companies loop
    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Cashbook Receipt') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Cashbook Receipt', 'A cash receipt captured directly in the Cashbook, not tied to a customer invoice') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'bank_account', null, 'gross'),
        (v_rule_id, 1, 'Credit', 'dynamic_income', null, 'net'),
        (v_rule_id, 2, 'Credit', 'vat_output', '2200', 'vat');
    end if;

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Cashbook Payment') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Cashbook Payment', 'A cash payment captured directly in the Cashbook, not tied to a supplier bill') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'dynamic_expense', null, 'net'),
        (v_rule_id, 1, 'Debit', 'vat_input', '2100', 'vat'),
        (v_rule_id, 2, 'Credit', 'bank_account', null, 'gross');
    end if;

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Bank Transfer') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Bank Transfer', 'A transfer of funds between two of the company''s own bank accounts') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'bank_account_to', null, 'gross'),
        (v_rule_id, 1, 'Credit', 'bank_account_from', null, 'gross');
    end if;
  end loop;
end $$;
