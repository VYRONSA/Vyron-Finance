-- RC1 Phase 5 — ONE shared Communication Platform. Not an email sender:
-- every outbound communication on any channel (Email now; InApp Notification
-- reuses the existing 0014 `notifications` table as its real delivery
-- target; SMS/WhatsApp/Teams/Slack/Push are named channels with no
-- implementation yet, honestly disclosed rather than faked) produces ONE
-- row in `communications` — never a per-module logging table. Approval
-- reuses the EXISTING generic Workflow Engine from 0014
-- (`workflow_definitions`/`workflow_instances`) rather than inventing a
-- second approval mechanism, per the Product Review Board's explicit
-- instruction. Queue processing reuses the EXISTING Automation Scheduler
-- (`automation_tasks`) rather than inventing a second scheduler loop — a
-- `CommunicationQueue` task type is added to its existing dispatch, so
-- `scheduler-service.ts::runDueTasks` is still the ONE place scheduled
-- work executes.

alter table automation_tasks drop constraint automation_tasks_task_type_check;
alter table automation_tasks add constraint automation_tasks_task_type_check
  check (task_type in ('RecurringTemplate', 'RuleEngineRun', 'ReportRefresh', 'CommunicationQueue', 'Custom'));

create table communication_templates (
  id bigint generated always as identity primary key,
  company_id uuid references companies (id) on delete cascade, -- null = platform-wide default, not company-specific
  code text not null, -- e.g. 'PaymentReminder', 'CustomerStatement' — the recurring/business trigger this template answers
  name text not null,
  channel text not null check (channel in ('Email', 'InApp', 'SMS', 'WhatsApp', 'Teams', 'Slack', 'Push')),
  category text not null default 'General',
  subject_template text, -- null for channels with no subject line (InApp, SMS, ...)
  body_template text not null, -- {{variable}} substitution + {{#if variable}}...{{/if}} conditional sections — see template-engine.ts
  variables_schema jsonb not null default '[]', -- [{name, description, example}] — drives the admin UI's variable picker
  branding jsonb not null default '{}', -- {logoUrl, primaryColor, footerText}
  requires_approval boolean not null default false,
  approval_workflow_definition_id bigint references workflow_definitions (id) on delete set null,
  is_active boolean not null default true,
  version int not null default 1,
  created_by text not null default 'System',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code, channel)
);

create index communication_templates_company_idx on communication_templates (company_id);

create table communication_template_versions (
  id bigint generated always as identity primary key,
  template_id bigint not null references communication_templates (id) on delete cascade,
  version_number int not null,
  subject_template text,
  body_template text not null,
  changed_by text not null default 'System',
  created_at timestamptz not null default now()
);

create index communication_template_versions_template_idx on communication_template_versions (template_id);

-- The one shared record every outbound communication produces, on every
-- channel, from every module — the directive's own field list, verbatim.
create table communications (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  module text not null, -- 'Sales' | 'Purchasing' | 'CustomerManagement' | 'SupplierManagement' | 'FinancialStatements' | 'Auditor' | 'Automation' | 'AICopilot' | ... (free text — spans modules beyond the fixed PermissionModule union, e.g. Automation/AICopilot)
  business_object_type text,
  business_object_id bigint,
  template_id bigint references communication_templates (id),
  channel text not null check (channel in ('Email', 'InApp', 'SMS', 'WhatsApp', 'Teams', 'Slack', 'Push')),
  recipients jsonb not null default '[]', -- [{type:'Customer'|'Supplier'|'User'|'Email', id, name, address}]
  subject text,
  body text not null,
  variables jsonb not null default '{}',
  status text not null default 'Draft' check (status in ('Draft', 'PendingApproval', 'Rejected', 'Queued', 'Sending', 'Sent', 'Failed', 'Cancelled', 'Expired')),
  priority text not null default 'Normal' check (priority in ('Low', 'Normal', 'High', 'Urgent')),
  scheduled_for timestamptz not null default now(),
  expires_at timestamptz,
  retry_count int not null default 0,
  max_retries int not null default 3,
  next_retry_at timestamptz,
  sent_at timestamptz,
  delivery_result jsonb,
  failure_reason text,
  approval_workflow_instance_id bigint references workflow_instances (id) on delete set null,
  related_notification_id bigint references notifications (id) on delete set null, -- set when channel = 'InApp' — the row this communication actually delivered as
  audit_ref text,
  created_by text not null default 'System',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index communications_company_status_idx on communications (company_id, status, scheduled_for);
create index communications_business_object_idx on communications (company_id, business_object_type, business_object_id);

alter table communication_templates enable row level security;
alter table communication_template_versions enable row level security;
alter table communications enable row level security;

-- Templates are administrative configuration (what every future send in
-- the company looks like) — the same posture as Roles & Permissions, so
-- writes require SystemAdministration via the Phase 1 Permission Engine's
-- own `user_has_permission()`, not mere membership. This is deliberately
-- NOT the same bar as `permission_roles` (which needed role-awareness
-- because a hole there lets a member grant themselves privilege) — a
-- template edit cannot escalate privilege, so requiring one real global
-- permission (rather than a security-definer-only write path) is
-- proportionate, matching how every other admin-configuration surface in
-- this codebase (e.g. `banking_rules`) is gated.
create policy "read company templates" on communication_templates for select
  using (company_id is null or user_can_access_company(company_id));
create policy "manage company templates with SystemAdministration" on communication_templates for insert with check (
  user_has_permission(company_id, 'SystemAdministration')
);
create policy "update company templates with SystemAdministration" on communication_templates for update using (
  user_has_permission(company_id, 'SystemAdministration')
);
create policy "delete company templates with SystemAdministration" on communication_templates for delete using (
  user_has_permission(company_id, 'SystemAdministration')
);

create policy "read template version history" on communication_template_versions for select using (
  exists (select 1 from communication_templates t where t.id = template_id and (t.company_id is null or user_can_access_company(t.company_id)))
);
create policy "write template version history with SystemAdministration" on communication_template_versions for insert with check (
  exists (select 1 from communication_templates t where t.id = template_id and user_has_permission(t.company_id, 'SystemAdministration'))
);

-- Communications themselves are a log of what the app already decided to
-- send, gated upstream by each originating module's own permission
-- (`requirePermission` in `communication-service.ts`) — membership-level
-- RLS is proportionate here (unlike `permission_roles`, queuing a
-- communication cannot escalate anyone's privilege).
create policy "members can access their company's communications" on communications for all using (user_can_access_company(company_id));

/** Seeds the 3 real recurring-template-facing templates (Payment
 * Reminder, Customer Statement, Supplier Statement — the only real,
 * already-shipped "communication actions" this pass found anywhere in
 * the codebase, see `recurring-template-service.ts`) plus one default
 * "Communication Approval" workflow definition, plus the singleton
 * `automation_tasks` row that makes the Communication Queue actually get
 * processed by the existing Scheduler. Idempotent — safe to call for a
 * company that already has these. Standalone (not folded into the
 * pre-existing giant `seed_company_defaults()`), matching the same
 * reasoning `seed_company_rbac_defaults()` used in 0025: avoids touching
 * an already-large function this pass didn't need to change. */
create function seed_company_communication_defaults(target_company_id uuid)
returns void
language plpgsql
as $$
declare
  approval_def_id bigint;
begin
  if exists (select 1 from communication_templates where company_id = target_company_id) then
    return;
  end if;

  insert into workflow_definitions (company_id, workflow_type, name, steps)
  values (target_company_id, 'Approval', 'Communication Approval', '[{"stepOrder":0,"name":"Finance Review","approverLabel":"Financial Manager"}]')
  returning id into approval_def_id;

  insert into communication_templates (company_id, code, name, channel, category, subject_template, body_template, variables_schema, requires_approval, approval_workflow_definition_id)
  values
    (target_company_id, 'PaymentReminder', 'Payment Reminder', 'Email', 'Reminder',
     'Payment Reminder — {{recipientName}}',
     'Dear {{recipientName}},{{#if message}}\n\n{{message}}{{/if}}\n\nThis is a reminder regarding your account with us.\n\nRegards,\n{{companyName}}',
     '[{"name":"recipientName","description":"Customer or supplier name"},{"name":"message","description":"Optional custom message"},{"name":"companyName","description":"Sending company name"}]',
     true, approval_def_id),
    (target_company_id, 'CustomerStatement', 'Customer Statement', 'Email', 'Statement',
     'Statement of Account — {{customerName}}',
     'Dear {{customerName}},\n\nPlease find your statement summary below.\n\nOutstanding balance: {{outstandingBalance}}\nOverdue: {{overdueAmount}}\n\nRegards,\n{{companyName}}',
     '[{"name":"customerName","description":"Customer name"},{"name":"outstandingBalance","description":"Total outstanding, formatted"},{"name":"overdueAmount","description":"Total overdue, formatted"},{"name":"companyName","description":"Sending company name"}]',
     true, approval_def_id),
    (target_company_id, 'SupplierStatement', 'Supplier Statement', 'Email', 'Statement',
     'Statement of Account — {{supplierName}}',
     'Dear {{supplierName}},\n\nPlease find your statement summary below.\n\nOutstanding balance: {{outstandingBalance}}\n\nRegards,\n{{companyName}}',
     '[{"name":"supplierName","description":"Supplier name"},{"name":"outstandingBalance","description":"Total outstanding, formatted"},{"name":"companyName","description":"Sending company name"}]',
     false, null);

  if not exists (select 1 from automation_tasks where company_id = target_company_id and task_type = 'CommunicationQueue') then
    insert into automation_tasks (company_id, task_type, name, next_run_at)
    values (target_company_id, 'CommunicationQueue', 'Communication Queue Processor', now());
  end if;
end;
$$;

do $$
declare
  c record;
begin
  for c in select id from companies loop
    perform seed_company_communication_defaults(c.id);
  end loop;
end $$;
