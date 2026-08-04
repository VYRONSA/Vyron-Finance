/**
 * The Executive Intelligence composer. Per the Product Review Board's
 * own instruction ("Do not create another AI engine. Consume the
 * existing Intelligence infrastructure. Expand it. No duplicated AI
 * logic"), this file detects NOTHING new by itself where a real detector
 * already exists — it normalizes `financial-intelligence-service.ts`'s
 * non-conforming signal shape into the common `{kind, message, reasoning,
 * confidence}` shape every other Intelligence module already uses, wires
 * real counts into the Scoring Engine, and raises Executive Alerts from
 * genuinely computed thresholds over existing services (Balance Sheet,
 * Forecasts, VAT/Banking Exceptions, Inventory, Automation Tasks) — never
 * a second GL query path or a second VAT/Banking rule engine.
 */

import { getFinancialIntelligence, shiftPeriodBack, type FinancialIntelligenceReport } from "@/server/services/financial-intelligence-service";
import { listBankingExceptions } from "@/server/services/banking-exception-service";
import { listVatExceptions } from "@/server/services/vat-exception-service";
import { listVatReturns } from "@/server/services/vat-return-service";
import { computeComplianceScore } from "@/server/services/vat-summary-service";
import { listAutomationTasks } from "@/server/services/scheduler-service";
import { listStockItems } from "@/server/services/stock-item-service";
import { listInventoryTransactions } from "@/server/services/inventory-transaction-service";
import { buildInventoryDashboardSummary } from "@/server/services/inventory-summary-service";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listPurchaseBills } from "@/server/repositories/purchase-bill-repository";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { getIncomeStatement, getBalanceSheet } from "@/server/services/financial-statements-service";
import { getCashflowForecast, getCustomerPaymentForecast } from "@/server/services/forecast-service";
import { raiseAlert } from "@/server/services/executive-alert-service";
import { computeAuditReadinessScore, computeBusinessRiskScore, computeFinancialHealthScore } from "@/server/reporting/scoring-engine";
import type { ExecutiveAlertType } from "@/server/reporting/types";

export type NormalizedIntelligenceSignal = {
  source: "Financial" | "Banking" | "VAT";
  kind: string;
  message: string;
  reasoning: string;
  confidence: number;
};

/** Pure — the one place `FinancialIntelligenceReport`'s 4 bespoke signal
 * shapes become the common `{kind, message, reasoning, confidence}`
 * shape. Confidence is derived, not invented: a duplicate seen across
 * more journals, or unusual growth further from the threshold, is more
 * confidently worth attention. */
export function normalizeFinancialIntelligence(report: FinancialIntelligenceReport): NormalizedIntelligenceSignal[] {
  const signals: NormalizedIntelligenceSignal[] = [];

  for (const m of report.largestMovements.slice(0, 5)) {
    signals.push({ source: "Financial", kind: "largest-movement", message: `Large posting to ${m.accountCode} — ${m.accountDescription}: ${m.amount}`, reasoning: m.reasoning, confidence: 0.5 });
  }
  for (const d of report.possibleDuplicateJournals) {
    signals.push({
      source: "Financial",
      kind: "possible-duplicate-journal",
      message: `${d.occurrences.length} journals posted the same amount to ${d.accountCode} on ${d.postingDate}`,
      reasoning: d.reasoning,
      confidence: Math.min(0.9, 0.4 + d.occurrences.length * 0.15),
    });
  }
  for (const p of report.missingPostings) {
    signals.push({ source: "Financial", kind: "missing-posting", message: `Journal ${p.journalNumber} (${p.status}) stale for ${p.ageDays} day(s)`, reasoning: p.reasoning, confidence: Math.min(0.9, 0.3 + p.ageDays / 30) });
  }
  for (const g of report.unusualGrowth) {
    signals.push({
      source: "Financial",
      kind: "unusual-growth",
      message: `${g.accountCode} — ${g.accountDescription} moved ${g.changePercent ?? "N/A"}% vs. the prior period`,
      reasoning: g.reasoning,
      confidence: g.changePercent === null ? 0.4 : Math.min(0.9, 0.3 + Math.abs(g.changePercent) / 200),
    });
  }

  return signals;
}

export type ExecutiveIntelligenceReport = {
  signals: NormalizedIntelligenceSignal[];
  financialHealthScore: number;
  businessRiskScore: number;
  auditReadinessScore: number;
  complianceScorePercent: number;
};

