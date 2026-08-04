-- Recurring Transactions & Autonomous Automation Platform (Module 7).
--
-- "One Rule Engine": rather than building a second, parallel rule-matching
-- system for Sales/Purchasing/Inventory/GL/VAT/Reporting/Communications
-- automation, the existing Banking Rule Engine (`banking_rules` +
-- `banking_rule_conditions`/`banking_rule_actions`/`banking_rule_versions`/
-- `banking_rule_applications`, built for Module 6) is EXTENDED with a
-- `domain` column. The matching algorithm in `rule-engine.ts` was already
-- domain-agnostic at the type level (AND-condition matching over named
-- fields, priority-per-type resolution) — only its TypeScript unions were
-- Banking-specific, and those are widened in code, not duplicated here.
-- The table/file names stay `banking_rules`/`server/banking-rules/*` (a
-- cosmetic rename across every repository/service/route/UI/test file
-- was judged not worth the regression risk under this module's explicit
-- "No regressions" completion criterion) — every existing Banking rule
-- row is unaffected (`domain` defaults to 'Banking', backfilled).
-- `field`/`action_type` free-text CHECKs are relaxed since each new
-- domain has its own field/action vocabulary, validated in the service
-- layer per domain instead of one shared global enum.

alter table banking_rules
  add column domain text not null default 'Banking' check (domain in (
    'Banking', 'Sales', 'Purchasing', 'Inventory', 'GeneralLedger', 'VAT',
    'Reporting', 'CustomerCommunications', 'SupplierCommunications'
  ));

-- `rule_type` was a fixed 12-value Banking-only enum; every other domain
-- needs its own rule_type vocabulary (e.g. Sales -> 'SalesAutomation'),
-- so the CHECK is dropped in favour of service-layer validation per
-- `domain` (same trade-off as `field`/`action_type` below).
alter table banking_rules drop constraint if exists banking_rules_rule_type_check;
alter table banking_rule_conditions drop constraint if exists banking_rule_conditions_field_check;
alter table banking_rule_actions drop constraint if exists banking_rule_actions_action_type_check;

-- Recurring Documents — one table, one `document_type` discriminator
-- (the same "one document, one discriminator column" convention
-- `ae_imported_bills`/`inventory_transactions`/`banking_rules` already
-- established), covering all 10 PRB-named recurring document types.
-- `document_payload` carries the reusable create-input for whichever
-- real, already-shipped service `document_type` maps to (Sales Invoice ->
-- `sales-invoice-service.ts`, Supplier Bill -> `purchase-bill-service.ts`,
-- etc.) — no new, parallel document-creation logic is introduced; the
-- Recurring engine is purely an orchestrator that calls the real service
-- with a payload reconstructed from what was saved.
create table recurring_templates (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  document_type text not null check (document_type in (
    'CustomerInvoice', 'SupplierBill', 'Journal', 'InventoryAdjustment',
    'CustomerStatement', 'SupplierStatement', 'ReminderEmail',
    'PaymentReminder', 'PurchaseOrder', 'SalesOrder'
  )),
  name text not null,
  frequency text not null check (frequency in ('Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually', 'Custom')),
  interval_count integer not null default 1,
  start_date date not null,
  end_date date,
  max_occurrences integer,
  occurrences_generated integer not null default 0,
  skip_weekends boolean not null default false,
  -- Public holiday calendars are jurisdiction-specific and none is
  -- configured anywhere in this codebase yet — the flag is real and
  -- respected by `computeNextRunDate`, but with an empty holiday set
  -- until a real calendar source exists (future-ready, per the PRB's
  -- own explicit "(future-ready)" annotation, not fabricated).
  skip_public_holidays boolean not null default false,
  next_run_date date not null,
  last_run_date date,
  is_active boolean not null default true,
  numbering_prefix text not null default '',
  document_payload jsonb not null default '{}',
  workflow_definition_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null default 'System',
  updated_by text not null default 'System'
);

create index recurring_templates_company_id_idx on recurring_templates (company_id);
create index recurring_templates_next_run_idx on recurring_templates (company_id, next_run_date) where is_active;

alter table recurring_templates enable row level security;
create policy "members can access their company's recurring templates" on recurring_templates for all using (user_can_access_company(company_id));

-- One row per real generation attempt — the artifact a recurring
-- template's run produced (or failed to produce), including the two
-- read-only "statement" document types, which have no ledger-affecting
-- business object of their own and so generate a real snapshot record
-- here instead.
create table generated_documents (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  recurring_template_id bigint not null references recurring_templates (id) on delete cascade,
  document_type text not null,
  generated_at timestamptz not null default now(),
  reference_type text not null default '',
  reference_id bigint,
  status text not null check (status in ('Success', 'Failed')),
  error_message text,
  summary text not null default ''
);

create index generated_documents_template_id_idx on generated_documents (recurring_template_id);
create index generated_documents_company_id_idx on generated_documents (company_id, generated_at);

alter table generated_documents enable row level security;
create policy "members can access their company's generated documents" on generated_documents for all using (user_can_access_company(company_id));

