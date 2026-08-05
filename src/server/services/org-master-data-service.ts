/**
 * Application Service layer for Branches, Departments, Cost Centres, and
 * Projects — four structurally identical master-data lists (name/code/
 * active), kept as one small file rather than four near-empty ones since
 * there's no meaningful validation divergence between them. Each still
 * goes through its own repository (`branch-repository.ts`,
 * `department-repository.ts`, `cost-centre-repository.ts`,
 * `project-repository.ts`) — this file only adds the shared "name is
 * required" validation on top. Projects were added by the Financial
 * Reporting & Executive Intelligence Platform (Module 9).
 *
 * Pilot Review Round 1, Phase 10 — previously none of the four could be
 * renamed/recoded after creation (only Active/Inactive). Now share the
 * same edit + audit trail discipline Customer/Supplier/Bank Account/
 * Stock Item already have, via the one `permission_audit_log` mechanism.
 */

import * as branchRepo from "@/server/repositories/branch-repository";
import * as departmentRepo from "@/server/repositories/department-repository";
import * as costCentreRepo from "@/server/repositories/cost-centre-repository";
import * as projectRepo from "@/server/repositories/project-repository";
import { recordPermissionAuditEntry } from "@/server/repositories/permission-repository";
import type { Branch, CostCentre, Department, Project } from "@/server/company-management/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

function requireName(name: string) {
  if (!name?.trim()) throw new ValidationError("Name is required.");
}

async function auditFieldChanges(companyId: string, itemType: string, itemId: number, oldValues: Record<string, unknown>, newValues: Record<string, unknown>, reason: string, performedBy: string) {
  for (const field of Object.keys(newValues)) {
    if (oldValues[field] !== newValues[field]) {
      await recordPermissionAuditEntry(companyId, itemType, String(itemId), field, String(oldValues[field]), String(newValues[field]), reason || `${itemType} details updated.`, performedBy);
    }
  }
}

export const listBranches = branchRepo.listBranches;
export async function createBranch(companyId: string, input: branchRepo.NewBranch): Promise<Branch> {
  requireName(input.name);
  return branchRepo.createBranch(companyId, { name: input.name.trim(), code: input.code?.trim(), address: input.address?.trim() });
}
export async function updateBranch(companyId: string, branchId: number, fields: branchRepo.UpdatableBranchFields, performedBy = "System", reason = ""): Promise<Branch> {
  if (fields.name !== undefined) requireName(fields.name);
  const existing = await branchRepo.getBranch(companyId, branchId);
  if (!existing) throw new NotFoundError(`No branch with id ${branchId}.`);
  const updated = await branchRepo.updateBranch(companyId, branchId, fields);
  await auditFieldChanges(companyId, "Branch", branchId, existing, updated, reason, performedBy);
  return updated;
}
export const setBranchActive = branchRepo.setBranchActive;

export const listDepartments = departmentRepo.listDepartments;
export async function createDepartment(companyId: string, input: departmentRepo.NewDepartment): Promise<Department> {
  requireName(input.name);
  return departmentRepo.createDepartment(companyId, { name: input.name.trim(), code: input.code?.trim() });
}
export async function updateDepartment(companyId: string, departmentId: number, fields: departmentRepo.UpdatableDepartmentFields, performedBy = "System", reason = ""): Promise<Department> {
  if (fields.name !== undefined) requireName(fields.name);
  const existing = await departmentRepo.getDepartment(companyId, departmentId);
  if (!existing) throw new NotFoundError(`No department with id ${departmentId}.`);
  const updated = await departmentRepo.updateDepartment(companyId, departmentId, fields);
  await auditFieldChanges(companyId, "Department", departmentId, existing, updated, reason, performedBy);
  return updated;
}
export const setDepartmentActive = departmentRepo.setDepartmentActive;

export const listCostCentres = costCentreRepo.listCostCentres;
export async function createCostCentre(companyId: string, input: costCentreRepo.NewCostCentre): Promise<CostCentre> {
  requireName(input.name);
  return costCentreRepo.createCostCentre(companyId, { name: input.name.trim(), code: input.code?.trim() });
}
export async function updateCostCentre(companyId: string, costCentreId: number, fields: costCentreRepo.UpdatableCostCentreFields, performedBy = "System", reason = ""): Promise<CostCentre> {
  if (fields.name !== undefined) requireName(fields.name);
  const existing = await costCentreRepo.getCostCentre(companyId, costCentreId);
  if (!existing) throw new NotFoundError(`No cost centre with id ${costCentreId}.`);
  const updated = await costCentreRepo.updateCostCentre(companyId, costCentreId, fields);
  await auditFieldChanges(companyId, "CostCentre", costCentreId, existing, updated, reason, performedBy);
  return updated;
}
export const setCostCentreActive = costCentreRepo.setCostCentreActive;

export const listProjects = projectRepo.listProjects;
export async function createProject(companyId: string, input: projectRepo.NewProject): Promise<Project> {
  requireName(input.name);
  return projectRepo.createProject(companyId, { name: input.name.trim(), code: input.code?.trim() });
}
export async function updateProject(companyId: string, projectId: number, fields: projectRepo.UpdatableProjectFields, performedBy = "System", reason = ""): Promise<Project> {
  if (fields.name !== undefined) requireName(fields.name);
  const existing = await projectRepo.getProject(companyId, projectId);
  if (!existing) throw new NotFoundError(`No project with id ${projectId}.`);
  const updated = await projectRepo.updateProject(companyId, projectId, fields);
  await auditFieldChanges(companyId, "Project", projectId, existing, updated, reason, performedBy);
  return updated;
}
export const setProjectActive = projectRepo.setProjectActive;
