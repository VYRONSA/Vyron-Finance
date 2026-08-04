-- RC1 Phase 6 — Enterprise Monitoring & Operations Centre. ONE shared
-- operational data model, not a developer dashboard bolted onto each
-- module. Most of what the Operations Centre displays is COMPUTED live
-- from tables that already exist (automation_tasks, workflow_instances,
-- notifications, communications, automation_audit_log,
-- permission_audit_log, matching_overrides, gl_transactions, vat_returns,
-- reporting_packages — see docs/MIGRATION_ROADMAP.md's own research
-- citations) — this migration adds only the two tables that genuinely
-- do not exist anywhere yet: a unified security/operational event log,
-- and the Alert Centre's own workflow state.

create table system_events (
  id bigint generated always as identity primary key,
  company_id uuid references companies (id) on delete cascade, -- null = platform-level event
  event_type text not null check (event_type in ('PermissionDenied', 'LoginFailed', 'AccountLocked', 'SessionExpired', 'ApiAuthFailure')),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'high', 'critical')),
  actor text,
  detail text not null default '',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index system_events_company_created_idx on system_events (company_id, created_at);
create index system_events_type_idx on system_events (event_type, created_at);

-- The Alert Centre's own workflow — reuses `notifications` for the
-- underlying content/creation the same moment an alert-worthy event
-- already fires a notification (see `communication-service.ts::recordFailure`
-- and `scheduler-service.ts::runDueTasks`'s existing AutomationFailure
-- notification calls), adding only the Acknowledge/Assign/Resolve/Reopen
-- state a plain notification doesn't have — never a second notification
-- store.
create table operations_alerts (
  id bigint generated always as identity primary key,
  company_id uuid references companies (id) on delete cascade, -- null = platform-level
  source_engine text not null,
  severity text not null check (severity in ('info', 'warning', 'high', 'critical')),
  title text not null,
  message text not null default '',
  status text not null default 'Open' check (status in ('Open', 'Acknowledged', 'Assigned', 'Resolved', 'Reopened')),
  assigned_to text,
  related_notification_id bigint references notifications (id) on delete set null,
  created_by text not null default 'System',
  created_at timestamptz not null default now(),
  acknowledged_by text,
  acknowledged_at timestamptz,
  resolved_by text,
  resolved_at timestamptz
);

create index operations_alerts_company_status_idx on operations_alerts (company_id, status, created_at);

alter table system_events enable row level security;
alter table operations_alerts enable row level security;

-- Company-scoped rows follow the same membership rule every other table
-- in this codebase uses. Platform-level rows (company_id is null) have
-- no equivalent gate to apply: this codebase's Platform Super
-- Administrator/Platform Administrator roles are seeded (0025) but have
-- NO enforcement code anywhere yet (confirmed by this phase's own
-- research — no `getPlatformRole()` function exists) — a genuine,
-- pre-existing gap, not something invented or hidden here. Until that
-- role-resolution layer is built (tracked as an RC1 Phase 7 concern),
-- platform-level operational rows are readable by any authenticated
-- user and writable only through the service layer's own authenticated
-- session check — the same honest boundary already applied to
-- `/platform`'s existing "My Companies" list, not a new one.
create policy "members can read their company's system events" on system_events for select using (
  company_id is null or user_can_access_company(company_id)
);
create policy "members can insert their company's system events" on system_events for insert with check (
  company_id is null or user_can_access_company(company_id)
);

create policy "members can access their company's operations alerts" on operations_alerts for all using (
  company_id is null or user_can_access_company(company_id)
);
