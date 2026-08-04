-- RC1 Phase 7.6 — LIVE DEFECT, the most significant found during live
-- certification. Confirmed by direct reproduction: a user given a
-- genuine `user_role_assignments` row for a company (exactly what the
-- Invite User workflow and direct role assignment both do) was
-- entirely BLOCKED from that company — `requirePermission()` reported
-- "You have no role assigned in this company yet" even though a real
-- assignment row existed.
--
-- Root cause: this platform has TWO separate membership concepts that
-- were never connected. `organisation_members` (0001) is the outer RLS
-- boundary every company-scoped table's policy checks via
-- `user_can_access_company()` — it is ORGANISATION-wide by original
-- design ("Reused by every company-scoped table... true iff the
-- current user belongs to the organisation that owns the given
-- company", 0001's own comment). `user_role_assignments` (0025) is the
-- separate, COMPANY-specific RBAC layer added later. Nothing has ever
-- added an invited/assigned user to `organisation_members` — only the
-- organisation's original creator gets that (via `bootstrap_organisation`,
-- 0033). So `permission_roles`' own SELECT policy ("read platform or
-- own-company roles", requiring `user_can_access_company`) silently
-- returned zero rows for `listRolesWithGrantsForCompany()`, even though
-- the user's own `user_role_assignments` row WAS independently visible
-- to them (its SELECT policy has a `user_id = auth.uid()` escape
-- hatch) — `getEffectiveRole()` found the assignment but then couldn't
-- find the matching role among an empty `allRoles`, and reported the
-- generic "no role assigned" message. This is why it read as "no role"
-- rather than a clearer RLS/permission error: two independent queries,
-- one succeeded and one silently returned empty.
--
-- This is a pre-existing gap from RC1 Phase 1 (not introduced by this
-- phase's Invite User work) — structurally undetectable without a real
-- database with RLS enabled, which is exactly what this phase is for.
--
-- Fixed conservatively, not by redesigning the org-wide RLS boundary
-- (out of scope per this phase's own "do not redesign" mandate, and
-- `user_can_access_company`'s organisation-wide reach is that
-- boundary's original, deliberate design — the accounting-firm-with-
-- multiple-clients model the Organisation/Company hierarchy exists
-- for, and it already behaves this way today for every organisation's
-- original owner). Instead: role assignment now ALSO ensures
-- `organisation_members` membership (as plain 'member', never
-- upgrading an existing 'owner'/'admin'), via one `security definer`
-- RPC that does both inserts atomically, mirroring the exact pattern
-- `bootstrap_organisation` already established. The RPC re-implements
-- the authorization check the old direct-insert policy provided
-- (`user_has_permission(company_id, 'ManageUsers')`) explicitly, since
-- bypassing RLS via security definer means that check no longer
-- happens automatically — it must not become a privilege-escalation
-- hole where any caller can assign any role.
-- NOTE: this function's original body (below) has a real bug — a
-- `returns table(...)` function's OUT-parameter names shadow
-- identically-named columns in any `RETURNING` clause inside it, even
-- when schema-qualified, which fails at call time with "column
-- reference user_id is ambiguous" (Postgres 42702). Left as originally
-- written/applied rather than edited in place, because this migration
-- had already run against the live certification database by the time
-- the bug was found — see 0035_assign_company_role_ambiguous_column_fix.sql,
-- which corrects it via `create or replace function`. A fresh install
-- applies both in order and ends up correct; this file stays an
-- honest record of what actually shipped first.
create function assign_company_role(target_user_id uuid, target_company_id uuid, target_role_id bigint, performed_by text)
returns table (id bigint, user_id uuid, company_id uuid, role_id bigint, assigned_by text, assigned_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org_id uuid;
begin
  if not user_has_permission(target_company_id, 'ManageUsers') then
    raise exception 'Not authorized to manage users in this company.';
  end if;

  select organisation_id into target_org_id from companies where companies.id = target_company_id;
  if target_org_id is null then
    raise exception 'Company not found.';
  end if;

  insert into organisation_members (organisation_id, user_id, role)
  values (target_org_id, target_user_id, 'member')
  on conflict (organisation_id, user_id) do nothing;

  return query
  insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
  values (target_user_id, target_company_id, target_role_id, performed_by)
  on conflict (user_id, company_id, role_id) do update set assigned_by = excluded.assigned_by
  returning user_role_assignments.id, user_role_assignments.user_id, user_role_assignments.company_id,
            user_role_assignments.role_id, user_role_assignments.assigned_by, user_role_assignments.assigned_at;
end;
$$;