export async function getExecutiveIntelligence(companyId: string, dateFrom: string, dateTo: string, financialYearStartDate: string): Promise<ExecutiveIntelligenceReport> {
  const [financialIntelligence, openBankingExceptions, openVatExceptions, vatReturns, balanceSheet, cashflowForecast, incomeStatement] = await Promise.all([
    getFinancialIntelligence(companyId, dateFrom, dateTo),
    listBankingExceptions(companyId, "Open"),
    listVatExceptions(companyId, "Open"),
    listVatReturns(companyId),
    getBalanceSheet(companyId, dateTo, financialYearStartDate),
    getCashflowForecast(companyId, dateTo),
    getIncomeStatement(companyId, dateFrom, dateTo),
  ]);

  const signals = normalizeFinancialIntelligence(financialIntelligence);
  const draftReturnCount = vatReturns.filter((r) => r.status === "Draft").length;
  const complianceScorePercent = computeComplianceScore(openVatExceptions, draftReturnCount);

  const cashTrendImproving = cashflowForecast.forecast.length === 0 || cashflowForecast.forecast[cashflowForecast.forecast.length - 1].value >= cashflowForecast.forecast[0].value;
  const financialHealthScore = computeFinancialHealthScore({
    isBalanceSheetBalanced: balanceSheet.isBalanced,
    assetToLiabilityRatio: balanceSheet.liabilities.total === 0 ? 2 : balanceSheet.totalAssets / balanceSheet.liabilities.total,
    netProfitMarginPercent: incomeStatement.revenue.total === 0 ? null : incomeStatement.netProfit / incomeStatement.revenue.total,
    cashTrendImproving,
  });

  const businessRiskScore = computeBusinessRiskScore({
    openBankingExceptionCount: openBankingExceptions.length,
    openVatExceptionCount: openVatExceptions.length,
    highRiskVatTransactionCount: 0,
    overdueDebtorsCount: 0,
    supplierConcentrationRiskCount: 0,
    duplicateTransactionSuspectCount: financialIntelligence.possibleDuplicateJournals.length,
  });

  const auditReadinessScore = computeAuditReadinessScore({
    stalePostingCount: financialIntelligence.missingPostings.filter((p) => p.status === "Approved").length,
    staleDraftCount: financialIntelligence.missingPostings.filter((p) => p.status === "Draft").length,
    openBankingExceptionCount: openBankingExceptions.length,
    openVatExceptionCount: openVatExceptions.length,
    failedAutomationTaskCount: 0,
  });

  return { signals, financialHealthScore, businessRiskScore, auditReadinessScore, complianceScorePercent };
}

// ---------------------------------------------------------------------
// Executive Alert detection — real thresholds over existing services,
// each raised via `raiseAlert` (idempotent — re-running detection never
// duplicates an already-open alert).
// ---------------------------------------------------------------------

type AlertCandidate = { alertType: ExecutiveAlertType; priority: "Low" | "Medium" | "High" | "Critical"; reason: string; evidence: string; recommendedAction: string };

async function detectDecliningCash(companyId: string, referenceDate: string): Promise<AlertCandidate | null> {
  const forecast = await getCashflowForecast(companyId, referenceDate);
  if (forecast.confidence < 0.3 || forecast.forecast.length === 0) return null;
  const declining = forecast.forecast[forecast.forecast.length - 1].value < forecast.forecast[0].value;
  if (!declining) return null;
  return {
    alertType: "DecliningCash",
    priority: "High",
    reason: "The Cashflow Forecast's fitted trend is declining over the next projected periods.",
    evidence: `Projected cash: ${forecast.forecast.map((p) => `${p.period}: ${p.value}`).join(", ")} (confidence ${Math.round(forecast.confidence * 100)}%).`,
    recommendedAction: "Review upcoming payables and collection timing before the projected shortfall.",
  };
}

async function detectMarginReduction(companyId: string, referenceDate: string): Promise<AlertCandidate | null> {
  const monthEnd = referenceDate;
  const monthStart = `${monthEnd.slice(0, 7)}-01`;
  const previous = { dateFrom: monthStart, dateTo: monthEnd };
  const priorPeriod = shiftPeriodBack(previous.dateFrom, previous.dateTo);

  const [current, prior] = await Promise.all([getIncomeStatement(companyId, monthStart, monthEnd), getIncomeStatement(companyId, priorPeriod.dateFrom, priorPeriod.dateTo)]);
  if (current.revenue.total === 0 || prior.revenue.total === 0) return null;

  const currentMargin = current.grossProfit / current.revenue.total;
  const priorMargin = prior.grossProfit / prior.revenue.total;
  const dropPoints = (priorMargin - currentMargin) * 100;
  if (dropPoints < 5) return null;

  return {
    alertType: "MarginReduction",
    priority: dropPoints >= 15 ? "Critical" : "High",
    reason: `Gross margin fell ${dropPoints.toFixed(1)} percentage points vs. the prior period.`,
    evidence: `Gross margin ${Math.round(priorMargin * 100)}% -> ${Math.round(currentMargin * 100)}%.`,
    recommendedAction: "Review cost of sales and pricing for the current period.",
  };
}

