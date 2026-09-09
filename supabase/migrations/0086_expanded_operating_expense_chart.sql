-- Phase 26F — GL account structure investigation found: the existing
-- `seed_company_defaults()` (migrations 0007->0022) seeds exactly 26
-- accounts, of which only 4 are `Expense`-typed (Bank Charges, Inventory
-- Adjustments, VAT Adjustments, Depreciation Expense) — no Rent,
-- Salaries, Telephone, Insurance, Fuel, Professional Fees, etc. Since
-- `evidence-builder.ts::candidateAccountsFor` offers AI classification
-- only accounts whose `account_type` is Expense/Cost of Sales/Other
-- Expense (for a payment) or Income/Other Income (for a receipt), an
-- ordinary business expense transaction currently has as few as 4-8 real
-- candidate accounts to be classified against, company-wide.
--
-- Deliberately NOT a `create or replace` of `seed_company_defaults`
-- itself (a ~300-line function seeding VAT treatments, 26 accounts, and
-- ~20 posting rules) — reproducing that whole body verbatim here to add
-- a handful of new rows would be a needlessly large, error-prone
-- migration for what is purely an additive change. Instead: a small,
-- standalone, idempotent function or the exact same shape, called
-- alongside the existing one (never replacing it), so the existing
-- function's own tested behaviour is completely untouched.
--
-- Every new account code below is new (does not collide with any of the
-- 26 already seeded by `seed_company_defaults` — verified against that
-- function's own INSERT list in migration 0022). `on conflict ... do
-- nothing` makes this genuinely idempotent AND non-destructive: it can
-- never overwrite an existing account, never changes an existing
-- account's code, type, or any other field — it only ever inserts a row
-- that doesn't already exist for that company+code. A company that has
-- since renamed/deleted/deactivated one of these accounts, or already
-- has a same-named account under a different code, is completely
-- unaffected either way.
create or replace function seed_expanded_operating_expense_chart(p_company_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into chart_of_accounts (company_id, account_code, description, account_type, category, normal_balance, is_control_account)
  values
    -- Assets
    (p_company_id, '1010', 'Petty Cash', 'Asset', 'Current Asset', 'Debit', false),
    (p_company_id, '1200', 'Prepayments', 'Asset', 'Current Asset', 'Debit', false),
    (p_company_id, '1610', 'Motor Vehicles - Cost', 'Asset', 'Non-current Asset', 'Debit', false),
    (p_company_id, '1620', 'Computer Equipment - Cost', 'Asset', 'Non-current Asset', 'Debit', false),
    (p_company_id, '1630', 'Office Equipment - Cost', 'Asset', 'Non-current Asset', 'Debit', false),
    -- Liabilities
    (p_company_id, '2150', 'PAYE Payable', 'Liability', 'Current Liability', 'Credit', false),
    (p_company_id, '2160', 'UIF Payable', 'Liability', 'Current Liability', 'Credit', false),
    (p_company_id, '2170', 'SDL Payable', 'Liability', 'Current Liability', 'Credit', false),
    (p_company_id, '2400', 'Accrued Expenses', 'Liability', 'Current Liability', 'Credit', false),
    (p_company_id, '2500', 'Loans Payable', 'Liability', 'Non-current Liability', 'Credit', false),
    (p_company_id, '2600', 'Credit Card', 'Liability', 'Current Liability', 'Credit', false),
    -- Equity
    (p_company_id, '3200', 'Share Capital', 'Equity', 'Equity', 'Credit', false),
    (p_company_id, '3300', 'Drawings', 'Equity', 'Equity', 'Debit', false),
    (p_company_id, '3400', 'Director''s Loan Account', 'Equity', 'Equity', 'Credit', false),
    -- Income
    (p_company_id, '4200', 'Service Revenue', 'Income', 'Operating Income', 'Credit', false),
    (p_company_id, '4300', 'Discount Received', 'Income', 'Operating Income', 'Credit', false),
    (p_company_id, '4400', 'Other Operating Income', 'Other Income', 'Other Income', 'Credit', false),
    -- Cost of Sales
    (p_company_id, '5020', 'Direct Materials', 'Cost of Sales', 'Cost of Sales', 'Debit', false),
    (p_company_id, '5030', 'Direct Labour', 'Cost of Sales', 'Cost of Sales', 'Debit', false),
    (p_company_id, '5040', 'Freight In', 'Cost of Sales', 'Cost of Sales', 'Debit', false),
    -- Operating Expenses — the core gap this migration closes
    (p_company_id, '6800', 'Accounting & Audit Fees', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6810', 'Advertising & Marketing', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6820', 'Computer & Software', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6830', 'Consulting Fees', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6840', 'Courier & Delivery', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6850', 'Entertainment', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6860', 'Fuel & Motor Expenses', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6870', 'Insurance', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6880', 'Interest Paid', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6890', 'Legal & Professional Fees', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6900', 'Office Expenses', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6910', 'Printing & Stationery', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6920', 'Rent', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6930', 'Repairs & Maintenance', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6940', 'Salaries & Wages', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6950', 'Staff Welfare', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6960', 'Subscriptions & Licences', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6970', 'Telephone & Internet', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6980', 'Travel', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6990', 'Training & Development', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '7000', 'Utilities', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '7010', 'Cleaning', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '7020', 'Security', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '7030', 'Bad Debts', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '7040', 'Merchant / Card Fees', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '7050', 'Postage', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '7060', 'Small Equipment', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '7070', 'Protective Clothing', 'Expense', 'Operating Expense', 'Debit', false),
    -- Other Expense / Finance / Tax
    (p_company_id, '7080', 'Finance Costs', 'Other Expense', 'Other Expense', 'Debit', false),
    (p_company_id, '7090', 'Tax Expense', 'Other Expense', 'Other Expense', 'Debit', false)
  on conflict (company_id, account_code) do nothing;
end;
$$;

-- Backfill: every EXISTING company gets the expanded chart too — this is
-- what makes the one already-created company (and any other company
-- created before this migration) actually able to classify ordinary
-- expenses, not just companies created from now on.
do $$
declare
  v_company record;
begin
  for v_company in select id from companies loop
    perform seed_expanded_operating_expense_chart(v_company.id);
  end loop;
end $$;
