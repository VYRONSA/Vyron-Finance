# VYRON FINANCE — Permission Model

RC2 Phase 12 deliverable. The complete, current permission catalog and role matrix. Source of truth: `src/server/permissions/types.ts` and `supabase/migrations/0025_rbac_platform.sql`/`0031_security_certification_hardening.sql`.

## The permission catalog — 136 keys

**12 modules** × **10 actions** = 120 module permissions, of the shape `Module:Action` (e.g. `Sales:Create`):

Modules: Sales, Purchasing, Inventory, Banking, Matching, GeneralLedger, VAT, Assets, Reports, Auditor, Cashbook, Settings.
Actions: View, Create, Edit, Delete, Approve, Reject, Reverse, Post, Export, Import.

**16 global permissions** (cross-cutting, not tied to one module): RunAutomation, RunReports, AccessAICopilot, ManageUsers, ManageFinancialYears, ManageVAT, ApproveJournals, ApprovePayments, ApprovePurchases, ApproveSales, ApproveAssets, RunDepreciation, GenerateFinancialStatements, AuditAccess, SystemAdministration, ManageBilling.

`ManageBilling` (added by the Commercial Billing Platform, migration `0050_billing_platform_support_notes_and_permission.sql`) gates the Customer Portal's self-service billing actions and the Internal Billing Console. Seeded onto Company Owner (company-scope, via a standalone `grant_manage_billing_to_company_owner()` RPC — not the big `seed_company_rbac_defaults()` function) and Platform Super Administrator/Platform Administrator (platform-scope) only — see `docs/BILLING_ARCHITECTURE.md`.

## The 19 roles

### 15 company-scope roles (per-company, seeded automatically on every company creation)

| Role | Grant shape |
|---|---|
| Read Only | Every `:View` permission, nothing else |
| Bookkeeper | `View`/`Create`/`Edit` on Sales/Purchasing/Inventory/Banking/Cashbook/Matching — **zero approval permission of any kind** |
| Senior Bookkeeper | Inherits Bookkeeper (the *only* `parent_role_id` inheritance edge in the entire seed) + `:Post` on Sales/Purchasing/Banking/Cashbook + `ApproveJournals`/`ApprovePayments` capped at R50,000 |
| Accounts Receivable Clerk | Sales `View`/`Create`/`Edit` + `ApproveSales`, R10,000 cap |
| Accounts Payable Clerk | Purchasing `View`/`Create`/`Edit` + `ApprovePurchases`, R10,000 cap |
| Inventory Manager | Inventory `View`/`Create`/`Edit`/`Delete` |
| Purchasing Manager | Purchasing `View`/`Create`/`Edit`/`Approve`/`Reject` + `ApprovePurchases`, R250,000 cap |
| Sales Manager | Sales `View`/`Create`/`Edit`/`Approve`/`Reject` + `ApproveSales`, R100,000 cap |
| Branch Manager | `View` only across Sales/Purchasing/Inventory/Banking/GeneralLedger/Reports |
| Auditor | `AuditAccess`/`RunReports`/`AccessAICopilot` + `View` across 10 modules |
| Accountant | Broad `View`/`Create`/`Edit`/`Post`/`Export` across 9 modules + `RunReports`/`AccessAICopilot`/`ManageVAT`/`RunDepreciation`/`GenerateFinancialStatements` + all 4 approval permissions, R150,000 cap each |
| Financial Manager | Accountant's ceiling raised (`Delete`/`Reject`/`Import` added) + `ManageUsers`/`ManageFinancialYears`/`ApproveAssets`/`RunAutomation`, R500,000 cap each |
| Financial Director | Every module × every action + 14 of 16 globals (all except `SystemAdministration`/`ManageBilling`), unlimited approval on every category |
| Managing Director | Same as Financial Director |
| Company Owner | Same as Financial Director + `SystemAdministration`/`ManageBilling` (the only company role with either) |

### 4 platform-scope roles (`company_id is null`, apply across every company via the two-branch `user_has_permission()`/`user_can_access_company()` design)

| Role | Grants |
|---|---|
| Platform Super Administrator | `SystemAdministration`, `ManageUsers`, `AuditAccess`, `RunReports`, `AccessAICopilot`, `ManageBilling` |
| Platform Administrator | `ManageUsers`, `AuditAccess`, `RunReports`, `ManageBilling` |
| Support Technician | `AuditAccess`, `RunReports` |
| Partner | **Zero grants, deliberately** — its own description ("cross-company access on ASSIGNED companies") can't be honestly modeled by the platform-wide `company_id is null` mechanism, which grants everywhere, not just assigned companies. Seeding it would silently over-privilege it. Needs normal per-company assignments per engagement until a real "assigned companies" concept is built. |

**No platform role holds a module CRUD or approval/posting permission.** This is deliberate and structurally enforced, not just policy — "a Platform Administrator cannot post customer journals inside another tenant" holds because there is no `GeneralLedger:Post`/`ApproveJournals` grant on any platform role to exploit, in any company.

## Approval limits — separate from CRUD permission

Holding `ApprovePurchases` does not by itself mean unlimited approval authority. Every approval-gated action calls `requireApproval(companyId, permissionKey, category, amount)`, which checks the permission **and** the role's `role_approval_limits` row for that category. A missing limit row is failure-closed (denied), not defaulted to unlimited — only an explicit `max_amount = null` row means unlimited. Categories: Journal, SupplierPayment, CustomerCreditNote, PurchaseApproval, AssetDisposal.

## Permission Matrix integrity — proven structurally, not by hand-checking every cell

- **No duplicate grants possible**: `role_permissions` carries `unique (role_id, permission_key)` — a database constraint, not a convention.
- **No unused permissions**: Financial Director/Managing Director/Company Owner's exhaustive cross-join grant (every module × every action, 14-16 of 16 globals — Company Owner alone holds `SystemAdministration` and `ManageBilling`) guarantees every one of the 136 catalog permissions is held by at least one role.
- **2 dead permissions found, 1 fixed**: `ManageFinancialYears` was granted but never checked by any route — traced to a wiring mistake (`financial-years` routes used the generic `Settings:Edit` instead of the purpose-built key, incorrectly excluding Financial Manager, who holds `ManageFinancialYears` but not `Settings:Edit`) and fixed. `RunReports` remains genuinely unchecked by any current route — disclosed honestly rather than force-fit onto an unrelated endpoint.

## Multi-level hierarchy — honestly characterized

The conceptual hierarchy (Supervisor → Manager → Financial Manager → CFO-equivalent → Administrator) maps to real roles by **increasing grant scope and rising/unlimited approval ceilings**, not a deep `parent_role_id` tree. Senior Bookkeeper → Bookkeeper is the only real inheritance edge in the entire seed; every other role's permissions are flat and independently granted. This is the accurate model, not a simplification of something deeper that exists elsewhere in the code.

## Platform/company isolation

`user_role_assignments` carries `unique (user_id, company_id, role_id)`. A user with different roles in different companies never gets either role's permissions applied to the other — proven by 4 executable regression tests (`src/server/permissions/security-regression.test.ts`) mirroring the exact SQL logic, plus live-verified during RC1 Phase 7.6 with two real test users.
