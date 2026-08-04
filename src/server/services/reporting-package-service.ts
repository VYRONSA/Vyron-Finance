/**
 * Application Service for Reporting Packages — "Each package should
 * reuse existing report generators and narrative engines." Every piece
 * bundled here is fetched from an EXISTING service call (Income
 * Statement/Balance Sheet/Cash Flow/Statement of Changes in Equity from
 * `financial-statements-service.ts`, Disclosure Notes freshly generated
 * via `disclosure-service.ts`, a narrative via `narrative-engine.ts`'s
 * own `buildFinancialNarrative`, the Trial Balance via
 * `trial-balance-service.ts`, and the Audit Readiness Score/open
 * findings count via `executive-intelligence-service.ts`/
 * `audit-finding-service.ts`) — nothing here is a second calculation.
 */

import { getBalanceSheet, getCashFlowStatement, getIncomeStatement, getStatementOfChangesInEquity } from "@/server/services/financial-statements-service";
import { getTrialBalance } from "@/server/services/trial-balance-service";
import { getExecutiveIntelligence } from "@/server/services/executive-intelligence-service";
import { listAuditFindings } from "@/server/services/audit-finding-service";
import { generateDisclosureNotes } from "@/server/services/disclosure-service";
import { shiftPeriodBack } from "@/server/general-ledger/growth-analysis";
import { buildFinancialNarrative } from "@/server/copilot/narrative-engine";
import { buildReportingPackageContents, determinePackageSections } from "@/server/reporting/reporting-package-engine";
import * as repo from "@/server/repositories/reporting-package-repository";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import type { ReportingPackage, ReportingPackageType } from "@/server/disclosures/types";

export const listReportingPackages = repo.listReportingPackages;
export { determinePackageSections };

export async function generateReportingPackage(
  companyId: string,
  packageType: ReportingPackageType,
  periodStart: string,
  periodEnd: string,
  financialYearStartDate: string,
  financialYearLabel: string,
  generatedBy = "System",
): Promise<ReportingPackage> {
  const previous = shiftPeriodBack(periodStart, periodEnd);

  const [incomeStatement, priorIncomeStatement, balanceSheet, cashFlowStatement, equityStatement, disclosureNotes, trialBalance, executiveIntelligence, openFindings] = await Promise.all([
    getIncomeStatement(companyId, periodStart, periodEnd),
    getIncomeStatement(companyId, previous.dateFrom, previous.dateTo),
    getBalanceSheet(companyId, periodEnd, financialYearStartDate),
    getCashFlowStatement(companyId, periodStart, periodEnd),
    getStatementOfChangesInEquity(companyId, financialYearStartDate, periodEnd, financialYearStartDate),
    generateDisclosureNotes(companyId, periodStart, periodEnd, financialYearStartDate, generatedBy),
    getTrialBalance(companyId, periodEnd),
    getExecutiveIntelligence(companyId, periodStart, periodEnd, financialYearStartDate),
    listAuditFindings(companyId, { status: "Open" }),
  ]);

  const narrative = buildFinancialNarrative(`${packageType === "BoardPack" ? "Board Pack" : "Management"} Summary — ${periodStart} to ${periodEnd}`, incomeStatement, priorIncomeStatement, balanceSheet, cashFlowStatement);

  const disclosureResults = disclosureNotes.map((n) => ({ noteType: n.noteType, title: n.title, content: n.generatedContent as { facts: string[]; placeholders: string[] }, requiresUserInput: n.requiresUserInput }));

  const contents = buildReportingPackageContents(
    packageType,
    periodStart,
    periodEnd,
    financialYearLabel,
    incomeStatement,
    balanceSheet,
    cashFlowStatement,
    equityStatement,
    disclosureResults,
    narrative,
    { totalDebit: trialBalance.totalDebit, totalCredit: trialBalance.totalCredit, accountCount: trialBalance.rows.length },
    { auditReadinessScore: executiveIntelligence.auditReadinessScore, openFindingsCount: openFindings.length },
  );

  const reportingPackage = await repo.createReportingPackage(companyId, {
    packageType,
    periodStart,
    periodEnd,
    financialYearLabel,
    contents: contents as unknown as Record<string, unknown>,
    generatedBy,
  });

  // Commercial Billing Platform — one Usage Engine event per generated
  // package (Management/Board/Accountant/Auditor). Deliberately not
  // wired into the live statement getters above (`getIncomeStatement`
  // etc.) — those are read paths a page re-fetches on every view/refresh,
  // not a discrete "generate a report" action a plan limit should count.
  await recordUsageEvent(companyId, "reports_generated");

  return reportingPackage;
}
