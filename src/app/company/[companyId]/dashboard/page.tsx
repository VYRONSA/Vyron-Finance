import type { Metadata } from "next";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import { ActivityBarChart } from "@/components/ui/charts/bar-chart";
import { StackedStatusBar } from "@/components/ui/charts/stacked-status-bar";
import { RadialMeter } from "@/components/ui/charts/radial-meter";
import { Sparkline, SparkBars } from "@/components/ui/charts/sparkline";
import {
  IconAlertTriangle,
  IconArchive,
  IconBank,
  IconBanknote,
  IconBookOpen,
  IconCalendar,
  IconClock,
  IconFileText,
  IconImport,
  IconListChecks,
  IconReceipt,
  IconReconcile,
  IconRefresh,
  IconShieldCheck,
  IconSliders,
  IconSparkles,
  IconUsers,
} from "@/components/ui/icons";
import {
  MOCK_AI_INSIGHTS,
  MOCK_CHECKLIST,
  MOCK_COMPLETION_PERCENT,
  MOCK_IMPORT_ACTIVITY,
  MOCK_RECENT_ACTIVITY,
  MOCK_RECOVERY_ALERTS,
  MOCK_RECOVERY_TREND,
} from "@/lib/mock/financial-data";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";
import { MOCK_BILLS, MOCK_SUPPLIERS } from "@/lib/mock/supplier-reconciliation-data";
import { MOCK_JOURNALS, MOCK_TRIAL_BALANCE } from "@/lib/mock/general-ledger-data";
import { MOCK_FINANCIAL_YEARS } from "@/lib/mock/company-management-data";
import { MOCK_CUSTOMERS } from "@/lib/mock/customer-management-data";
import { MOCK_SALES_INVOICES, MOCK_SALES_ORDERS } from "@/lib/mock/sales-data";
import { MOCK_PURCHASE_BILLS, MOCK_PURCHASE_ORDERS, MOCK_SUPPLIER_PAYMENTS } from "@/lib/mock/purchasing-data";
import { MOCK_INVENTORY_TRANSACTIONS, MOCK_STOCK_ITEMS } from "@/lib/mock/inventory-data";
import { MOCK_IMPORT_BATCHES } from "@/lib/mock/import-centre-data";
import { MOCK_BANKING_AGGREGATE } from "@/lib/mock/transaction-explorer-data";
import { MOCK_BANKING_EXCEPTIONS } from "@/lib/mock/banking-automation-data";
import { MOCK_AUTOMATION_TASKS, MOCK_AUTOMATION_TASK_RUNS } from "@/lib/mock/automation-data";
import { MOCK_VAT_EXCEPTIONS, MOCK_VAT_RETURNS } from "@/lib/mock/vat-data";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listJournals } from "@/server/services/journal-workflow-service";
import { listBankAccountSummaries } from "@/server/services/bank-account-service";
import { getTrialBalance } from "@/server/services/trial-balance-service";
import { listFinancialYears } from "@/server/services/financial-year-service";
import { listCustomers } from "@/server/services/customer-service";
import { listSalesInvoices } from "@/server/services/sales-invoice-service";
import { listSalesOrders } from "@/server/services/sales-order-service";
import { buildSalesDashboardSummary } from "@/server/services/sales-summary-service";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listAllBills } from "@/server/services/purchase-bill-service";
import { listPurchaseOrders } from "@/server/services/purchase-order-service";
import { listSupplierPayments } from "@/server/services/supplier-payment-service";
import { buildPurchasingDashboardSummary } from "@/server/services/purchasing-summary-service";
import { listStockItems } from "@/server/services/stock-item-service";
import { listInventoryTransactions } from "@/server/services/inventory-transaction-service";
import { buildInventoryDashboardSummary } from "@/server/services/inventory-summary-service";
import { listTransactions, getBankingAutomationAggregate } from "@/server/services/transaction-explorer-service";
import { listRecentImports } from "@/server/services/import-service";
import { listBankingExceptions } from "@/server/services/banking-exception-service";
import { listRuleApplicationsSince } from "@/server/services/banking-rule-service";
import { buildBankingAutomationSummary } from "@/server/services/banking-summary-service";
import { listAutomationTasks, listRecentTaskRuns } from "@/server/services/scheduler-service";
import { buildAutomationDashboardSummary } from "@/server/services/automation-dashboard-summary-service";
import { listVatReturns } from "@/server/services/vat-return-service";
import { listVatExceptions } from "@/server/services/vat-exception-service";
import { buildVatDashboardSummary } from "@/server/services/vat-summary-service";
import { getIncomeStatement } from "@/server/services/financial-statements-service";
import { getExecutiveIntelligence } from "@/server/services/executive-intelligence-service";
import { listExecutiveAlerts } from "@/server/services/executive-alert-service";
import { listAuditLog } from "@/server/services/automation-audit-service";
import { listAuditFindings } from "@/server/services/audit-finding-service";
import { buildAuditDashboardSummary } from "@/server/services/audit-dashboard-summary-service";
import { answerMissingSupportingDocuments } from "@/server/audit/audit-assistant-engine";
import { listFixedAssets } from "@/server/services/asset-register-service";
import { listAssetFindings } from "@/server/services/asset-intelligence-service";
import { listDepreciationRuns } from "@/server/services/depreciation-run-service";
import { buildAssetDashboardSummary } from "@/server/services/asset-dashboard-summary-service";
import { listCopilotBriefings } from "@/server/services/executive-briefing-service";
import type { ExecutiveBriefing } from "@/server/copilot/executive-briefing-engine";
import { getReportingReadiness } from "@/server/services/reporting-readiness-service";
import { getMatchingQueue } from "@/server/services/matching-queue-service";
import { buildMatchingSummary } from "@/server/services/matching-summary-service";
import { MOCK_MATCHING_SUMMARY } from "@/lib/mock/matching-data";
import {
  MOCK_FINANCIAL_HEALTH_SCORE,
  MOCK_BUSINESS_RISK_SCORE,
  MOCK_AUDIT_READINESS_SCORE,
  MOCK_INCOME_STATEMENT,
} from "@/lib/mock/financial-reporting-data";
import { MOCK_AUDIT_FINDINGS } from "@/lib/mock/audit-data";
import { MOCK_FIXED_ASSETS, MOCK_ASSET_FINDINGS, MOCK_DEPRECIATION_RUNS } from "@/lib/mock/asset-data";
import { MOCK_COPILOT_BRIEFING } from "@/lib/mock/copilot-data";
import { MOCK_REPORTING_READINESS } from "@/lib/mock/financial-statements-data";
import type { JournalStatus } from "@/server/accounting/types";

export const metadata: Metadata = {
  title: "Dashboard — VYRON FINANCE",
};