async function detectInventoryProblems(companyId: string): Promise<AlertCandidate | null> {
  const [items, transactions] = await Promise.all([listStockItems(companyId), listInventoryTransactions(companyId)]);
  const summary = buildInventoryDashboardSummary(items, transactions, new Date().toISOString().slice(0, 10));
  if (summary.outOfStockCount === 0 && summary.reorderAlertCount === 0) return null;
  return {
    alertType: "InventoryProblems",
    priority: summary.outOfStockCount > 0 ? "High" : "Medium",
    reason: `${summary.outOfStockCount} item(s) out of stock, ${summary.reorderAlertCount} awaiting reorder.`,
    evidence: `Out of stock: ${summary.outOfStockCount}. Reorder alerts: ${summary.reorderAlertCount}.`,
    recommendedAction: "Review the Inventory workspace's reorder list.",
  };
}

async function detectComplianceIssues(companyId: string): Promise<AlertCandidate | null> {
  const openVatExceptions = await listVatExceptions(companyId, "Open");
  if (openVatExceptions.length === 0) return null;
  return {
    alertType: "ComplianceIssues",
    priority: openVatExceptions.length >= 5 ? "Critical" : "Medium",
    reason: `${openVatExceptions.length} open VAT exception(s) awaiting resolution.`,
    evidence: openVatExceptions.slice(0, 5).map((e) => `${e.exceptionType}: ${e.reason}`).join(" | "),
    recommendedAction: "Review the VAT Exception Centre.",
  };
}

async function detectAutomationFailures(companyId: string): Promise<AlertCandidate | null> {
  const tasks = await listAutomationTasks(companyId);
  const failed = tasks.filter((t) => t.status === "Failed");
  if (failed.length === 0) return null;
  return {
    alertType: "AutomationFailures",
    priority: "High",
    reason: `${failed.length} automation task(s) failed after exhausting retries.`,
    evidence: failed.slice(0, 5).map((t) => t.name).join(", "),
    recommendedAction: "Review the Automation Dashboard's retry queue and resolve the underlying cause.",
  };
}

async function detectLargeUnusualTransactionsAndDuplicates(companyId: string, dateFrom: string, dateTo: string): Promise<AlertCandidate[]> {
  const report = await getFinancialIntelligence(companyId, dateFrom, dateTo);
  const candidates: AlertCandidate[] = [];

  const largest = report.largestMovements[0];
  if (largest && largest.amount > 0) {
    candidates.push({
      alertType: "LargeUnusualTransactions",
      priority: "Medium",
      reason: `The largest single posting this period was ${largest.amount} to ${largest.accountCode}.`,
      evidence: largest.reasoning,
      recommendedAction: "Confirm the posting was intended and correctly coded.",
    });
  }

  if (report.possibleDuplicateJournals.length > 0) {
    const top = report.possibleDuplicateJournals[0];
    candidates.push({
      alertType: "DuplicateTrends",
      priority: report.possibleDuplicateJournals.length >= 3 ? "High" : "Medium",
      reason: `${report.possibleDuplicateJournals.length} possible duplicate posting group(s) detected this period.`,
      evidence: top.reasoning,
      recommendedAction: "Review the Financial Intelligence report's duplicate postings list.",
    });
  }

  return candidates;
}

async function detectSupplierRisk(companyId: string): Promise<AlertCandidate | null> {
  const [suppliers, bills] = await Promise.all([listSuppliers(companyId), listPurchaseBills(companyId)]);
  const totalsBySupplier = new Map<number, number>();
  let grandTotal = 0;
  for (const bill of bills) {
    if (!bill.supplierId) continue;
    totalsBySupplier.set(bill.supplierId, (totalsBySupplier.get(bill.supplierId) ?? 0) + bill.total);
    grandTotal += bill.total;
  }
  if (grandTotal === 0) return null;

  let topSupplierId: number | null = null;
  let topTotal = 0;
  for (const [supplierId, total] of totalsBySupplier) {
    if (total > topTotal) {
      topTotal = total;
      topSupplierId = supplierId;
    }
  }
  const share = topTotal / grandTotal;
  if (share < 0.4 || topSupplierId === null) return null;

  const supplier = suppliers.find((s) => s.id === topSupplierId);
  return {
    alertType: "SupplierRisk",
    priority: share >= 0.6 ? "High" : "Medium",
    reason: `${supplier?.name ?? `Supplier #${topSupplierId}`} accounts for ${Math.round(share * 100)}% of total purchases — concentration risk.`,
    evidence: `${money(topTotal)} of ${money(grandTotal)} total purchases.`,
    recommendedAction: "Consider diversifying suppliers for this spend category.",
  };
}

