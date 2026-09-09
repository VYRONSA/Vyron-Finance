/**
 * Pure Reporting Readiness engine — no Supabase. Composes ALREADY-
 * COMPUTED signals (the Balance Sheet's own `isBalanced`, outstanding
 * Disclosure Notes still requiring user input, Module 10's Audit
 * Readiness Score, and its own open Audit Findings count) into one 0-100
 * score, the same "100 minus a real, traceable penalty per cause"
 * pattern `asset-dashboard-summary-service.ts::computeAssetHealthScore`/
 * `vat-summary-service.ts::computeComplianceScore` already established.
 * Nothing here is a new detector — every point deducted traces to a
 * specific, visible cause.
 */

export type ReportingStatus = "Draft" | "ReadyForReview" | "Ready";

export function computeReportingReadinessScore(isBalanceSheetBalanced: boolean, outstandingDisclosureCount: number, auditReadinessScore: number, openAuditFindingsCount: number): number {
  let penalty = 0;
  if (!isBalanceSheetBalanced) penalty += 40; // a fundamental integrity failure — dominant weight, same as Balance Sheet's own isBalanced check
  penalty += Math.min(30, outstandingDisclosureCount * 5);
  penalty += Math.round((100 - auditReadinessScore) * 0.2);
  penalty += Math.min(15, openAuditFindingsCount * 2);
  return Math.max(0, Math.round(100 - penalty));
}

export function determineReportingStatus(score: number): ReportingStatus {
  if (score >= 85) return "Ready";
  if (score >= 60) return "ReadyForReview";
  return "Draft";
}

export type ReportingReadiness = {
  score: number;
  status: ReportingStatus;
  isBalanceSheetBalanced: boolean;
  outstandingDisclosureCount: number;
  auditReadinessScore: number;
  openAuditFindingsCount: number;
  financialStatementsGeneratedCount: number;
};

export function buildReportingReadiness(
  isBalanceSheetBalanced: boolean,
  outstandingDisclosureCount: number,
  auditReadinessScore: number,
  openAuditFindingsCount: number,
  financialStatementsGeneratedCount: number,
): ReportingReadiness {
  const score = computeReportingReadinessScore(isBalanceSheetBalanced, outstandingDisclosureCount, auditReadinessScore, openAuditFindingsCount);
  return { score, status: determineReportingStatus(score), isBalanceSheetBalanced, outstandingDisclosureCount, auditReadinessScore, openAuditFindingsCount, financialStatementsGeneratedCount };
}
