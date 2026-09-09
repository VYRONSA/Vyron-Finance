-- RC1 Phase 7.6 — corrective migration. 0034's `assign_company_role`
-- function failed on its first live call with "column reference
-- user_id is ambiguous" (Postgres error 42702) — a `returns table(...)`
-- function's OUT-parameter names shadow identically-named columns in
-- any `RETURNING` clause inside the function body. Since 0034 already
-- ran against this live database, the fix is a follow-up migration
-- (`create or replace function`) rather than an edit to 0034 itself —
-- once a migration has actually executed against a real database, its
-- history is never silently rewritten, matching this platform's own
-- established convention (see 0025's own "Security Fix... found before
-- this migration ever ran against a real database" comment, which
-- explicitly contrasts that case, safe to edit in place, with this
-- one, which is not). A fresh installation with no history yet applies
-- 0034 and 0035 in order and ends up at the same correct end state.
-- `create or replace` cannot change a function's return type (`table(...)`
-- to `setof user_role_assignments` — Postgres 42P13), so the old
-- signature must be dropped first.
drop function if exists assign_company_role(uuid, uuid, bigint, text);

create function assign_company_role(target_user_id uuid, target_company_id uuid, target_role_id bigint, performed_by text)
returns setof user_role_assignments
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
  returning *;
end;
$$;
