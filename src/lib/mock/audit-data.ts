/**
 * Preview Mode seed data for the Auditor Workspace & Audit Intelligence
 * Platform (Module 10). Field shapes match the real domain types
 * exactly. Findings are derived where possible via the real production
 * test functions against the existing `MOCK_GL_TRANSACTIONS`/
 * `MOCK_JOURNALS` (e.g. `runDuplicateJournalsTest` genuinely finds the
 * JR000006/JR000007 re-entered-fee pair those files already seed) —
 * the same "derived, not hand-typed" discipline `general-ledger-data.ts`
 * established, extended here rather than duplicated.
 */

import type { AuditEngagement, AuditFinding, AuditQuery, AuditRiskRegisterEntry, AuditTeamAssignment, AuditWorkingPaper } from "@/server/audit/types";
import { runDuplicateJournalsTest, runLargeJournalsTest, runSuspenseAccountReviewTest, runWeekendPostingTest } from "@/server/audit/audit-tests-engine";
import { buildExceptionReportPaper, buildLeadSchedule } from "@/server/audit/working-paper-engine";
import { MOCK_GL_TRANSACTIONS, MOCK_JOURNALS, MOCK_TRIAL_BALANCE } from "./general-ledger-data";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_AUDIT_ENGAGEMENTS: AuditEngagement[] = [
  {
    id: 1,
    companyId: COMPANY_ID,
    financialYearId: null,
    name: "FY2026 Statutory Audit",
    materiality: 100000,
    performanceMateriality: 75000,
    status: "Fieldwork",
    leadAuditor: "T. Nkosi (Meridian Audit & Assurance)",
    planningNotes: "Focus areas: Revenue cut-off, Inventory existence, VAT compliance given the recent Reverse Charge exposure.",
    createdBy: "System",
    createdAt: "2026-06-01T09:00:00Z",
    updatedAt: "2026-06-15T09:00:00Z",
  },
];

export const MOCK_AUDIT_AREAS = [
  { id: 1, companyId: COMPANY_ID, engagementId: 1, name: "Revenue", riskLevel: "High" as const, notes: "Cut-off and revenue recognition risk, given growth this period.", createdAt: "2026-06-01T09:00:00Z" },
  { id: 2, companyId: COMPANY_ID, engagementId: 1, name: "Inventory", riskLevel: "Medium" as const, notes: "Existence and valuation.", createdAt: "2026-06-01T09:00:00Z" },
  { id: 3, companyId: COMPANY_ID, engagementId: 1, name: "VAT Compliance", riskLevel: "High" as const, notes: "Reverse Charge treatment introduced this year.", createdAt: "2026-06-01T09:00:00Z" },
];

export const MOCK_AUDIT_PROGRAMME_STEPS = [
  { id: 1, companyId: COMPANY_ID, areaId: 1, description: "Select a sample of invoices around period-end and trace to shipping documentation.", isComplete: true, assignedTo: "J. Adams", createdAt: "2026-06-05T09:00:00Z" },
  { id: 2, companyId: COMPANY_ID, areaId: 1, description: "Recompute revenue growth vs. prior year and investigate variances > 30%.", isComplete: false, assignedTo: "J. Adams", createdAt: "2026-06-05T09:00:00Z" },
  { id: 3, companyId: COMPANY_ID, areaId: 3, description: "Verify VAT split consistency for every Reverse Charge document this period.", isComplete: false, assignedTo: "T. Nkosi", createdAt: "2026-06-05T09:00:00Z" },
];

export const MOCK_AUDIT_RISK_REGISTER: AuditRiskRegisterEntry[] = [
  { id: 1, companyId: COMPANY_ID, engagementId: 1, riskDescription: "Revenue could be overstated near period-end to meet targets.", area: "Revenue", likelihood: "Medium", impact: "High", response: "Extended cut-off testing.", createdAt: "2026-06-01T09:00:00Z" },
  { id: 2, companyId: COMPANY_ID, engagementId: 1, riskDescription: "Manual journals could be used to bypass automated controls.", area: "Journals", likelihood: "Low", impact: "High", response: "100% review of manual journals above materiality.", createdAt: "2026-06-01T09:00:00Z" },
];

export const MOCK_AUDIT_TEAM_ASSIGNMENTS: AuditTeamAssignment[] = [
  { id: 1, companyId: COMPANY_ID, engagementId: 1, memberName: "T. Nkosi", role: "Engagement Lead", createdAt: "2026-06-01T09:00:00Z" },
  { id: 2, companyId: COMPANY_ID, engagementId: 1, memberName: "J. Adams", role: "Senior Auditor", createdAt: "2026-06-01T09:00:00Z" },
];

// ---------------------------------------------------------------------
// Findings — Test findings are DERIVED by running the real Audit Tests
// engine against the same mock GL data `general-ledger-data.ts` already
// seeds; Intelligence findings are illustrative (composing signals that
// need broader cross-module data than Preview Mode's small sample can
// realistically produce) but shaped identically to what
// `audit-intelligence-service.ts` would actually raise.
// ---------------------------------------------------------------------

function findingId(prefix: number, index: number): number {
  return prefix * 100 + index;
}

