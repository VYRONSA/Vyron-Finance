/**
 * Domain types for the Auditor Workspace & Audit Intelligence Platform
 * (Module 10). See supabase/migrations/0017_auditor_workspace.sql.
 */

export type AuditEngagementStatus = "Planning" | "Fieldwork" | "Review" | "Complete";
export const AUDIT_ENGAGEMENT_STATUSES: AuditEngagementStatus[] = ["Planning", "Fieldwork", "Review", "Complete"];

export type AuditEngagement = {
  id: number;
  companyId: string;
  financialYearId: number | null;
  name: string;
  materiality: number;
  performanceMateriality: number;
  status: AuditEngagementStatus;
  leadAuditor: string;
  planningNotes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type RiskLevel = "Low" | "Medium" | "High";
export const RISK_LEVELS: RiskLevel[] = ["Low", "Medium", "High"];

export type AuditArea = {
  id: number;
  companyId: string;
  engagementId: number;
  name: string;
  riskLevel: RiskLevel;
  notes: string;
  createdAt: string;
};

export type AuditProgrammeStep = {
  id: number;
  companyId: string;
  areaId: number;
  description: string;
  isComplete: boolean;
  assignedTo: string;
  createdAt: string;
};

export type AuditRiskRegisterEntry = {
  id: number;
  companyId: string;
  engagementId: number;
  riskDescription: string;
  area: string;
  likelihood: RiskLevel;
  impact: RiskLevel;
  response: string;
  createdAt: string;
};

export type AuditTeamAssignment = {
  id: number;
  companyId: string;
  engagementId: number;
  memberName: string;
  role: string;
  createdAt: string;
};

export type AuditFindingType =
  | "DuplicatePayments" | "DuplicateSuppliers" | "DuplicateCustomers" | "DuplicateJournals" | "DuplicateVatClaims"
  | "SequenceGaps" | "PostingDateTests" | "CutoffTests" | "BenfordAnalysis" | "LargeJournalTests"
  | "WeekendPosting" | "HolidayPosting" | "ManualJournalReview" | "SuspenseAccountReview"
  | "NegativeInventory" | "NegativeCash" | "AgedReconcilingItems" | "OrphanTransactions"
  | "MaterialMisstatement" | "ControlWeakness" | "FraudIndicator" | "ComplianceRisk" | "UnusualTrend"
  | "HighRiskJournal" | "HighRiskUser" | "RelatedPartyIndicator" | "GoingConcernRisk" | "RevenueManipulationIndicator" | "AssetRisk";

export const AUDIT_TEST_TYPES: AuditFindingType[] = [
  "DuplicatePayments", "DuplicateSuppliers", "DuplicateCustomers", "DuplicateJournals", "DuplicateVatClaims",
  "SequenceGaps", "PostingDateTests", "CutoffTests", "BenfordAnalysis", "LargeJournalTests",
  "WeekendPosting", "HolidayPosting", "ManualJournalReview", "SuspenseAccountReview",
  "NegativeInventory", "NegativeCash", "AgedReconcilingItems", "OrphanTransactions",
];

export const AUDIT_INTELLIGENCE_TYPES: AuditFindingType[] = [
  "MaterialMisstatement", "ControlWeakness", "FraudIndicator", "ComplianceRisk", "UnusualTrend",
  "HighRiskJournal", "HighRiskUser", "RelatedPartyIndicator", "GoingConcernRisk", "RevenueManipulationIndicator", "AssetRisk",
];

export type AuditFindingCategory = "Test" | "Intelligence";
export type AuditFindingSeverity = "Low" | "Medium" | "High" | "Critical";
export type AuditFindingStatus = "Open" | "Reviewed" | "Dismissed";

export type AuditFinding = {
  id: number;
  companyId: string;
  engagementId: number | null;
  findingType: AuditFindingType;
  category: AuditFindingCategory;
  severity: AuditFindingSeverity;
  confidence: number;
  reason: string;
  evidence: string;
  suggestedProcedure: string;
  relatedType: string | null;
  relatedId: number | null;
  status: AuditFindingStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};

export type AuditWorkingPaperType =
  | "LeadSchedule" | "SupportingSchedule" | "Reconciliation" | "AccountAnalysis" | "VarianceReport"
  | "RiskSummary" | "ExceptionReport" | "SamplingList" | "AuditNote";

export const AUDIT_WORKING_PAPER_TYPES: AuditWorkingPaperType[] = [
  "LeadSchedule", "SupportingSchedule", "Reconciliation", "AccountAnalysis", "VarianceReport",
  "RiskSummary", "ExceptionReport", "SamplingList", "AuditNote",
];

export type AuditWorkingPaper = {
  id: number;
  companyId: string;
  engagementId: number | null;
  paperType: AuditWorkingPaperType;
  title: string;
  content: Record<string, unknown>;
  generatedAt: string;
  generatedBy: string;
};

export type AuditQuery = {
  id: number;
  companyId: string;
  name: string;
  description: string;
  queryDefinition: AuditQueryDefinition;
  createdBy: string;
  createdAt: string;
};

/** A real, structured filter — evaluated by `audit-query-service.ts`
 * against the same GL Inquiry / journal repositories every other module
 * already reads. Not a free-text query language. */
export type AuditQuerySource = "journals" | "glTransactions" | "bankTransactions";

export type AuditQueryCondition = {
  field: string;
  operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "isWeekend" | "isTrue" | "isFalse";
  value?: string | number;
};

export type AuditQueryDefinition = {
  source: AuditQuerySource;
  conditions: AuditQueryCondition[];
};
