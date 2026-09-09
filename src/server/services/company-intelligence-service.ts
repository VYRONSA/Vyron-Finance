/**
 * Company Intelligence Service — Phase 10, expanded in Phase 13. The I/O
 * layer around the pure `financial-intelligence-engine.ts`: fetches real
 * data from EXISTING services only (no new query shapes, no new tables),
 * computes the aggregates the engine itself doesn't own (Aging buckets,
 * VAT summary, total cash — each via their own existing pure builders or
 * a trivial reduce over already-fetched data), and hands everything to
 * `buildFinancialIntelligenceSummary`.
 *
 * "Company -> Financial Intelligence -> Findings -> Severity ->
 * Recommended Actions" (brief, section 8) — this file IS that pipeline's
 * fetch stage. Every call below already exists and is already used
 * elsewhere in the app (mostly the Executive Company Dashboard) — see
 * FINDINGS_INVENTORY.md for the full reuse audit.
 *
 * Not named `financial-intelligence-service.ts` — that file already
 * exists and covers a different, narrower concern (GL-transaction-level
 * signals: largest movements, possible duplicate journals, missing
 * postings, unusual growth). Phase 13 wraps ITS real output
 * (`getFinancialIntelligence`) into `Finding[]` here via
 * `findGeneralLedgerFindings` — reused, not duplicated, not replaced.
 */

import { listBankAccountSummaries } from "@/server/services/bank-account-service";
import { listRecentImports } from "@/server/services/import-service";
import { listOpeningBalanceEntries } from "@/server/services/opening-balance-service";
import { listCustomers } from "@/server/services/customer-service";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listFinancialYears } from "@/server/services/financial-year-service";
import { listBankingExceptions } from "@/server/services/banking-exception-service";
import { getSummary as getTransactionExplorerSummary } from "@/server/services/transaction-explorer-service";
import { listSalesInvoices } from "@/server/services/sales-invoice-service";
import { listAllBills } from "@/server/services/purchase-bill-service";
import { listVatReturns } from "@/server/services/vat-return-service";
import { listVatExceptions } from "@/server/services/vat-exception-service";
import { buildVatDashboardSummary } from "@/server/services/vat-summary-service";
import { listExecutiveAlerts } from "@/server/services/executive-alert-service";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { getIncomeStatement } from "@/server/services/financial-statements-service";
import { getFinancialIntelligence } from "@/server/services/financial-intelligence-service";
import { listAssetFindings } from "@/server/services/asset-intelligence-service";
import { listAuditFindings } from "@/server/services/audit-finding-service";
import { listTransactionsForExport } from "@/server/services/transaction-explorer-service";
import type { TransactionExplorerFilters } from "@/server/accounting/types";
import { computeAgingBuckets } from "@/server/shared/aging";
import { detectRecurringTransactionPatterns } from "@/server/financial-intelligence/recurring-transaction-detector";
import { detectCustomerConcentrationRisk } from "@/server/financial-intelligence/customer-concentration-detector";
import { detectRepeatedCorrectionPatterns } from "@/server/financial-intelligence/repeated-correction-detector";
import { buildFinancialIntelligenceSummary, type FinancialIntelligenceInput, type FinancialIntelligenceSummary } from "@/server/financial-intelligence/financial-intelligence-engine";

/** Same "fetch everything, unfiltered, up to the export cap" filters
 * `duplicate-detection-service.ts::DEFAULT_TRANSACTION_FILTERS` already
 * uses for its own company-wide pure-detection pass over transaction
 * history — reused verbatim rather than re-declared with different
 * defaults. */
const ALL_TRANSACTIONS_FILTERS: TransactionExplorerFilters = {
  search: null, dateFrom: null, dateTo: null, minAmount: null, maxAmount: null,
  statuses: null, bankAccountId: null, importBatch: null, duplicateOnly: false,
  unknownSupplierOnly: false, sortBy: "transactionDate", sortDirection: "desc",
};

function daysSince(dateStr: string | null, now: Date): number | null {
  if (!dateStr) return null;
  return Math.floor((now.getTime() - new Date(dateStr).getTime()) / 86_400_000);
}

/**
 * Fetches everything `buildFinancialIntelligenceSummary` needs, entirely
 * from existing services, entirely in one `Promise.all` (none of the 17
 * calls below depends on another's result — matching this codebase's own
 * "one barrier when there's no true dependency" discipline, see
 * dashboard/page.tsx's own comment for the full rationale). Phase 13
 * adds `getFinancialIntelligence`/`getIncomeStatement`/`listAssetFindings`/
 * `listAuditFindings`/`listChartOfAccounts` — five more independent,
 * already-existing calls, still one barrier. Phase 25B adds
 * `listTransactionsForExport` (reusing the same call
 * `duplicate-detection-service.ts` already makes for its own company-wide
 * pass) so `detectRecurringTransactionPatterns` has real transaction
 * history to run over.
 */
