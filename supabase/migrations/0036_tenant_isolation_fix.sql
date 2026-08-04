-- RC1 Phase 7.6 — CRITICAL LIVE DEFECT, a genuine cross-tenant data
-- leak, reproduced with concrete evidence: a user with a real
-- `user_role_assignments` row for Company B only (Bookkeeper, no role
-- anywhere in Company A) was able to read Company A's customer list —
-- including a record deliberately named "CONFIDENTIAL Company A
-- Client" — via a plain `GET /api/companies/{companyA}/customers`
-- call, with no error, no filtering.
--
-- Root cause: `user_can_access_company()` (0001_platform_foundation.sql),
-- the function ~117 of this platform's 119 tables use as their RLS
-- tenant-isolation boundary, checks `organisation_members` —
-- deliberately ORGANISATION-wide by its own original design comment
-- ("true iff the current user belongs to the organisation that owns
-- the given company"). `user_role_assignments` (0025_rbac_platform.sql),
-- the actual per-company RBAC layer added later, is a completely
-- separate table. Every route that calls `requirePermission()` was
-- already correctly protected (that check is per-company by
-- construction) — but every route that only calls `requireSession()`
-- and relies on RLS + `.eq("company_id", ...)` filtering (most GET/list
-- endpoints) was not: RLS's own `user_can_access_company` check passed
-- for ANY company under an organisation the user belongs to, real
-- per-company role or not.
--
-- This became newly exploitable, not newly created, by 0034/0035's own
-- fix earlier in this same certification pass: before that fix, an
-- invited/assigned user was never added to `organisation_members` at
-- all, so they were incorrectly blocked from their OWN company (the
-- first live defect found) — but also, as an accidental side effect,
-- never had this broader leak available to them either. Fixing the
-- first bug by adding real org membership is what made the second,
-- more serious bug reachable and provable. Both needed fixing; this
-- migration is the second half.
--
-- Fixed by making `user_can_access_company()` check real per-company
-- (or genuine platform-scope) grants via `user_role_assignments` —
-- the same two-branch shape already established for `user_has_permission()`
-- (0031's fix) — instead of organisation-wide membership. Every
-- legitimate access pattern already has a real `user_role_assignments`
-- row for exactly this reason: `createCompany` assigns the creator
-- Company Owner for every company they create (verified live, not
-- assumed), and 0034/0035's fix now correctly grants one to every
-- invited/assigned user too. Nobody currently has org membership
-- without a real per-company or platform-scope assignment somewhere,
-- so no legitimate access is lost — only the leak closes. This also,
-- as an intended side effect, makes platform-scope roles
-- (Platform Super Administrator/Administrator's AuditAccess/ManageUsers/
-- SystemAdministration grants) genuinely usable across every company at
-- the RLS layer, not just the application permission-check layer,
-- completing what 0031 started rather than leaving it half-applied.
--
-- Deliberately NOT touched: `organisations`/`organisation_members`'s
-- own policies (metadata-level, not a business-data leak), and BOTH of
-- `companies`' own policies. `companies` has its own independent,
-- org-membership-based SELECT policy ("members can view companies in
-- their organisation") that in principle has the same class of leak
-- (any org member can see that a sibling company merely exists — its
-- name/industry/status, not its business data) — but fixing it hits
-- the exact same RETURNING-visibility trap 0033 already fixed once
-- this session: `createCompany` does `.insert({...}).select("*")`,
-- and at that exact moment the creator has no per-company role
-- assignment yet for the brand-new company (that comes one step
-- later) — changing this policy to require one would break company
-- creation itself. Given the real, confirmed, high-severity leak
-- (actual customer/journal/financial DATA readable cross-company) is
-- fully closed by the `user_can_access_company()` fix alone — every
-- one of the ~117 business-data tables uses that function, `companies`
-- is one of only 2 tables with its own independent policy — the lower-
-- severity company-existence-metadata visibility is disclosed here as
-- a known remainder rather than risked against breaking company
-- creation under this pass's time constraints.
create or replace function user_can_access_company(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from user_role_assignments ura
    where ura.user_id = auth.uid()
      and ura.company_id = target_company_id
  )
  or exists (
    select 1 from user_role_assignments ura
    where ura.user_id = auth.uid()
      and ura.company_id is null
  );
$$;
