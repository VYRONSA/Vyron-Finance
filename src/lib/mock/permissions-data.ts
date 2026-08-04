/**
 * Preview Mode seed data for the RC1 Phase 1 RBAC platform. Mirrors the
 * real 19 system roles `0025_rbac_platform.sql::seed_company_rbac_defaults`
 * seeds for every real company, so Preview Mode's Roles & Permissions
 * tab looks and behaves like a real, already-configured company rather
 * than an empty shell.
 */

import type { PermissionRoleWithGrants, UserRoleAssignment } from "@/server/permissions/types";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;

function role(overrides: Partial<PermissionRoleWithGrants>): PermissionRoleWithGrants {
  return {
    id: 0, companyId: COMPANY_ID, roleKey: "", name: "", description: "", isSystemRole: true,
    scope: "company", parentRoleId: null, createdAt: "2026-01-01", permissionKeys: [], approvalLimits: [],
    ...overrides,
  };
}

const READ_ONLY_PERMS = ["Sales:View", "Purchasing:View", "Inventory:View", "Banking:View", "Matching:View", "GeneralLedger:View", "VAT:View", "Assets:View", "Reports:View", "Auditor:View", "Cashbook:View", "Settings:View"] as const;

export const MOCK_PERMISSION_ROLES: PermissionRoleWithGrants[] = [
  role({ id: 101, companyId: null, roleKey: "platform_super_administrator", name: "Platform Super Administrator", scope: "platform", permissionKeys: [...READ_ONLY_PERMS, "SystemAdministration"] }),
  role({ id: 102, companyId: null, roleKey: "platform_administrator", name: "Platform Administrator", scope: "platform", permissionKeys: [...READ_ONLY_PERMS] }),
  role({ id: 103, companyId: null, roleKey: "partner", name: "Partner", scope: "platform", permissionKeys: [...READ_ONLY_PERMS, "RunReports"] }),
  role({ id: 104, companyId: null, roleKey: "support_technician", name: "Support Technician", scope: "platform", permissionKeys: [...READ_ONLY_PERMS] }),

  role({ id: 1, roleKey: "company_owner", name: "Company Owner", permissionKeys: ["SystemAdministration", "ManageUsers", "ManageFinancialYears", "ManageVAT", "ApproveJournals", "ApprovePayments", "ApprovePurchases", "ApproveSales", "ApproveAssets", "RunDepreciation", "GenerateFinancialStatements", "AuditAccess", "RunAutomation", "RunReports", "AccessAICopilot"], approvalLimits: [{ id: 1, roleId: 1, category: "Journal", maxAmount: null }, { id: 2, roleId: 1, category: "SupplierPayment", maxAmount: null }, { id: 3, roleId: 1, category: "CustomerCreditNote", maxAmount: null }, { id: 4, roleId: 1, category: "PurchaseApproval", maxAmount: null }, { id: 5, roleId: 1, category: "AssetDisposal", maxAmount: null }] }),
  role({ id: 2, roleKey: "managing_director", name: "Managing Director", permissionKeys: ["ManageUsers", "ManageFinancialYears", "ManageVAT", "ApproveJournals", "ApprovePayments", "ApprovePurchases", "ApproveSales", "ApproveAssets", "RunDepreciation", "GenerateFinancialStatements", "AuditAccess", "RunReports", "AccessAICopilot"], approvalLimits: [{ id: 6, roleId: 2, category: "Journal", maxAmount: null }, { id: 7, roleId: 2, category: "SupplierPayment", maxAmount: null }] }),
  role({ id: 3, roleKey: "financial_director", name: "Financial Director", permissionKeys: ["ManageUsers", "ManageFinancialYears", "ManageVAT", "ApproveJournals", "ApprovePayments", "ApprovePurchases", "ApproveSales", "ApproveAssets", "RunDepreciation", "GenerateFinancialStatements", "AuditAccess", "RunReports", "AccessAICopilot"], approvalLimits: [{ id: 8, roleId: 3, category: "Journal", maxAmount: null }, { id: 9, roleId: 3, category: "SupplierPayment", maxAmount: null }, { id: 10, roleId: 3, category: "AssetDisposal", maxAmount: null }] }),
  role({ id: 4, roleKey: "financial_manager", name: "Financial Manager", permissionKeys: ["ManageUsers", "ManageFinancialYears", "ManageVAT", "ApproveJournals", "ApprovePayments", "ApprovePurchases", "ApproveSales", "ApproveAssets", "RunDepreciation", "GenerateFinancialStatements", "RunAutomation", "RunReports", "AccessAICopilot", "Sales:Approve", "Purchasing:Approve"], approvalLimits: [{ id: 11, roleId: 4, category: "Journal", maxAmount: 500000 }, { id: 12, roleId: 4, category: "SupplierPayment", maxAmount: 500000 }, { id: 13, roleId: 4, category: "CustomerCreditNote", maxAmount: 500000 }, { id: 14, roleId: 4, category: "PurchaseApproval", maxAmount: 500000 }, { id: 15, roleId: 4, category: "AssetDisposal", maxAmount: 500000 }] }),
  role({ id: 5, roleKey: "accountant", name: "Accountant", permissionKeys: ["Sales:View", "Sales:Create", "Sales:Edit", "Sales:Post", "Purchasing:View", "Purchasing:Create", "Purchasing:Edit", "Purchasing:Post", "GeneralLedger:View", "GeneralLedger:Post", "VAT:View", "ManageVAT", "RunDepreciation", "GenerateFinancialStatements", "ApproveJournals", "ApprovePayments", "RunReports", "AccessAICopilot"], approvalLimits: [{ id: 16, roleId: 5, category: "Journal", maxAmount: 150000 }, { id: 17, roleId: 5, category: "SupplierPayment", maxAmount: 150000 }] }),
  role({ id: 6, roleKey: "bookkeeper", name: "Bookkeeper", permissionKeys: ["Sales:View", "Sales:Create", "Sales:Edit", "Purchasing:View", "Purchasing:Create", "Purchasing:Edit", "Banking:View", "Banking:Create", "Cashbook:View", "Cashbook:Create"] }),
  role({ id: 7, roleKey: "senior_bookkeeper", name: "Senior Bookkeeper", parentRoleId: 6, permissionKeys: ["Sales:Post", "Purchasing:Post", "Banking:Post", "ApproveJournals", "ApprovePayments"], approvalLimits: [{ id: 18, roleId: 7, category: "Journal", maxAmount: 50000 }, { id: 19, roleId: 7, category: "SupplierPayment", maxAmount: 50000 }] }),
  role({ id: 8, roleKey: "accounts_receivable_clerk", name: "Accounts Receivable Clerk", permissionKeys: ["Sales:View", "Sales:Create", "Sales:Edit", "ApproveSales"], approvalLimits: [{ id: 20, roleId: 8, category: "CustomerCreditNote", maxAmount: 10000 }] }),
  role({ id: 9, roleKey: "accounts_payable_clerk", name: "Accounts Payable Clerk", permissionKeys: ["Purchasing:View", "Purchasing:Create", "Purchasing:Edit", "ApprovePurchases"], approvalLimits: [{ id: 21, roleId: 9, category: "PurchaseApproval", maxAmount: 10000 }] }),
  role({ id: 10, roleKey: "inventory_manager", name: "Inventory Manager", permissionKeys: ["Inventory:View", "Inventory:Create", "Inventory:Edit", "Inventory:Delete"] }),
  role({ id: 11, roleKey: "purchasing_manager", name: "Purchasing Manager", permissionKeys: ["Purchasing:View", "Purchasing:Create", "Purchasing:Edit", "Purchasing:Approve", "Purchasing:Reject", "ApprovePurchases"], approvalLimits: [{ id: 22, roleId: 11, category: "PurchaseApproval", maxAmount: 250000 }] }),
  role({ id: 12, roleKey: "sales_manager", name: "Sales Manager", permissionKeys: ["Sales:View", "Sales:Create", "Sales:Edit", "Sales:Approve", "Sales:Reject", "ApproveSales"], approvalLimits: [{ id: 23, roleId: 12, category: "CustomerCreditNote", maxAmount: 100000 }] }),
  role({ id: 13, roleKey: "branch_manager", name: "Branch Manager", permissionKeys: ["Sales:View", "Purchasing:View", "Inventory:View", "Banking:View", "GeneralLedger:View", "Reports:View"] }),
  role({ id: 14, roleKey: "auditor", name: "Auditor", permissionKeys: [...READ_ONLY_PERMS, "AuditAccess", "RunReports", "AccessAICopilot"] }),
  role({ id: 15, roleKey: "read_only", name: "Read Only", permissionKeys: [...READ_ONLY_PERMS] }),
];

export const MOCK_ROLE_ASSIGNMENTS: UserRoleAssignment[] = [
  { id: 1, userId: "b3e1a6b0-1c2d-4e3f-8a9b-000000000001", companyId: COMPANY_ID, roleId: 1, assignedBy: "System", assignedAt: "2026-01-01T00:00:00Z" },
  { id: 2, userId: "b3e1a6b0-1c2d-4e3f-8a9b-000000000002", companyId: COMPANY_ID, roleId: 5, assignedBy: "Priya Shah", assignedAt: "2026-02-15T00:00:00Z" },
  { id: 3, userId: "b3e1a6b0-1c2d-4e3f-8a9b-000000000003", companyId: COMPANY_ID, roleId: 6, assignedBy: "Priya Shah", assignedAt: "2026-03-01T00:00:00Z" },
];
