-- GAAP-Compliant Financial Statements & Disclosure Engine (Module 13).
--
-- "The objective is not simply to print financial statements. The
-- objective is to generate professional, standards-compliant financial
-- reporting supported by complete audit traceability." This migration
-- adds NO new calculation table — the Statement of Financial Position,
-- Statement of Profit or Loss, and Statement of Cash Flows already exist
-- (Module 9's `financial-statements-service.ts`); the Statement of
-- Changes in Equity is a new pure engine added to that SAME file, not a
-- parallel one. What's new here is purely persistence for this module's
-- own generated artifacts: Disclosure Notes (real data where it exists,
-- an honest "requires user input" flag where it doesn't) and Reporting
-- Packages (a snapshot of which real statements/notes/narratives were
-- bundled together, reusing every existing generator — "no duplicated
-- calculations or reporting logic").

create table disclosure_notes (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  note_type text not null check (note_type in (
    'AccountingPolicies', 'SignificantJudgements', 'Estimates', 'FixedAssetNotes', 'InventoryNotes',
    'VatNotes', 'RevenueNotes', 'ExpenseNotes', 'RelatedPartyTransactions',
    'CommitmentsAndContingencies', 'EventsAfterReportingDate'
  )),
  title text not null,
  generated_content jsonb not null default '{}',
  requires_user_input boolean not null default false,
  user_notes text not null default '',
  generated_at timestamptz not null default now(),
  generated_by text not null default 'System',
  updated_at timestamptz not null default now(),
  unique (company_id, period_start, period_end, note_type)
);

create index disclosure_notes_company_id_idx on disclosure_notes (company_id, period_start, period_end);
alter table disclosure_notes enable row level security;
create policy "members can access their company's disclosure notes" on disclosure_notes for all using (user_can_access_company(company_id));

-- Reporting Packages — Management/Board/Accountant/Auditor Pack. `contents`
-- is a persisted SNAPSHOT (the same convention `copilot_narratives`/
-- `audit_working_papers` already use) of exactly which real statements,
-- disclosure notes, and narratives were bundled at generation time, so a
-- previously issued pack stays reproducible even if live data later
-- changes. Every value inside `contents` is itself the output of an
-- existing generator — this table stores the bundle, not a second
-- calculation of anything in it.
create table reporting_packages (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  package_type text not null check (package_type in (
    'ManagementPack', 'BoardPack', 'AccountantPack', 'AuditorPack'
  )),
  period_start date not null,
  period_end date not null,
  financial_year_label text not null default '',
  contents jsonb not null default '{}',
  generated_at timestamptz not null default now(),
  generated_by text not null default 'System'
);

create index reporting_packages_company_id_idx on reporting_packages (company_id, period_start, period_end);
alter table reporting_packages enable row level security;
create policy "members can access their company's reporting packages" on reporting_packages for all using (user_can_access_company(company_id));
