-- Commercial Billing Platform — Sub-Phase 0, part 2 of 6. The
-- subscription lifecycle state machine's real target, and the join that
-- makes "no ERP module manages company status itself" structurally
-- true: a company's billing lifecycle state is always a DERIVED READ
-- from its one governing subscription via `subscription_companies`,
-- never a stored/duplicated column. `companies.status` (0006) is
-- untouched — it stays the pure onboarding-progress enum it already was
-- ('active'/'needs-attention'/'onboarding'), unrelated to billing.

create table billing_accounts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null unique references organisations (id) on delete cascade,
  billing_email text not null,
  billing_contact_name text not null default '',
  tax_number text not null default '',
  billing_address text not null default '',
  default_currency_code text not null references currencies (code),
  provider_customer_id text, -- Stripe Customer ID, populated once Sub-Phase 8 connects a real provider
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The 8-state subscription lifecycle named by the directive, in full:
-- Trial -> Active -> Past Due -> Grace Period -> Suspended -> Cancelled
-- -> Expired -> Archived. Legal transitions between these are enforced
-- in application code (`subscription-lifecycle-engine.ts::canTransition`,
-- a pure, table-driven, exhaustively unit-tested function) rather than a
-- DB trigger, matching this codebase's established preference for
-- business-rule logic living in TypeScript over the database (e.g.
-- journal status transitions, `posting_rule_lines.role`).
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references billing_accounts (id) on delete cascade,
  plan_id bigint not null references subscription_plans (id),
  billing_cycle text not null check (billing_cycle in ('monthly', 'quarterly', 'annual', 'custom')),
  currency_code text not null references currencies (code),
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'grace_period', 'suspended', 'cancelled', 'expired', 'archived')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  provider text not null default 'manual' check (provider in ('stripe', 'manual', 'migrated')),
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_billing_account_id_idx on subscriptions (billing_account_id);
create unique index subscriptions_provider_sub_id_idx on subscriptions (provider, provider_subscription_id) where provider_subscription_id is not null;

-- Every transition, audited — the one place "why is this company
-- suspended" gets answered, and what the Internal Billing Console's
-- "Customer Activity" tab reads from.
create table subscription_status_history (
  id bigint generated always as identity primary key,
  subscription_id uuid not null references subscriptions (id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text not null default '',
  performed_by text not null,
  occurred_at timestamptz not null default now()
);
create index subscription_status_history_subscription_id_idx on subscription_status_history (subscription_id);

create table subscription_companies (
  id bigint generated always as identity primary key,
  subscription_id uuid not null references subscriptions (id) on delete cascade,
  company_id uuid not null unique references companies (id) on delete cascade,
  added_at timestamptz not null default now()
);
create index subscription_companies_subscription_id_idx on subscription_companies (subscription_id);

alter table billing_accounts enable row level security;
alter table subscriptions enable row level security;
alter table subscription_status_history enable row level security;
alter table subscription_companies enable row level security;

-- Read: an organisation member (real, pre-existing membership table) OR
-- anyone `user_can_access_company()` already lets in (which itself
-- covers both "a company-scoped member of a linked company" and
-- "a platform-scope role" — see 0036_tenant_isolation_fix.sql, no
-- separate platform-scope branch needed here).
create policy "org members can read their billing account" on billing_accounts for select using (
  exists (select 1 from organisation_members om where om.organisation_id = billing_accounts.organisation_id and om.user_id = auth.uid())
  or exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)
);
-- Write: user-initiated billing actions (Subscribe/Upgrade/...) go
-- through the normal session client after `requirePermission(companyId,
-- "ManageBilling")`, so a real INSERT/UPDATE policy is needed here (not
-- an admin-client-only table) — scoped identically to the read policy.
create policy "org members can write their billing account" on billing_accounts for all using (
  exists (select 1 from organisation_members om where om.organisation_id = billing_accounts.organisation_id and om.user_id = auth.uid())
  or exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)
);

create policy "members can read their company's governing subscription" on subscriptions for select using (
  exists (select 1 from subscription_companies sc where sc.subscription_id = subscriptions.id and user_can_access_company(sc.company_id))
  or exists (select 1 from billing_accounts ba join organisation_members om on om.organisation_id = ba.organisation_id
             where ba.id = subscriptions.billing_account_id and om.user_id = auth.uid())
);
create policy "members can write their company's governing subscription" on subscriptions for all using (
  exists (select 1 from subscription_companies sc where sc.subscription_id = subscriptions.id and user_can_access_company(sc.company_id))
  or exists (select 1 from billing_accounts ba join organisation_members om on om.organisation_id = ba.organisation_id
             where ba.id = subscriptions.billing_account_id and om.user_id = auth.uid())
);

create policy "members can read their subscription's status history" on subscription_status_history for select using (
  exists (select 1 from subscriptions s
          join subscription_companies sc on sc.subscription_id = s.id
          where s.id = subscription_status_history.subscription_id and user_can_access_company(sc.company_id))
  or exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)
);
-- History rows are written by the engine alongside the subscription
-- write itself (same transaction-equivalent request), through the same
-- session client and the same access check as the subscription row.
create policy "members can insert their subscription's status history" on subscription_status_history for insert with check (
  exists (select 1 from subscriptions s
          join subscription_companies sc on sc.subscription_id = s.id
          where s.id = subscription_status_history.subscription_id and user_can_access_company(sc.company_id))
  or exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)
);

create policy "members can read their company's subscription link" on subscription_companies for select using (user_can_access_company(company_id));
create policy "members can write their company's subscription link" on subscription_companies for all using (user_can_access_company(company_id));
