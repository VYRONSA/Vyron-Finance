-- RC1 Phase 1 — Role Based Access Control. ONE Permission Engine, no
-- per-module reimplementation. `organisation_members` (0001) stays
-- exactly as-is (org-level owner/admin/member, used only to bootstrap
-- company access) — this migration adds the COMPANY-level (and
-- platform-level) role/permission layer that never existed before,
-- confirmed absent by research: no `company_members`/role-aware table
-- existed anywhere prior to this migration.
--
-- Design: `permission_roles` holds both the 19 named system roles (4
-- platform-scope, 15 company-scope) AND any company's own custom roles
-- (`is_system_role = false`), so "Support Custom Roles" needs no second
-- table. `role_permissions` is a flat (role, permission_key) grant list
-- — permission_key values are validated application-side against the
-- fixed catalog in `src/server/permissions/types.ts` (kept as free text
-- here, matching this codebase's established `posting_rule_lines.role`/
-- `banking_rule_conditions.field` precedent of validating enums in the
-- service layer rather than a DB CHECK). `parent_role_id` gives
-- single-parent inheritance — resolved by the pure engine, never a
-- recursive SQL query, so behavior is unit-testable.
--
-- Deliberately a NEW, standalone `seed_company_rbac_defaults()`
-- function rather than redefining the existing `seed_company_defaults()`
-- — that function's body has been `create or replace`d ~8 times across
-- prior migrations and this migration does not have its full current
-- text to safely re-paste; a second, purpose-specific seeding function
-- (called by both this migration's one-time backfill below AND
-- `company-service.ts::createCompany` going forward) avoids destroying
-- any of that accumulated logic.

create table permission_roles (
  id bigint generated always as identity primary key,
  company_id uuid references companies (id) on delete cascade, -- null = platform-scope system role, shared by every company
  role_key text not null,
  name text not null,
  description text not null default '',
  is_system_role boolean not null default false,
  scope text not null default 'company' check (scope in ('platform', 'company')),
  parent_role_id bigint references permission_roles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, role_key)
);

create table role_permissions (
  id bigint generated always as identity primary key,
  role_id bigint not null references permission_roles (id) on delete cascade,
  permission_key text not null,
  unique (role_id, permission_key)
);

-- Approval Limits — the 5 categories the directive names explicitly:
-- Journal, Supplier Payment, Customer Credit Note, Purchase Approval,
-- Asset Disposal. `max_amount = null` means explicitly unlimited (a
-- real, deliberate grant, e.g. Financial Director) — distinct from NO
-- ROW for a category, which means this role cannot approve that
-- category at all regardless of whether it holds the underlying
-- permission key.
create table role_approval_limits (
  id bigint generated always as identity primary key,
  role_id bigint not null references permission_roles (id) on delete cascade,
  category text not null check (category in ('Journal', 'SupplierPayment', 'CustomerCreditNote', 'PurchaseApproval', 'AssetDisposal')),
  max_amount numeric(14, 2),
  unique (role_id, category)
);

-- Real user -> role assignment, company-scoped (or platform-scoped when
-- company_id is null, for the 4 platform roles).
create table user_role_assignments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references companies (id) on delete cascade,
  role_id bigint not null references permission_roles (id) on delete cascade,
  assigned_by text not null default 'System',
  assigned_at timestamptz not null default now(),
  unique (user_id, company_id, role_id)
);