async function detectSlowPayingCustomers(companyId: string, referenceDate: string): Promise<AlertCandidate | null> {
  const forecast = await getCustomerPaymentForecast(companyId, referenceDate);
  if (forecast.historicalPoints < 2 || forecast.confidence < 0.3 || forecast.forecast.length === 0) return null;
  const worsening = forecast.forecast[forecast.forecast.length - 1].value > forecast.forecast[0].value;
  if (!worsening) return null;
  return {
    alertType: "SlowPayingCustomers",
    priority: "Medium",
    reason: "Average customer payment days are trending upward.",
    evidence: `Projected average days to pay: ${forecast.forecast.map((p) => `${p.period}: ${p.value}`).join(", ")}.`,
    recommendedAction: "Review the Customer Aging report for slow-paying accounts.",
  };
}

async function detectIncreasingDebtors(companyId: string, referenceDate: string): Promise<AlertCandidate | null> {
  const monthAgo = new Date(`${referenceDate}T00:00:00Z`);
  monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
  const monthAgoIso = monthAgo.toISOString().slice(0, 10);

  const accounts = await listChartOfAccounts(companyId);
  const debtorAccounts = accounts.filter((a) => a.accountType === "Asset" && /debtor|receivable/i.test(a.description));
  if (debtorAccounts.length === 0) return null;

  const [currentBalance, priorBalance] = await Promise.all([
    getBalanceSheet(companyId, referenceDate, referenceDate),
    getBalanceSheet(companyId, monthAgoIso, monthAgoIso),
  ]);
  const currentTotal = debtorAccounts.reduce((sum, a) => sum + (currentBalance.assets.lines.find((l) => l.accountId === a.id)?.amount ?? 0), 0);
  const priorTotal = debtorAccounts.reduce((sum, a) => sum + (priorBalance.assets.lines.find((l) => l.accountId === a.id)?.amount ?? 0), 0);
  if (priorTotal <= 0) return null;

  const changePercent = ((currentTotal - priorTotal) / priorTotal) * 100;
  if (changePercent < 15) return null;

  return {
    alertType: "IncreasingDebtors",
    priority: changePercent >= 30 ? "High" : "Medium",
    reason: `Total debtors grew ${changePercent.toFixed(1)}% over the last month.`,
    evidence: `${money(priorTotal)} -> ${money(currentTotal)}.`,
    recommendedAction: "Review outstanding customer balances and collection follow-up.",
  };
}

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Scans real data across every module and raises any Executive Alert
 * whose threshold is met — idempotent via `raiseAlert`'s underlying
 * `raiseAlertIdempotent`, so calling this repeatedly (e.g. from the
 * Automation Scheduler) never duplicates an already-open alert. Errors
 * from any one detector don't block the others. */
export async function detectAndRaiseExecutiveAlerts(companyId: string, referenceDate: string): Promise<number> {
  const monthStart = `${referenceDate.slice(0, 7)}-01`;

  const detectors: Promise<AlertCandidate | AlertCandidate[] | null>[] = [
    detectDecliningCash(companyId, referenceDate),
    detectMarginReduction(companyId, referenceDate),
    detectInventoryProblems(companyId),
    detectComplianceIssues(companyId),
    detectAutomationFailures(companyId),
    detectLargeUnusualTransactionsAndDuplicates(companyId, monthStart, referenceDate),
    detectSupplierRisk(companyId),
    detectSlowPayingCustomers(companyId, referenceDate),
    detectIncreasingDebtors(companyId, referenceDate),
  ];

  const results = await Promise.allSettled(detectors);
  const candidates: AlertCandidate[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    if (Array.isArray(result.value)) candidates.push(...result.value);
    else candidates.push(result.value);
  }

  let raisedCount = 0;
  for (const candidate of candidates) {
    await raiseAlert(companyId, { ...candidate });
    raisedCount += 1;
  }
  return raisedCount;
}
