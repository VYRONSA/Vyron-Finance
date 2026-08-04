-- VAT Intelligence & Tax Compliance Platform (Module 8).
--
-- Research confirmed (before writing anything here) that VAT math is
-- ALREADY genuinely centralized — `splitGrossAmount` in
-- `posting-rule-service.ts`, called from exactly one place
-- (`buildJournalLinesFromRule`), consumed identically by Sales/
-- Purchasing/Inventory's approve-and-post paths. There is no duplicated
-- VAT arithmetic to consolidate. What's genuinely missing (and what this
-- migration adds): a VAT TYPE taxonomy (today `vat_treatments` is a flat
-- code/name/rate with zero-rated/exempt/import/reverse-charge distinguished
-- only by convention in the name string), effective-dated rate history
-- (today `rate` is a bare mutable column — editing it would silently
-- change every historical calculation), and the VAT Return/Adjustment/
-- Exception entities themselves, which don't exist anywhere yet.
--
-- "One VAT Engine": `vat_treatments`/`splitGrossAmount`/
-- `buildJournalFromEvent` are EXTENDED, not replaced — the new
-- `server/vat/vat-engine.ts` (pure) wraps the existing split function
-- rather than reimplementing it, and every new posting rule below (VAT
-- Adjustment, Reverse Charge Self-Assessment) reuses the exact same
-- `posting_rules`/`posting_rule_lines` mechanism and terminates at the
-- same `postApprovedJournals` Posting Engine every other module uses.
--
-- "One Rule Engine": VAT automation rules use the SAME `banking_rules`
-- table (`domain = 'VAT'`, already schema-ready since Module 7) — no new
-- rule table.
--
-- "One Audit Trail": VAT Returns/Adjustments record into the EXISTING
-- `automation_audit_log` (Module 7) via `documentType = 'VatReturn'` /
-- `'VatAdjustment'` — no new audit table.

-- VAT type taxonomy — real structure, not string-matching on `name`.
alter table vat_treatments
  add column vat_type text not null default 'Standard' check (vat_type in (
    'Standard', 'ZeroRated', 'Exempt', 'OutsideScope', 'Import', 'Export', 'ReverseCharge'
  ));

update vat_treatments set vat_type = 'ZeroRated' where code = 'Zero Rated';
update vat_treatments set vat_type = 'Exempt' where code = 'Exempt';
update vat_treatments set vat_type = 'OutsideScope' where code = 'No VAT';
update vat_treatments set vat_type = 'ZeroRated' where code = 'Fuel VAT';
update vat_treatments set vat_type = 'Import' where code = 'Import VAT';
-- 'Standard Rated' keeps the column default ('Standard').

-- Effective-dated rate history — "Do not hardcode tax rates" / "Future
-- tax-rate changes / Effective dates" from the VAT Configuration brief.
-- `vat_treatments.rate` stays as a live convenience column (existing
-- callers are unaffected), but is now treated as a cache of whichever
-- history row is currently effective; `vat-engine.ts::resolveEffectiveRate`
-- is the one place that actually decides which rate applied on a given
-- date, so a future rate change never silently rewrites history.
create table vat_rate_history (
  id bigint generated always as identity primary key,
  vat_treatment_id bigint not null references vat_treatments (id) on delete cascade,
  rate numeric(5, 2) not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  created_by text not null default 'System'
);

create index vat_rate_history_treatment_id_idx on vat_rate_history (vat_treatment_id, effective_from);

alter table vat_rate_history enable row level security;
create policy "members can access their company's vat rate history" on vat_rate_history for all using (
  exists (select 1 from vat_treatments t where t.id = vat_treatment_id and user_can_access_company(t.company_id))
);

-- One history row per existing treatment, effective from its own
-- creation date, open-ended — real history from day one, not a gap.
insert into vat_rate_history (vat_treatment_id, rate, effective_from, created_by)
select id, rate, created_at::date, 'System' from vat_treatments;