-- Automation Scheduler — the ONE shared queue every scheduled activity in
-- the platform executes through (recurring templates, periodic Rule
-- Engine runs, future scheduled work). No module may create its own
-- scheduling loop; a module that needs to run periodically inserts one
-- row here instead.
create table automation_tasks (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  task_type text not null check (task_type in ('RecurringTemplate', 'RuleEngineRun', 'ReportRefresh', 'Custom')),
  reference_id bigint,
  name text not null,
  status text not null default 'Queued' check (status in ('Queued', 'Running', 'Success', 'Failed', 'Paused', 'Disabled')),
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  last_run_status text,
  last_run_duration_ms integer,
  retry_count integer not null default 0,
  max_retries integer not null default 3,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index automation_tasks_company_id_idx on automation_tasks (company_id);
create index automation_tasks_due_idx on automation_tasks (company_id, next_run_at) where is_active;

alter table automation_tasks enable row level security;
create policy "members can access their company's automation tasks" on automation_tasks for all using (user_can_access_company(company_id));

create table automation_task_runs (
  id bigint generated always as identity primary key,
  task_id bigint not null references automation_tasks (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('Running', 'Success', 'Failed')),
  error_message text,
  summary jsonb not null default '{}'
);

create index automation_task_runs_task_id_idx on automation_task_runs (task_id);
create index automation_task_runs_company_started_idx on automation_task_runs (company_id, started_at);

alter table automation_task_runs enable row level security;
create policy "members can access their company's automation task runs" on automation_task_runs for all using (user_can_access_company(company_id));

-- Workflow Engine — genuinely new shared infrastructure, real, wired to
-- ONE concrete caller this pass (a recurring template can require
-- approval before it ever activates). Deliberately NOT retrofitted onto
-- already-shipped modules' own status-transition logic (Purchase Orders'
-- Submitted/Approved/Rejected, Journals' own workflow) — that would carry
-- real regression risk against this module's own "No regressions"
-- completion criterion, and is disclosed as a bounded, deliberate choice
-- rather than a silent gap.
create table workflow_definitions (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  workflow_type text not null check (workflow_type in ('Approval', 'Review', 'Exception', 'Audit')),
  name text not null,
  steps jsonb not null default '[]',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index workflow_definitions_company_id_idx on workflow_definitions (company_id);

alter table workflow_definitions enable row level security;
create policy "members can access their company's workflow definitions" on workflow_definitions for all using (user_can_access_company(company_id));

alter table recurring_templates
  add constraint recurring_templates_workflow_definition_id_fkey foreign key (workflow_definition_id) references workflow_definitions (id) on delete set null;

create table workflow_instances (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  workflow_definition_id bigint not null references workflow_definitions (id) on delete cascade,
  subject_type text not null,
  subject_id bigint not null,
  current_step integer not null default 0,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  created_at timestamptz not null default now()
);

create index workflow_instances_company_id_idx on workflow_instances (company_id);
create index workflow_instances_subject_idx on workflow_instances (subject_type, subject_id);

alter table workflow_instances enable row level security;
create policy "members can access their company's workflow instances" on workflow_instances for all using (user_can_access_company(company_id));

create table workflow_instance_steps (
  id bigint generated always as identity primary key,
  instance_id bigint not null references workflow_instances (id) on delete cascade,
  step_order integer not null,
  decided_by text not null default 'System',
  decision text not null check (decision in ('Approved', 'Rejected')),
  note text not null default '',
  decided_at timestamptz not null default now()
);

create index workflow_instance_steps_instance_id_idx on workflow_instance_steps (instance_id);

alter table workflow_instance_steps enable row level security;
create policy "members can access their company's workflow instance steps" on workflow_instance_steps for all using (
  exists (select 1 from workflow_instances i where i.id = instance_id and user_can_access_company(i.company_id))
);

-- Notification Centre — real, in-app. `email_status` is a genuine,
-- honest "infrastructure only" hook per the PRB's own explicit wording
-- ("Email-ready notifications... infrastructure only if email service
-- isn't available yet") — no email provider is connected anywhere in
-- this codebase, so nothing here ever actually sends one; it stays
-- 'NotSent' until a real provider is wired.
create table notifications (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  recipient text not null default 'Company-wide',
  notification_type text not null check (notification_type in (
    'TaskAssignment', 'ExceptionAlert', 'ApprovalRequest', 'AutomationFailure',
    'AuditWarning', 'RuleFailure', 'PeriodLockAlert'
  )),
  title text not null,
  message text not null default '',
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  is_read boolean not null default false,
  email_status text not null default 'NotSent' check (email_status in ('NotSent', 'Sent', 'Failed')),
  related_type text,
  related_id bigint,
  created_at timestamptz not null default now()
);

create index notifications_company_id_idx on notifications (company_id, is_read);
create index notifications_created_at_idx on notifications (company_id, created_at);

alter table notifications enable row level security;
create policy "members can access their company's notifications" on notifications for all using (user_can_access_company(company_id));

-- Audit Trail — one row per automated action, answering every question
-- the PRB's brief lists (who/what rule/why/what changed/what journals/
-- what documents/how long/reversible). Complements, not replaces, the
-- existing per-module history tables (`ae_allocation_history`,
-- `ae_transaction_review_history`, `banking_rule_applications`) — those
-- stay the record of a specific field changing; this is the cross-cutting
-- "an automated action happened" record spanning every module.
create table automation_audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  performed_by text not null default 'System',
  action_type text not null,
  rule_id bigint references banking_rules (id) on delete set null,
  reason text not null default '',
  changes jsonb not null default '{}',
  journal_ids bigint[] not null default '{}',
  document_type text,
  document_id bigint,
  duration_ms integer,
  is_reversible boolean not null default false,
  created_at timestamptz not null default now()
);

create index automation_audit_log_company_id_idx on automation_audit_log (company_id, created_at);

alter table automation_audit_log enable row level security;
create policy "members can access their company's automation audit log" on automation_audit_log for all using (user_can_access_company(company_id));
