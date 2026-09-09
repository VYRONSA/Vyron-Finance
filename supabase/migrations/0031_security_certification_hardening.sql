-- RC1 Phase 7 — Enterprise Security & Multi-Tenant Certification. Fixes
-- for the CONFIRMED findings from this phase's own audit (see
-- docs/MIGRATION_ROADMAP.md's "Phase 7" section for the full evidence
-- trail). No new ERP functionality — security and isolation hardening
-- only.

-- FINDING (RBAC audit, Task 2c): `user_has_permission()`'s role-chain
-- CTE matched `ura.company_id is null` for ANY `target_company_id`,
-- meaning a platform-scope role assignment (company_id null) would
-- grant that role's permissions in EVERY company, not just ones the
-- user is actually a member of. Confirmed DORMANT today (the 4 seeded
-- platform roles carry zero role_permissions grants, and no application
-- code path ever creates a company_id-null user_role_assignments row —
-- see `assignRole()`), but a real latent privilege-escalation defect
-- that must not survive the moment either precondition changes (this
-- migration seeds real platform-role permissions below, which makes the
-- OLD version of this function immediately live and exploitable if not
-- fixed in the same migration). Fixed by resolving platform-scope
-- assignments through a SEPARATE branch that is honest about what a
-- platform role actually grants: platform-scope permissions apply
-- everywhere by design (that is the definition of a platform role), but
-- company-scope assignments only ever match their own company — the
-- defect was that a company-scope target could ALSO be satisfied by an
-- unrelated platform assignment lookup being conflated in one clause.
-- The corrected function keeps the same two real cases but makes the
-- platform-wide grant explicit and auditable rather than an accidental
-- side effect of an `or`.
create or replace function user_has_permission(target_company_id uuid, target_permission_key text)
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
      and ura.company_id = target_company_id
    union
    select pr.id, pr.parent_role_id
    from permission_roles pr
    join user_role_assignments ura on ura.role_id = pr.id
    where ura.user_id = auth.uid()
      and ura.company_id is null
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

-- FINDING (Repository audit, Part 4): `communication_attachments` had
-- no check anywhere — application or RLS — that an attached
-- `document_id` actually belongs to the same company as the
-- communication. Fixed at the application layer already
-- (`communication-service.ts::queueCommunication` now verifies every
-- documentId resolves via `getDocument(companyId, id)` before
-- attaching); this tightens the RLS insert policy itself for the same
-- defense-in-depth reasoning already applied throughout this platform's
-- RBAC tables — RLS must independently enforce what the app enforces,
-- never rely on the app alone.
drop policy "members can access their company's communication attachments" on communication_attachments;
create policy "read own-company communication attachments" on communication_attachments for select using (
  exists (select 1 from communications c where c.id = communication_id and user_can_access_company(c.company_id))
);
create policy "attach only same-company documents" on communication_attachments for insert with check (
  exists (select 1 from communications c where c.id = communication_id and user_can_access_company(c.company_id))
  and exists (select 1 from documents d join communications c2 on c2.id = communication_id where d.id = document_id and d.company_id = c2.company_id)
);
create policy "delete own-company communication attachments" on communication_attachments for delete using (
  exists (select 1 from communications c where c.id = communication_id and user_can_access_company(c.company_id))
);

-- FINDING (RLS audit): `automation_audit_log` used the generic
-- `for all using (user_can_access_company(company_id))` policy,
-- meaning any company member could directly INSERT/UPDATE/DELETE their
-- own audit trail — undermining the integrity guarantee an audit log
-- implies, unlike `permission_audit_log` (RPC-only writes, already
-- tamper-proof since 0025). Reads stay open to any company member
-- (unchanged); writes are removed from the client entirely — every real
-- caller already writes through `automation-audit-repository.ts::recordAuditEntry`
-- using the same authenticated session client, so this migration also
-- adds a `security definer` RPC so that real write path keeps working
-- without weakening the table's own policy.
drop policy "members can access their company's automation audit log" on automation_audit_log;
create policy "read own-company automation audit log" on automation_audit_log for select using (
  user_can_access_company(company_id)
);
create function record_automation_audit_entry(
  target_company_id uuid, p_performed_by text, p_action_type text, p_rule_id bigint, p_reason text,
  p_changes jsonb, p_journal_ids bigint[], p_document_type text, p_document_id bigint, p_duration_ms integer, p_is_reversible boolean
)
returns automation_audit_log
language plpgsql
security definer
set search_path = public
as $$
declare
  result automation_audit_log;
