-- General Ledger & Accounting Engine (Module 10).
--
-- The only real, working posting engine in the reference app lives in
-- the legacy single-company backend (`accounting/posting_engine.py` +
-- `posting_rules.py` + `journal_engine.py` + `general_ledger.py` +
-- `trial_balance.py`) — the multi-tenant `accounting_engine` world this
-- whole port is built from has none (its own `JournalService` docstring
-- says posting is "out of scope for Phase A"). This migration ports the
-- legacy engine's mechanics faithfully, adapted for multi-tenancy.
--
-- Chart of Accounts nesting, a database-driven Posting Rules engine, and
-- Financial Period locking do not exist in ANY reference implementation
-- (confirmed by full-codebase research) — these are genuinely new
-- capability, built deliberately rather than invented casually.

-- ---------------------------------------------------------------------
-- Chart of Accounts
-- ---------------------------------------------------------------------

create table chart_of_accounts (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  account_code text not null,
  description text not null,
  account_type text not null check (account_type in (
    'Asset', 'Liability', 'Equity', 'Income', 'Cost of Sales', 'Expense', 'Other Income', 'Other Expense'
  )),
  category text not null default '',
  normal_balance text not null check (normal_balance in ('Debit', 'Credit')),
  parent_account_id bigint references chart_of_accounts (id) on delete set null,
  reporting_group text not null default '',
  financial_statement_group text not null default '',
  tax_treatment text not null default '',
  branch_id bigint references branches (id) on delete set null,
  department_id bigint references departments (id) on delete set null,
  cost_centre_id bigint references cost_centres (id) on delete set null,
  is_control_account boolean not null default false,
  is_active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, account_code)
);

create index chart_of_accounts_company_id_idx on chart_of_accounts (company_id);
create index chart_of_accounts_parent_account_id_idx on chart_of_accounts (parent_account_id);

alter table chart_of_accounts enable row level security;
create policy "members can access their company's chart of accounts" on chart_of_accounts for all using (user_can_access_company(company_id));

-- ---------------------------------------------------------------------
-- Journal workflow — extend the existing ae_journals table (shipped in
-- 0005_transaction_explorer.sql) rather than replace it, so Transaction
-- Explorer's already-live "Generate Journal" keeps working unchanged.
-- ---------------------------------------------------------------------

alter table ae_journals drop constraint ae_journals_status_check;
alter table ae_journals add constraint ae_journals_status_check
  check (status in ('Draft', 'Submitted', 'Approved', 'Rejected', 'Posted', 'Cancelled'));

alter table ae_journals
  add column submitted_by text,
  add column submitted_at timestamptz,
  add column approved_by text,
  add column approved_at timestamptz,
  add column rejected_by text,
  add column rejected_at timestamptz,
  add column cancelled_by text,
  add column cancelled_at timestamptz,
  -- A flag layered on top of the reference's real mechanic (a brand-new
  -- offsetting journal) — not a rewrite of that mechanic. The original
  -- journal is flagged reversed; the reversal is its own separate,
  -- auto-approved journal linked back via reversal_of_journal_id.
  add column is_reversed boolean not null default false,
  add column reversal_of_journal_id bigint references ae_journals (id) on delete set null,
  add column reversed_by_journal_id bigint references ae_journals (id) on delete set null;

create table posting_batches (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  batch_number text not null,
  posting_date date not null,
  journal_count integer not null default 0,
  transaction_count integer not null default 0,
  posted_by text not null default 'System',
  created_at timestamptz not null default now(),
  unique (company_id, batch_number)
);

alter table posting_batches enable row level security;
create policy "members can access their company's posting batches" on posting_batches for all using (user_can_access_company(company_id));

alter table ae_journals
  add column posting_batch_id bigint references posting_batches (id) on delete set null;

