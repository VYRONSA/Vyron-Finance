/**
 * Application Service for Reporting Readiness — composes ALREADY-
 * COMPUTED real signals (the Balance Sheet's own `isBalanced`,
 * outstanding Disclosure Notes, the Audit Readiness Score and open
 * findings count from Module 9/10, and how many Reporting Packages have
 * actually been generated) into the `ReportingReadiness` shape the
 * Financial Statements workspace's own Dashboard tab AND the Executive
 * Dashboard both call identically — the same `buildXSummary` precedent
 * every prior module's Dashboard tiles follow, so the two can never
 * diverge.
 */

import { getBalanceSheet } from "@/server/services/financial-statements-service";
import { getExecutiveIntelligence } from "@/server/services/executive-intelligence-service";
import { listAuditFindings } from "@/server/services/audit-finding-service";
import { listDisclosureNotes } from "@/server/services/disclosure-service";
import { listReportingPackages } from "@/server/services/reporting-package-service";
import { buildReportingReadiness, type ReportingReadiness } from "@/server/reporting/reporting-readiness-engine";

export async function getReportingReadiness(companyId: string, periodStart: string, periodEnd: string, financialYearStartDate: string): Promise<ReportingReadiness> {
  const [balanceSheet, executiveIntelligence, openFindings, disclosureNotes, reportingPackages] = await Promise.all([
    getBalanceSheet(companyId, periodEnd, financialYearStartDate),
    getExecutiveIntelligence(companyId, periodStart, periodEnd, financialYearStartDate),
    listAuditFindings(companyId, { status: "Open" }),
    listDisclosureNotes(companyId, periodStart, periodEnd),
    listReportingPackages(companyId),
  ]);

  const outstandingDisclosureCount = disclosureNotes.filter((n) => n.requiresUserInput && n.userNotes.trim() === "").length;

  return buildReportingReadiness(balanceSheet.isBalanced, outstandingDisclosureCount, executiveIntelligence.auditReadinessScore, openFindings.length, reportingPackages.length);
}
