/**
 * Row <-> domain type mappers for the Auditor Workspace & Audit
 * Intelligence Platform (Module 10). See
 * supabase/migrations/0017_auditor_workspace.sql.
 */

import type {
  AuditArea,
  AuditEngagement,
  AuditFinding,
  AuditProgrammeStep,
  AuditQuery,
  AuditQueryDefinition,
  AuditRiskRegisterEntry,
  AuditTeamAssignment,
  AuditWorkingPaper,
} from "./types";

export type AuditEngagementRow = {
  id: number;
  company_id: string;
  financial_year_id: number | null;
  name: string;
  materiality: number;
  performance_materiality: number;
  status: string;
  lead_auditor: string;
  planning_notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export function auditEngagementFromRow(row: AuditEngagementRow): AuditEngagement {
  return {
    id: row.id,
    companyId: row.company_id,
    financialYearId: row.financial_year_id,
    name: row.name,
    materiality: Number(row.materiality),
    performanceMateriality: Number(row.performance_materiality),
    status: row.status as AuditEngagement["status"],
    leadAuditor: row.lead_auditor,
    planningNotes: row.planning_notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type AuditAreaRow = { id: number; company_id: string; engagement_id: number; name: string; risk_level: string; notes: string; created_at: string };

export function auditAreaFromRow(row: AuditAreaRow): AuditArea {
  return { id: row.id, companyId: row.company_id, engagementId: row.engagement_id, name: row.name, riskLevel: row.risk_level as AuditArea["riskLevel"], notes: row.notes, createdAt: row.created_at };
}

export type AuditProgrammeStepRow = { id: number; company_id: string; area_id: number; description: string; is_complete: boolean; assigned_to: string; created_at: string };

export function auditProgrammeStepFromRow(row: AuditProgrammeStepRow): AuditProgrammeStep {
  return { id: row.id, companyId: row.company_id, areaId: row.area_id, description: row.description, isComplete: row.is_complete, assignedTo: row.assigned_to, createdAt: row.created_at };
}

export type AuditRiskRegisterRow = {
  id: number;
  company_id: string;
  engagement_id: number;
  risk_description: string;
  area: string;
  likelihood: string;
  impact: string;
  response: string;
  created_at: string;
};

export function auditRiskRegisterFromRow(row: AuditRiskRegisterRow): AuditRiskRegisterEntry {
  return {
    id: row.id,
    companyId: row.company_id,
    engagementId: row.engagement_id,
    riskDescription: row.risk_description,
    area: row.area,
    likelihood: row.likelihood as AuditRiskRegisterEntry["likelihood"],
    impact: row.impact as AuditRiskRegisterEntry["impact"],
    response: row.response,
    createdAt: row.created_at,
  };
}

export type AuditTeamAssignmentRow = { id: number; company_id: string; engagement_id: number; member_name: string; role: string; created_at: string };

export function auditTeamAssignmentFromRow(row: AuditTeamAssignmentRow): AuditTeamAssignment {
  return { id: row.id, companyId: row.company_id, engagementId: row.engagement_id, memberName: row.member_name, role: row.role, createdAt: row.created_at };
}

export type AuditFindingRow = {
  id: number;
  company_id: string;
  engagement_id: number | null;
  finding_type: string;
  category: string;
  severity: string;
  confidence: number;
  reason: string;
  evidence: string;
  suggested_procedure: string;
  related_type: string | null;
  related_id: number | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
};

export function auditFindingFromRow(row: AuditFindingRow): AuditFinding {
  return {
    id: row.id,
    companyId: row.company_id,
    engagementId: row.engagement_id,
    findingType: row.finding_type as AuditFinding["findingType"],
    category: row.category as AuditFinding["category"],
    severity: row.severity as AuditFinding["severity"],
    confidence: Number(row.confidence),
    reason: row.reason,
    evidence: row.evidence,
    suggestedProcedure: row.suggested_procedure,
    relatedType: row.related_type,
    relatedId: row.related_id,
    status: row.status as AuditFinding["status"],
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    createdAt: row.created_at,
  };
}

export type AuditWorkingPaperRow = {
  id: number;
  company_id: string;
  engagement_id: number | null;
  paper_type: string;
  title: string;
  content: unknown;
  generated_at: string;
  generated_by: string;
};

export function auditWorkingPaperFromRow(row: AuditWorkingPaperRow): AuditWorkingPaper {
  return {
    id: row.id,
    companyId: row.company_id,
    engagementId: row.engagement_id,
    paperType: row.paper_type as AuditWorkingPaper["paperType"],
    title: row.title,
    content: (row.content as Record<string, unknown>) ?? {},
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
  };
}

export type AuditQueryRow = { id: number; company_id: string; name: string; description: string; query_definition: unknown; created_by: string; created_at: string };

export function auditQueryFromRow(row: AuditQueryRow): AuditQuery {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    description: row.description,
    queryDefinition: (row.query_definition as AuditQueryDefinition) ?? { source: "journals", conditions: [] },
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
