-- Pilot Review Round 1 Final Certification — LIVE DEFECT, found by this
-- round's own live-verification methodology (a genuinely fresh test
-- user with no pre-existing platform-scope role, not a superadmin
-- account) while testing "Company creation" as part of the required
-- regression pass.
--
-- Root cause: company creation's own role-bootstrap step
-- (company-service.ts::createCompany) previously read the newly-seeded
-- company-scoped roles via a plain client-side SELECT
-- (listRolesForCompany -> `permission_roles`) to find the `company_owner`
-- role's id before assigning it. But `permission_roles`' own SELECT
-- policy ("read platform or own-company roles", 0025) requires
-- `user_can_access_company(company_id)`, which is false for a brand new
-- company's creator until they already hold a role there — the exact
-- chicken-and-egg problem 0034 already fixed for a DIFFERENT read (a
-- user's own `user_role_assignments` row) but which was never noticed
-- for THIS read, because `assign_company_role` (0034/0035) itself also
-- requires the caller to already hold `ManageUsers` on the target
-- company — a second, independent chicken-and-egg problem, since nobody
-- can hold any permission on a company that has zero role assignments
-- yet. Both problems were masked in every prior round of live
-- verification because the test admin accounts used already held a
-- platform-scope role (which satisfies `user_can_access_company` and
-- `user_has_permission` unconditionally, see 0036/0025) — a genuinely
-- fresh self-service signup user creating their first company (the real
-- product's actual onboarding path) hit both and got a 500.
--
-- Fixed the same way 0033/0034 already solved the analogous
-- organisation-bootstrap problem: one narrowly-scoped, security-definer
-- RPC that performs the entire first-owner-role assignment atomically,
-- server-side, so the client never needs to read `permission_roles` for
-- a company it can't access yet. Deliberately NOT a relaxation of
-- `assign_company_role`'s own authorization (that check — real
-- `ManageUsers` permission required — stays exactly as-is for every
-- other caller, e.g. the Invite User workflow) and NOT a relaxation of
-- `permission_roles`' SELECT policy (broadening that would let any
-- authenticated user enumerate every company's custom role structure).
-- Uses `auth.uid()` directly rather than a client-supplied target user
-- id, mirroring `bootstrap_organisation`'s (0033) own trust model, and
-- self-limits to a single use per company (raises once the company
-- already has any role assignment) so it can never become a standing
-- privilege-escalation path.
create function bootstrap_company_owner_role(target_company_id uuid, performed_by text)
returns setof user_role_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org_id uuid;
  owner_role_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  select organisation_id into target_org_id from companies where companies.id = target_company_id;
  if target_org_id is null then
    raise exception 'Company not found.';
  end if;

  if not exists (
    select 1 from organisation_members
    where organisation_id = target_org_id and user_id = auth.uid()
  ) then
    raise exception 'Not authorized to bootstrap this company.';
  end if;

  if exists (select 1 from user_role_assignments where company_id = target_company_id) then
    raise exception 'This company already has role assignments — use assign_company_role instead.';
  end if;

  select id into owner_role_id from permission_roles where company_id = target_company_id and role_key = 'company_owner';
  if owner_role_id is null then
    raise exception 'No company_owner role found for this company — seed_company_rbac_defaults() must run first.';
  end if;

  insert into organisation_members (organisation_id, user_id, role)
  values (target_org_id, auth.uid(), 'member')
  on conflict (organisation_id, user_id) do nothing;

  return query
  insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
  values (auth.uid(), target_company_id, owner_role_id, performed_by)
  returning *;
end;
$$;
