-- Pilot Review Round 1, Phase 1+2 — Opening Balances Management Centre
-- and editable Bank Account opening balances.
--
-- `ManageOpeningBalances` is added to GLOBAL_PERMISSIONS in
-- `src/server/permissions/types.ts` as part of this same change.
-- `'OpeningBalance'` is added to APPROVAL_CATEGORIES the same way.
--
-- Deliberately NOT touching `seed_company_rbac_defaults()` (0025) to
-- grant this to future senior roles — that function has accumulated
-- many migrations of logic this pass doesn't have the full current text
-- to safely re-paste, the same reasoning 0028 and 0050 already used.
-- A small dedicated function does the same job for this one permission,
-- mirroring 0050's `grant_manage_billing_to_company_owner` exactly.

-- One real table per opening-balance line, company-scoped. A line
-- targets exactly one of account_code / bank_account_id / customer_id /
-- supplier_id depending on its category — enforced by the check
-- constraint below rather than five separate nullable-FK tables, so the
-- Opening Balances Centre can list/edit every category from one query.
-- `amount` follows the normal-balance sign convention already used by
-- Chart of Accounts (positive = a debit-side increase, negative =
-- credit-side); Debtors/Bank/GL-Asset lines are typically positive,
-- Creditors/Loans/VAT-Control-credit lines typically negative.
create table opening_balance_entries (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  category text not null check (category in (
    'GeneralLedger', 'BankAccount', 'Customer', 'Supplier', 'Inventory', 'FixedAsset', 'VATControl', 'Loan'
  )),
  account_code text,
  bank_account_id bigint references ae_bank_accounts (id) on delete cascade,
  customer_id bigint references customers (id) on delete cascade,
  supplier_id bigint references ae_suppliers (id) on delete cascade,
  description text not null default '',
  amount numeric(14, 2) not null default 0,
  reference text not null default '',
  balance_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'posted')),
  journal_id bigint references ae_journals (id) on delete set null,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exactly one target reference must be set, matching the row's own
  -- category — catches a wrong-category bug at the database layer, not
  -- just in application code.
  constraint opening_balance_entries_target_matches_category check (
    (category = 'BankAccount' and bank_account_id is not null and customer_id is null and supplier_id is null)
    or (category = 'Customer' and customer_id is not null and bank_account_id is null and supplier_id is null)
    or (category = 'Supplier' and supplier_id is not null and bank_account_id is null and customer_id is null)
    or (category in ('GeneralLedger', 'Inventory', 'FixedAsset', 'VATControl', 'Loan') and account_code is not null and bank_account_id is null and customer_id is null and supplier_id is null)
  )
);

create index opening_balance_entries_company_id_idx on opening_balance_entries (company_id);
create index opening_balance_entries_status_idx on opening_balance_entries (company_id, status);

alter table opening_balance_entries enable row level security;
create policy "members can access their company's opening balance entries" on opening_balance_entries for all using (user_can_access_company(company_id));

-- Editable post-creation Bank Account opening balance (Phase 2) — the
-- plain `opening_balance` column already exists (0003) but has no date/
-- reference and was create-only. Additive columns only; the existing
-- column and its semantics (feeds `current_balance` at creation) are
-- unchanged for backward compatibility with every row already written.
alter table ae_bank_accounts
  add column opening_balance_date date,
  add column opening_balance_reference text not null default '';

-- Widen the approval-category check constraint to add 'OpeningBalance' —
-- same drop/recreate pattern 0050 used for `notifications`' check.
alter table role_approval_limits drop constraint role_approval_limits_category_check;
alter table role_approval_limits add constraint role_approval_limits_category_check check (
  category in ('Journal', 'SupplierPayment', 'CustomerCreditNote', 'PurchaseApproval', 'AssetDisposal', 'OpeningBalance')
);

-- Grants `ManageOpeningBalances` to the 2 platform-scope roles
-- immediately (their `permission_roles` rows already exist, seeded once
-- in 0025) — matches 0050's platform-role grant for `ManageBilling`.
insert into role_permissions (role_id, permission_key)
select id, 'ManageOpeningBalances' from permission_roles where role_key in ('platform_super_administrator', 'platform_administrator')
on conflict (role_id, permission_key) do nothing;

-- Standalone, idempotent function granting `ManageOpeningBalances` and a
-- real `OpeningBalance` approval limit to one company's senior roles —
-- called once per existing company below (backfill) and from
-- `company-service.ts::createCompany` for every company created from
-- now on, alongside `seedCompanyRbacDefaults`/`grantManageBillingToCompanyOwner`.
-- Limits mirror the equivalent Journal/SupplierPayment ceilings already
-- seeded for the same roles in `seed_company_rbac_defaults()` (0025) —
-- Financial Manager capped, Financial Director/Managing Director/Company
-- Owner unlimited — since an opening-balance journal is exactly as
-- financially significant as any other journal entry.
create function grant_manage_opening_balances_defaults(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role record;
begin
  for v_role in
    select id, role_key from permission_roles
    where company_id = target_company_id
      and role_key in ('financial_manager', 'financial_director', 'managing_director', 'company_owner')
  loop
    insert into role_permissions (role_id, permission_key) values (v_role.id, 'ManageOpeningBalances')
    on conflict (role_id, permission_key) do nothing;

    insert into role_approval_limits (role_id, category, max_amount)
    values (v_role.id, 'OpeningBalance', case when v_role.role_key = 'financial_manager' then 500000 else null end)
    on conflict (role_id, category) do nothing;
  end loop;
end;
$$;

do $$
declare
  c record;
begin
  for c in select id from companies loop
    perform grant_manage_opening_balances_defaults(c.id);
  end loop;
end $$;