export async function getCompanyIntelligenceSummary(companyId: string, todayIso: string): Promise<FinancialIntelligenceSummary> {
  const monthStartIso = `${todayIso.slice(0, 7)}-01`;

  const [
    bankAccountSummaries,
    importBatches,
    openingBalanceEntries,
    customers,
    suppliers,
    financialYears,
    openBankingExceptions,
    transactionSummary,
    salesInvoices,
    allBills,
    [vatReturns, openVatExceptions],
    openExecutiveAlerts,
    chartOfAccounts,
    monthIncomeStatement,
    financialIntelligenceReport,
    openAssetFindings,
    openAuditFindings,
    transactionsResult,
  ] = await Promise.all([
    listBankAccountSummaries(companyId),
    listRecentImports(companyId),
    listOpeningBalanceEntries(companyId),
    listCustomers(companyId),
    listSuppliers(companyId),
    listFinancialYears(companyId),
    listBankingExceptions(companyId, "Open"),
    getTransactionExplorerSummary(companyId),
    listSalesInvoices(companyId),
    listAllBills(companyId),
    Promise.all([listVatReturns(companyId), listVatExceptions(companyId, "Open")]),
    listExecutiveAlerts(companyId, "Open"),
    listChartOfAccounts(companyId),
    getIncomeStatement(companyId, monthStartIso, todayIso),
    getFinancialIntelligence(companyId, monthStartIso, todayIso),
    listAssetFindings(companyId, { status: "Open" }),
    listAuditFindings(companyId, { status: "Open" }),
    listTransactionsForExport(companyId, ALL_TRANSACTIONS_FILTERS),
  ]);

  const now = new Date(`${todayIso}T00:00:00.000Z`);
  const activeAccounts = bankAccountSummaries.filter((s) => s.account.status !== "Archived");
  const accountsNeedingReconciliation = activeAccounts.filter((s) => {
    const days = daysSince(s.account.lastReconciliationDate, now);
    return days === null || days > 30;
  }).length;
  const totalCash = activeAccounts.reduce((sum, s) => sum + s.account.currentBalance, 0);

  const latestVatReturn = [...vatReturns].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0] ?? null;
  const vatSummary = buildVatDashboardSummary(latestVatReturn, vatReturns, openVatExceptions, 0);

  const debtorsAging = computeAgingBuckets(
    salesInvoices.filter((i) => i.documentType !== "Credit Note").map((i) => ({ outstanding: i.outstanding, dueDate: i.dueDate })),
    todayIso,
  );
  const creditorsAging = computeAgingBuckets(
    allBills.filter((b) => b.documentType !== "Credit Note").map((b) => ({ outstanding: b.outstanding, dueDate: b.dueDate })),
    todayIso,
  );

  const recurringPatterns = detectRecurringTransactionPatterns(transactionsResult.transactions);
  const customerConcentration = detectCustomerConcentrationRisk(customers, salesInvoices);
  const repeatedCorrectionPatterns = detectRepeatedCorrectionPatterns(transactionsResult.transactions);

  const input: FinancialIntelligenceInput = {
    companyId,
    hasBankAccount: activeAccounts.length > 0,
    hasBankTransactionsImported: importBatches.some((b) => b.importType === "bank_transactions"),
    hasOpeningBalanceEntries: openingBalanceEntries.length > 0,
    hasCustomers: customers.length > 0,
    hasSuppliers: suppliers.length > 0,
    hasFinancialYearConfigured: financialYears.length > 0,
    hasChartOfAccounts: chartOfAccounts.length > 0,
    openExceptions: openBankingExceptions,
    accountsNeedingReconciliation,
    awaitingReviewCount: transactionSummary.awaitingReview,
    unallocatedCount: transactionSummary.unmatched,
    debtorsAging,
    creditorsAging,
    vatSummary,
    openExecutiveAlerts,
    financialIntelligenceReport,
    totalCash,
    netProfit: monthIncomeStatement.netProfit,
    openAssetFindings,
    openAuditFindings,
    recurringPatterns,
    customerConcentration,
    repeatedCorrectionPatterns,
  };

  return buildFinancialIntelligenceSummary(input);
}
