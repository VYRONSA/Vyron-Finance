/**
 * Preview Mode support for the Financial Intelligence Engine (Phase 10)
 * and the VYRON Intelligence Centre (Phase 11). Assembles the exact same
 * `FinancialIntelligenceInput` shape `company-intelligence-service.ts`
 * builds from real data, but from this app's existing mock fixtures —
 * reuses the real pure engine (`buildFinancialIntelligenceSummary`) and
 * the real pure `computeAgingBuckets`/`buildVatDashboardSummary`
 * builders, so Preview Mode can never drift from what real data would
 * produce through the same code path.
 */

import { buildFinancialIntelligenceSummary, type FinancialIntelligenceSummary } from "@/server/financial-intelligence/financial-intelligence-engine";
import { computeAgingBuckets } from "@/server/shared/aging";
import { buildVatDashboardSummary } from "@/server/services/vat-summary-service";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "./bank-accounts-data";
import { MOCK_IMPORT_BATCHES } from "./import-centre-data";
import { MOCK_CUSTOMERS } from "./customer-management-data";
import { MOCK_SUPPLIERS, MOCK_BILLS } from "./supplier-reconciliation-data";
import { MOCK_FINANCIAL_YEARS } from "./company-management-data";
import { MOCK_BANKING_EXCEPTIONS } from "./banking-automation-data";
import { MOCK_TRANSACTION_SUMMARY } from "./transaction-explorer-data";
import { MOCK_SALES_INVOICES } from "./sales-data";
import { MOCK_PURCHASE_BILLS } from "./purchasing-data";
import { MOCK_VAT_RETURNS, MOCK_VAT_EXCEPTIONS } from "./vat-data";
import { MOCK_CHART_OF_ACCOUNTS } from "./general-ledger-data";
import { MOCK_INCOME_STATEMENT } from "./financial-reporting-data";
import { MOCK_ASSET_FINDINGS } from "./asset-data";
import { MOCK_AUDIT_FINDINGS } from "./audit-data";

export function buildPreviewFinancialIntelligenceSummary(companyId: string, todayIso: string): FinancialIntelligenceSummary {
  const activeAccounts = MOCK_BANK_ACCOUNT_SUMMARIES.filter((s) => s.account.status !== "Archived");
  const accountsNeedingReconciliation = activeAccounts.filter((s) => {
    const days = s.account.lastReconciliationDate
      ? Math.floor((new Date(todayIso).getTime() - new Date(s.account.lastReconciliationDate).getTime()) / 86_400_000)
      : null;
    return days === null || days > 30;
  }).length;

  const debtorsAging = computeAgingBuckets(
    MOCK_SALES_INVOICES.filter((i) => i.documentType !== "Credit Note").map((i) => ({ outstanding: i.outstanding, dueDate: i.dueDate })),
    todayIso,
  );
  const creditorsAging = computeAgingBuckets(
    [...MOCK_BILLS, ...MOCK_PURCHASE_BILLS].filter((b) => b.documentType !== "Credit Note").map((b) => ({ outstanding: b.outstanding, dueDate: b.dueDate })),
    todayIso,
  );

  const latestVatReturn = [...MOCK_VAT_RETURNS].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0] ?? null;
  const vatSummary = buildVatDashboardSummary(latestVatReturn, MOCK_VAT_RETURNS, MOCK_VAT_EXCEPTIONS, 0);

  return buildFinancialIntelligenceSummary({
    companyId,
    hasBankAccount: activeAccounts.length > 0,
    hasBankTransactionsImported: MOCK_IMPORT_BATCHES.some((b) => b.importType === "bank_transactions"),
    // No mock fixture exists for Opening Balance entries — honestly
    // reported as "none entered" rather than assumed complete.
    hasOpeningBalanceEntries: false,
    hasCustomers: MOCK_CUSTOMERS.length > 0,
    hasSuppliers: MOCK_SUPPLIERS.length > 0,
    hasFinancialYearConfigured: MOCK_FINANCIAL_YEARS.some((fy) => fy.isCurrent),
    openExceptions: MOCK_BANKING_EXCEPTIONS.filter((e) => e.status === "Open"),
    accountsNeedingReconciliation,
    awaitingReviewCount: MOCK_TRANSACTION_SUMMARY.awaitingReview,
    unallocatedCount: MOCK_TRANSACTION_SUMMARY.unmatched,
    debtorsAging,
    creditorsAging,
    vatSummary,
    // No mock fixture exists for Executive Alerts either — omitted
    // rather than fabricated (matches Dashboard's own preview branch).
    openExecutiveAlerts: [],
    hasChartOfAccounts: MOCK_CHART_OF_ACCOUNTS.length > 0,
    totalCash: activeAccounts.reduce((sum, s) => sum + s.account.currentBalance, 0),
    netProfit: MOCK_INCOME_STATEMENT.netProfit,
    openAssetFindings: MOCK_ASSET_FINDINGS.filter((f) => f.status === "Open"),
    openAuditFindings: MOCK_AUDIT_FINDINGS.filter((f) => f.status === "Open"),
    // No mock fixture exists for a full FinancialIntelligenceReport
    // (largest movements / duplicate journals / missing postings /
    // unusual growth) — omitted rather than fabricated; Preview Mode
    // simply shows no General Ledger findings, same "honest gap" this
    // file already discloses for Opening Balances and Executive Alerts.
  });
}