-- ---------------------------------------------------------------------
-- The ledger — append-only by convention: only the posting engine ever
-- inserts here, nothing updates or deletes, matching the reference's own
-- stated invariant ("This is the ONLY place that ever writes to
-- gl_transactions... posted journals are never deleted").
-- ---------------------------------------------------------------------

create table gl_transactions (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  journal_id bigint not null references ae_journals (id),
  journal_line_id bigint not null references ae_journal_lines (id),
  account_id bigint not null references chart_of_accounts (id),
  posting_date date not null,
  reference text not null default '',
  description text not null default '',
  debit numeric(14, 2) not null default 0,
  credit numeric(14, 2) not null default 0,
  financial_year_label text not null default '',
  financial_period integer not null default 0,
  posted_at timestamptz not null default now(),
  posted_by text not null default 'System'
);

create index gl_transactions_company_id_idx on gl_transactions (company_id);
create index gl_transactions_account_id_idx on gl_transactions (company_id, account_id, posting_date);
create index gl_transactions_journal_id_idx on gl_transactions (journal_id);

alter table gl_transactions enable row level security;
create policy "members can access their company's GL transactions" on gl_transactions for all using (user_can_access_company(company_id));

-- ---------------------------------------------------------------------
-- Posting Rules — a database-driven rule engine replacing the
-- reference's hardcoded `posting_rules.py` Python dispatch functions,
-- per the explicit "nothing may hardcode journal entries" requirement.
-- `role` is a symbolic slot a rule line fills; when `fixed_account_code`
-- is null, the caller supplies that role's account when building a
-- journal from this rule (e.g. a specific bill's own GL account).
-- ---------------------------------------------------------------------

create table posting_rules (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  event_type text not null,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, event_type)
);

create table posting_rule_lines (
  id bigint generated always as identity primary key,
  posting_rule_id bigint not null references posting_rules (id) on delete cascade,
  line_order integer not null default 0,
  side text not null check (side in ('Debit', 'Credit')),
  role text not null,
  fixed_account_code text,
  amount_source text not null check (amount_source in ('gross', 'net', 'vat'))
);

create index posting_rules_company_id_idx on posting_rules (company_id);
create index posting_rule_lines_posting_rule_id_idx on posting_rule_lines (posting_rule_id);

alter table posting_rules enable row level security;
alter table posting_rule_lines enable row level security;
create policy "members can access their company's posting rules" on posting_rules for all using (user_can_access_company(company_id));
create policy "members can access their posting rule's lines" on posting_rule_lines for all using (
  exists (select 1 from posting_rules r where r.id = posting_rule_id and user_can_access_company(r.company_id))
);

-- ---------------------------------------------------------------------
-- Financial Periods — extends the real financial_years table Company
-- Management already shipped, rather than a parallel table. Neither
-- reference backend ever had period locking at all; this is genuinely
-- new, built deliberately.
-- ---------------------------------------------------------------------

alter table financial_years
  add column lock_date date,
  add column reopened_at timestamptz,
  add column reopened_by text;

-- ---------------------------------------------------------------------
-- Seed data — extends the seed_company_defaults() function Company
-- Management already added (0006), so createCompany()'s existing single
-- call site now also seeds a real, usable Chart of Accounts (the
-- reference's exact 11 default accounts, `accounting_engine/schema.py::
-- DEFAULT_CHART_OF_ACCOUNTS`, remapped onto the 8-type enum using each
-- account's own reference `category`) and the reference's exact 8
-- templated posting rules — now editable data instead of hardcoded code.
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
    (p_company_id, '2000', 'Creditors', 'Liability', 'Current Liability', 'Credit', true),
    (p_company_id, '2100', 'VAT Input', 'Asset', 'Current Asset', 'Debit', false),
    (p_company_id, '2200', 'VAT Output', 'Liability', 'Current Liability', 'Credit', false),
    (p_company_id, '3000', 'Retained Income', 'Equity', 'Equity', 'Credit', false),
    (p_company_id, '4000', 'Sales', 'Income', 'Operating Income', 'Credit', false),
    (p_company_id, '4100', 'Sales Returns', 'Income', 'Operating Income', 'Debit', false),
    (p_company_id, '5000', 'Purchases', 'Cost of Sales', 'Cost of Sales', 'Debit', false),
    (p_company_id, '6100', 'Bank Charges', 'Expense', 'Operating Expense', 'Debit', false),
    (p_company_id, '6200', 'Interest Received', 'Other Income', 'Other Income', 'Credit', false),
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
end;
$$;

-- ---------------------------------------------------------------------
-- Trial Balance — a DB-side aggregate for the same reason
-- `fn_transaction_explorer_summary` (0005) is one: pulling every
-- gl_transactions row client-side to sum per account would violate the
-- "100,000+ transactions" performance requirement once a company has been
-- running for a while. security invoker rides on gl_transactions' and
-- chart_of_accounts' own RLS; p_company_id is still filtered on
-- explicitly, matching this codebase's "never rely on RLS alone"
-- convention. Every active account is returned, even one with zero
-- movement — a Trial Balance is meant to show the whole chart, not just
-- accounts that happen to have activity.
create function fn_trial_balance(p_company_id uuid, p_as_of_date date default null)
returns table (
  account_id bigint,
  account_code text,
  description text,
  account_type text,
  normal_balance text,
  total_debit numeric,
  total_credit numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coa.id,
    coa.account_code,
    coa.description,
    coa.account_type,
    coa.normal_balance,
    coalesce(sum(gt.debit), 0) as total_debit,
    coalesce(sum(gt.credit), 0) as total_credit
  from chart_of_accounts coa
  left join gl_transactions gt
    on gt.account_id = coa.id
    and gt.company_id = coa.company_id
    and (p_as_of_date is null or gt.posting_date <= p_as_of_date)
  where coa.company_id = p_company_id and coa.is_active
  group by coa.id, coa.account_code, coa.description, coa.account_type, coa.normal_balance
  order by coa.account_code;
$$;

-- Account Activity's opening balance — the sum of everything posted to
-- one account before a given date. Same DB-side-aggregate reasoning as
-- fn_trial_balance: a high-volume control account (Bank, Debtors) could
-- have years of history by the time someone views its Account Activity
-- page, so this can't be a client-side reduce over every prior row.
create function fn_account_balance_before(p_company_id uuid, p_account_id bigint, p_before_date date)
returns table (total_debit numeric, total_credit numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
  from gl_transactions
  where company_id = p_company_id and account_id = p_account_id and posting_date < p_before_date;
$$;
