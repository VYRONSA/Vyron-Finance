/**
 * Repository layer for Audit Planning's child entities — Areas,
 * Programme Steps, Risk Register, and Team Assignments. Four
 * structurally simple, engagement-scoped lists kept in one file rather
 * than four near-empty ones (same rationale as
 * `org-master-data-service.ts`). See
 * supabase/migrations/0017_auditor_workspace.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { auditAreaFromRow, auditProgrammeStepFromRow, auditRiskRegisterFromRow, auditTeamAssignmentFromRow } from "@/server/audit/mappers";
import type { AuditAreaRow, AuditProgrammeStepRow, AuditRiskRegisterRow, AuditTeamAssignmentRow } from "@/server/audit/mappers";
import type { AuditArea, AuditProgrammeStep, AuditRiskRegisterEntry, AuditTeamAssignment, RiskLevel } from "@/server/audit/types";

// --- Areas -------------------------------------------------------------

export async function listAuditAreas(companyId: string, engagementId: number): Promise<AuditArea[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("audit_areas").select("*").eq("company_id", companyId).eq("engagement_id", engagementId).order("created_at").returns<AuditAreaRow[]>();
  if (error) throw error;
  return data.map(auditAreaFromRow);
}

export async function createAuditArea(companyId: string, engagementId: number, input: { name: string; riskLevel?: RiskLevel; notes?: string }): Promise<AuditArea> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_areas")
    .insert({ company_id: companyId, engagement_id: engagementId, name: input.name, risk_level: input.riskLevel ?? "Medium", notes: input.notes ?? "" })
    .select("*")
    .single<AuditAreaRow>();
  if (error) throw error;
  return auditAreaFromRow(data);
}

// --- Programme Steps -----------------------------------------------------

export async function listAuditProgrammeSteps(companyId: string, areaId: number): Promise<AuditProgrammeStep[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("audit_programme_steps").select("*").eq("company_id", companyId).eq("area_id", areaId).order("created_at").returns<AuditProgrammeStepRow[]>();
  if (error) throw error;
  return data.map(auditProgrammeStepFromRow);
}

export async function createAuditProgrammeStep(companyId: string, areaId: number, input: { description: string; assignedTo?: string }): Promise<AuditProgrammeStep> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_programme_steps")
    .insert({ company_id: companyId, area_id: areaId, description: input.description, assigned_to: input.assignedTo ?? "" })
    .select("*")
    .single<AuditProgrammeStepRow>();
  if (error) throw error;
  return auditProgrammeStepFromRow(data);
}

export async function setAuditProgrammeStepComplete(companyId: string, stepId: number, isComplete: boolean): Promise<AuditProgrammeStep> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_programme_steps")
    .update({ is_complete: isComplete })
    .eq("company_id", companyId)
    .eq("id", stepId)
    .select("*")
    .single<AuditProgrammeStepRow>();
  if (error) throw error;
  return auditProgrammeStepFromRow(data);
}

// --- Risk Register -------------------------------------------------------

export async function listAuditRiskRegister(companyId: string, engagementId: number): Promise<AuditRiskRegisterEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("audit_risk_register").select("*").eq("company_id", companyId).eq("engagement_id", engagementId).order("created_at").returns<AuditRiskRegisterRow[]>();
  if (error) throw error;
  return data.map(auditRiskRegisterFromRow);
}

export async function createAuditRiskRegisterEntry(
  companyId: string,
  engagementId: number,
  input: { riskDescription: string; area?: string; likelihood?: RiskLevel; impact?: RiskLevel; response?: string },
): Promise<AuditRiskRegisterEntry> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_risk_register")
    .insert({
      company_id: companyId,
      engagement_id: engagementId,
      risk_description: input.riskDescription,
      area: input.area ?? "",
      likelihood: input.likelihood ?? "Medium",
      impact: input.impact ?? "Medium",
      response: input.response ?? "",
    })
    .select("*")
    .single<AuditRiskRegisterRow>();
  if (error) throw error;
  return auditRiskRegisterFromRow(data);
}

// --- Team Assignments ------------------------------------------------------

export async function listAuditTeamAssignments(companyId: string, engagementId: number): Promise<AuditTeamAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("audit_team_assignments").select("*").eq("company_id", companyId).eq("engagement_id", engagementId).order("created_at").returns<AuditTeamAssignmentRow[]>();
  if (error) throw error;
  return data.map(auditTeamAssignmentFromRow);
}

export async function createAuditTeamAssignment(companyId: string, engagementId: number, input: { memberName: string; role?: string }): Promise<AuditTeamAssignment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_team_assignments")
    .insert({ company_id: companyId, engagement_id: engagementId, member_name: input.memberName, role: input.role ?? "" })
    .select("*")
    .single<AuditTeamAssignmentRow>();
  if (error) throw error;
  return auditTeamAssignmentFromRow(data);
}