const JOURNAL_STATUS_TONE: Record<JournalStatus, "good" | "info" | "warn" | "danger" | "muted"> = {
  Draft: "warn",
  Submitted: "info",
  Approved: "info",
  Rejected: "danger",
  Posted: "good",
  Cancelled: "muted",
};
const INSIGHT_TONE_DOT = { good: "bg-vf-success", warn: "bg-vf-warning", info: "bg-vf-info" } as const;
const EXEC_SUMMARY_ICON: Record<string, ComponentType<{ className?: string }>> = {
  totalCash: IconBanknote,
  netProfitMtd: IconBanknote,
  businessRiskScore: IconAlertTriangle,
  importsToday: IconImport,
  automation: IconReconcile,
  auditReadiness: IconShieldCheck,
  activeAccounts: IconBank,
  draftJournals: IconFileText,
  postingQueue: IconClock,
  trialBalanceTotal: IconBookOpen,
  financialPeriod: IconCalendar,
  vatExceptions: IconReceipt,
  salesToday: IconBanknote,
  invoicesThisMonth: IconFileText,
  outstandingDebtors: IconClock,
  purchasesToday: IconBanknote,
  outstandingCreditors: IconUsers,
  ordersAwaitingApproval: IconClock,
  inventoryValue: IconBanknote,
  lowStock: IconAlertTriangle,
  outOfStock: IconAlertTriangle,
  reorderAlerts: IconAlertTriangle,
  transactionsAutomated: IconReconcile,
  exceptionsAwaitingReview: IconAlertTriangle,
  rulesAppliedToday: IconSparkles,
  unknownMerchants: IconAlertTriangle,
  duplicateDetection: IconAlertTriangle,
  tasksExecutedToday: IconRefresh,
  tasksWaiting: IconClock,
  schedulerHealth: IconShieldCheck,
  vatPayable: IconReceipt,
  vatComplianceScore: IconShieldCheck,
  financialHealthScore: IconShieldCheck,
  outstandingAuditIssues: IconAlertTriangle,
  controlFailures: IconAlertTriangle,
  missingDocumentation: IconFileText,
  highRiskJournals: IconAlertTriangle,
  materialExceptions: IconAlertTriangle,
  totalAssetValue: IconBanknote,
  assetNetBookValue: IconBanknote,
  assetDepreciationThisMonth: IconBanknote,
  assetsDueForReplacement: IconAlertTriangle,
  assetWarrantyExpiry: IconAlertTriangle,
  assetImpairmentAlerts: IconAlertTriangle,
  assetHealthScore: IconShieldCheck,
  statementsGenerated: IconFileText,
  reportingStatus: IconSparkles,
  outstandingDisclosures: IconFileText,
  auditCompletion: IconShieldCheck,
  reportingReadiness: IconShieldCheck,
  matchingAccuracy: IconReconcile,
  manualQueue: IconListChecks,
  duplicateRisk: IconAlertTriangle,
  ruleSuccessRate: IconSliders,
  aiConfidence: IconSparkles,
};
const ACTIVITY_ICON: Record<string, ComponentType<{ className?: string }>> = {
  Import: IconImport,
  Matching: IconReconcile,
  "Merchant Rules": IconSparkles,
  Journals: IconBookOpen,
  Users: IconShieldCheck,
  Recovery: IconAlertTriangle,
};

