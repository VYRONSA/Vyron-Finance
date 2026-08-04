/**
 * Preview Mode seed data for the GAAP-Compliant Financial Statements &
 * Disclosure Engine (Module 13). Every value below is DERIVED by calling
 * the real pure engines (`equity-engine.ts`/`disclosure-engine.ts`/
 * `reporting-package-engine.ts`/`reporting-readiness-engine.ts`) against
 * the SAME mock financial statements/asset/inventory/VAT data every
 * prior module's mock file already established — the "derived, not
 * hand-typed" discipline this entire session has followed.
 */

import { buildStatementOfChangesInEquity, type StatementOfChangesInEquity } from "@/server/reporting/equity-engine";
import {
  buildAccountingPoliciesNote,
  buildCommitmentsAndContingenciesNote,
  buildEstimatesNote,
  buildEventsAfterReportingDateNote,
  buildExpenseNotes,
  buildFixedAssetNotes,
  buildInventoryNotes,
  buildRelatedPartyNote,
  buildRevenueNotes,
  buildSignificantJudgementsNote,
  buildVatNotes,
  type DisclosureNoteResult,
} from "@/server/disclosures/disclosure-engine";
import { buildReportingPackageContents } from "@/server/reporting/reporting-package-engine";
import { buildReportingReadiness } from "@/server/reporting/reporting-readiness-engine";
import { buildAssetDashboardSummary } from "@/server/services/asset-dashboard-summary-service";
import { buildInventoryDashboardSummary } from "@/server/services/inventory-summary-service";
import { buildVatDashboardSummary } from "@/server/services/vat-summary-service";
import { buildFinancialNarrative } from "@/server/copilot/narrative-engine";
import type { DisclosureNote, ReportingPackage } from "@/server/disclosures/types";
import {
  ACCOUNTS,
  FINANCIAL_YEAR_START,
  MOCK_BALANCE_SHEET,
  MOCK_CASH_FLOW_STATEMENT,
  MOCK_INCOME_STATEMENT,
  MOCK_AUDIT_READINESS_SCORE,
  PERIOD_END,
  PERIOD_START,
  trialBalanceRowsAsOf,
} from "./financial-reporting-data";
import { MOCK_COMPANY } from "./financial-data";
import { MOCK_ASSET_FINDINGS, MOCK_DEPRECIATION_RUNS, MOCK_FIXED_ASSETS } from "./asset-data";
import { MOCK_STOCK_ITEMS, MOCK_INVENTORY_TRANSACTIONS } from "./inventory-data";
import { MOCK_VAT_RETURNS, MOCK_VAT_EXCEPTIONS } from "./vat-data";
import { MOCK_VAT_TREATMENTS } from "./company-management-data";
import { MOCK_AUDIT_FINDINGS } from "./audit-data";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_STATEMENT_OF_CHANGES_IN_EQUITY: StatementOfChangesInEquity = buildStatementOfChangesInEquity(
  ACCOUNTS,
  trialBalanceRowsAsOf("2025-12-31"),
  trialBalanceRowsAsOf(PERIOD_END),
  FINANCIAL_YEAR_START,
  PERIOD_END,
  MOCK_BALANCE_SHEET.equity.lines.find((l) => l.description === "Current Year Earnings")?.amount ?? 0,
);

const latestPostedDepreciationRun = [...MOCK_DEPRECIATION_RUNS].filter((r) => r.status === "Posted").sort((a, b) => (a.runDate < b.runDate ? 1 : -1))[0] ?? null;
const MOCK_ASSET_SUMMARY = buildAssetDashboardSummary(MOCK_FIXED_ASSETS, MOCK_ASSET_FINDINGS.filter((f) => f.status === "Open"), latestPostedDepreciationRun?.totalAmount ?? 0);
const MOCK_INVENTORY_SUMMARY = buildInventoryDashboardSummary(MOCK_STOCK_ITEMS, MOCK_INVENTORY_TRANSACTIONS, PERIOD_END);
const latestVatReturn = [...MOCK_VAT_RETURNS].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0] ?? null;
const openVatExceptions = MOCK_VAT_EXCEPTIONS.filter((e) => e.status === "Open");
const MOCK_VAT_SUMMARY = buildVatDashboardSummary(latestVatReturn, MOCK_VAT_RETURNS, openVatExceptions, 0);

const activeAssets = MOCK_FIXED_ASSETS.filter((a) => a.status !== "WrittenOff");
const depreciationMethodsInUse = [...new Set(activeAssets.map((a) => a.depreciationMethod))];
const vatTypesInUse = [...new Set(MOCK_VAT_TREATMENTS.filter((t) => t.isActive).map((t) => t.vatType))];
const usefulLifeMonths = activeAssets.map((a) => a.usefulLifeMonths);

