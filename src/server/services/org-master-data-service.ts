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
 */

import * as branchRepo from "@/server/repositories/branch-repository";
import * as departmentRepo from "@/server/repositories/department-repository";
import * as costCentreRepo from "@/server/repositories/cost-centre-repository";
import * as projectRepo from "@/server/repositories/project-repository";
import type { Branch, CostCentre, Department, Project } from "@/server/company-management/types";

export class ValidationError extends Error {}

function requireName(name: string) {
  if (!name?.trim()) throw new ValidationError("Name is required.");
}

export const listBranches = branchRepo.listBranches;
export async function createBranch(companyId: string, input: branchRepo.NewBranch): Promise<Branch> {
  requireName(input.name);
  return branchRepo.createBranch(companyId, { name: input.name.trim(), code: input.code?.trim(), address: input.address?.trim() });
}
export const setBranchActive = branchRepo.setBranchActive;

export const listDepartments = departmentRepo.listDepartments;
export async function createDepartment(companyId: string, input: departmentRepo.NewDepartment): Promise<Department> {
  requireName(input.name);
  return departmentRepo.createDepartment(companyId, { name: input.name.trim(), code: input.code?.trim() });
}
export const setDepartmentActive = departmentRepo.setDepartmentActive;

export const listCostCentres = costCentreRepo.listCostCentres;
export async function createCostCentre(companyId: string, input: costCentreRepo.NewCostCentre): Promise<CostCentre> {
  requireName(input.name);
  return costCentreRepo.createCostCentre(companyId, { name: input.name.trim(), code: input.code?.trim() });
}
export const setCostCentreActive = costCentreRepo.setCostCentreActive;

export const listProjects = projectRepo.listProjects;
export async function createProject(companyId: string, input: projectRepo.NewProject): Promise<Project> {
  requireName(input.name);
  return projectRepo.createProject(companyId, { name: input.name.trim(), code: input.code?.trim() });
}
export const setProjectActive = projectRepo.setProjectActive;
