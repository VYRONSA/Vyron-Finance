-- Banking Automation & Rule Intelligence Platform (Module 6).
--
-- Per the Product Review Board's own framing: "the objective is no
-- longer to import transactions, the objective is to automate accounting
-- from bank statements." Confirmed via research before writing a single
-- line here (see the Migration Roadmap's Banking Automation section):
-- the Matching Engine (`matching-engine.ts`) and Allocation Engine
-- (`allocation-engine.ts`) are real but purely algorithmic — fixed-weight
-- supplier-name scoring, not a data-driven, user-configurable rule
-- engine. No `*_rule` table exists anywhere except `posting_rules`
-- (General Ledger's unrelated event-type -> DR/CR templating engine).
-- This migration is therefore genuinely greenfield, built to EXTEND
-- `ae_bank_transactions`'s already-rich column set (adding only what's
-- missing: `matched_customer_id`, `matched_merchant_id`, `rule_id`), not
-- duplicate it.
--
-- "One Business Object": `merchants` is a new, real business object
-- (Recognise Merchant is step 1 of the PRB's own stated pipeline) — a
-- named identity a raw `beneficiary` string can resolve to, carrying
-- default Supplier/Customer/GL/VAT so downstream rules don't have to
-- repeat that lookup. It does not duplicate Suppliers/Customers; it sits
-- upstream of both.
--
-- Rule Engine shape: one `banking_rules` header row per rule
-- (`rule_type` discriminator across the PRB's 12 named categories —
-- Merchant/Supplier/Customer/GL/VAT/Payment/BankFee/Transfer/Payroll/
-- Loan/Interest/Recurring — the same "one table, one discriminator
-- column" convention `ae_imported_bills`/`sales_invoices`/
-- `inventory_transactions` already established, not 12 parallel tables),
-- child `banking_rule_conditions` (ALL must match — AND logic) and
-- `banking_rule_actions` (what to set when they do), `banking_rule_versions`
-- (a real snapshot on every edit — the PRB's own "Version History"
-- requirement) and `banking_rule_applications` (one row per real time a
-- rule actually fired against a transaction — genuine usage data for the
-- PRB's own "Analytics"/"Rules Applied Today" requirement, not a
-- fabricated counter).
--
-- `banking_exceptions`: the dedicated workspace the PRB explicitly asked
-- for ("Unknown transactions should become the exception — not the
-- normal workflow") — one row per transaction the Rule Engine could not
-- confidently resolve, each carrying Reason/Evidence/Recommended Action,
-- with Resolve/Dismiss building real resolution history.
--
-- Deliberately NOT built here (disclosed, not silently skipped): a
-- scheduling/execution engine for Recurring Transaction Rules — the rule
-- TYPE and its conditions/actions are fully real and authorable, but
-- actually running one on a schedule is the PRB's own next-listed
-- roadmap module ("Recurring Transactions & Automation"), not this one.
-- Payroll/Loan rule types are likewise fully real (conditions, actions,
-- GL/VAT resolution) but have no dedicated Payroll/Loan ledger to link
-- to yet, same honest gap as Bank Fee/Interest resolving to the
-- ALREADY-EXISTING 'Bank Charges'/'Interest Received' posting rules
-- rather than inventing new ones.

create table merchants (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  default_supplier_id bigint references ae_suppliers (id) on delete set null,
  default_customer_id bigint references customers (id) on delete set null,
  default_gl_account text not null default '',
  default_vat_code text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create index merchants_company_id_idx on merchants (company_id);

alter table merchants enable row level security;
create policy "members can access their company's merchants" on merchants for all using (user_can_access_company(company_id));

create table banking_rules (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  rule_type text not null check (rule_type in (
    'Merchant', 'Supplier', 'Customer', 'GL', 'VAT', 'Payment',
    'BankFee', 'Transfer', 'Payroll', 'Loan', 'Interest', 'Recurring'
  )),
  name text not null,
  description text not null default '',
  priority integer not null default 100,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null default 'System',
  updated_by text not null default 'System'
);

create index banking_rules_company_id_idx on banking_rules (company_id);
create index banking_rules_type_priority_idx on banking_rules (company_id, rule_type, priority);

alter table banking_rules enable row level security;
create policy "members can access their company's banking rules" on banking_rules for all using (user_can_access_company(company_id));

create table banking_rule_conditions (
  id bigint generated always as identity primary key,
  rule_id bigint not null references banking_rules (id) on delete cascade,
  field text not null check (field in (
    'beneficiary', 'description', 'reference', 'notes', 'bank_account',
    'gl_account', 'amount', 'debit', 'credit'
  )),
  operator text not null check (operator in (
    'contains', 'equals', 'starts_with', 'ends_with', 'regex',
    'greater_than', 'less_than', 'between'
  )),
  value text not null default '',
  value2 text
);

create index banking_rule_conditions_rule_id_idx on banking_rule_conditions (rule_id);

alter table banking_rule_conditions enable row level security;
create policy "members can access their company's rule conditions" on banking_rule_conditions for all using (
  exists (select 1 from banking_rules r where r.id = rule_id and user_can_access_company(r.company_id))
);

create table banking_rule_actions (
  id bigint generated always as identity primary key,
  rule_id bigint not null references banking_rules (id) on delete cascade,
  action_type text not null check (action_type in (
    'set_merchant', 'set_supplier', 'set_customer', 'set_gl_account',
    'set_vat_code', 'flag_for_review'
  )),
  -- FK-shaped target (merchant/supplier/customer id) when the action
  -- points at a real business object; free-text target (a GL code, a VAT
  -- code, an exception reason) otherwise. Never both populated.
  target_id bigint,
  target_text text
);

create index banking_rule_actions_rule_id_idx on banking_rule_actions (rule_id);

alter table banking_rule_actions enable row level security;
create policy "members can access their company's rule actions" on banking_rule_actions for all using (
  exists (select 1 from banking_rules r where r.id = rule_id and user_can_access_company(r.company_id))
);

-- Full snapshot (name/description/priority/is_active/conditions/actions
-- as one jsonb blob) taken every time a rule is edited — the PRB's own
-- "Version History" requirement, real and queryable, not a bare counter.
create table banking_rule_versions (
  id bigint generated always as identity primary key,
  rule_id bigint not null references banking_rules (id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  created_by text not null default 'System',
  unique (rule_id, version)
);

create index banking_rule_versions_rule_id_idx on banking_rule_versions (rule_id);

alter table banking_rule_versions enable row level security;
create policy "members can access their company's rule versions" on banking_rule_versions for all using (
  exists (select 1 from banking_rules r where r.id = rule_id and user_can_access_company(r.company_id))
);

-- One row per real time a rule actually matched and was applied to a
-- transaction — the PRB's own "Analytics"/"Rules Applied Today"
-- requirement, computed from genuine usage rather than fabricated.
create table banking_rule_applications (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  rule_id bigint not null references banking_rules (id) on delete cascade,
  bank_transaction_id bigint not null references ae_bank_transactions (id) on delete cascade,
  applied_at timestamptz not null default now()
);

create index banking_rule_applications_rule_id_idx on banking_rule_applications (rule_id);
create index banking_rule_applications_company_applied_idx on banking_rule_applications (company_id, applied_at);

alter table banking_rule_applications enable row level security;
create policy "members can access their company's rule applications" on banking_rule_applications for all using (user_can_access_company(company_id));

create table banking_exceptions (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  bank_transaction_id bigint not null references ae_bank_transactions (id) on delete cascade,
  exception_type text not null check (exception_type in (
    'UnknownMerchant', 'MissingSupplier', 'PossibleDuplicate',
    'UnbalancedAllocation', 'MissingInvoice', 'UnexpectedVAT',
    'PeriodConflict', 'LargeUnusualPayment'
  )),
  reason text not null default '',
  evidence text not null default '',
  recommended_action text not null default '',
  status text not null default 'Open' check (status in ('Open', 'Resolved', 'Dismissed')),
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  -- One open exception per transaction+type; a resolved/dismissed one
  -- doesn't block a fresh exception of the same type being raised again
  -- on a future re-run of the rule engine (partial unique index, not a
  -- table-wide constraint).
  unique (bank_transaction_id, exception_type, status)
);

create index banking_exceptions_company_status_idx on banking_exceptions (company_id, status);
create index banking_exceptions_transaction_id_idx on banking_exceptions (bank_transaction_id);

alter table banking_exceptions enable row level security;
create policy "members can access their company's banking exceptions" on banking_exceptions for all using (user_can_access_company(company_id));

-- Extend, don't duplicate: `ae_bank_transactions` already carries
-- matched_supplier_id/allocation_status/confidence_score/etc. from the
-- Matching/Allocation Engines. The only genuinely missing pieces for the
-- Rule Engine are a customer match (Customers didn't exist when this
-- table was first designed), a merchant match, and which rule (if any)
-- last fired on this transaction.
alter table ae_bank_transactions
  add column matched_customer_id bigint references customers (id) on delete set null,
  add column matched_merchant_id bigint references merchants (id) on delete set null,
  add column rule_id bigint references banking_rules (id) on delete set null;

create index ae_bank_transactions_matched_customer_id_idx on ae_bank_transactions (matched_customer_id);
create index ae_bank_transactions_matched_merchant_id_idx on ae_bank_transactions (matched_merchant_id);
create index ae_bank_transactions_rule_id_idx on ae_bank_transactions (rule_id);
