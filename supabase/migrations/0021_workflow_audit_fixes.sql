-- Product Review Board — Workflow Completion Audit.
--
-- "Every time you find... incorrect posting... STOP. Fix the issue."
-- A full workflow audit (Sales/Purchasing/Inventory/Banking/Matching/
-- Reports/chrome) found that cancelling a Goods Received Note only
-- flipped its own status — it never reversed the `received_quantity` it
-- had added to the Purchase Order line, nor the real DR Inventory / CR
-- Goods Received Not Invoiced journal `createGoodsReceivedNote` posts
-- automatically for stock lines. That silently overstated inventory and
-- left an un-reversed liability on the books.
--
-- The correct fix needs a real reversing posting rule — the exact
-- inverse of the existing 'Goods Received' rule (DR Inventory / CR GRNI)
-- — since none of the existing Inventory rules ('Inventory Issue' posts
-- to Cost of Sales, 'Inventory Adjustment Decrease' posts to Inventory
-- Adjustments) correctly reverses a GRNI-clearing receipt. This is
-- `seed_company_defaults()`'s 7th definition — extended, not forked, per
-- every prior migration's own convention. No new chart-of-accounts rows
-- are needed: both accounts (1500 Inventory, 2050 Goods Received Not
-- Invoiced) already exist.

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
end;
$$;

do $$
declare
  v_company record;
  v_rule_id bigint;
begin
  for v_company in select id from companies loop
    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Goods Received Reversal') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Goods Received Reversal', 'Reversal of a cancelled goods received note') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'grni_clearing', '2050', 'gross'),
        (v_rule_id, 1, 'Credit', 'inventory', '1500', 'gross');
    end if;
  end loop;
end $$;