-- SECURITY FIX (found during RC1 Phase 2's own Security Audit, before
-- this migration ever ran against a real database — fixed in place
-- rather than patched with a follow-up migration, since no real
-- deployment's history needs preserving): the first draft of this
-- migration gated `permission_roles`/`role_permissions`/
-- `role_approval_limits`/`user_role_assignments` writes on
-- MEMBERSHIP only (`user_can_access_company`), reasoning that the
-- application layer's `requirePermission(companyId, "ManageUsers")`
-- was the real gate. That reasoning is exactly backwards for Supabase:
-- the anon-key client is reachable directly from any signed-in
-- browser, bypassing the Next.js app (and its `requirePermission()`
-- check) entirely — RLS is not a "backstop" here, it is the ONLY
-- enforcement a direct REST/client call sees. A membership-only write
-- policy on these 4 tables would let ANY company member (even a
-- Read Only role) grant themselves `ManageUsers`/`SystemAdministration`,
-- rewrite a role's `parent_role_id` to inherit from Company Owner, or
-- insert a `user_role_assignments` row making themselves Company Owner
-- directly — a real, directly exploitable privilege escalation. Every
-- write policy below now requires `user_has_permission(company_id,
-- 'ManageUsers')` — a NEW SQL-level mirror of
-- `permission-engine.ts::resolveEffectivePermissions`'s own
-- inheritance-walk (a recursive CTE, since RLS cannot call the TS
-- engine) — the same "explicit check AND RLS enforces it too" pattern
-- `user_can_access_company()` already established for company
-- membership, applied here to ROLE, not just membership.

/** SQL-level mirror of the pure TS engine's inheritance walk — the ONE
 * function every RBAC write policy below calls, so a role's real
 * effective permission set (including inherited grants) is what RLS
 * itself checks, not just direct grants. Depth-capped at 10 (matching
 * `MAX_INHERITANCE_DEPTH` in `permission-engine.ts`) via the recursive
 * CTE's own row count, not an explicit counter — Postgres recursive
 * CTEs terminate when no new rows are produced, and a role hierarchy
 * this codebase seeds is at most 2 levels deep, so this is a generous
 * safety margin, not a tight bound. */
create function user_has_permission(target_company_id uuid, target_permission_key text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  with recursive role_chain as (
    select pr.id, pr.parent_role_id
    from permission_roles pr
    join user_role_assignments ura on ura.role_id = pr.id
    where ura.user_id = auth.uid()
      and (ura.company_id = target_company_id or ura.company_id is null)
    union
    select parent.id, parent.parent_role_id
    from permission_roles parent
    join role_chain rc on parent.id = rc.parent_role_id
  )
  select exists (
    select 1
    from role_permissions rp
    join role_chain rc on rc.id = rp.role_id
    where rp.permission_key = target_permission_key
  );
$$;

-- A minimal, dedicated audit log for RBAC changes — role
-- create/update/delete, permission-grant changes, approval-limit
-- changes, and role assignment/revocation. Deliberately its own table
-- rather than overloading `matching_overrides` (a real table, but
-- scoped to the Matching Platform's own domain — reusing it here would
-- be reuse of a shape, not a genuine domain fit) or extending
-- `automation_audit_log` (Automation's own domain, would need new
-- columns to carry a permission diff). Same generic
-- item_type/item_id/field_name/old_value/new_value/reason/performed_by
-- shape as `matching_overrides` on purpose — a proven, minimal pattern
-- for "record what changed and why," not reinvented.
create table permission_audit_log (
  id bigint generated always as identity primary key,
  company_id uuid references companies (id) on delete cascade,
  item_type text not null,
  item_id text not null,
  field_name text not null,
  old_value text,
  new_value text,
  reason text not null default '',
  performed_by text not null default 'System',
  performed_at timestamptz not null default now()
);

alter table permission_roles enable row level security;
alter table role_permissions enable row level security;
alter table role_approval_limits enable row level security;
alter table user_role_assignments enable row level security;
alter table permission_audit_log enable row level security;

-- Platform-scope rows (company_id is null) are readable by every
-- authenticated user (needed to resolve platform-role assignments and
-- to list the seeded system roles as templates); company-scope rows
-- follow the same `user_can_access_company` membership boundary every
-- other company-scoped table already uses. EVERY write requires the
-- real, role-aware `user_has_permission(company_id, 'ManageUsers')` —
-- see this file's own security-fix comment above `user_has_permission`.
create policy "read platform or own-company roles" on permission_roles for select
  using (company_id is null or user_can_access_company(company_id));
create policy "insert own-company roles" on permission_roles for insert with check (company_id is not null and user_has_permission(company_id, 'ManageUsers'));
create policy "update own-company roles" on permission_roles for update using (company_id is not null and user_has_permission(company_id, 'ManageUsers'));
create policy "delete own-company roles" on permission_roles for delete using (company_id is not null and user_has_permission(company_id, 'ManageUsers') and is_system_role = false);

create policy "read role permissions" on role_permissions for select
  using (exists (select 1 from permission_roles r where r.id = role_id and (r.company_id is null or user_can_access_company(r.company_id))));
create policy "write role permissions" on role_permissions for insert with check (
  exists (select 1 from permission_roles r where r.id = role_id and r.company_id is not null and user_has_permission(r.company_id, 'ManageUsers'))
);
create policy "update role permissions" on role_permissions for update using (
  exists (select 1 from permission_roles r where r.id = role_id and r.company_id is not null and user_has_permission(r.company_id, 'ManageUsers'))
);
create policy "delete role permissions" on role_permissions for delete using (
  exists (select 1 from permission_roles r where r.id = role_id and r.company_id is not null and user_has_permission(r.company_id, 'ManageUsers'))
);

create policy "read approval limits" on role_approval_limits for select
  using (exists (select 1 from permission_roles r where r.id = role_id and (r.company_id is null or user_can_access_company(r.company_id))));
create policy "write approval limits" on role_approval_limits for insert with check (
  exists (select 1 from permission_roles r where r.id = role_id and r.company_id is not null and user_has_permission(r.company_id, 'ManageUsers'))
);
create policy "update approval limits" on role_approval_limits for update using (
  exists (select 1 from permission_roles r where r.id = role_id and r.company_id is not null and user_has_permission(r.company_id, 'ManageUsers'))
);
create policy "delete approval limits" on role_approval_limits for delete using (
  exists (select 1 from permission_roles r where r.id = role_id and r.company_id is not null and user_has_permission(r.company_id, 'ManageUsers'))
);

create policy "read own or own-company assignments" on user_role_assignments for select
  using (user_id = auth.uid() or (company_id is not null and user_can_access_company(company_id)));
create policy "insert own-company assignments" on user_role_assignments for insert with check (company_id is not null and user_has_permission(company_id, 'ManageUsers'));
create policy "update own-company assignments" on user_role_assignments for update using (company_id is not null and user_has_permission(company_id, 'ManageUsers'));
create policy "delete own-company assignments" on user_role_assignments for delete using (company_id is not null and user_has_permission(company_id, 'ManageUsers'));

-- The audit log itself: readable by anyone who could manage users in
-- that company (so the very people making changes can review the
-- trail); writable only via the `security definer` RPC below, never
-- directly, so the row can never be forged or its `performed_at`
-- backdated by a client insert.
create policy "read own-company permission audit log" on permission_audit_log for select
  using (company_id is not null and user_has_permission(company_id, 'ManageUsers'));

create function record_permission_audit_entry(
  target_company_id uuid, p_item_type text, p_item_id text, p_field_name text,
  p_old_value text, p_new_value text, p_reason text, p_performed_by text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into permission_audit_log (company_id, item_type, item_id, field_name, old_value, new_value, reason, performed_by)
  values (target_company_id, p_item_type, p_item_id, p_field_name, p_old_value, p_new_value, p_reason, p_performed_by);
$$;

-- Seed the 4 platform-scope system roles once (company_id null, global).
insert into permission_roles (company_id, role_key, name, description, is_system_role, scope) values
  (null, 'platform_super_administrator', 'Platform Super Administrator', 'Full control of every organisation, company, and platform setting.', true, 'platform'),
  (null, 'platform_administrator', 'Platform Administrator', 'Administers organisations and companies; cannot change platform-level system configuration.', true, 'platform'),
  (null, 'partner', 'Partner', 'External accounting partner with cross-company read/prepare access on assigned companies.', true, 'platform'),
  (null, 'support_technician', 'Support Technician', 'Read-only diagnostic access for support purposes.', true, 'platform');

create function seed_company_rbac_defaults(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r_owner bigint; r_md bigint; r_fd bigint; r_fm bigint; r_acct bigint; r_sbk bigint; r_bk bigint;
  r_arc bigint; r_apc bigint; r_im bigint; r_pm bigint; r_sm bigint; r_bm bigint; r_aud bigint; r_ro bigint;
begin
  if exists (select 1 from permission_roles where company_id = target_company_id) then
    return; -- idempotent — a company that already has roles is never reseeded
  end if;

  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'company_owner', 'Company Owner', true, 'company') returning id into r_owner;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'managing_director', 'Managing Director', true, 'company') returning id into r_md;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'financial_director', 'Financial Director', true, 'company') returning id into r_fd;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'financial_manager', 'Financial Manager', true, 'company') returning id into r_fm;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'accountant', 'Accountant', true, 'company') returning id into r_acct;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'bookkeeper', 'Bookkeeper', true, 'company') returning id into r_bk;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope, parent_role_id) values (target_company_id, 'senior_bookkeeper', 'Senior Bookkeeper', true, 'company', r_bk) returning id into r_sbk;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'accounts_receivable_clerk', 'Accounts Receivable Clerk', true, 'company') returning id into r_arc;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'accounts_payable_clerk', 'Accounts Payable Clerk', true, 'company') returning id into r_apc;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'inventory_manager', 'Inventory Manager', true, 'company') returning id into r_im;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'purchasing_manager', 'Purchasing Manager', true, 'company') returning id into r_pm;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'sales_manager', 'Sales Manager', true, 'company') returning id into r_sm;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'branch_manager', 'Branch Manager', true, 'company') returning id into r_bm;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'auditor', 'Auditor', true, 'company') returning id into r_aud;
  insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (target_company_id, 'read_only', 'Read Only', true, 'company') returning id into r_ro;

  -- Read Only: every View permission, nothing else.
  insert into role_permissions (role_id, permission_key)
    select r_ro, m || ':View' from unnest(array['Sales','Purchasing','Inventory','Banking','Matching','GeneralLedger','VAT','Assets','Reports','Auditor','Cashbook','Settings']) as m;

  -- Bookkeeper: View/Create/Edit across the transactional modules, no approve/post/delete.
  insert into role_permissions (role_id, permission_key)
    select r_bk, m || ':' || a from unnest(array['Sales','Purchasing','Inventory','Banking','Cashbook','Matching']) as m
    cross join unnest(array['View','Create','Edit']) as a;

  -- Senior Bookkeeper INHERITS Bookkeeper (parent_role_id set above)
  -- and additionally gets Post + a limited approval.
  insert into role_permissions (role_id, permission_key)
    select r_sbk, m || ':Post' from unnest(array['Sales','Purchasing','Banking','Cashbook']) as m;
  insert into role_permissions (role_id, permission_key) values (r_sbk, 'ApproveJournals'), (r_sbk, 'ApprovePayments');
  insert into role_approval_limits (role_id, category, max_amount) values (r_sbk, 'Journal', 50000), (r_sbk, 'SupplierPayment', 50000);

  -- Accounts Receivable / Payable Clerks — scoped to their own domain.
  insert into role_permissions (role_id, permission_key)
    select r_arc, 'Sales:' || a from unnest(array['View','Create','Edit']) as a;
  insert into role_permissions (role_id, permission_key) values (r_arc, 'ApproveSales');
  insert into role_approval_limits (role_id, category, max_amount) values (r_arc, 'CustomerCreditNote', 10000);

  insert into role_permissions (role_id, permission_key)
    select r_apc, 'Purchasing:' || a from unnest(array['View','Create','Edit']) as a;
  insert into role_permissions (role_id, permission_key) values (r_apc, 'ApprovePurchases');
  insert into role_approval_limits (role_id, category, max_amount) values (r_apc, 'PurchaseApproval', 10000);

  insert into role_permissions (role_id, permission_key)
    select r_im, 'Inventory:' || a from unnest(array['View','Create','Edit','Delete']) as a;

  insert into role_permissions (role_id, permission_key)
    select r_pm, 'Purchasing:' || a from unnest(array['View','Create','Edit','Approve','Reject']) as a;
  insert into role_permissions (role_id, permission_key) values (r_pm, 'ApprovePurchases');
  insert into role_approval_limits (role_id, category, max_amount) values (r_pm, 'PurchaseApproval', 250000);

  insert into role_permissions (role_id, permission_key)
    select r_sm, 'Sales:' || a from unnest(array['View','Create','Edit','Approve','Reject']) as a;
  insert into role_permissions (role_id, permission_key) values (r_sm, 'ApproveSales');
  insert into role_approval_limits (role_id, category, max_amount) values (r_sm, 'CustomerCreditNote', 100000);

  insert into role_permissions (role_id, permission_key)
    select r_bm, m || ':View' from unnest(array['Sales','Purchasing','Inventory','Banking','GeneralLedger','Reports']) as m;

  insert into role_permissions (role_id, permission_key) values (r_aud, 'AuditAccess'), (r_aud, 'RunReports'), (r_aud, 'AccessAICopilot');
  insert into role_permissions (role_id, permission_key)
    select r_aud, m || ':View' from unnest(array['Sales','Purchasing','Inventory','Banking','Matching','GeneralLedger','VAT','Assets','Reports','Cashbook']) as m;

  -- Accountant: broad operational access, moderate approval limits.
  insert into role_permissions (role_id, permission_key)
    select r_acct, m || ':' || a
    from unnest(array['Sales','Purchasing','Inventory','Banking','Matching','GeneralLedger','VAT','Assets','Cashbook']) as m
    cross join unnest(array['View','Create','Edit','Post','Export']) as a;
  insert into role_permissions (role_id, permission_key) values
    (r_acct, 'RunReports'), (r_acct, 'AccessAICopilot'), (r_acct, 'ManageVAT'), (r_acct, 'RunDepreciation'),
    (r_acct, 'GenerateFinancialStatements'), (r_acct, 'ApproveJournals'), (r_acct, 'ApprovePayments'), (r_acct, 'ApprovePurchases'), (r_acct, 'ApproveSales');
  insert into role_approval_limits (role_id, category, max_amount) values
    (r_acct, 'Journal', 150000), (r_acct, 'SupplierPayment', 150000), (r_acct, 'CustomerCreditNote', 150000), (r_acct, 'PurchaseApproval', 150000);

  -- Financial Manager: Accountant's ceiling raised, plus Manage Users/Financial Years.
  insert into role_permissions (role_id, permission_key)
    select r_fm, m || ':' || a
    from unnest(array['Sales','Purchasing','Inventory','Banking','Matching','GeneralLedger','VAT','Assets','Reports','Cashbook']) as m
    cross join unnest(array['View','Create','Edit','Delete','Approve','Reject','Post','Export','Import']) as a;
  insert into role_permissions (role_id, permission_key) values
    (r_fm, 'RunAutomation'), (r_fm, 'RunReports'), (r_fm, 'AccessAICopilot'), (r_fm, 'ManageUsers'), (r_fm, 'ManageFinancialYears'),
    (r_fm, 'ManageVAT'), (r_fm, 'ApproveJournals'), (r_fm, 'ApprovePayments'), (r_fm, 'ApprovePurchases'), (r_fm, 'ApproveSales'),
    (r_fm, 'ApproveAssets'), (r_fm, 'RunDepreciation'), (r_fm, 'GenerateFinancialStatements');
  insert into role_approval_limits (role_id, category, max_amount) values
    (r_fm, 'Journal', 500000), (r_fm, 'SupplierPayment', 500000), (r_fm, 'CustomerCreditNote', 500000), (r_fm, 'PurchaseApproval', 500000), (r_fm, 'AssetDisposal', 500000);

  -- Financial Director, Managing Director, Company Owner: unlimited
  -- (max_amount null) across every category, and System Administration
  -- for Company Owner only.
  insert into role_permissions (role_id, permission_key)
    select rid, m || ':' || a
    from (values (r_fd), (r_md), (r_owner)) as roles(rid)
    cross join unnest(array['Sales','Purchasing','Inventory','Banking','Matching','GeneralLedger','VAT','Assets','Reports','Auditor','Cashbook','Settings']) as m
    cross join unnest(array['View','Create','Edit','Delete','Approve','Reject','Reverse','Post','Export','Import']) as a;
  insert into role_permissions (role_id, permission_key)
    select rid, p
    from (values (r_fd), (r_md), (r_owner)) as roles(rid)
    cross join unnest(array['RunAutomation','RunReports','AccessAICopilot','ManageUsers','ManageFinancialYears','ManageVAT','ApproveJournals','ApprovePayments','ApprovePurchases','ApproveSales','ApproveAssets','RunDepreciation','GenerateFinancialStatements','AuditAccess']) as p;
  insert into role_permissions (role_id, permission_key) values (r_owner, 'SystemAdministration');
  insert into role_approval_limits (role_id, category, max_amount)
    select rid, cat, null
    from (values (r_fd), (r_md), (r_owner)) as roles(rid)
    cross join unnest(array['Journal','SupplierPayment','CustomerCreditNote','PurchaseApproval','AssetDisposal']) as cat;
end;
$$;

-- One-time backfill: every company that already exists gets its 15
-- system roles seeded immediately (idempotent — see the function's own
-- early-return guard), so this migration alone makes RBAC usable for
-- every existing company, not only ones created after this point.
do $$
declare
  c record;
begin
  for c in select id from companies loop
    perform seed_company_rbac_defaults(c.id);
  end loop;
end $$;
