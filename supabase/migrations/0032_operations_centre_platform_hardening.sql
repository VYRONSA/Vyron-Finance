-- RC1 Phase 7.5 — a fresh RLS re-audit (Part 9, "do not assume previous
-- work is complete") found one real, previously-undisclosed gap that
-- 0031 did not touch: `system_events` and `operations_alerts` treat
-- EVERY platform-level row (`company_id is null`) as readable/writable
-- by any authenticated user, not just an actual platform role holder.
-- 0030's own comment disclosed this honestly at the time ("Platform
-- Super Administrator/Platform Administrator roles are seeded but have
-- NO enforcement code anywhere yet") — but 0031 already closed that gap
-- by giving those roles real permission grants and fixing
-- `user_has_permission()`'s cross-tenant defect, so this policy is now
-- stale, not merely permissive-by-necessity. Fixed the same way 0031
-- fixed `automation_audit_log`: platform-level rows now require the
-- caller to actually hold a platform-scope permission, checked via the
-- same `user_has_permission()` used everywhere else — no new RPC
-- needed, since `user_has_permission(null, key)`'s two-branch design
-- (see 0031) already resolves ONLY real platform-scope grants when
-- passed a null company id (the company-scoped branch's `ura.company_id
-- = null` can never match under SQL NULL semantics). Company-scoped
-- rows are unaffected — `user_can_access_company(company_id)` was
-- already correct there.

drop policy "members can read their company's system events" on system_events;
drop policy "members can insert their company's system events" on system_events;
drop policy "members can access their company's operations alerts" on operations_alerts;

create policy "read own-company or own-platform-role system events" on system_events for select using (
  (company_id is not null and user_can_access_company(company_id))
  or (company_id is null and user_has_permission(null, 'AuditAccess'))
);
create policy "insert own-company or own-platform-role system events" on system_events for insert with check (
  (company_id is not null and user_can_access_company(company_id))
  or (company_id is null and user_has_permission(null, 'AuditAccess'))
);

create policy "access own-company operations alerts" on operations_alerts for all using (
  company_id is not null and user_can_access_company(company_id)
);
create policy "access own-platform-role operations alerts" on operations_alerts for all using (
  company_id is null and user_has_permission(null, 'AuditAccess')
);
