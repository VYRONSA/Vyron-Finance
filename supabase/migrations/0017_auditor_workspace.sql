-- Auditor Workspace & Audit Intelligence Platform (Module 10).
--
-- "Leverage the existing Audit Trail. Do not build another audit log."
-- Confirmed by research before writing this: `automation_audit_log`
-- (0014_automation_platform.sql) is automation-triggered only, and the
-- real drill-through chain (Business Event -> Journal -> GL -> Financial
-- Statements -> Source Documents) already exists via `ae_journals`
-- (source_type/source_id) and `gl_transactions.journal_id` — this
-- migration adds NO parallel logging table. `audit_findings` is a
-- results/evidence table (what a test or intelligence detector
-- produced), not a log of actions — a different, real, additive
-- concern, shaped identically to `vat_exceptions` (0015) for
-- consistency with the rest of the platform.

create table audit_engagements (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  financial_year_id bigint references financial_years (id) on delete set null,
  name text not null,
  materiality numeric(14, 2) not null default 0,
  performance_materiality numeric(14, 2) not null default 0,
  status text not null default 'Planning' check (status in ('Planning', 'Fieldwork', 'Review', 'Complete')),
  lead_auditor text not null default '',
  planning_notes text not null default '',
  created_by text not null default 'System',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index audit_engagements_company_id_idx on audit_engagements (company_id);
alter table audit_engagements enable row level security;
create policy "members can access their company's audit engagements" on audit_engagements for all using (user_can_access_company(company_id));

create table audit_areas (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  engagement_id bigint not null references audit_engagements (id) on delete cascade,
  name text not null,
  risk_level text not null default 'Medium' check (risk_level in ('Low', 'Medium', 'High')),
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index audit_areas_engagement_id_idx on audit_areas (engagement_id);
alter table audit_areas enable row level security;
create policy "members can access their company's audit areas" on audit_areas for all using (user_can_access_company(company_id));

create table audit_programme_steps (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  area_id bigint not null references audit_areas (id) on delete cascade,
  description text not null,
  is_complete boolean not null default false,
  assigned_to text not null default '',
  created_at timestamptz not null default now()
);

create index audit_programme_steps_area_id_idx on audit_programme_steps (area_id);
alter table audit_programme_steps enable row level security;
create policy "members can access their company's audit programme steps" on audit_programme_steps for all using (user_can_access_company(company_id));

create table audit_risk_register (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  engagement_id bigint not null references audit_engagements (id) on delete cascade,
  risk_description text not null,
  area text not null default '',
  likelihood text not null default 'Medium' check (likelihood in ('Low', 'Medium', 'High')),
  impact text not null default 'Medium' check (impact in ('Low', 'Medium', 'High')),
  response text not null default '',
  created_at timestamptz not null default now()
);

create index audit_risk_register_engagement_id_idx on audit_risk_register (engagement_id);
alter table audit_risk_register enable row level security;
create policy "members can access their company's audit risk register" on audit_risk_register for all using (user_can_access_company(company_id));

create table audit_team_assignments (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  engagement_id bigint not null references audit_engagements (id) on delete cascade,
  member_name text not null,
  role text not null default '',
  created_at timestamptz not null default now()
);

create index audit_team_assignments_engagement_id_idx on audit_team_assignments (engagement_id);
alter table audit_team_assignments enable row level security;
create policy "members can access their company's audit team assignments" on audit_team_assignments for all using (user_can_access_company(company_id));

-- Findings — both Audit TESTS (Duplicate Payments/Suppliers/Customers/
-- Journals/VAT Claims, Sequence Gaps, Posting Date Tests, Cut-off Tests,
-- Benford Analysis, Large Journal Tests, Weekend/Holiday Posting, Manual
-- Journal Review, Suspense Account Review, Negative Inventory/Cash, Aged
-- Reconciling Items, Orphan Transactions) and Audit INTELLIGENCE
-- (Material Misstatements, Control Weaknesses, Fraud Indicators,
-- Compliance Risks, Unusual Trends, High-Risk Journals/Users,
-- Related-Party Indicators, Going Concern Risks, Revenue Manipulation
-- Indicators) land in this one table, distinguished by `category` — same
-- rich reason/evidence/recommended-action/resolution shape as
-- `vat_exceptions`, so the Auditor Workspace's review workflow is
-- identical to the VAT/Banking Exception Centres auditors already know.
create table audit_findings (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  engagement_id bigint references audit_engagements (id) on delete set null,
  finding_type text not null check (finding_type in (
    'DuplicatePayments', 'DuplicateSuppliers', 'DuplicateCustomers', 'DuplicateJournals', 'DuplicateVatClaims',
    'SequenceGaps', 'PostingDateTests', 'CutoffTests', 'BenfordAnalysis', 'LargeJournalTests',
    'WeekendPosting', 'HolidayPosting', 'ManualJournalReview', 'SuspenseAccountReview',
    'NegativeInventory', 'NegativeCash', 'AgedReconcilingItems', 'OrphanTransactions',
    'MaterialMisstatement', 'ControlWeakness', 'FraudIndicator', 'ComplianceRisk', 'UnusualTrend',
    'HighRiskJournal', 'HighRiskUser', 'RelatedPartyIndicator', 'GoingConcernRisk', 'RevenueManipulationIndicator'
  )),
  category text not null default 'Test' check (category in ('Test', 'Intelligence')),
  severity text not null default 'Medium' check (severity in ('Low', 'Medium', 'High', 'Critical')),
  confidence numeric(5, 2) not null default 0,
  reason text not null default '',
  evidence text not null default '',
  suggested_procedure text not null default '',
  related_type text,
  related_id bigint,
  status text not null default 'Open' check (status in ('Open', 'Reviewed', 'Dismissed')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  unique (company_id, finding_type, related_type, related_id, status)
);

create index audit_findings_company_status_idx on audit_findings (company_id, status);
create index audit_findings_engagement_id_idx on audit_findings (engagement_id);
alter table audit_findings enable row level security;
create policy "members can access their company's audit findings" on audit_findings for all using (user_can_access_company(company_id));

-- Working Papers — generated FROM live data (Trial Balance/GL/VAT/
-- Findings), never hand-typed. `content` is a real jsonb structure the
-- Working Papers UI renders; `source_refs` (inside content) is what
-- keeps every paper traceable back to the transactions/accounts it was
-- built from.
create table audit_working_papers (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  engagement_id bigint references audit_engagements (id) on delete set null,
  paper_type text not null check (paper_type in (
    'LeadSchedule', 'SupportingSchedule', 'Reconciliation', 'AccountAnalysis', 'VarianceReport',
    'RiskSummary', 'ExceptionReport', 'SamplingList', 'AuditNote'
  )),
  title text not null,
  content jsonb not null default '{}',
  generated_at timestamptz not null default now(),
  generated_by text not null default 'System'
);

create index audit_working_papers_engagement_id_idx on audit_working_papers (engagement_id);
alter table audit_working_papers enable row level security;
create policy "members can access their company's audit working papers" on audit_working_papers for all using (user_can_access_company(company_id));

-- Auditor Queries — reusable saved audit procedures ("Transactions >
-- R500,000", "All journals posted on weekends", ...). `query_definition`
-- is a real, structured filter (source + conditions), evaluated by
-- `audit-query-service.ts` against the same GL/journal/bank repositories
-- every other module already reads from — no new query engine.
create table audit_queries (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  description text not null default '',
  query_definition jsonb not null default '{}',
  created_by text not null default 'System',
  created_at timestamptz not null default now()
);

create index audit_queries_company_id_idx on audit_queries (company_id);
alter table audit_queries enable row level security;
create policy "members can access their company's audit queries" on audit_queries for all using (user_can_access_company(company_id));