const derivedDuplicateJournals = runDuplicateJournalsTest(MOCK_GL_TRANSACTIONS).map((f, i) => ({ ...f, id: findingId(1, i) }));
const derivedLargeJournals = runLargeJournalsTest(MOCK_JOURNALS, 10000).map((f, i) => ({ ...f, id: findingId(2, i) }));
const derivedWeekendPostings = runWeekendPostingTest(MOCK_JOURNALS).map((f, i) => ({ ...f, id: findingId(3, i) }));
const derivedSuspenseActivity = runSuspenseAccountReviewTest(MOCK_GL_TRANSACTIONS).map((f, i) => ({ ...f, id: findingId(4, i) }));

function toAuditFinding(result: ReturnType<typeof runDuplicateJournalsTest>[number] & { id: number }, category: "Test" | "Intelligence", status: AuditFinding["status"] = "Open"): AuditFinding {
  return {
    id: result.id,
    companyId: COMPANY_ID,
    engagementId: 1,
    findingType: result.findingType,
    category,
    severity: result.severity,
    confidence: result.confidence,
    reason: result.reason,
    evidence: result.evidence,
    suggestedProcedure: result.suggestedProcedure,
    relatedType: result.relatedType,
    relatedId: result.relatedId,
    status,
    reviewedBy: status === "Open" ? null : "T. Nkosi",
    reviewedAt: status === "Open" ? null : "2026-06-20T09:00:00Z",
    reviewNote: status === "Open" ? null : "Traced to source — confirmed a legitimate re-entry after correction.",
    createdAt: "2026-06-18T09:00:00Z",
  };
}

export const MOCK_AUDIT_FINDINGS: AuditFinding[] = [
  ...derivedDuplicateJournals.map((f) => toAuditFinding(f, "Test", "Reviewed")),
  ...derivedLargeJournals.map((f) => toAuditFinding(f, "Test")),
  ...derivedWeekendPostings.map((f) => toAuditFinding(f, "Test")),
  ...derivedSuspenseActivity.map((f) => toAuditFinding(f, "Test")),
  {
    id: 9001,
    companyId: COMPANY_ID,
    engagementId: 1,
    findingType: "ComplianceRisk",
    category: "Intelligence",
    severity: "High",
    confidence: 0.75,
    reason: "VAT document is high-risk: unusually large VAT value relative to this vendor's history.",
    evidence: "Composed from VAT Intelligence's high-risk signal on document #204.",
    suggestedProcedure: "Review this document's VAT treatment against SARS requirements.",
    relatedType: "vat_document",
    relatedId: 204,
    status: "Open",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: "2026-06-19T09:00:00Z",
  },
  {
    id: 9002,
    companyId: COMPANY_ID,
    engagementId: 1,
    findingType: "GoingConcernRisk",
    category: "Intelligence",
    severity: "Medium",
    confidence: 0.6,
    reason: "Financial Health Score is 62% and Business Risk Score is 38% for this period.",
    evidence: "See the Reports workspace's Executive scores for the underlying components (liquidity, profitability, cash trend).",
    suggestedProcedure: "Assess management's going concern basis and whether additional disclosure is required.",
    relatedType: null,
    relatedId: null,
    status: "Open",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: "2026-06-19T09:00:00Z",
  },
];

// ---------------------------------------------------------------------
// Working Papers — generated via the real pure builders from the same
// mock Trial Balance / Findings above.
// ---------------------------------------------------------------------

const leadScheduleResult = buildLeadSchedule(MOCK_TRIAL_BALANCE.rows, MOCK_TRIAL_BALANCE.asOfDate ?? "2026-06-30");
const exceptionReportResult = buildExceptionReportPaper(MOCK_AUDIT_FINDINGS);

export const MOCK_AUDIT_WORKING_PAPERS: AuditWorkingPaper[] = [
  { id: 1, companyId: COMPANY_ID, engagementId: 1, paperType: "LeadSchedule", title: leadScheduleResult.title, content: leadScheduleResult.content, generatedAt: "2026-06-20T09:00:00Z", generatedBy: "System" },
  { id: 2, companyId: COMPANY_ID, engagementId: 1, paperType: "ExceptionReport", title: exceptionReportResult.title, content: exceptionReportResult.content, generatedAt: "2026-06-20T09:05:00Z", generatedBy: "System" },
];

export const MOCK_AUDIT_QUERIES: AuditQuery[] = [
  {
    id: 1,
    companyId: COMPANY_ID,
    name: "Large journals > R500,000",
    description: "PRB example query.",
    queryDefinition: { source: "journals", conditions: [{ field: "amount", operator: "gt", value: 500000 }] },
    createdBy: "T. Nkosi",
    createdAt: "2026-06-02T09:00:00Z",
  },
  {
    id: 2,
    companyId: COMPANY_ID,
    name: "Journals posted on weekends",
    description: "PRB example query.",
    queryDefinition: { source: "journals", conditions: [{ field: "journalDate", operator: "isWeekend" }] },
    createdBy: "T. Nkosi",
    createdAt: "2026-06-02T09:00:00Z",
  },
  {
    id: 3,
    companyId: COMPANY_ID,
    name: "Manual journals in December",
    description: "PRB example query.",
    queryDefinition: { source: "journals", conditions: [{ field: "sourceType", operator: "eq", value: "manual" }] },
    createdBy: "J. Adams",
    createdAt: "2026-06-02T09:00:00Z",
  },
];