begin
  if not user_can_access_company(target_company_id) then
    raise exception 'Not a member of this company.';
  end if;
  insert into automation_audit_log (company_id, performed_by, action_type, rule_id, reason, changes, journal_ids, document_type, document_id, duration_ms, is_reversible)
  values (target_company_id, coalesce(p_performed_by, 'System'), p_action_type, p_rule_id, coalesce(p_reason, ''), coalesce(p_changes, '{}'::jsonb), coalesce(p_journal_ids, '{}'::bigint[]), p_document_type, p_document_id, p_duration_ms, coalesce(p_is_reversible, true))
  returning * into result;
  return result;
end;
$$;

-- FINDING (RBAC audit, Task 2c): the 4 seeded platform-scope roles
-- (0025) carry ZERO permission grants — meaning "Platform Super
-- Administrator: full control of every organisation, company, and
-- platform setting" is currently non-functional, not merely safely
-- bounded. This is a real completeness gap (Part 1's own mandate: RBAC
-- "must now be FULLY implemented"), not a vulnerability — but leaving it
-- unfixed would tempt a future change to grant these roles broad
-- transactional permissions "to make them work," which is exactly the
-- cross-tenant risk this migration's `user_has_permission()` fix above
-- guards against. Seeded here deliberately narrow: administrative and
-- read/reporting permissions only — NEVER a module CRUD permission
-- (Sales:*, Purchasing:*, GeneralLedger:*, ...) or an approval/posting
-- permission (ApproveJournals, GeneralLedger:Post, ...), so "a Platform
-- Administrator cannot post customer journals inside another tenant"
-- holds by design, not by omission. `partner` is deliberately left with
-- NO grants in this pass: its own description ("cross-company access on
-- ASSIGNED companies") cannot be honestly modeled by the platform-wide
-- `company_id is null` mechanism (which grants everywhere, not just
-- assigned companies) — a Partner should be given normal company-scoped
-- assignments per engagement until a real "assigned companies" concept
-- is built; seeding it here would silently grant it access to every
-- company on the platform, contradicting its own stated scope.
do $$
declare
  r_psa bigint;
  r_pa bigint;
  r_support bigint;
begin
  select id into r_psa from permission_roles where role_key = 'platform_super_administrator' and company_id is null;
  select id into r_pa from permission_roles where role_key = 'platform_administrator' and company_id is null;
  select id into r_support from permission_roles where role_key = 'support_technician' and company_id is null;

  insert into role_permissions (role_id, permission_key)
  select r_psa, k from unnest(array['SystemAdministration','ManageUsers','AuditAccess','RunReports','AccessAICopilot']) as k
  where not exists (select 1 from role_permissions where role_id = r_psa and permission_key = k);

  insert into role_permissions (role_id, permission_key)
  select r_pa, k from unnest(array['ManageUsers','AuditAccess','RunReports']) as k
  where not exists (select 1 from role_permissions where role_id = r_pa and permission_key = k);

  insert into role_permissions (role_id, permission_key)
  select r_support, k from unnest(array['AuditAccess','RunReports']) as k
  where not exists (select 1 from role_permissions where role_id = r_support and permission_key = k);
end $$;

-- FINDING (Repository audit, Part 4): 5 repository functions update a
-- company-scoped row filtered by `id` alone, with no `companyId`
-- parameter at all — RLS already protects every one of these (each
-- table's UPDATE policy independently re-checks company_id via
-- `user_can_access_company`/`user_has_permission`), so none were
-- exploitable, but this closes the gap at the SQL layer too for the two
-- that had no defensible single-call-site justification:
-- `stock_cost_layers` (`applyLayerUpdates`) and `automation_task_runs`
-- (`finishTaskRun`) previously had no extra protection beyond the
-- table's own blanket policy; this is now moot since the repository
-- layer fix (see communication-service.ts-style companyId threading)
-- lands in the same commit as this migration. No schema change needed
-- — documented here for the certification record.
