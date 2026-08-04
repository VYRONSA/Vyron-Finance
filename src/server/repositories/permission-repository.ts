/**
 * Repository layer for the RC1 RBAC platform. See
 * supabase/migrations/0025_rbac_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import {
  permissionAuditEntryFromRow,
  permissionKeyFromRow,
  permissionRoleFromRow,
  roleApprovalLimitFromRow,
  userRoleAssignmentFromRow,
  type PermissionAuditEntryRow,
  type PermissionRoleRow,
  type RoleApprovalLimitRow,
  type RolePermissionRow,
  type UserRoleAssignmentRow,
} from "@/server/permissions/mappers";
import type { PermissionAuditEntry, PermissionKey, PermissionRole, PermissionRoleWithGrants, RoleApprovalLimit, UserRoleAssignment } from "@/server/permissions/types";

/** Every role visible to a company: its own custom/system roles PLUS
 * the 4 platform-scope roles (company_id null) — a platform-role
 * assignment for this user is resolved separately, but the roles
 * themselves must be listable alongside company roles for admin UI. */
export async function listRolesForCompany(companyId: string): Promise<PermissionRole[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("permission_roles")
    .select("*")
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .order("scope")
    .order("name")
    .returns<PermissionRoleRow[]>();
  if (error) throw error;
  return data.map(permissionRoleFromRow);
}

export async function getRole(roleId: number): Promise<PermissionRole | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("permission_roles").select("*").eq("id", roleId).maybeSingle<PermissionRoleRow>();
  if (error) throw error;
  return data ? permissionRoleFromRow(data) : null;
}

/** Defense-in-depth companyId scoping (the service layer already checks
 * `role.companyId !== companyId` before calling into any of the
 * mutation functions below, but this repository never assumes a caller
 * always goes through that layer — RLS is the real enforcement now, see
 * 0025_rbac_platform.sql's own security-fix comment, and this explicit
 * filter is the same "belt and braces" discipline every other
 * company-scoped repository in this codebase already applies). */
export async function getRoleForCompany(companyId: string, roleId: number): Promise<PermissionRole | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("permission_roles")
    .select("*")
    .eq("id", roleId)
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .maybeSingle<PermissionRoleRow>();
  if (error) throw error;
  return data ? permissionRoleFromRow(data) : null;
}

export async function listPermissionsForRoles(roleIds: number[]): Promise<Map<number, PermissionKey[]>> {
  if (roleIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("role_permissions").select("*").in("role_id", roleIds).returns<RolePermissionRow[]>();
  if (error) throw error;
  const map = new Map<number, PermissionKey[]>();
  for (const row of data) {
    const list = map.get(row.role_id) ?? [];
    list.push(permissionKeyFromRow(row));
    map.set(row.role_id, list);
  }
  return map;
}

export async function listApprovalLimitsForRoles(roleIds: number[]): Promise<Map<number, RoleApprovalLimit[]>> {
  if (roleIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("role_approval_limits").select("*").in("role_id", roleIds).returns<RoleApprovalLimitRow[]>();
  if (error) throw error;
  const map = new Map<number, RoleApprovalLimit[]>();
  for (const row of data) {
    const list = map.get(row.role_id) ?? [];
    list.push(roleApprovalLimitFromRow(row));
    map.set(row.role_id, list);
  }
  return map;
}

/** Every company role, joined with its own grants — what the pure
 * engine needs for inheritance resolution (it needs every role in the
 * chain, not just the one the caller holds). */
export async function listRolesWithGrantsForCompany(companyId: string): Promise<PermissionRoleWithGrants[]> {
  const roles = await listRolesForCompany(companyId);
  const roleIds = roles.map((r) => r.id);
  const [permissionsByRole, limitsByRole] = await Promise.all([listPermissionsForRoles(roleIds), listApprovalLimitsForRoles(roleIds)]);
  return roles.map((r) => ({ ...r, permissionKeys: permissionsByRole.get(r.id) ?? [], approvalLimits: limitsByRole.get(r.id) ?? [] }));
}

export async function getUserRoleAssignment(userId: string, companyId: string): Promise<UserRoleAssignment | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_role_assignments")
    .select("*")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle<UserRoleAssignmentRow>();
  if (error) throw error;
  return data ? userRoleAssignmentFromRow(data) : null;
}

export async function listAssignmentsForCompany(companyId: string): Promise<UserRoleAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("user_role_assignments").select("*").eq("company_id", companyId).returns<UserRoleAssignmentRow[]>();
  if (error) throw error;
  return data.map(userRoleAssignmentFromRow);
}

/** Platform-scope assignments only (`company_id is null`) — what
 * `requirePlatformPermission()` needs to resolve. A direct query, not a
 * per-company loop the way Operations Centre's own access model
 * currently works (a real, disclosed improvement over that pattern —
 * see `billing-platform`'s own migration notes). */
