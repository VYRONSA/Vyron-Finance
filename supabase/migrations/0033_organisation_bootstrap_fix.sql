-- RC1 Phase 7.6 — LIVE DEFECT, found only by testing against a real
-- database (Preview Mode and unit tests both bypass RLS entirely, so
-- this was structurally invisible until now). A brand-new user's very
-- first company creation failed with "new row violates row-level
-- security policy for table organisations" even though migration
-- 0006's insert policy ("authenticated users can create an
-- organisation") correctly allows the INSERT itself.
--
-- Root cause: `company-repository.ts::bootstrapOrganisation` does
-- `.from("organisations").insert({name}).select("id")` — PostgREST
-- implements this as `INSERT ... RETURNING id`, and Postgres RLS
-- applies the table's SELECT policy to what RETURNING is allowed to
-- show, not just the INSERT policy to the write itself. The SELECT
-- policy ("members can view their organisation") requires the user to
-- already be a member of the organisation — which they can't be yet,
-- since the membership row is the NEXT statement. The INSERT succeeds
-- at the storage layer and is then immediately hidden from its own
-- RETURNING clause, which PostgREST reports as the same generic RLS
-- violation as a rejected write.
--
-- Fixed by replacing the two separate client-side inserts with one
-- `security definer` RPC — the same pattern already established for
-- every other privileged multi-step operation in this codebase
-- (`seed_company_rbac_defaults`, `record_permission_audit_entry`,
-- `record_automation_audit_entry`). This also fixes a real secondary
-- defect the two-insert version had: if the second insert (membership)
-- failed after the first (organisation) succeeded, the user was left
-- with an orphaned organisation they could never see or access again
-- (the same SELECT-requires-membership chicken-and-egg problem, just
-- permanent). One transaction now makes both inserts atomic.
create function bootstrap_organisation(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  insert into organisations (name) values (org_name) returning id into new_org_id;
  insert into organisation_members (organisation_id, user_id, role) values (new_org_id, auth.uid(), 'owner');

  return new_org_id;
end;
$$;
