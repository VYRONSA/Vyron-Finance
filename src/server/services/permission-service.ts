/**
 * The ONE Permission Engine's async wrapper — every API route composes
 * `requirePermission()`/`requireApproval()` the exact same way it
 * already composes `requireSession()` (`{ ok: true } | { ok: false,
 * response }`), so adding a permission check to a route is a one-line,
 * mechanically consistent change: `const check = await
 * requirePermission(companyId, "Sales:Approve"); if (!check.ok) return
 * check.response;`. No route/page/service reimplements a check itself —
 * this file, plus the pure `permission-engine.ts` it delegates to, is
 * the only place an authorization decision is made.
 */

import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/server/auth/require-session";
import * as repo from "@/server/repositories/permission-repository";
import { evaluateApproval, resolveApprovalLimit, resolveEffectivePermissions } from "@/server/permissions/permission-engine";
import { recordSystemEvent } from "@/server/services/operations-service";
import type { ApprovalCategory, PermissionKey, PermissionRole, PermissionRoleWithGrants, UserRoleAssignment } from "@/server/permissions/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export type PermissionCheck = { ok: true } | { ok: false; response: NextResponse };

/** Resolves the signed-in user's role for this company (their explicit
 * company-scope assignment; a platform-scope assignment, if any, is a
 * separate concern — see `getPlatformRole`) and every role in the
 * company so inheritance can be walked. Returns `null` when the user
 * has no role assignment in this company at all — a real, honest
 * "unassigned" state, not defaulted to some permissive fallback. */
export async function getEffectiveRole(userId: string, companyId: string): Promise<{ role: PermissionRoleWithGrants; allRoles: PermissionRoleWithGrants[] } | null> {
  const [assignment, allRoles] = await Promise.all([repo.getUserRoleAssignment(userId, companyId), repo.listRolesWithGrantsForCompany(companyId)]);
  if (!assignment) return null;
  const role = allRoles.find((r) => r.id === assignment.roleId);
  if (!role) return null;
  return { role, allRoles };
}

/** Every denial funnels through here — the RC1 Phase 6 Operations
 * Centre's Security Dashboard logs a real `PermissionDenied` event on
 * every call, fire-and-forget (`recordSystemEvent` already swallows its
 * own errors), so a logging failure can never affect the actual
 * authorization decision this function returns. */
function forbidden(message: string, companyId: string | null, userId: string, permissionKey: string): PermissionCheck {
  void recordSystemEvent(companyId, "PermissionDenied", "warning", userId, message, { permissionKey });
  return { ok: false, response: NextResponse.json({ error: message }, { status: 403 }) };
}

/** The one function every permission-gated route calls. Mirrors
 * `requireSession()`'s exact composable shape. */
export async function requirePermission(companyId: string, permissionKey: PermissionKey): Promise<PermissionCheck> {
  const userId = await getCurrentUserId();
  const resolved = await getEffectiveRole(userId, companyId);
  if (!resolved) return forbidden("You have no role assigned in this company yet — ask a Company Owner or Financial Manager to assign one.", companyId, userId, permissionKey);

  const effective = resolveEffectivePermissions(resolved.role, resolved.allRoles);
  if (!effective.has(permissionKey)) {
    return forbidden(`Your role ("${resolved.role.name}") does not have the "${permissionKey}" permission.`, companyId, userId, permissionKey);
  }
  return { ok: true };
}

/** For platform-wide capabilities (the Internal Billing Console, and
 * anything else genuinely cross-tenant) — checks the signed-in user's
 * `company_id is null` role assignment(s) directly via one query, no
 * per-company loop. A real, disclosed improvement over Operations
 * Centre's own current access model (`/platform/operations`, which
 * iterates every company the user belongs to and re-checks
 * `SystemAdministration` per company) — not retrofitted onto that
 * module in this pass, since it wasn't asked for and touching a
 * shipped, tested module's access model unprompted is exactly the kind
 * of unscoped change this codebase's own standing rules avoid. */
export async function requirePlatformPermission(permissionKey: PermissionKey): Promise<PermissionCheck> {
  const userId = await getCurrentUserId();
  const assignments = await repo.listPlatformRoleAssignmentsForUser(userId);
  if (assignments.length === 0) {
    return forbidden("You have no platform-scope role assigned.", null, userId, permissionKey);
  }

  const roleIds = assignments.map((a) => a.roleId);
  const grantsByRole = await repo.listPermissionsForRoles(roleIds);
  const hasGrant = roleIds.some((id) => (grantsByRole.get(id) ?? []).includes(permissionKey));
  if (!hasGrant) {
    return forbidden(`Your platform role does not have the "${permissionKey}" permission.`, null, userId, permissionKey);
  }
  return { ok: true };
}

/** The one function every approval-limit-gated route calls. Journal
 * approval, supplier payments, customer credit notes, purchase
 * approvals, and asset disposals all call this exact function — never a
 * per-module reimplementation of "is this amount within limit." */
