-- Commercial Billing, Licensing & Subscription Platform (Phase 1 of the
-- Product Review Board's 9-phase commercial-launch program) — Sub-Phase
-- 0, schema foundation, part 1 of 6. "Never hardcode prices" — this is
-- the literal mechanism: the plan catalog, its per-cycle prices, its
-- entitlement limits, and its feature grants are all real rows in real
-- tables, seeded as data below, never a TypeScript constant.
--
-- Platform-wide, not tenant data — no `company_id` anywhere in this
-- file, matching the existing `currencies` table's own shape and RLS
-- (0006_company_management.sql): open read to any authenticated user,
-- no insert/update/delete policy at all (default deny) — only a
-- migration or a future Internal Billing Console server route using
-- `createAdminClient()` after a `requirePlatformPermission("ManageBilling")`
-- check may ever write to the catalog.
--
-- Six plan tiers, exactly as named by the directive: Free Trial,
-- Starter, Professional, Enterprise, Partner, Internal. Partner/Internal
-- are not customer-purchased (no seat fee), reflected as a single
-- `unit_amount = 0` monthly row rather than a full cycle matrix.
--
-- Known, disclosed reconciliation gap: the existing marketing pricing
-- page (`src/app/(marketing)/pricing/page.tsx`) shows a 4-tier ladder
-- (Starter/Professional/Business/Enterprise) that doesn't match this
-- catalog's 6 named tiers — "Business" has no equivalent here. Marketing
-- Website is Phase 8, out of scope now; left untouched deliberately, not
-- silently dropped. Documented again in BILLING_ARCHITECTURE.md.

create table subscription_plans (
  id bigint generated always as identity primary key,
  plan_key text not null unique check (plan_key in ('free_trial', 'starter', 'professional', 'enterprise', 'partner', 'internal')),
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table subscription_plan_prices (
  id bigint generated always as identity primary key,
  plan_id bigint not null references subscription_plans (id) on delete cascade,
  billing_cycle text not null check (billing_cycle in ('monthly', 'quarterly', 'annual', 'custom')),
  currency_code text not null references currencies (code),
  unit_amount numeric(14, 2) not null,
  is_active boolean not null default true,
  provider_price_id text, -- Stripe Price ID; stays null until Sub-Phase 8 populates it against a real Stripe account
  created_at timestamptz not null default now(),
  unique (plan_id, billing_cycle, currency_code)
);

-- The 8 limit keys named by the directive. limit_value = null is a real,
-- deliberate "unlimited" grant (same convention already established by
-- `role_approval_limits.max_amount` in 0025_rbac_platform.sql), not a
-- missing value.
create table subscription_plan_entitlements (
  id bigint generated always as identity primary key,
  plan_id bigint not null references subscription_plans (id) on delete cascade,
  limit_key text not null check (limit_key in (
    'max_users', 'max_companies', 'max_storage_mb', 'max_documents',
    'max_ai_requests_monthly', 'max_automation_runs_monthly',
    'max_api_calls_monthly', 'max_integrations'
  )),
  limit_value bigint,
  unique (plan_id, limit_key)
);

-- The 10 feature keys named by the directive.
create table feature_flags (
  id bigint generated always as identity primary key,
  feature_key text not null unique check (feature_key in (
    'ai_copilot', 'auditor_workspace', 'automation', 'fixed_assets', 'inventory',
    'manufacturing_integration', 'advanced_reporting', 'document_platform',
    'communication_platform', 'operations_centre'
  )),
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table subscription_plan_features (
  id bigint generated always as identity primary key,
  plan_id bigint not null references subscription_plans (id) on delete cascade,
  feature_id bigint not null references feature_flags (id) on delete cascade,
  is_enabled boolean not null default true,
  unique (plan_id, feature_id)
);

alter table subscription_plans enable row level security;
alter table subscription_plan_prices enable row level security;
alter table subscription_plan_entitlements enable row level security;
alter table feature_flags enable row level security;
alter table subscription_plan_features enable row level security;

create policy "any authenticated user can read the plan catalog" on subscription_plans for select using (auth.uid() is not null);
create policy "any authenticated user can read plan prices" on subscription_plan_prices for select using (auth.uid() is not null);
create policy "any authenticated user can read plan entitlements" on subscription_plan_entitlements for select using (auth.uid() is not null);
create policy "any authenticated user can read feature flags" on feature_flags for select using (auth.uid() is not null);
create policy "any authenticated user can read plan features" on subscription_plan_features for select using (auth.uid() is not null);

-- Seed: 6 plans.
insert into subscription_plans (plan_key, name, description, sort_order) values
  ('free_trial', 'Free Trial', 'Full-featured evaluation period before choosing a paid plan.', 0),
  ('starter', 'Starter', 'For a single company getting started with core accounting.', 1),
  ('professional', 'Professional', 'Multi-company accounting with automation and intelligence.', 2),
  ('enterprise', 'Enterprise', 'Full platform, highest limits, dedicated support.', 3),
  ('partner', 'Partner', 'External accounting partners managing client companies.', 4),
  ('internal', 'Internal', 'VYRON-operated companies (demos, staff, internal use).', 5);

-- Seed: prices. Free Trial/Partner/Internal are not customer-purchased —
-- a single zero-amount monthly row each, not a full cycle matrix.
insert into subscription_plan_prices (plan_id, billing_cycle, currency_code, unit_amount)
select id, 'monthly', 'ZAR', 0 from subscription_plans where plan_key in ('free_trial', 'partner', 'internal');

insert into subscription_plan_prices (plan_id, billing_cycle, currency_code, unit_amount)
select id, cycle, 'ZAR', amount
from subscription_plans, (values
  ('starter', 'monthly', 450.00), ('starter', 'quarterly', 1282.50), ('starter', 'annual', 4590.00),
  ('professional', 'monthly', 950.00), ('professional', 'quarterly', 2707.50), ('professional', 'annual', 9690.00),
  ('enterprise', 'monthly', 2400.00), ('enterprise', 'quarterly', 6840.00), ('enterprise', 'annual', 24480.00)
) as p(plan_key, cycle, amount)
where subscription_plans.plan_key = p.plan_key;

-- Seed: entitlements. null = unlimited.
insert into subscription_plan_entitlements (plan_id, limit_key, limit_value)
select sp.id, e.limit_key, e.limit_value
from subscription_plans sp
join (values
  ('free_trial', 'max_users', 3), ('free_trial', 'max_companies', 1), ('free_trial', 'max_storage_mb', 500),
  ('free_trial', 'max_documents', 100), ('free_trial', 'max_ai_requests_monthly', 50),
  ('free_trial', 'max_automation_runs_monthly', 50), ('free_trial', 'max_api_calls_monthly', 1000), ('free_trial', 'max_integrations', 1),

  ('starter', 'max_users', 5), ('starter', 'max_companies', 1), ('starter', 'max_storage_mb', 2000),
  ('starter', 'max_documents', 1000), ('starter', 'max_ai_requests_monthly', 200),
  ('starter', 'max_automation_runs_monthly', 500), ('starter', 'max_api_calls_monthly', 10000), ('starter', 'max_integrations', 2),

  ('professional', 'max_users', 20), ('professional', 'max_companies', 5), ('professional', 'max_storage_mb', 20000),
  ('professional', 'max_documents', 10000), ('professional', 'max_ai_requests_monthly', 2000),
  ('professional', 'max_automation_runs_monthly', 5000), ('professional', 'max_api_calls_monthly', 100000), ('professional', 'max_integrations', 10),

  ('enterprise', 'max_users', null), ('enterprise', 'max_companies', null), ('enterprise', 'max_storage_mb', null),
  ('enterprise', 'max_documents', null), ('enterprise', 'max_ai_requests_monthly', null),
  ('enterprise', 'max_automation_runs_monthly', null), ('enterprise', 'max_api_calls_monthly', null), ('enterprise', 'max_integrations', null),

  ('partner', 'max_users', 50), ('partner', 'max_companies', 25), ('partner', 'max_storage_mb', 50000),
  ('partner', 'max_documents', 25000), ('partner', 'max_ai_requests_monthly', 5000),
  ('partner', 'max_automation_runs_monthly', 10000), ('partner', 'max_api_calls_monthly', 250000), ('partner', 'max_integrations', 25),

  ('internal', 'max_users', null), ('internal', 'max_companies', null), ('internal', 'max_storage_mb', null),
  ('internal', 'max_documents', null), ('internal', 'max_ai_requests_monthly', null),
  ('internal', 'max_automation_runs_monthly', null), ('internal', 'max_api_calls_monthly', null), ('internal', 'max_integrations', null)
) as e(plan_key, limit_key, limit_value) on e.plan_key = sp.plan_key;

-- Seed: the 10 feature flags.
insert into feature_flags (feature_key, name, description) values
  ('ai_copilot', 'AI Executive Copilot', 'Executive Q&A, narrative generation, what-if scenarios.'),
  ('auditor_workspace', 'Auditor Workspace', 'Audit planning, automated tests, working papers.'),
  ('automation', 'Automation Platform', 'Recurring documents, scheduler, workflow engine.'),
  ('fixed_assets', 'Fixed Assets', 'Asset register, depreciation engine, asset intelligence.'),
  ('inventory', 'Inventory', 'Warehouses, stock items, FIFO costing.'),
  ('manufacturing_integration', 'Manufacturing Integration', 'VYRON COST business-event integration.'),
  ('advanced_reporting', 'Advanced Reporting', 'Report Designer, forecasting, executive intelligence.'),
  ('document_platform', 'Document Platform', 'Document storage, OCR, virus scanning integration points.'),
  ('communication_platform', 'Communication Platform', 'Email/SMS templates, communication queue.'),
  ('operations_centre', 'Operations Centre', 'Cross-tenant operational command centre.');

-- Seed: plan -> feature grants. Free Trial gets everything (full
-- evaluation); Starter gets the accounting core only; Professional adds
-- automation/reporting/documents/communications; Enterprise/Partner/
-- Internal get everything.
insert into subscription_plan_features (plan_id, feature_id, is_enabled)
select sp.id, ff.id, true
from subscription_plans sp
join feature_flags ff on true
where (sp.plan_key in ('free_trial', 'enterprise', 'partner', 'internal'))
   or (sp.plan_key = 'professional' and ff.feature_key not in ('manufacturing_integration'))
   or (sp.plan_key = 'starter' and ff.feature_key in ('inventory', 'document_platform'));