-- VAT Return — generated from live GL data (VAT Input 2100 / VAT Output
-- 2200 account activity over the period), never a second source of
-- truth. `sars_reference`/`submission_method` are real, honest extension
-- points for future SARS eFiling — no submission logic exists behind
-- them (see vat-return-service.ts's own module docstring).
create table vat_returns (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'Draft' check (status in ('Draft', 'Review', 'Approved', 'Submitted')),
  total_output_vat numeric(14, 2) not null default 0,
  total_input_vat numeric(14, 2) not null default 0,
  net_payable numeric(14, 2) not null default 0,
  settlement_journal_id bigint,
  is_amendment boolean not null default false,
  amended_return_id bigint references vat_returns (id) on delete set null,
  sars_reference text,
  submission_method text not null default 'Manual' check (submission_method in ('Manual', 'SARS_eFiling')),
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  notes text not null default '',
  generated_at timestamptz not null default now(),
  generated_by text not null default 'System',
  unique (company_id, period_start, period_end, is_amendment, amended_return_id)
);

create index vat_returns_company_id_idx on vat_returns (company_id, period_start);

alter table vat_returns enable row level security;
create policy "members can access their company's vat returns" on vat_returns for all using (user_can_access_company(company_id));

-- VAT Adjustments — real, posts through the SAME Posting Engine via a
-- new 'VAT Adjustment Increase'/'VAT Adjustment Decrease' posting rule
-- pair (dynamic `vat_account` role, resolved to 2100 or 2200 by the
-- service depending which side is being corrected) — mirrors
-- Inventory's own Increase/Decrease posting-rule pattern exactly.
create table vat_adjustments (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  vat_return_id bigint references vat_returns (id) on delete set null,
  vat_treatment_id bigint references vat_treatments (id) on delete set null,
  direction text not null check (direction in ('Increase', 'Decrease')),
  target_account text not null check (target_account in ('VATInput', 'VATOutput')),
  amount numeric(14, 2) not null,
  reason text not null default '',
  adjustment_date date not null,
  journal_id bigint,
  status text not null default 'Draft' check (status in ('Draft', 'Approved')),
  created_by text not null default 'System',
  created_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz
);

create index vat_adjustments_company_id_idx on vat_adjustments (company_id, adjustment_date);

alter table vat_adjustments enable row level security;
create policy "members can access their company's vat adjustments" on vat_adjustments for all using (user_can_access_company(company_id));

-- VAT Exception Centre — same shape as Banking Exceptions (Module 6:
-- reason/evidence/recommended-action/status/resolution-history), a
-- separate table since the exception-type vocabulary and the documents
-- it links to (invoices/bills/adjustments/returns, not just bank
-- transactions) are genuinely different.
create table vat_exceptions (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  exception_type text not null check (exception_type in (
    'MissingVatNumber', 'IncorrectVatCode', 'UnexpectedVatPercentage',
    'LargeVatAdjustment', 'DuplicateVatClaim', 'VatRateConflict', 'CrossPeriodVat'
  )),
  document_type text not null,
  document_id bigint not null,
  reason text not null default '',
  evidence text not null default '',
  recommended_action text not null default '',
  status text not null default 'Open' check (status in ('Open', 'Resolved', 'Dismissed')),
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  unique (document_type, document_id, exception_type, status)
);

create index vat_exceptions_company_status_idx on vat_exceptions (company_id, status);
create index vat_exceptions_document_idx on vat_exceptions (document_type, document_id);

alter table vat_exceptions enable row level security;
create policy "members can access their company's vat exceptions" on vat_exceptions for all using (user_can_access_company(company_id));

-- New control accounts + posting rules — extends seed_company_defaults()
-- (now on its 5th definition; see 0007/0012's own header comments for
-- the same "extend, don't fork" convention) plus the standard idempotent
-- per-company backfill block.
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
    (p_company_id, '2000', 'Creditors', 'Liability', 'Current Liability', 'Credit', true),
    (p_company_id, '2050', 'Goods Received Not Invoiced', 'Liability', 'Current Liability', 'Credit', true),
    (p_company_id, '2100', 'VAT Input', 'Asset', 'Current Asset', 'Debit', false),
    (p_company_id, '2200', 'VAT Output', 'Liability', 'Current Liability', 'Credit', false),
    (p_company_id, '2300', 'VAT Control', 'Liability', 'Current Liability', 'Credit', true),
    (p_company_id, '3000', 'Retained Income', 'Equity', 'Equity', 'Credit', false),
    (p_company_id, '4000', 'Sales', 'Income', 'Operating Income', 'Credit', false),
    (p_company_id, '4100', 'Sales Returns', 'Income', 'Operating Income', 'Debit', false),
    (p_company_id, '5000', 'Purchases', 'Cost of Sales', 'Cost of Sales', 'Debit', false),
    (p_company_id, '5010', 'Cost of Sales', 'Cost of Sales', 'Cost of Sales', 'Debit', false),
    (p_company_id, '6100', 'Bank Charges', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6200', 'Interest Received', 'Other Income', 'Other Income', 'Credit', false),
    (p_company_id, '6300', 'Inventory Adjustments', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6400', 'VAT Adjustments', 'Expense', 'Operating Expense', 'Debit', false),
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
  -- — net-zero cash effect, both VAT boxes populated, per South African
  -- reverse-charge convention for imported services.
  insert into posting_rules (company_id, event_type, description) values (p_company_id, 'Reverse Charge Self-Assessment', 'Self-assessed VAT on imported services under the reverse charge mechanism') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'vat_input', '2100', 'gross'),
    (v_rule_id, 1, 'Credit', 'vat_output', '2200', 'gross');
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
      ('2300', 'VAT Control', 'Liability', 'Current Liability', 'Credit', true),
      ('6400', 'VAT Adjustments', 'Expense', 'Operating Expense', 'Debit', false)
    ) as x(account_code, description, account_type, category, normal_balance, is_control_account)
    where not exists (
      select 1 from chart_of_accounts coa where coa.company_id = v_company.id and coa.account_code = x.account_code
    );

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'VAT Adjustment Increase') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'VAT Adjustment Increase', 'Manual correction increasing a VAT Input or VAT Output balance') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'vat_account', null, 'gross'),
        (v_rule_id, 1, 'Credit', 'vat_adjustment', '6400', 'gross');
    end if;

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'VAT Adjustment Decrease') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'VAT Adjustment Decrease', 'Manual correction decreasing a VAT Input or VAT Output balance') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'vat_adjustment', '6400', 'gross'),
        (v_rule_id, 1, 'Credit', 'vat_account', null, 'gross');
    end if;

    if not exists (select 1 from posting_rules where company_id = v_company.id and event_type = 'Reverse Charge Self-Assessment') then
      insert into posting_rules (company_id, event_type, description) values (v_company.id, 'Reverse Charge Self-Assessment', 'Self-assessed VAT on imported services under the reverse charge mechanism') returning id into v_rule_id;
      insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
        (v_rule_id, 0, 'Debit', 'vat_input', '2100', 'gross'),
        (v_rule_id, 1, 'Credit', 'vat_output', '2200', 'gross');
    end if;
  end loop;
end;
$$;
