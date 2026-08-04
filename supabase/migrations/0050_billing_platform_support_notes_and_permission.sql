-- Commercial Billing Platform — Sub-Phase 0, part 6 of 6. Support notes
-- (Internal Billing Console only), the "BillingAlert" notification type
-- (so trial/payment/grace-period/suspension notices reuse the existing
-- Notification Centre rather than a parallel path — same widening
-- pattern as 0044's `integration_connections.system_name`), and the
-- `ManageBilling` permission grant.
--
-- `ManageBilling` itself is added to `GLOBAL_PERMISSIONS` in
-- `src/server/permissions/types.ts` as part of this same change (kept
-- as free text here, matching `role_permissions.permission_key`'s
-- established "validated in the service layer, not a DB CHECK"
-- precedent — see 0025_rbac_platform.sql's own header comment).
--
-- Deliberately NOT touching `seed_company_rbac_defaults()` (0025) to
-- grant this to future Company Owners — that function has accumulated
-- ~8 migrations of logic this pass doesn't have the full current text
-- to safely re-paste, the exact same reasoning 0028 already used to add
-- a second, standalone seeding function instead of editing it. A small
-- dedicated function does the same job for this one permission.

create table billing_support_notes (
  id bigint generated always as identity primary key,
  billing_account_id uuid not null references billing_accounts (id) on delete cascade,
  note text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index billing_support_notes_billing_account_id_idx on billing_support_notes (billing_account_id);

alter table billing_support_notes enable row level security;
create policy "platform-scope roles can access billing support notes" on billing_support_notes for all using (
  exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)
);

alter table notifications drop constraint notifications_notification_type_check;
alter table notifications add constraint notifications_notification_type_check check (notification_type in (
  'TaskAssignment', 'ExceptionAlert', 'ApprovalRequest', 'AutomationFailure',
  'AuditWarning', 'RuleFailure', 'PeriodLockAlert', 'BillingAlert'
));

-- Grants `ManageBilling` to the 2 platform-scope roles immediately
-- (their `permission_roles` rows already exist, seeded once in 0025).
insert into role_permissions (role_id, permission_key)
select id, 'ManageBilling' from permission_roles where role_key in ('platform_super_administrator', 'platform_administrator')
on conflict (role_id, permission_key) do nothing;

-- Standalone, idempotent function granting `ManageBilling` to a single
-- company's own Company Owner role — called once per existing company
-- below (backfill) and from `company-service.ts::createCompany` for
-- every company created from now on, alongside the existing
-- `seedCompanyRbacDefaults`/`assignRole` calls.
create function grant_manage_billing_to_company_owner(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_role_id bigint;
begin
  select id into v_owner_role_id from permission_roles where company_id = target_company_id and role_key = 'company_owner';
  if v_owner_role_id is null then
    return; -- no RBAC seeded yet for this company (shouldn't happen post-0025, but never error a billing migration over it)
  end if;

  insert into role_permissions (role_id, permission_key) values (v_owner_role_id, 'ManageBilling')
  on conflict (role_id, permission_key) do nothing;
end;
$$;

do $$
declare
  c record;
begin
  for c in select id from companies loop
    perform grant_manage_billing_to_company_owner(c.id);
  end loop;
end $$;
