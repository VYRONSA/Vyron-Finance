/**
 * Domain types for the RC1 Phase 1 RBAC platform — the ONE Permission
 * Engine. See supabase/migrations/0025_rbac_platform.sql. Every named
 * role in the Product Review Board's own directive (4 platform-scope,
 * 15 company-scope) is a real, seeded row in `permission_roles`, not a
 * hardcoded switch — "Support Custom Roles" falls out of the same
 * table/shape for free (`isSystemRole: false`).
 */

export const PERMISSION_MODULES = [
  "Sales", "Purchasing", "Inventory", "Banking", "Matching", "GeneralLedger",
  "VAT", "Assets", "Reports", "Auditor", "Cashbook", "Settings",
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const MODULE_ACTIONS = [
  "View", "Create", "Edit", "Delete", "Approve", "Reject", "Reverse", "Post", "Export", "Import",
] as const;
export type ModuleAction = (typeof MODULE_ACTIONS)[number];

/** The directive's own named, cross-cutting permission categories —
 * global, not per-module (a company either grants "ApproveJournals" to
 * a role or it doesn't; there's no "Sales:ApproveJournals"). */
export const GLOBAL_PERMISSIONS = [
  "RunAutomation", "RunReports", "AccessAICopilot", "ManageUsers", "ManageFinancialYears",
  "ManageVAT", "ApproveJournals", "ApprovePayments", "ApprovePurchases", "ApproveSales",
  "ApproveAssets", "RunDepreciation", "GenerateFinancialStatements", "AuditAccess", "SystemAdministration",
  "ManageBilling",
] as const;
export type GlobalPermission = (typeof GLOBAL_PERMISSIONS)[number];

export type ModulePermissionKey = `${PermissionModule}:${ModuleAction}`;
export type PermissionKey = ModulePermissionKey | GlobalPermission;

/** Every valid key, generated (not hand-typed) from the two catalogs
 * above — the one place a caller can validate an arbitrary string
 * against "is this a real permission key." */
export const ALL_PERMISSION_KEYS: PermissionKey[] = [
  ...PERMISSION_MODULES.flatMap((m) => MODULE_ACTIONS.map((a): ModulePermissionKey => `${m}:${a}`)),
  ...GLOBAL_PERMISSIONS,
];

export function isValidPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSION_KEYS as string[]).includes(value);
}

export type RoleScope = "platform" | "company";

export type PermissionRole = {
  id: number;
  companyId: string | null;
  roleKey: string;
  name: string;
  description: string;
  isSystemRole: boolean;
  scope: RoleScope;
  parentRoleId: number | null;
  createdAt: string;
};

/** Approval Limits — the 5 categories the directive names explicitly.
 * `maxAmount: null` means explicitly unlimited (a real grant); the
 * ABSENCE of a `RoleApprovalLimit` row for a category (not represented
 * in this type — see `permission-engine.ts::evaluateApproval`) means
 * the role cannot approve that category at all. */
export const APPROVAL_CATEGORIES = ["Journal", "SupplierPayment", "CustomerCreditNote", "PurchaseApproval", "AssetDisposal"] as const;
export type ApprovalCategory = (typeof APPROVAL_CATEGORIES)[number];

export type RoleApprovalLimit = {
  id: number;
  roleId: number;
  category: ApprovalCategory;
  maxAmount: number | null;
};

export type UserRoleAssignment = {
  id: number;
  userId: string;
  companyId: string | null;
  roleId: number;
  assignedBy: string;
  assignedAt: string;
};

/** A role with everything the pure engine needs already attached —
 * what the service layer fetches and hands to `permission-engine.ts`. */
export type PermissionRoleWithGrants = PermissionRole & {
  permissionKeys: PermissionKey[];
  approvalLimits: RoleApprovalLimit[];
};

/** One row of the RBAC audit trail — who changed what and why. Written
 * only via the `record_permission_audit_entry` security-definer RPC
 * (see `permission-repository.ts`); this is its read-side shape. */
export type PermissionAuditEntry = {
  id: number;
  companyId: string | null;
  itemType: string;
  itemId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  performedBy: string;
  performedAt: string;
};