const DISCLOSURE_RESULTS: DisclosureNoteResult[] = [
  buildAccountingPoliciesNote(depreciationMethodsInUse, vatTypesInUse),
  buildSignificantJudgementsNote(),
  buildEstimatesNote(usefulLifeMonths),
  buildFixedAssetNotes(MOCK_FIXED_ASSETS, MOCK_ASSET_SUMMARY),
  buildInventoryNotes(MOCK_INVENTORY_SUMMARY),
  buildVatNotes(MOCK_VAT_SUMMARY, latestVatReturn),
  buildRevenueNotes(MOCK_INCOME_STATEMENT),
  buildExpenseNotes(MOCK_INCOME_STATEMENT),
  buildRelatedPartyNote(),
  buildCommitmentsAndContingenciesNote(),
  buildEventsAfterReportingDateNote(PERIOD_END),
];

export const MOCK_DISCLOSURE_NOTES: DisclosureNote[] = DISCLOSURE_RESULTS.map((r, i) => ({
  id: i + 1,
  companyId: COMPANY_ID,
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  noteType: r.noteType,
  title: r.title,
  generatedContent: r.content,
  requiresUserInput: r.requiresUserInput,
  userNotes: "",
  generatedAt: "2026-06-01T07:00:00Z",
  generatedBy: "System",
  updatedAt: "2026-06-01T07:00:00Z",
}));

const openAuditFindingsCount = MOCK_AUDIT_FINDINGS.filter((f) => f.status === "Open").length;

const MOCK_NARRATIVE = buildFinancialNarrative(`Management Summary — ${PERIOD_START} to ${PERIOD_END}`, MOCK_INCOME_STATEMENT, MOCK_INCOME_STATEMENT, MOCK_BALANCE_SHEET, MOCK_CASH_FLOW_STATEMENT);

const MANAGEMENT_PACK_CONTENTS = buildReportingPackageContents(
  "ManagementPack", PERIOD_START, PERIOD_END, MOCK_COMPANY.financialYear,
  MOCK_INCOME_STATEMENT, MOCK_BALANCE_SHEET, MOCK_CASH_FLOW_STATEMENT, MOCK_STATEMENT_OF_CHANGES_IN_EQUITY,
  DISCLOSURE_RESULTS, MOCK_NARRATIVE,
  { totalDebit: 0, totalCredit: 0, accountCount: ACCOUNTS.length },
  { auditReadinessScore: MOCK_AUDIT_READINESS_SCORE, openFindingsCount: openAuditFindingsCount },
);

const AUDITOR_PACK_CONTENTS = buildReportingPackageContents(
  "AuditorPack", PERIOD_START, PERIOD_END, MOCK_COMPANY.financialYear,
  MOCK_INCOME_STATEMENT, MOCK_BALANCE_SHEET, MOCK_CASH_FLOW_STATEMENT, MOCK_STATEMENT_OF_CHANGES_IN_EQUITY,
  DISCLOSURE_RESULTS, MOCK_NARRATIVE,
  { totalDebit: 0, totalCredit: 0, accountCount: ACCOUNTS.length },
  { auditReadinessScore: MOCK_AUDIT_READINESS_SCORE, openFindingsCount: openAuditFindingsCount },
);

export const MOCK_REPORTING_PACKAGES: ReportingPackage[] = [
  { id: 1, companyId: COMPANY_ID, packageType: "ManagementPack", periodStart: PERIOD_START, periodEnd: PERIOD_END, financialYearLabel: MOCK_COMPANY.financialYear, contents: MANAGEMENT_PACK_CONTENTS as unknown as Record<string, unknown>, generatedAt: "2026-06-01T07:15:00Z", generatedBy: "System" },
  { id: 2, companyId: COMPANY_ID, packageType: "AuditorPack", periodStart: PERIOD_START, periodEnd: PERIOD_END, financialYearLabel: MOCK_COMPANY.financialYear, contents: AUDITOR_PACK_CONTENTS as unknown as Record<string, unknown>, generatedAt: "2026-06-01T07:20:00Z", generatedBy: "System" },
];

const outstandingDisclosureCount = MOCK_DISCLOSURE_NOTES.filter((n) => n.requiresUserInput && n.userNotes.trim() === "").length;

export const MOCK_REPORTING_READINESS = buildReportingReadiness(MOCK_BALANCE_SHEET.isBalanced, outstandingDisclosureCount, MOCK_AUDIT_READINESS_SCORE, openAuditFindingsCount, MOCK_REPORTING_PACKAGES.length);