export async function listPlatformRoleAssignmentsForUser(userId: string): Promise<UserRoleAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("user_role_assignments").select("*").eq("user_id", userId).is("company_id", null).returns<UserRoleAssignmentRow[]>();
  if (error) throw error;
  return data.map(userRoleAssignmentFromRow);
}

export type NewPermissionRole = { companyId: string; roleKey: string; name: string; description?: string };

export async function createCustomRole(input: NewPermissionRole): Promise<PermissionRole> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("permission_roles")
    .insert({ company_id: input.companyId, role_key: input.roleKey, name: input.name, description: input.description ?? "", is_system_role: false, scope: "company" })
    .select("*")
    .single<PermissionRoleRow>();
  if (error) throw error;
  return permissionRoleFromRow(data);
}

export async function deleteCustomRole(companyId: string, roleId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("permission_roles").delete().eq("id", roleId).eq("company_id", companyId).eq("is_system_role", false);
  if (error) throw error;
}

/** Replaces a role's full permission grant set — same "delete then
 * re-insert" shape this codebase already uses for editing a rule's
 * conditions/actions (`banking-rule-repository.ts`) or a split
 * transaction's lines. RLS (see 0025's `user_has_permission()`) is the
 * real enforcement; this call fails outright for a caller who isn't
 * entitled, it doesn't rely on the service layer alone. */
export async function setRolePermissions(roleId: number, permissionKeys: PermissionKey[]): Promise<void> {
  const supabase = await createClient();
  const { error: deleteError } = await supabase.from("role_permissions").delete().eq("role_id", roleId);
  if (deleteError) throw deleteError;
  if (permissionKeys.length === 0) return;
  const { error: insertError } = await supabase.from("role_permissions").insert(permissionKeys.map((key) => ({ role_id: roleId, permission_key: key })));
  if (insertError) throw insertError;
}

export async function setRoleApprovalLimit(roleId: number, category: string, maxAmount: number | null): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("role_approval_limits").upsert({ role_id: roleId, category, max_amount: maxAmount }, { onConflict: "role_id,category" });
  if (error) throw error;
}

/** RC1 Phase 2 — every RBAC mutation records who changed what and why,
 * via the `security definer` RPC only (there is no client-writable
 * policy on `permission_audit_log` at all — see the migration's own
 * comment), so the row can never be forged or backdated. */
export async function recordPermissionAuditEntry(companyId: string, itemType: string, itemId: string, fieldName: string, oldValue: string | null, newValue: string | null, reason: string, performedBy: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_permission_audit_entry", {
    target_company_id: companyId,
    p_item_type: itemType,
    p_item_id: itemId,
    p_field_name: fieldName,
    p_old_value: oldValue,
    p_new_value: newValue,
    p_reason: reason,
    p_performed_by: performedBy,
  });
  if (error) throw error;
}

/** RC1 Phase 6 — the Operations Centre's Audit Dashboard needs to READ
 * this trail; only a write path existed before this (via the RPC
 * above). A real `select` RLS policy already existed on
 * `permission_audit_log` (0025) — this was simply never queried. */
export async function listRecentPermissionAuditEntries(companyId: string, limit = 20): Promise<PermissionAuditEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("permission_audit_log")
    .select("*")
    .eq("company_id", companyId)
    .order("performed_at", { ascending: false })
    .limit(limit)
    .returns<PermissionAuditEntryRow[]>();
  if (error) throw error;
  return data.map(permissionAuditEntryFromRow);
}

/** Via the `assign_company_role` RPC (migration
 * 0034_role_assignment_organisation_membership_fix.sql), not a direct
 * insert — a direct insert only ever created the `user_role_assignments`
 * row, never the `organisation_members` row every company-scoped
 * table's RLS policy also requires, silently leaving every
 * newly-assigned user unable to access the company they were just
 * given a role in. Found during RC1 Phase 7.6 live certification. */
export async function assignRole(userId: string, companyId: string, roleId: number, assignedBy: string): Promise<UserRoleAssignment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("assign_company_role", { target_user_id: userId, target_company_id: companyId, target_role_id: roleId, performed_by: assignedBy })
    .single<UserRoleAssignmentRow>();
  if (error) throw error;
  return userRoleAssignmentFromRow(data);
}

export async function revokeRoleAssignment(assignmentId: number, companyId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("user_role_assignments").delete().eq("id", assignmentId).eq("company_id", companyId);
  if (error) throw error;
}

export async function seedCompanyRbacDefaults(companyId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("seed_company_rbac_defaults", { target_company_id: companyId });
  if (error) throw error;
}

/** Grants `ManageBilling` to the company's own Company Owner role — a
 * small, standalone RPC (0050_billing_platform_support_notes_and_permission.sql)
 * rather than a change to `seed_company_rbac_defaults` itself, matching
 * that migration's own reasoning for not re-pasting a function this
 * codebase has never safely re-pasted before. */
export async function grantManageBillingToCompanyOwner(companyId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_manage_billing_to_company_owner", { target_company_id: companyId });
  if (error) throw error;
}
