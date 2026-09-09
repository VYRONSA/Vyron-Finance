-- AI Executive Copilot & Financial Intelligence Platform (Module 12).
--
-- "This is a consumer of the existing intelligence layer — not a
-- replacement for it." "No duplicate intelligence logic exists." This
-- migration adds NO new signal-detection table — every score, finding,
-- and forecast the Copilot narrates or answers from already exists
-- (Modules 8-11's VAT/Executive/Audit/Asset Intelligence). What's new
-- here is purely persistence for the Copilot's own generated artifacts
-- (a saved What-If scenario result, a generated narrative, a daily
-- briefing) — real outputs of real calculations, never a parallel
-- calculation path.
--
-- "Scenarios must be isolated and never modify live accounting data" —
-- `copilot_scenarios` stores only the scenario's inputs and computed
-- outputs; nothing in this migration touches `fixed_assets`,
-- `gl_transactions`, or any other live accounting table.

create table copilot_scenarios (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  scenario_type text not null check (scenario_type in (
    'SalesIncrease', 'ReceiptDelay', 'SupplierPriceIncrease', 'AssetReplacement', 'OpexReduction', 'Hiring'
  )),
  parameters jsonb not null default '{}',
  results jsonb not null default '{}',
  created_by text not null default 'System',
  created_at timestamptz not null default now()
);

create index copilot_scenarios_company_id_idx on copilot_scenarios (company_id);
alter table copilot_scenarios enable row level security;
create policy "members can access their company's copilot scenarios" on copilot_scenarios for all using (user_can_access_company(company_id));

create table copilot_narratives (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  narrative_type text not null check (narrative_type in (
    'MonthEnd', 'QuarterEnd', 'YearEnd', 'BoardPack', 'ManagementReport',
    'CashFlowCommentary', 'BudgetVarianceExplanation', 'ProfitabilityCommentary'
  )),
  period_start date not null,
  period_end date not null,
  title text not null,
  content jsonb not null default '{}',
  generated_at timestamptz not null default now(),
  generated_by text not null default 'System'
);

create index copilot_narratives_company_id_idx on copilot_narratives (company_id, narrative_type);
alter table copilot_narratives enable row level security;
create policy "members can access their company's copilot narratives" on copilot_narratives for all using (user_can_access_company(company_id));

-- Executive Briefings — one real generated artifact per company per day,
-- composed entirely from already-computed scores (Financial Health,
-- Business Risk, Audit Readiness, Asset Health, VAT Compliance) — see
-- `executive-briefing-engine.ts`.
create table copilot_briefings (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  briefing_date date not null,
  content jsonb not null default '{}',
  generated_at timestamptz not null default now(),
  generated_by text not null default 'System',
  unique (company_id, briefing_date)
);

alter table copilot_briefings enable row level security;
create policy "members can access their company's copilot briefings" on copilot_briefings for all using (user_can_access_company(company_id));
