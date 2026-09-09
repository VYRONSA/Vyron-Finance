/**
 * Application Service for Audit Planning — Engagements, Areas, Programme
 * Steps, Risk Register, and Team Assignments. Thin validation layer over
 * `audit-engagement-repository.ts` and `audit-planning-repository.ts`.
 */

import * as engagementRepo from "@/server/repositories/audit-engagement-repository";
import * as planningRepo from "@/server/repositories/audit-planning-repository";
import type { AuditEngagement } from "@/server/audit/types";

export class ValidationError extends Error {}

export const listAuditEngagements = engagementRepo.listAuditEngagements;
export const getAuditEngagement = engagementRepo.getAuditEngagement;

export async function createAuditEngagement(companyId: string, performedBy: string, input: engagementRepo.NewAuditEngagement): Promise<AuditEngagement> {
  if (!input.name?.trim()) throw new ValidationError("Engagement name is required.");
  return engagementRepo.createAuditEngagement(companyId, { ...input, name: input.name.trim(), createdBy: performedBy });
}

export const updateAuditEngagement = engagementRepo.updateAuditEngagement;

export const listAuditAreas = planningRepo.listAuditAreas;
export async function createAuditArea(companyId: string, engagementId: number, input: Parameters<typeof planningRepo.createAuditArea>[2]) {
  if (!input.name?.trim()) throw new ValidationError("Area name is required.");
  return planningRepo.createAuditArea(companyId, engagementId, input);
}

export const listAuditProgrammeSteps = planningRepo.listAuditProgrammeSteps;
export async function createAuditProgrammeStep(companyId: string, areaId: number, input: Parameters<typeof planningRepo.createAuditProgrammeStep>[2]) {
  if (!input.description?.trim()) throw new ValidationError("Step description is required.");
  return planningRepo.createAuditProgrammeStep(companyId, areaId, input);
}
export const setAuditProgrammeStepComplete = planningRepo.setAuditProgrammeStepComplete;

export const listAuditRiskRegister = planningRepo.listAuditRiskRegister;
export async function createAuditRiskRegisterEntry(companyId: string, engagementId: number, input: Parameters<typeof planningRepo.createAuditRiskRegisterEntry>[2]) {
  if (!input.riskDescription?.trim()) throw new ValidationError("Risk description is required.");
  return planningRepo.createAuditRiskRegisterEntry(companyId, engagementId, input);
}

export const listAuditTeamAssignments = planningRepo.listAuditTeamAssignments;
export async function createAuditTeamAssignment(companyId: string, engagementId: number, input: Parameters<typeof planningRepo.createAuditTeamAssignment>[2]) {
  if (!input.memberName?.trim()) throw new ValidationError("Member name is required.");
  return planningRepo.createAuditTeamAssignment(companyId, engagementId, input);
}