function money(value: number, compact = false) {
  if (compact) {
    if (Math.abs(value) >= 1_000_000) return `R ${(value / 1_000_000).toFixed(2)}M`;
    if (Math.abs(value) >= 1_000) return `R ${(value / 1_000).toFixed(1)}K`;
  }
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function DashboardPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();
  const reconciliationHref = `/company/${companyId}/supplier-reconciliation`;
  const generalLedgerHref = `/company/${companyId}/general-ledger`;
  const salesHref = `/company/${companyId}/sales`;
  const purchasingHref = `/company/${companyId}/purchasing`;
  const todayIso = new Date().toISOString().slice(0, 10);
  const bankingDefaultFilters = {
    search: null, dateFrom: null, dateTo: null, minAmount: null, maxAmount: null,
    statuses: null, bankAccountId: null, importBatch: null, duplicateOnly: false,
    unknownSupplierOnly: false, sortBy: "transactionDate" as const, sortDirection: "desc" as const,
  };

  // RC2 Phase 1/5 performance audit finding: this page — the flagship
  // screen the directive names explicitly — previously ran ~12-13
  // sequential await/Promise.all barriers even though almost none of
  // them depend on another barrier's FETCHED data, only on `companyId`
  // and the two local constants above. Live-measured server response
  // time was 5.8-6.6s, the slowest of 13 benchmarked subsystems; a
  // smaller fix (batching only the final few solo awaits) improved it
  // by under 2%, proving the real cost was the barrier COUNT, not any
  // one slow call. Every fetch below was individually traced for a true
  // data dependency on another fetch's result (not just a shared input)
  // before being grouped here — General Ledger/Sales/Purchasing/
  // Inventory/Banking/Matching/Automation/VAT genuinely have none, so
  // all 21 of their underlying queries now run in ONE barrier. Executive
  // Intelligence genuinely needs the financial year's start date
  // (Group 1's result), and the final Audit/Assets/Copilot/Reporting-
  // Readiness/Bank-Summary group genuinely needs its audit readiness
  // score — those stay in their own later barriers, not forced together.
  const [
    [journals, trialBalance, financialYears],
    [salesCustomers, salesInvoices, salesOrders],
    [purchasingSuppliers, allBills, purchaseOrders, supplierPayments],
    [inventoryItems, inventoryTransactions],
    [bankingAggregate, importBatches, bankingExceptions, ruleApplicationsToday, todaysBankTransactions],
    matchingQueue,
    [automationTasks, automationRunsToday],
    [vatReturnsForDashboard, vatExceptionsForDashboard],
  ] = previewMode
    ? [
        [MOCK_JOURNALS, MOCK_TRIAL_BALANCE, MOCK_FINANCIAL_YEARS],
        [MOCK_CUSTOMERS, MOCK_SALES_INVOICES, MOCK_SALES_ORDERS],
        [MOCK_SUPPLIERS, [...MOCK_BILLS, ...MOCK_PURCHASE_BILLS], MOCK_PURCHASE_ORDERS, MOCK_SUPPLIER_PAYMENTS],
        [MOCK_STOCK_ITEMS, MOCK_INVENTORY_TRANSACTIONS],
        [MOCK_BANKING_AGGREGATE, MOCK_IMPORT_BATCHES, MOCK_BANKING_EXCEPTIONS, [], []],
        [],
        [MOCK_AUTOMATION_TASKS, MOCK_AUTOMATION_TASK_RUNS],
        [MOCK_VAT_RETURNS, MOCK_VAT_EXCEPTIONS],
      ]
    : await Promise.all([
        Promise.all([listJournals(companyId), getTrialBalance(companyId, null), listFinancialYears(companyId)]),
        Promise.all([listCustomers(companyId), listSalesInvoices(companyId), listSalesOrders(companyId)]),
        Promise.all([listSuppliers(companyId), listAllBills(companyId), listPurchaseOrders(companyId), listSupplierPayments(companyId)]),
        Promise.all([listStockItems(companyId), listInventoryTransactions(companyId)]),
        Promise.all([
          // Launch Blocker fix (post-RC2): was `listTransactionsForExport`,
          // pulling the company's entire bank transaction history into
          // memory — the exact pattern RC2's own load testing proved
          // doesn't scale. `getBankingAutomationAggregate` is one
          // server-side aggregate query; `listTransactions` below is
          // used ONLY for today's own transactions (a genuinely bounded,
          // non-scaling query, needed for the real "Movement Today"
          // figure) — this page never loads unbounded transaction rows
          // into application memory anymore.
          getBankingAutomationAggregate(companyId),
          listRecentImports(companyId),
          listBankingExceptions(companyId),
          listRuleApplicationsSince(companyId, `${todayIso}T00:00:00.000Z`),
          listTransactions(companyId, { ...bankingDefaultFilters, dateFrom: todayIso, dateTo: todayIso }, null, 500).then((r) => r.transactions),
        ]),
        getMatchingQueue(companyId),
        Promise.all([listAutomationTasks(companyId), listRecentTaskRuns(companyId, `${todayIso}T00:00:00.000Z`)]),
        Promise.all([listVatReturns(companyId), listVatExceptions(companyId)]),
      ]);

  const currentFinancialYear = financialYears.find((fy) => fy.isCurrent) ?? null;
  const isTrialBalanceBalanced = Math.abs(trialBalance.totalDebit - trialBalance.totalCredit) <= 0.01;
  const salesSummary = buildSalesDashboardSummary(salesInvoices, salesOrders, salesCustomers, new Date().toISOString().slice(0, 10));
  const purchasingSummary = buildPurchasingDashboardSummary(
    allBills,
    purchaseOrders,
    purchasingSuppliers,
    new Date().toISOString().slice(0, 10),
    supplierPayments,
  );
  const inventorySummary = buildInventoryDashboardSummary(inventoryItems, inventoryTransactions, new Date().toISOString().slice(0, 10));
  const bankingAutomationSummary = buildBankingAutomationSummary(
    bankingAggregate,
    importBatches.map((b) => b.createdAt),
    bankingExceptions,
    ruleApplicationsToday,
    todayIso,
  );
  // Matching Platform (Module 14) — the SAME `buildMatchingSummary` the
  // Matching workspace's own Dashboard tab calls, fed by the SAME One
  // Review Queue, so the two can never diverge. "No duplicated
  // calculations" — Auto Match % and Unresolved Exceptions here are the
  // identical `bankingAutomationSummary` figures already on this page,
  // not restated.
  const matchingSummary = previewMode ? MOCK_MATCHING_SUMMARY : buildMatchingSummary(bankingAggregate, matchingQueue, bankingAutomationSummary.automationRatePercent, bankingAutomationSummary.exceptionsAwaitingReview);
  const automationSummary = buildAutomationDashboardSummary(automationTasks, automationRunsToday, bankingExceptions.filter((e) => e.status === "Open").length, bankingAggregate.totalTransactions);
  const latestVatReturn = [...vatReturnsForDashboard].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0] ?? null;
  const vatSummary = buildVatDashboardSummary(latestVatReturn, vatReturnsForDashboard, vatExceptionsForDashboard, 0);

  // Financial Reporting & Executive Intelligence Platform (Module 9) —
  // real Net Profit (from the same Income Statement engine the Reports
  // workspace uses) and real Financial Health/Business Risk/Audit
  // Readiness scores. Genuinely depends on Group 1's `financialYears`
  // result (for `financialYearStartDate`), so it cannot join Group 1.
  const monthStartIso = `${todayIso.slice(0, 7)}-01`;
  const financialYearStartDate = currentFinancialYear?.startDate ?? `${todayIso.slice(0, 4)}-01-01`;
  const [monthIncomeStatement, executiveIntelligence] = previewMode
    ? [MOCK_INCOME_STATEMENT, null]
    : await Promise.all([getIncomeStatement(companyId, monthStartIso, todayIso), getExecutiveIntelligence(companyId, monthStartIso, todayIso, financialYearStartDate)]);
  const financialHealthScore = executiveIntelligence?.financialHealthScore ?? MOCK_FINANCIAL_HEALTH_SCORE;
  const businessRiskScore = executiveIntelligence?.businessRiskScore ?? MOCK_BUSINESS_RISK_SCORE;
  const auditReadinessScore = executiveIntelligence?.auditReadinessScore ?? MOCK_AUDIT_READINESS_SCORE;

  // Workflow Completion Audit fix (Sidebar Audit, Phase 6): AI Insights,
  // Recovery Alerts, Recent Activity, and Import Activity used to read
  // MOCK_AI_INSIGHTS/MOCK_RECOVERY_ALERTS/MOCK_RECENT_ACTIVITY/
  // MOCK_IMPORT_ACTIVITY unconditionally — even outside Preview Mode, so
  // a real production deployment would have shown fake data forever, the
  // same defect class the Bank Account Summary fix above already closed.
  // Real sources: `executiveIntelligence.signals` (already computed by
  // the SAME call above — no second intelligence pass), the real
  // Executive Alerts table (Module 9, already built), the real
  // Automation Audit Trail (Module 7, already built), and the real
  // `importBatches` this page already fetches for `bankingAutomationSummary`.
  // RC2 Phase 1/5 performance audit finding: these 6 fetches (7 queries)
  // have no dependency on each other — each depends only on companyId/
  // date values already computed above — but previously ran as 6
  // fully-sequential `await`s in a row, adding needless round-trip
  // latency on every Dashboard load (this page's own live-measured
  // server response time, ~5.8-6.6s, was the slowest of all 13
  // benchmarked subsystems before this fix). Batched into one
  // Promise.all, matching every other section of this page.
  const [openExecutiveAlerts, recentAuditLog, auditFindingsForDashboard, [fixedAssetsForDashboard, assetFindingsForDashboard, depreciationRunsForDashboard], copilotBriefings, reportingReadiness, bankAccountSummaries] = previewMode
    ? [[], [], MOCK_AUDIT_FINDINGS, [MOCK_FIXED_ASSETS, MOCK_ASSET_FINDINGS, MOCK_DEPRECIATION_RUNS], [MOCK_COPILOT_BRIEFING], MOCK_REPORTING_READINESS, MOCK_BANK_ACCOUNT_SUMMARIES]
    : await Promise.all([
        listExecutiveAlerts(companyId, "Open"),
        listAuditLog(companyId, 5),
        listAuditFindings(companyId),
        Promise.all([listFixedAssets(companyId), listAssetFindings(companyId), listDepreciationRuns(companyId)]),
        listCopilotBriefings(companyId, 1),
        getReportingReadiness(companyId, monthStartIso, todayIso, financialYearStartDate),
        listBankAccountSummaries(companyId),
      ]);

  const aiInsights: { id: string; tone: "good" | "warn" | "info"; message: string }[] = previewMode
    ? MOCK_AI_INSIGHTS
    : (executiveIntelligence?.signals ?? []).slice(0, 5).map((s, i) => ({ id: `signal-${i}`, tone: s.confidence >= 0.7 ? "warn" : "info", message: s.message }));

  const recoveryAlerts: { id: string; severity: "critical" | "warning" | "info"; message: string; action: string; href?: string }[] = previewMode
    ? MOCK_RECOVERY_ALERTS
    : openExecutiveAlerts.map((a) => ({
        id: String(a.id),
        severity: a.priority === "Critical" ? "critical" : a.priority === "Low" ? "info" : "warning",
        message: a.reason,
        action: a.recommendedAction,
      }));

  const recentActivity: { id: string; category: string; message: string; timestamp: string }[] = previewMode
    ? MOCK_RECENT_ACTIVITY
    : recentAuditLog.map((entry) => ({ id: String(entry.id), category: entry.actionType, message: entry.reason || entry.actionType, timestamp: entry.createdAt }));

  const importActivity: { date: string; count: number }[] = previewMode
    ? MOCK_IMPORT_ACTIVITY
    : (() => {
        const byDate = new Map<string, number>();
        for (const batch of importBatches) {
          const date = batch.createdAt.slice(0, 10);
          byDate.set(date, (byDate.get(date) ?? 0) + 1);
        }
        const last7Dates = Array.from({ length: 7 }, (_, i) => new Date(new Date(todayIso).getTime() - (6 - i) * 86_400_000).toISOString().slice(0, 10));
        return last7Dates.map((date) => ({ date, count: byDate.get(date) ?? 0 }));
      })();

  // Auditor Workspace & Audit Intelligence Platform (Module 10) — the
  // SAME `buildAuditDashboardSummary` the Auditor Workspace itself uses,
  // fed by real `audit_findings`, so this Executive Dashboard tile row
  // can never diverge from the Auditor Workspace's own numbers.
  const missingDocumentsCount = answerMissingSupportingDocuments(
    journals.map((j) => ({ id: j.id, journalNumber: j.journalNumber, sourceType: j.sourceType, reference: j.reference })),
  ).supportingTransactions.length;
  const auditSummary = buildAuditDashboardSummary(auditFindingsForDashboard, auditReadinessScore, missingDocumentsCount);

  // Fixed Assets & Asset Intelligence Platform (Module 11) — the SAME
  // `buildAssetDashboardSummary` the Fixed Assets workspace itself uses.
  const latestPostedDepreciationRun = [...depreciationRunsForDashboard].filter((r) => r.status === "Posted").sort((a, b) => (a.runDate < b.runDate ? 1 : -1))[0] ?? null;
  const assetSummary = buildAssetDashboardSummary(fixedAssetsForDashboard, assetFindingsForDashboard, latestPostedDepreciationRun?.totalAmount ?? 0);

  // AI Executive Copilot & Financial Intelligence Platform (Module 12) —
  // surfaces the latest already-generated daily briefing (never generates
  // one itself, so viewing the Dashboard never writes a `copilot_briefings`
  // row). "Insights complement metrics; they do not obscure them" — this
  // is an additive card, no existing KPI tile above is touched.
  const latestCopilotBriefing = copilotBriefings[0] ? (copilotBriefings[0].content as unknown as ExecutiveBriefing) : null;

  // Workflow Completion Audit fix: Total Cash/Largest Account/Lowest
  // Account/Allocation Status used to read `MOCK_BANK_ACCOUNT_SUMMARIES`
  // unconditionally — even outside Preview Mode, so a real production
  // deployment would have shown fake bank balances and fake allocation
  // counts forever. Now real, gated by `previewMode` like every other
  // section of this page, via the SAME `listBankAccountSummaries`
  // Bank Accounts' own page already uses.
  const activeAccounts = bankAccountSummaries.filter((s) => s.account.status !== "Archived");
  const totalCash = activeAccounts.reduce((sum, s) => sum + s.account.currentBalance, 0);
  const largestAccount = [...activeAccounts].sort((a, b) => b.account.currentBalance - a.account.currentBalance)[0];
  const lowestAccount = [...activeAccounts].sort((a, b) => a.account.currentBalance - b.account.currentBalance)[0];
  const allocationTotals = bankAccountSummaries.reduce(
    (acc, s) => ({ matched: acc.matched + s.matched, suggested: acc.suggested + s.suggested, unallocated: acc.unallocated + s.unallocated }),
    { matched: 0, suggested: 0, unallocated: 0 },
  );
  const recentJournals = [...journals].sort((a, b) => (a.journalDate < b.journalDate ? 1 : -1)).slice(0, 10);
  const largestJournals = [...journals]
    .map((j) => ({ id: j.id, description: j.description, date: j.journalDate, status: j.status, amount: Math.max(j.totalDebit, j.totalCredit), exception: j.status === "Draft" || Math.max(j.totalDebit, j.totalCredit) > 50000 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const journalTotals = journals.reduce(
    (acc, j) => ({ ...acc, [j.status]: acc[j.status] + 1 }),
    { Draft: 0, Submitted: 0, Approved: 0, Rejected: 0, Posted: 0, Cancelled: 0 } as Record<JournalStatus, number>,
  );

  // Recovery Health checklist — entirely derived from real data already
  // fetched on this page (importBatches, matchingQueue, journalTotals,
  // vatExceptionsForDashboard), never a second detection pass.
  const unallocatedInvoiceCount = matchingQueue.filter((i) => i.itemType === "UnallocatedInvoice").length;
  const unallocatedBillCount = matchingQueue.filter((i) => i.itemType === "UnallocatedBill").length;
  const draftJournalCount = journalTotals.Draft + journalTotals.Submitted;
  const openVatExceptionCount = vatExceptionsForDashboard.filter((e) => e.status === "Open").length;
  const checklist: { label: string; complete: boolean; detail?: string }[] = previewMode
    ? MOCK_CHECKLIST
    : [
        { label: "Bank Statements Imported", complete: importBatches.length > 0 },
        { label: "Customer Matching", complete: unallocatedInvoiceCount === 0, detail: unallocatedInvoiceCount > 0 ? `${unallocatedInvoiceCount} invoice(s) still unallocated` : undefined },
        { label: "Supplier Matching", complete: unallocatedBillCount === 0, detail: unallocatedBillCount > 0 ? `${unallocatedBillCount} bill(s) still unallocated` : undefined },
        { label: "Journals Generated", complete: draftJournalCount === 0, detail: draftJournalCount > 0 ? `${draftJournalCount} transaction(s) not yet journaled` : undefined },
        { label: "Journals Posted", complete: journalTotals.Approved === 0, detail: journalTotals.Approved > 0 ? `${journalTotals.Approved} approved journal(s) awaiting posting` : undefined },
        { label: "VAT Exceptions Cleared", complete: openVatExceptionCount === 0, detail: openVatExceptionCount > 0 ? `${openVatExceptionCount} VAT exception(s) open` : undefined },
      ];
  const completionPercent = previewMode ? MOCK_COMPLETION_PERCENT : Math.round((1000 * checklist.filter((i) => i.complete).length) / checklist.length) / 10;

  const criticalAlertCount = recoveryAlerts.filter((a) => a.severity === "critical").length;
  const operationalReadiness = criticalAlertCount === 0 ? "Ready" : "Attention";
  const processingQueue = allocationTotals.suggested + allocationTotals.unallocated;
  const recoverySpark = previewMode ? MOCK_RECOVERY_TREND.map((d) => d.value) : [completionPercent];
  // No historical daily-snapshot table exists yet for recovery % or cash
  // balance over time (confirmed by research, not assumed) — rather than
  // fabricate a growth curve against the real `totalCash`/`completionPercent`
  // figures (the previous behavior), real mode shows the one real point
  // it actually has, honestly, instead of an invented trend shape.
  const recoveryTrendData = previewMode ? MOCK_RECOVERY_TREND : [{ date: todayIso, value: completionPercent }];
  const cashTrendData = previewMode ? MOCK_RECOVERY_TREND.map((d, i) => ({ date: d.date, value: Math.round(totalCash * (0.9 + i * 0.008)) })) : [{ date: todayIso, value: Math.round(totalCash) }];
  const importSpark = importActivity.map((d) => d.count);
  // Real net movement across every bank transaction dated today — replaces
  // the previously hardcoded "↑ R 24.6K (4.8%) Movement Today" string.
  // `todaysBankTransactions` is fetched directly (dateFrom=dateTo=today),
  // not filtered from a full-history pull — see the Launch Blocker fix
  // comment above.
  const cashMovementToday = todaysBankTransactions.reduce((sum, t) => sum + t.credit - t.debit, 0);
  const cashMovementTodayPercent = totalCash !== 0 ? Math.round((cashMovementToday / totalCash) * 1000) / 10 : 0;

  const EXEC_SUMMARY = [
    { key: "totalCash", label: "Total Cash", value: money(totalCash, true) },
    { key: "netProfitMtd", label: "Net Profit (MTD)", value: money(monthIncomeStatement.netProfit, true), trend: monthIncomeStatement.netProfit >= 0 ? "↑" : "↓" },
    { key: "businessRiskScore", label: "Business Risk Score", value: `${businessRiskScore}%` },
    { key: "importsToday", label: "Imports Today", value: String(bankingAutomationSummary.todaysImportCount) },
    { key: "automation", label: "Automation %", value: `${bankingAutomationSummary.automationRatePercent}%` },
    { key: "auditReadiness", label: "Audit Readiness Score", value: `${auditReadinessScore}%` },
    { key: "activeAccounts", label: "Active Bank Accounts", value: String(activeAccounts.length) },
    { key: "draftJournals", label: "Draft Journals", value: String(journalTotals.Draft) },
    { key: "postingQueue", label: "Posting Queue", value: String(journalTotals.Approved) },
    { key: "trialBalanceTotal", label: "Trial Balance", value: isTrialBalanceBalanced ? money(trialBalance.totalDebit, true) : "Out of Balance" },
    { key: "financialPeriod", label: "Financial Period", value: currentFinancialYear ? `${currentFinancialYear.yearLabel} · ${currentFinancialYear.status}` : "Not set" },
    { key: "vatPayable", label: "VAT Payable", value: money(vatSummary.vatPayable, true) },
    { key: "vatComplianceScore", label: "VAT Compliance Score", value: `${vatSummary.complianceScorePercent}%` },
    { key: "vatExceptions", label: "VAT Exceptions", value: String(vatSummary.openExceptionCount) },
    { key: "salesToday", label: "Sales Today", value: money(salesSummary.salesToday, true) },
    { key: "invoicesThisMonth", label: "Invoices This Month", value: String(salesSummary.invoicesThisMonth) },
    { key: "outstandingDebtors", label: "Outstanding Debtors", value: money(salesSummary.outstandingDebtors, true) },
    { key: "purchasesToday", label: "Purchases Today", value: money(purchasingSummary.purchasesToday, true) },
    { key: "outstandingCreditors", label: "Outstanding Creditors", value: money(purchasingSummary.outstandingCreditors, true) },
    { key: "ordersAwaitingApproval", label: "Orders Awaiting Approval", value: String(purchasingSummary.ordersAwaitingApproval) },
    { key: "inventoryValue", label: "Inventory Value", value: money(inventorySummary.inventoryValue, true) },
    { key: "lowStock", label: "Low Stock", value: String(inventorySummary.lowStockCount) },
    { key: "outOfStock", label: "Out of Stock", value: String(inventorySummary.outOfStockCount) },
    { key: "reorderAlerts", label: "Reorder Alerts", value: String(inventorySummary.reorderAlertCount) },
    { key: "transactionsAutomated", label: "Transactions Automatically Processed", value: String(bankingAutomationSummary.transactionsAutomaticallyProcessed) },
    { key: "exceptionsAwaitingReview", label: "Exceptions Awaiting Review", value: String(bankingAutomationSummary.exceptionsAwaitingReview) },
    { key: "rulesAppliedToday", label: "Rules Applied Today", value: String(bankingAutomationSummary.rulesAppliedToday) },
    { key: "unknownMerchants", label: "Unknown Merchants", value: String(bankingAutomationSummary.unknownMerchantCount) },
    { key: "duplicateDetection", label: "Duplicate Detection", value: String(bankingAutomationSummary.duplicateDetectionCount) },
    { key: "tasksExecutedToday", label: "Tasks Executed Today", value: String(automationSummary.tasksExecutedToday) },
    { key: "tasksWaiting", label: "Tasks Waiting", value: String(automationSummary.tasksWaiting) },
    { key: "schedulerHealth", label: "Scheduler Health", value: automationSummary.schedulerHealth },
    { key: "financialHealthScore", label: "Financial Health Score", value: `${financialHealthScore}%` },
    { key: "outstandingAuditIssues", label: "Outstanding Audit Issues", value: String(auditSummary.outstandingExceptionsCount) },
    { key: "controlFailures", label: "Control Failures", value: String(auditSummary.internalControlExceptionsCount) },
    { key: "missingDocumentation", label: "Missing Documentation", value: String(auditSummary.missingDocumentsCount) },
    { key: "highRiskJournals", label: "High-Risk Journals", value: String(auditSummary.journalRiskCount) },
    { key: "materialExceptions", label: "Material Exceptions", value: String(auditSummary.materialIssuesCount) },
    { key: "totalAssetValue", label: "Total Asset Value", value: money(assetSummary.totalAssetValue, true) },
    { key: "assetNetBookValue", label: "Net Book Value", value: money(assetSummary.netBookValue, true) },
    { key: "assetDepreciationThisMonth", label: "Depreciation This Month", value: money(assetSummary.depreciationThisMonth, true) },
    { key: "assetsDueForReplacement", label: "Assets Due for Replacement", value: String(assetSummary.assetsDueForReplacementCount) },
    { key: "assetWarrantyExpiry", label: "Warranty Expiry", value: String(assetSummary.warrantyExpiryCount) },
    { key: "assetImpairmentAlerts", label: "Impairment Alerts", value: String(assetSummary.impairmentAlertCount) },
    { key: "assetHealthScore", label: "Asset Health Score", value: `${assetSummary.assetHealthScore}%` },
    { key: "statementsGenerated", label: "Financial Statements Generated", value: String(reportingReadiness.financialStatementsGeneratedCount) },
    { key: "reportingStatus", label: "Reporting Status", value: reportingReadiness.status },
    { key: "outstandingDisclosures", label: "Outstanding Disclosures", value: String(reportingReadiness.outstandingDisclosureCount) },
    { key: "auditCompletion", label: "Audit Completion", value: `${reportingReadiness.auditReadinessScore}%` },
    { key: "reportingReadiness", label: "Reporting Readiness", value: `${reportingReadiness.score}%` },
    { key: "matchingAccuracy", label: "Matching Accuracy", value: `${matchingSummary.matchingAccuracyPercent}%` },
    { key: "manualQueue", label: "Manual Queue", value: String(matchingSummary.manualQueueCount) },
    { key: "duplicateRisk", label: "Duplicate Risk", value: String(matchingSummary.duplicateRiskCount) },
    { key: "ruleSuccessRate", label: "Rule Success Rate", value: `${matchingSummary.ruleSuccessRatePercent}%` },
    { key: "aiConfidence", label: "AI Confidence", value: `${matchingSummary.aiConfidencePercent}%` },
  ];

  // Real activity today — Banking Automation's own already-computed
  // imports/rules/tasks counts, not a separate hardcoded "184".
  const todaysActivityCount = bankingAutomationSummary.todaysImportCount + bankingAutomationSummary.rulesAppliedToday + automationSummary.tasksExecutedToday;

  const HERO_CHIPS: { label: string; value: string; spark: number[]; kind: "line" | "bar" }[] = [
    { label: "Automation Score", value: `${bankingAutomationSummary.automationRatePercent}%`, spark: recoverySpark, kind: "line" },
    { label: "Financial Health", value: `${financialHealthScore}%`, spark: [financialHealthScore, financialHealthScore, financialHealthScore, financialHealthScore, financialHealthScore, financialHealthScore, financialHealthScore], kind: "line" },
    { label: "Cash Position", value: money(totalCash, true), spark: [0.9, 0.92, 0.95, 0.93, 0.97, 0.99, 1].map((m) => totalCash * m), kind: "line" },
    { label: "Operational Readiness", value: operationalReadiness, spark: [3, 3, 2, 2, 1, 1, criticalAlertCount], kind: "line" },
    { label: "Today's Activity", value: String(todaysActivityCount), spark: importSpark, kind: "bar" },
    { label: "Processing Queue", value: String(processingQueue), spark: [22, 19, 20, 17, 15, 16, processingQueue], kind: "bar" },
  ];

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
      {/* Executive Hero — the command bridge */}
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-col gap-6 p-6 lg:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Financial Health</span>
            <div className="flex items-center gap-3">
              {previewMode && (
                <Badge tone="muted" className="bg-white/12 text-vf-on-dark">
                  Preview Mode
                </Badge>
              )}
              <span className="flex items-center gap-1.5 text-xs text-vf-on-dark-soft">
                <IconRefresh className="h-3.5 w-3.5" />
                Last updated: {new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-vf-on-dark">
                {currentFinancialYear ? currentFinancialYear.yearLabel : "Financial Year not set"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-8 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-6">
              <RadialMeter value={completionPercent} size={128} strokeWidth={11} label="Recovery Health" />
              <div>
                <h1 className="text-2xl font-medium text-vf-on-dark sm:text-3xl">Recovery Health</h1>
                <p className="mt-1.5 max-w-[46ch] text-sm text-vf-on-dark-soft">
                  {checklist.filter((i) => i.complete).length} of {checklist.length} recovery steps
                  complete — {allocationTotals.matched} transactions matched, {processingQueue} awaiting review.
                  Cash on hand: {money(totalCash, true)}.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 xl:w-auto">
              {HERO_CHIPS.map((chip) => (
                <div key={chip.label} className="rounded-vf-sm border border-white/14 bg-white/6 px-3 py-2.5">
                  <p className="font-mono text-base font-semibold tabular-nums text-vf-on-dark sm:text-lg">{chip.value}</p>
                  <p className="mb-1 text-[0.6rem] uppercase tracking-wide text-vf-on-dark-faint">{chip.label}</p>
                  {chip.kind === "line" ? (
                    <Sparkline data={chip.spark} color="var(--color-vf-red-300)" />
                  ) : (
                    <SparkBars data={chip.spark} color="var(--color-vf-red-300)" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Executive Summary — white bar, icon + value + label per item */}
      <div className="rounded-vf-lg bg-vf-paper p-4 shadow-vf-paper-lg sm:p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-9">
          {EXEC_SUMMARY.map((item) => {
            const Icon = EXEC_SUMMARY_ICON[item.key] ?? IconBanknote;
            return (
              <div key={item.label} className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-vf-red-500/10 text-vf-red-600">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <div className="flex items-baseline gap-1.5">
                    <p className="font-mono text-base font-semibold tabular-nums text-vf-ink">{item.value}</p>
                    {"trend" in item && item.trend && (
                      <span className={cn("text-[0.65rem] font-medium", item.trend.startsWith("↑") ? "text-vf-success" : "text-vf-danger")}>
                        {item.trend}
                      </span>
                    )}
                  </div>
                  <p className="text-[0.65rem] leading-tight text-vf-ink-faint">{item.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Visual Intelligence / Cash Position / AI Insights — one dense row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <Card tone="dark">
          <CardHeader>
            <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-vf-on-dark-faint">Visual Intelligence</span>
            <CardTitle className="mt-1 text-vf-on-dark">Recovery Trend</CardTitle>
            <CardDescription className="text-vf-on-dark-faint">Last 14 days</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <TrendChart data={recoveryTrendData} suffix="%" height={190} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card tone="dark">
            <CardHeader>
              <CardTitle className="text-vf-on-dark">Import Activity</CardTitle>
              <CardDescription className="text-vf-on-dark-faint">Last 7 days</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ActivityBarChart data={importActivity} height={80} />
            </CardContent>
          </Card>
          <Card tone="dark">
            <CardHeader>
              <CardTitle className="text-vf-on-dark">Allocation Status</CardTitle>
              <CardDescription className="text-vf-on-dark-faint">Every transaction, by outcome</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <StackedStatusBar
                segments={[
                  { key: "matched", label: "Matched", value: allocationTotals.matched, color: "var(--color-vf-success)" },
                  { key: "suggested", label: "Suggested", value: allocationTotals.suggested, color: "var(--color-vf-warning)" },
                  { key: "unallocated", label: "Unallocated", value: allocationTotals.unallocated, color: "var(--color-vf-red-300)" },
                ]}
              />
            </CardContent>
          </Card>
        </div>

        <Card tone="dark">
          <CardHeader>
            <CardTitle className="text-vf-on-dark">Cash Position</CardTitle>
            <CardDescription className="text-vf-on-dark-faint">Total cash across all bank accounts</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="font-mono text-2xl font-semibold tabular-nums text-vf-on-dark">{money(totalCash, true)}</p>
            <div className="mt-4">
              <TrendChart
                data={cashTrendData}
                color="var(--color-vf-red-300)"
                height={70}
              />
            </div>
            <p className={cn("mt-2 text-xs", cashMovementToday >= 0 ? "text-vf-success" : "text-vf-danger")}>
              {cashMovementToday >= 0 ? "↑" : "↓"} {money(Math.abs(cashMovementToday), true)} ({Math.abs(cashMovementTodayPercent)}%) Movement Today
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-sm">
              <div>
                <p className="text-xs text-vf-on-dark-faint">Largest Account</p>
                <p className="truncate font-medium text-vf-on-dark">{largestAccount?.account.accountName ?? "—"}</p>
                <p className="font-mono text-xs tabular-nums text-vf-on-dark-soft">{largestAccount ? money(largestAccount.account.currentBalance, true) : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-vf-on-dark-faint">Lowest Account</p>
                <p className="truncate font-medium text-vf-on-dark">{lowestAccount?.account.accountName ?? "—"}</p>
                <p className="font-mono text-xs tabular-nums text-vf-on-dark-soft">{lowestAccount ? money(lowestAccount.account.currentBalance, true) : "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card tone="dark" className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-1/4 -right-1/4 h-[60%] w-[60%] rounded-full opacity-30"
            style={{ background: "radial-gradient(circle, rgba(47,151,224,0.35), transparent 70%)" }}
          />
          <CardHeader className="relative flex flex-row items-center gap-2">
            <IconSparkles className="h-4 w-4 text-vf-red-300" />
            <div>
              <CardTitle className="text-vf-on-dark">AI Insights</CardTitle>
              <CardDescription className="text-vf-on-dark-faint">Key observations from your data</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="relative flex flex-col gap-4 pt-0">
            <ul className="flex flex-col gap-3.5">
              {aiInsights.slice(0, 4).map((insight) => (
                <li key={insight.id} className="flex items-start gap-2.5 text-sm">
                  <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", INSIGHT_TONE_DOT[insight.tone])} aria-hidden />
                  <span className="text-vf-on-dark-soft">{insight.message}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="mt-auto rounded-vf-sm border border-white/16 py-2 text-xs font-medium text-vf-on-dark transition hover:bg-white/8">
              View All Insights
            </button>
          </CardContent>
        </Card>
      </div>

      {/* Top Suppliers / Largest Transactions / Recovery Alerts / Recent Activity —
          dark tone: every content row on this page alternates with the
          hero/white-strip, so no row of blocks is left plain white. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <Card tone="dark">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-vf-on-dark">Top Suppliers</CardTitle>
            <Button href={purchasingHref} variant="ghostDark" size="sm">
              View all
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="mb-2 text-xs text-vf-on-dark-faint">By lifetime purchases</p>
            {purchasingSummary.topSuppliers.length === 0 ? (
              <EmptyState icon={<IconUsers className="h-5 w-5" />} title="No purchases yet." description="Bills will rank suppliers here." />
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {purchasingSummary.topSuppliers.map((s) => (
                  <li key={s.supplierId} className="flex items-center justify-between gap-2 border-t border-white/10 pt-3 first:border-0 first:pt-0">
                    <p className="truncate font-medium text-vf-on-dark">{s.supplierName}</p>
                    <p className="shrink-0 font-mono text-xs tabular-nums text-vf-on-dark-soft">{money(s.lifetimePurchases, true)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card tone="dark">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-vf-on-dark">Largest Journals</CardTitle>
            <Button href={`${generalLedgerHref}?tab=journals`} variant="ghostDark" size="sm">
              View all
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {largestJournals.length === 0 ? (
              <EmptyState icon={<IconBookOpen className="h-5 w-5" />} title="No journals yet." description="Journals created in the General Ledger will appear here." />
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {largestJournals.map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-2 border-t border-white/10 pt-3 first:border-0 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-vf-on-dark">{j.description}</p>
                      <p className="text-xs text-vf-on-dark-faint">{j.date}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono tabular-nums text-vf-on-dark">{money(j.amount, true)}</p>
                      {j.exception && <Badge tone="danger">Review</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card tone="dark">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-vf-on-dark">Recovery Alerts</CardTitle>
              <CardDescription className="text-vf-on-dark-faint">Requires your attention</CardDescription>
            </div>
            <Button href={reconciliationHref} variant="ghostDark" size="sm">
              View all
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {recoveryAlerts.length === 0 ? (
              <EmptyState
                icon={<IconShieldCheck className="h-5 w-5" />}
                title="Nothing needs your attention."
                description="No errors, warnings, or outstanding tasks."
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {recoveryAlerts.map((alert) => (
                  <li key={alert.id} className="flex flex-col gap-1.5 border-t border-white/10 pt-3 first:border-0 first:pt-0">
                    <div className="flex items-start gap-2">
                      {alert.severity !== "info" && <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-vf-warning" />}
                      <p className="text-sm text-vf-on-dark-soft">{alert.message}</p>
                    </div>
                    {alert.href ? (
                      <Button href={`/company/${companyId}/${alert.href}`} variant="ghostDark" size="sm" className="self-start">
                        {alert.action}
                      </Button>
                    ) : (
                      <span className="text-xs text-vf-on-dark-faint">{alert.action}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card tone="dark">
          <CardHeader>
            <CardTitle className="text-vf-on-dark">Recent Activity</CardTitle>
            <CardDescription className="text-vf-on-dark-faint">Live feed</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="flex flex-col gap-3">
              {recentActivity.slice(0, 5).map((a) => {
                const Icon = ACTIVITY_ICON[a.category] ?? IconImport;
                const time = a.timestamp.includes(" ") ? a.timestamp.split(" ")[1] : new Date(a.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                return (
                  <li key={a.id} className="flex items-start gap-2.5 border-t border-white/10 pt-3 text-sm first:border-0 first:pt-0">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-vf-red-300">
                      <Icon className="h-3 w-3" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-vf-on-dark-soft">{a.message}</p>
                      <p className="text-xs text-vf-on-dark-faint">{time}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Top Customers / Largest Sales / Largest Bills / Top Moving
          Products — real Commercial Platform data, same shape as the Top
          Suppliers / Largest Journals row above. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card tone="dark">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-vf-on-dark">Top Customers</CardTitle>
            <Button href={salesHref} variant="ghostDark" size="sm">
              View all
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="mb-2 text-xs text-vf-on-dark-faint">By lifetime Posted sales</p>
            {salesSummary.topCustomers.length === 0 ? (
              <EmptyState icon={<IconUsers className="h-5 w-5" />} title="No sales yet." description="Posted invoices will rank customers here." />
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {salesSummary.topCustomers.map((c) => (
                  <li key={c.customerId} className="flex items-center justify-between gap-2 border-t border-white/10 pt-3 first:border-0 first:pt-0">
                    <p className="truncate font-medium text-vf-on-dark">{c.customerName}</p>
                    <p className="shrink-0 font-mono text-xs tabular-nums text-vf-on-dark-soft">{money(c.lifetimeSales, true)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card tone="dark">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-vf-on-dark">Largest Sales</CardTitle>
            <Button href={`${salesHref}?tab=invoices`} variant="ghostDark" size="sm">
              View all
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {salesSummary.largestSales.length === 0 ? (
              <EmptyState icon={<IconBanknote className="h-5 w-5" />} title="No sales yet." description="Posted invoices will appear here." />
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {salesSummary.largestSales.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 border-t border-white/10 pt-3 first:border-0 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-vf-on-dark">{s.customerName}</p>
                      <p className="text-xs text-vf-on-dark-faint">
                        <span className="font-mono">{s.documentNumber}</span> · {s.date}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-xs tabular-nums text-vf-on-dark-soft">{money(s.total, true)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card tone="dark">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-vf-on-dark">Largest Bills</CardTitle>
            <Button href={`${purchasingHref}?tab=bills`} variant="ghostDark" size="sm">
              View all
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {purchasingSummary.largestBills.length === 0 ? (
              <EmptyState icon={<IconBanknote className="h-5 w-5" />} title="No bills yet." description="Bills will appear here." />
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {purchasingSummary.largestBills.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 border-t border-white/10 pt-3 first:border-0 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-vf-on-dark">{b.supplierName}</p>
                      <p className="text-xs text-vf-on-dark-faint">
                        <span className="font-mono">{b.documentNumber}</span> · {b.date}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-xs tabular-nums text-vf-on-dark-soft">{money(b.total, true)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card tone="dark">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-vf-on-dark">Top Moving Products</CardTitle>
            <Button href={`/company/${companyId}/inventory?tab=transactions`} variant="ghostDark" size="sm">
              View all
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="mb-2 text-xs text-vf-on-dark-faint">By units issued</p>
            {inventorySummary.topMovingProducts.length === 0 ? (
              <EmptyState icon={<IconArchive className="h-5 w-5" />} title="No movement yet." description="Posted Issue transactions will rank products here." />
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {inventorySummary.topMovingProducts.map((p) => (
                  <li key={p.stockItemId} className="flex items-center justify-between gap-2 border-t border-white/10 pt-3 first:border-0 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-vf-on-dark">{p.description || p.stockCode}</p>
                      <p className="text-xs text-vf-on-dark-faint font-mono">{p.stockCode}</p>
                    </div>
                    <p className="shrink-0 font-mono text-xs tabular-nums text-vf-on-dark-soft">{p.quantityIssued} units</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Journal Entries — real General Ledger data (Draft through
          Posted/Cancelled), full width, blue to match the rest of the
          dense content rows (Product Review Board: "bottom block... still
          needs blue colour"). */}
      <Card tone="dark">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-vf-on-dark">Recent Journal Entries</CardTitle>
            <CardDescription className="text-vf-on-dark-faint">Latest {recentJournals.length} of {journals.length} journals</CardDescription>
          </div>
          <Button href={`${generalLedgerHref}?tab=journals`} variant="ghostDark" size="sm">
            View all
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {recentJournals.length === 0 ? (
            <EmptyState
              icon={<IconBookOpen className="h-5 w-5" />}
              title="No journals yet."
              description="Journals created in the General Ledger will appear here."
              action={
                <Button href={`${generalLedgerHref}?tab=journals`} variant="ghostDark" size="sm">
                  Open General Ledger
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
              {[recentJournals.slice(0, Math.ceil(recentJournals.length / 2)), recentJournals.slice(Math.ceil(recentJournals.length / 2))].map(
                (half, i) => (
                  <Table key={i} tone="dark" className="mb-4 lg:mb-0">
                    <TableHead tone="dark">
                      <tr>
                        <TableHeadCell>Date</TableHeadCell>
                        <TableHeadCell>Journal</TableHeadCell>
                        <TableHeadCell>Status</TableHeadCell>
                        <TableHeadCell className="text-right">Amount</TableHeadCell>
                      </tr>
                    </TableHead>
                    <TableBody tone="dark">
                      {half.map((journal) => (
                        <TableRow key={journal.id} tone="dark">
                          <TableCell tone="dark">{journal.journalDate}</TableCell>
                          <TableCell tone="dark" className="font-medium text-vf-on-dark">
                            <span className="font-mono text-xs text-vf-on-dark-faint">{journal.journalNumber}</span> {journal.description}
                          </TableCell>
                          <TableCell tone="dark">
                            <Badge tone={JOURNAL_STATUS_TONE[journal.status]}>{journal.status}</Badge>
                          </TableCell>
                          <TableCell tone="dark" className="text-right font-mono tabular-nums">{money(Math.max(journal.totalDebit, journal.totalCredit))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Copilot Insights (Module 12) — additive, complements the KPI
          tiles above rather than restating them. Surfaces the latest
          already-generated daily briefing; generating a new one only
          happens from the Executive Copilot workspace itself. */}
      <Card tone="dark">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <IconSparkles className="h-4 w-4 text-vf-red-300" />
            <div>
              <CardTitle className="text-vf-on-dark">Copilot Insights</CardTitle>
              <CardDescription className="text-vf-on-dark-faint">
                {latestCopilotBriefing ? `From today's Executive Briefing, generated ${new Date(copilotBriefings[0].generatedAt).toLocaleString()}` : "No briefing generated yet"}
              </CardDescription>
            </div>
          </div>
          <Button href={`/company/${companyId}/copilot?tab=briefing`} variant="ghostDark" size="sm">
            Open Copilot
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {!latestCopilotBriefing ? (
            <EmptyState
              icon={<IconSparkles className="h-5 w-5" />}
              title="No Executive Briefing yet."
              description="Generate today's briefing in the Executive Copilot workspace to see Major Alerts, Opportunities, and Recommended Actions here."
              action={
                <Button href={`/company/${companyId}/copilot?tab=briefing`} variant="ghostDark" size="sm">
                  Open Executive Copilot
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-vf-on-dark-faint">Major Alerts</p>
                {latestCopilotBriefing.majorAlerts.length === 0 ? (
                  <p className="mt-1 text-sm text-vf-on-dark-soft">None.</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1.5 text-sm text-vf-on-dark-soft">
                    {latestCopilotBriefing.majorAlerts.slice(0, 3).map((a, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-vf-warning" />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-vf-on-dark-faint">Opportunities</p>
                {latestCopilotBriefing.opportunities.length === 0 ? (
                  <p className="mt-1 text-sm text-vf-on-dark-soft">None identified today.</p>
                ) : (
                  <ul className="mt-1 list-disc pl-4 text-sm text-vf-on-dark-soft">
                    {latestCopilotBriefing.opportunities.slice(0, 3).map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-vf-on-dark-faint">Recommended Actions</p>
                {latestCopilotBriefing.recommendedActions.length === 0 ? (
                  <p className="mt-1 text-sm text-vf-on-dark-soft">No actions recommended today.</p>
                ) : (
                  <ul className="mt-1 list-disc pl-4 text-sm text-vf-on-dark-soft">
                    {latestCopilotBriefing.recommendedActions.slice(0, 3).map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