export async function requireApproval(companyId: string, permissionKey: PermissionKey, category: ApprovalCategory, amount: number): Promise<PermissionCheck> {
  const userId = await getCurrentUserId();
  const resolved = await getEffectiveRole(userId, companyId);
  if (!resolved) return forbidden("You have no role assigned in this company yet — ask a Company Owner or Financial Manager to assign one.", companyId, userId, permissionKey);

  const effective = resolveEffectivePermissions(resolved.role, resolved.allRoles);
  const limit = resolveApprovalLimit(resolved.role, resolved.allRoles, category);
  const evaluation = evaluateApproval(effective.has(permissionKey), limit, amount);
  if (!evaluation.allowed) return forbidden(evaluation.reason, companyId, userId, permissionKey);
  return { ok: true };
}

// ---------------------------------------------------------------------
// Role / permission / assignment administration — used by the Settings
// "Roles & Permissions" tab. Every mutation here itself requires
// "ManageUsers" — checked by the calling API route via
// `requirePermission(companyId, "ManageUsers")`, the same composable
// pattern as every other gated route, never a bespoke admin-only check.
// ---------------------------------------------------------------------

export const listRolesForCompany = repo.listRolesForCompany;
export const listAssignmentsForCompany = repo.listAssignmentsForCompany;

export async function getRolesWithGrants(companyId: string): Promise<PermissionRoleWithGrants[]> {
  return repo.listRolesWithGrantsForCompany(companyId);
}

export async function createCustomRole(companyId: string, name: string, description: string, performedBy: string): Promise<PermissionRole> {
  if (!name.trim()) throw new ValidationError("Role name is required.");
  const roleKey = `custom_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}_${Date.now().toString(36)}`;
  const role = await repo.createCustomRole({ companyId, roleKey, name: name.trim(), description });
  await repo.recordPermissionAuditEntry(companyId, "Role", String(role.id), "created", null, name.trim(), "Custom role created.", performedBy);
  return role;
}

export async function deleteCustomRole(companyId: string, roleId: number, performedBy: string): Promise<void> {
  const role = await repo.getRoleForCompany(companyId, roleId);
  if (!role) throw new NotFoundError(`No role with id ${roleId}.`);
  if (role.isSystemRole) throw new ValidationError("System roles cannot be deleted — create a custom role instead.");
  await repo.deleteCustomRole(companyId, roleId);
  await repo.recordPermissionAuditEntry(companyId, "Role", String(roleId), "deleted", role.name, null, "Custom role deleted.", performedBy);
}

export async function updateRolePermissions(companyId: string, roleId: number, permissionKeys: PermissionKey[], performedBy: string): Promise<void> {
  const role = await repo.getRoleForCompany(companyId, roleId);
  if (!role) throw new NotFoundError(`No role with id ${roleId}.`);
  if (role.isSystemRole) throw new ValidationError("System roles' permissions are fixed defaults — create a custom role to customize.");
  if (role.companyId !== companyId) throw new ValidationError("This role does not belong to this company.");
  await repo.setRolePermissions(roleId, permissionKeys);
  await repo.recordPermissionAuditEntry(companyId, "Role", String(roleId), "permissionKeys", null, permissionKeys.join(","), `Permissions updated for role "${role.name}".`, performedBy);
}

export async function updateRoleApprovalLimit(companyId: string, roleId: number, category: ApprovalCategory, maxAmount: number | null, performedBy: string): Promise<void> {
  const role = await repo.getRoleForCompany(companyId, roleId);
  if (!role) throw new NotFoundError(`No role with id ${roleId}.`);
  if (role.isSystemRole) throw new ValidationError("System roles' approval limits are fixed defaults — create a custom role to customize.");
  if (role.companyId !== companyId) throw new ValidationError("This role does not belong to this company.");
  if (maxAmount !== null && maxAmount < 0) throw new ValidationError("Approval limit cannot be negative.");
  await repo.setRoleApprovalLimit(roleId, category, maxAmount);
  await repo.recordPermissionAuditEntry(companyId, "Role", String(roleId), `approvalLimit:${category}`, null, maxAmount === null ? "unlimited" : String(maxAmount), `Approval limit updated for role "${role.name}".`, performedBy);
}

export async function assignUserRole(companyId: string, userId: string, roleId: number, performedBy: string): Promise<UserRoleAssignment> {
  const role = await repo.getRoleForCompany(companyId, roleId);
  if (!role) throw new NotFoundError(`No role with id ${roleId}.`);
  if (role.companyId !== companyId && role.scope !== "platform") throw new ValidationError("This role does not belong to this company.");
  const assignment = await repo.assignRole(userId, companyId, roleId, performedBy);
  await repo.recordPermissionAuditEntry(companyId, "UserRoleAssignment", userId, "roleId", null, String(roleId), `Assigned role "${role.name}" to user ${userId}.`, performedBy);
  return assignment;
}

export async function revokeUserRole(companyId: string, assignmentId: number, performedBy: string): Promise<void> {
  await repo.revokeRoleAssignment(assignmentId, companyId);
  await repo.recordPermissionAuditEntry(companyId, "UserRoleAssignment", String(assignmentId), "revoked", "active", "revoked", "Role assignment revoked.", performedBy);
}
