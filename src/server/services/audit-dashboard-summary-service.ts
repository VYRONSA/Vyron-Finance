/**
 * Shared Audit Dashboard summary math — the single place every Audit
 * Dashboard metric (Material Issues/High-Risk Areas/Outstanding
 * Exceptions/Internal Control Exceptions/VAT-Financial-Reporting-
 * Inventory-Revenue-Recognition-Journal Risk/Going Concern Indicators) is
 * computed from real `audit_findings`, so the Auditor Workspace and the
 * Executive Dashboard can never quietly restate the same numbers
 * differently. Mirrors `vat-summary-service.ts`/
 * `banking-summary-service.ts`. Pure — unit tested.
 */

import type { AuditFinding } from "@/server/audit/types";

export type AuditDashboardSummary = {
  auditReadinessScore: number;
  materialIssuesCount: number;
  highRiskAreaCount: number;
  outstandingExceptionsCount: number;
  missingDocumentsCount: number;
  reconciliationStatus: "Clean" | "Attention" | "Critical";
  internalControlExceptionsCount: number;
  vatRiskCount: number;
  financialReportingRiskCount: number;
  inventoryRiskCount: number;
  revenueRecognitionRiskCount: number;
  journalRiskCount: number;
  goingConcernIndicatorCount: number;
};

const JOURNAL_RISK_TYPES = new Set(["HighRiskJournal", "LargeJournalTests", "WeekendPosting", "HolidayPosting", "PostingDateTests", "CutoffTests", "ManualJournalReview"]);
const RECONCILING_ATTENTION_THRESHOLD = 5;
const RECONCILING_CRITICAL_THRESHOLD = 15;

export function buildAuditDashboardSummary(findings: AuditFinding[], auditReadinessScore: number, missingDocumentsCount: number): AuditDashboardSummary {
  const open = findings.filter((f) => f.status === "Open");
  const highSeverity = open.filter((f) => f.severity === "High" || f.severity === "Critical");
  const reconcilingItemCount = open.filter((f) => f.findingType === "AgedReconcilingItems").length;

  return {
    auditReadinessScore,
    materialIssuesCount: highSeverity.length,
    highRiskAreaCount: new Set(highSeverity.map((f) => f.findingType)).size,
    outstandingExceptionsCount: open.length,
    missingDocumentsCount,
    reconciliationStatus: reconcilingItemCount >= RECONCILING_CRITICAL_THRESHOLD ? "Critical" : reconcilingItemCount >= RECONCILING_ATTENTION_THRESHOLD ? "Attention" : "Clean",
    internalControlExceptionsCount: open.filter((f) => f.findingType === "ControlWeakness").length,
    vatRiskCount: open.filter((f) => f.findingType === "ComplianceRisk" || f.findingType === "DuplicateVatClaims").length,
    financialReportingRiskCount: open.filter((f) => f.findingType === "MaterialMisstatement").length,
    inventoryRiskCount: open.filter((f) => f.findingType === "NegativeInventory").length,
    revenueRecognitionRiskCount: open.filter((f) => f.findingType === "RevenueManipulationIndicator" || f.findingType === "UnusualTrend").length,
    journalRiskCount: open.filter((f) => JOURNAL_RISK_TYPES.has(f.findingType)).length,
    goingConcernIndicatorCount: open.filter((f) => f.findingType === "GoingConcernRisk").length,
  };
}
