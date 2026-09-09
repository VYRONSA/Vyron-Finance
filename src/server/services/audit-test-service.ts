/**
 * Orchestrates the 18 Audit Tests over real, live data for a period, and
 * persists results via `raiseFindingIdempotent` — re-running tests never
 * duplicates an already-open finding. Every fetch here reuses an
 * existing company-wide repository/service; no new data-access path.
 */

import { listJournals } from "@/server/services/journal-workflow-service";
import { listGlTransactionsInRange } from "@/server/repositories/gl-repository";
import { listTransactionsForExport } from "@/server/services/transaction-explorer-service";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listCustomers } from "@/server/services/customer-service";
import { listStockItems } from "@/server/services/stock-item-service";
import { listVatDocuments } from "@/server/services/vat-transaction-service";
import { getTrialBalance } from "@/server/services/trial-balance-service";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { identifyCashAccountIds } from "@/server/services/financial-statements-service";
import { raiseFindingIdempotent } from "@/server/repositories/audit-finding-repository";
import type { IntelligenceTransaction } from "@/server/banking-rules/banking-intelligence";
import {
  runAgedReconcilingItemsTest,
  runBenfordAnalysis,
  runCutoffTest,
  runDuplicateCustomersTest,
  runDuplicateJournalsTest,
  runDuplicatePaymentsTest,
  runDuplicateSuppliersTest,
  runDuplicateVatClaimsTest,
  runHolidayPostingTest,
  runLargeJournalsTest,
  runManualJournalReviewTest,
  runNegativeCashTest,
  runNegativeInventoryTest,
  runOrphanTransactionsTest,
  runPostingDateTest,
  runSequenceGapsTest,
  runSuspenseAccountReviewTest,
  runWeekendPostingTest,
  type AuditTestFinding,
} from "@/server/audit/audit-tests-engine";

const DEFAULT_LARGE_JOURNAL_MULTIPLE = 2; // "large" = 2x materiality by default, a real, disclosed default
const DEFAULT_RECONCILING_ITEM_TRANSACTION_CAP = 5000;

export async function runAuditTests(
  companyId: string,
  engagementId: number | null,
  periodStart: string,
  periodEnd: string,
  materialityThreshold: number,
  holidayDates: string[] = [],
): Promise<{ findingsRaised: number; findingsAlreadyOpen: number }> {
  const [allJournals, glResult, bankResult, suppliers, customers, stockItems, vatDocuments, accounts, trialBalance] = await Promise.all([
    listJournals(companyId),
    listGlTransactionsInRange(companyId, periodStart, periodEnd),
    listTransactionsForExport(companyId, {
      search: null, dateFrom: periodStart, dateTo: periodEnd, minAmount: null, maxAmount: null,
      statuses: null, bankAccountId: null, importBatch: null, duplicateOnly: false,
      unknownSupplierOnly: false, sortBy: "transactionDate", sortDirection: "desc",
    }),
    listSuppliers(companyId),
    listCustomers(companyId),
    listStockItems(companyId),
    listVatDocuments(companyId),
    listChartOfAccounts(companyId),
    getTrialBalance(companyId, periodEnd),
  ]);

  const journalsInPeriod = allJournals.filter((j) => j.journalDate >= periodStart && j.journalDate <= periodEnd);
  const validJournalIds = new Set(allJournals.map((j) => j.id));
  const vatDocumentsInPeriod = vatDocuments.filter((d) => d.date >= periodStart && d.date <= periodEnd);
  const cashAccountIds = identifyCashAccountIds(accounts);

  const bankTransactionsAsIntelligence: IntelligenceTransaction[] = bankResult.transactions.map((t) => ({ id: t.id, transactionDate: t.transactionDate, beneficiary: t.beneficiary, debit: t.debit, credit: t.credit }));

  const results: AuditTestFinding[] = [
    ...runDuplicatePaymentsTest(bankTransactionsAsIntelligence),
    ...runDuplicateJournalsTest(glResult.transactions),
    ...runDuplicateVatClaimsTest(vatDocumentsInPeriod),
    ...runDuplicateSuppliersTest(suppliers.map((s) => ({ id: s.id, name: s.name, bankAccountNumber: s.bankAccountNumber, vatNumber: s.vatNumber }))),
    ...runDuplicateCustomersTest(customers.map((c) => ({ id: c.id, name: c.name, vatNumber: c.vatNumber, registrationNumber: c.registrationNumber }))),
    ...runSequenceGapsTest(journalsInPeriod.map((j) => ({ id: j.id, number: j.journalNumber })), "journal"),
    ...runPostingDateTest(journalsInPeriod),
    ...runCutoffTest(journalsInPeriod, periodEnd),
    ...runBenfordAnalysis(journalsInPeriod.map((j) => Math.max(j.totalDebit, j.totalCredit))),
    ...runLargeJournalsTest(journalsInPeriod, materialityThreshold * DEFAULT_LARGE_JOURNAL_MULTIPLE),
    ...runWeekendPostingTest(journalsInPeriod),
    ...runHolidayPostingTest(journalsInPeriod, holidayDates),
    ...runManualJournalReviewTest(journalsInPeriod, materialityThreshold),
    ...runSuspenseAccountReviewTest(glResult.transactions),
    ...runNegativeInventoryTest(stockItems.map((s) => ({ id: s.id, stockCode: s.stockCode, description: s.description, quantityOnHand: s.quantityOnHand }))),
    ...runNegativeCashTest(trialBalance.rows, cashAccountIds),
    ...runAgedReconcilingItemsTest(bankResult.transactions.slice(0, DEFAULT_RECONCILING_ITEM_TRANSACTION_CAP), periodEnd),
    ...runOrphanTransactionsTest(glResult.transactions, validJournalIds),
  ];

  let findingsRaised = 0;
  let findingsAlreadyOpen = 0;
  for (const result of results) {
    const { created } = await raiseFindingIdempotent(companyId, { ...result, engagementId, category: "Test" });
    if (created) findingsRaised += 1;
    else findingsAlreadyOpen += 1;
  }

  return { findingsRaised, findingsAlreadyOpen };
}
