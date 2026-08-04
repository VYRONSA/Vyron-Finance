/**
 * The ONE Permission Engine — pure, no Supabase. Every page/API/report/
 * workflow that needs an authorization decision calls into this file
 * (via `permission-service.ts`'s thin async wrapper), never
 * reimplements a check itself. Two responsibilities: resolving a role's
 * EFFECTIVE permission set (including inherited ones), and evaluating
 * whether a specific approval is within a role's amount limit.
 */

import type { ApprovalCategory, PermissionKey, PermissionRoleWithGrants } from "./types";

const MAX_INHERITANCE_DEPTH = 10;

/** Pure — walks `parentRoleId` up the chain (cycle-guarded by a depth
 * cap, since a role hierarchy is data, not a compile-time guarantee)
 * and unions every ancestor's permission grants with the role's own. A
 * role that inherits from another automatically gets everything the
 * parent has, plus whatever it adds itself — never the reverse. */
export function resolveEffectivePermissions(role: PermissionRoleWithGrants, allRoles: PermissionRoleWithGrants[]): Set<PermissionKey> {
  const byId = new Map(allRoles.map((r) => [r.id, r]));
  const effective = new Set<PermissionKey>();
  let current: PermissionRoleWithGrants | undefined = role;
  let depth = 0;
  const visited = new Set<number>();

  while (current && depth < MAX_INHERITANCE_DEPTH && !visited.has(current.id)) {
    visited.add(current.id);
    for (const key of current.permissionKeys) effective.add(key);
    current = current.parentRoleId !== null ? byId.get(current.parentRoleId) : undefined;
    depth += 1;
  }

  return effective;
}

export function hasPermission(effectivePermissions: Set<PermissionKey>, key: PermissionKey): boolean {
  return effectivePermissions.has(key);
}

/** Pure — resolves a role's own approval-limit row for a category, then
 * walks the inheritance chain if the role itself has none (a role that
 * doesn't override a limit uses its parent's). No row anywhere in the
 * chain means the role cannot approve that category at all. */
export function resolveApprovalLimit(role: PermissionRoleWithGrants, allRoles: PermissionRoleWithGrants[], category: ApprovalCategory): { maxAmount: number | null } | null {
  const byId = new Map(allRoles.map((r) => [r.id, r]));
  let current: PermissionRoleWithGrants | undefined = role;
  let depth = 0;
  const visited = new Set<number>();

  while (current && depth < MAX_INHERITANCE_DEPTH && !visited.has(current.id)) {
    visited.add(current.id);
    const own = current.approvalLimits.find((l) => l.category === category);
    if (own) return { maxAmount: own.maxAmount };
    current = current.parentRoleId !== null ? byId.get(current.parentRoleId) : undefined;
    depth += 1;
  }

  return null;
}

export type ApprovalEvaluation = { allowed: boolean; reason: string };

/** Pure — the ONE approval-limit decision function. Journal approval,
 * supplier payments, customer credit notes, purchase approvals, and
 * asset disposals all call this exact function (via
 * `permission-service.ts::requireApproval`) — never a per-module
 * reimplementation of "is this amount within limit." */
export function evaluateApproval(hasApprovalPermission: boolean, limit: { maxAmount: number | null } | null, amount: number): ApprovalEvaluation {
  if (!hasApprovalPermission) {
    return { allowed: false, reason: "This role does not have approval permission for this category." };
  }
  if (limit === null) {
    return { allowed: false, reason: "No approval limit is configured for this role in this category — approval is blocked until a limit is set." };
  }
  if (limit.maxAmount === null) {
    return { allowed: true, reason: "This role has an unlimited approval limit for this category." };
  }
  if (amount <= limit.maxAmount) {
    return { allowed: true, reason: `Within this role's approval limit of ${limit.maxAmount.toFixed(2)}.` };
  }
  return { allowed: false, reason: `Amount ${amount.toFixed(2)} exceeds this role's approval limit of ${limit.maxAmount.toFixed(2)}.` };
}
