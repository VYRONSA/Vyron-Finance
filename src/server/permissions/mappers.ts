import type { ApprovalCategory, PermissionAuditEntry, PermissionKey, PermissionRole, RoleApprovalLimit, RoleScope, UserRoleAssignment } from "./types";

export type PermissionRoleRow = {
  id: number;
  company_id: string | null;
  role_key: string;
  name: string;
  description: string;
  is_system_role: boolean;
  scope: string;
  parent_role_id: number | null;
  created_at: string;
};

export function permissionRoleFromRow(row: PermissionRoleRow): PermissionRole {
  return {
    id: row.id,
    companyId: row.company_id,
    roleKey: row.role_key,
    name: row.name,
    description: row.description,
    isSystemRole: row.is_system_role,
    scope: row.scope as RoleScope,
    parentRoleId: row.parent_role_id,
    createdAt: row.created_at,
  };
}

export type RolePermissionRow = { id: number; role_id: number; permission_key: string };

export function permissionKeyFromRow(row: RolePermissionRow): PermissionKey {
  return row.permission_key as PermissionKey;
}

export type RoleApprovalLimitRow = { id: number; role_id: number; category: string; max_amount: number | string | null };

export function roleApprovalLimitFromRow(row: RoleApprovalLimitRow): RoleApprovalLimit {
  return {
    id: row.id,
    roleId: row.role_id,
    category: row.category as ApprovalCategory,
    maxAmount: row.max_amount === null ? null : Number(row.max_amount),
  };
}

export type UserRoleAssignmentRow = {
  id: number;
  user_id: string;
  company_id: string | null;
  role_id: number;
  assigned_by: string;
  assigned_at: string;
};

export function userRoleAssignmentFromRow(row: UserRoleAssignmentRow): UserRoleAssignment {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    roleId: row.role_id,
    assignedBy: row.assigned_by,
    assignedAt: row.assigned_at,
  };
}

export type PermissionAuditEntryRow = {
  id: number;
  company_id: string | null;
  item_type: string;
  item_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  reason: string;
  performed_by: string;
  performed_at: string;
};

export function permissionAuditEntryFromRow(row: PermissionAuditEntryRow): PermissionAuditEntry {
  return {
    id: row.id,
    companyId: row.company_id,
    itemType: row.item_type,
    itemId: row.item_id,
    fieldName: row.field_name,
    oldValue: row.old_value,
    newValue: row.new_value,
    reason: row.reason,
    performedBy: row.performed_by,
    performedAt: row.performed_at,
  };
}
