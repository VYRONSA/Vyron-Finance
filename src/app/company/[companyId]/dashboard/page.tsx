import type { Metadata } from "next";
import type { ComponentType } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconBookOpen,
  IconHelpCircle,
  IconReconcile,
  IconShieldCheck,
  IconSparkles,
} from "@/components/ui/icons";
import {
  PIconArrowRight,
  PIconBars,
  PIconBill,
  PIconBuildingColumns,
  PIconCart,
  PIconCheckCircle,
  PIconChevronRight,
  PIconDatabase,
  PIconInvoice,
  PIconPie,
  PIconSparkles,
  PIconUpload,
  PIconWallet,
} from "@/components/ui/precisia-icons";
import {
  MOCK_CHECKLIST,
  MOCK_COMPLETION_PERCENT,
  MOCK_RECENT_ACTIVITY,
} from "@/lib/mock/financial-data";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";
import { MOCK_BILLS, MOCK_SUPPLIERS } from "@/lib/mock/supplier-reconciliation-data";
import { MOCK_JOURNALS } from "@/lib/mock/general-ledger-data";
import { MOCK_FINANCIAL_YEARS } from "@/lib/mock/company-management-data";
import { MOCK_CUSTOMERS } from "@/lib/mock/customer-management-data";
import { MOCK_SALES_INVOICES, MOCK_SALES_ORDERS } from "@/lib/mock/sales-data";
import { MOCK_PURCHASE_BILLS, MOCK_PURCHASE_ORDERS, MOCK_SUPPLIER_PAYMENTS } from "@/lib/mock/purchasing-data";
import { MOCK_STOCK_ITEMS } from "@/lib/mock/inventory-data";
import { MOCK_IMPORT_BATCHES } from "@/lib/mock/import-centre-data";
import { MOCK_BANKING_EXCEPTIONS } from "@/lib/mock/banking-automation-data";
import { MOCK_VAT_EXCEPTIONS, MOCK_VAT_RETURNS } from "@/lib/mock/vat-data";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCurrentUserEmail } from "@/server/auth/require-session";
import { listJournals } from "@/server/services/journal-workflow-service";
import { listBankAccountSummaries } from "@/server/services/bank-account-service";
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
import { getSummary as getTransactionExplorerSummary } from "@/server/services/transaction-explorer-service";
import { listRecentImports } from "@/server/services/import-service";
import { listOpeningBalanceEntries } from "@/server/services/opening-balance-service";
import { listBankingExceptions } from "@/server/services/banking-exception-service";
import { listVatReturns } from "@/server/services/vat-return-service";
import { listVatExceptions } from "@/server/services/vat-exception-service";
import { buildVatDashboardSummary } from "@/server/services/vat-summary-service";
import { dayBefore, identifyCashAccountIds } from "@/server/services/financial-statements-service";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { getTrialBalance } from "@/server/services/trial-balance-service";
import { buildIncomeStatement } from "@/server/reporting/income-statement-engine";
import { listExecutiveAlerts } from "@/server/services/executive-alert-service";
import { listAuditLog } from "@/server/services/automation-audit-service";
import { listAuditFindings } from "@/server/services/audit-finding-service";
import { listAssetFindings } from "@/server/services/asset-intelligence-service";
import { getMatchingQueue } from "@/server/services/matching-queue-service";
import { computeAgingBuckets } from "@/server/shared/aging";
import { buildFinancialIntelligenceSummary } from "@/server/financial-intelligence/financial-intelligence-engine";
import { FINDING_SEVERITY_LABEL, type FindingSeverity } from "@/server/financial-intelligence/types";
import { MOCK_TRANSACTION_SUMMARY } from "@/lib/mock/transaction-explorer-data";
import { ACCOUNTS as MOCK_REPORTING_ACCOUNTS, PERIOD_END as MOCK_REPORTING_PERIOD_END, trialBalanceRowsAsOf } from "@/lib/mock/financial-reporting-data";
import { MOCK_AUDIT_FINDINGS } from "@/lib/mock/audit-data";
import { MOCK_ASSET_FINDINGS } from "@/lib/mock/asset-data";
import type { JournalStatus } from "@/server/accounting/types";
import { formatAmount, formatLongDate } from "@/lib/format";
import { RefPiece } from "@/components/ui/ref-piece";
import { AccountOverviewChart, KpiSparkline, type AccountOverviewPoint } from "@/components/financial/dashboard/account-overview-chart";

export const metadata: Metadata = {
  title: "Dashboard — PRECISIA",
};

const SEVERITY_TONE: Record<FindingSeverity, { chip: string; icon: "alert" | "info" }> = {
  Critical: { chip: "bg-[#3a0f1c] text-[#ff5a64]", icon: "alert" },
  High: { chip: "bg-[#3a0f1c] text-[#ff5a64]", icon: "alert" },
  Medium: { chip: "bg-[#3a2508] text-[#f5a524]", icon: "alert" },
  Low: { chip: "bg-[#0c2350] text-[#5cb3ff]", icon: "info" },
};
const ACTIVITY_ICON: Record<string, ComponentType<{ className?: string }>> = {
  Import: PIconBuildingColumns,
  Matching: IconReconcile,
  "Merchant Rules": IconSparkles,
  Journals: IconBookOpen,
  Users: IconShieldCheck,
  Recovery: IconAlertTriangle,
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-01" shifted by `delta` months → another "YYYY-MM-01". */
function shiftMonthStart(monthStartIso: string, delta: number): string {
  const year = Number(monthStartIso.slice(0, 4));
  const month = Number(monthStartIso.slice(5, 7)) - 1 + delta;
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function formatMonthShort(isoDate: string): string {
  return MONTH_SHORT[Number(isoDate.slice(5, 7)) - 1] ?? isoDate.slice(0, 7);
}

/** "R 29.9K" — for the short context line under a KPI figure. */
function compactRand(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

/** Whole rands, as the reference's KPI cards show them: "R 2,480,560". */
function wholeRand(value: number): string {
  return `R ${formatAmount(Math.round(value), 0)}`;
}

function activityTimeAgo(timestamp: string, now: Date): string {
  const at = Date.parse(timestamp.includes("T") ? timestamp : timestamp.replace(" ", "T"));
  if (Number.isNaN(at)) return timestamp;
  const minutes = Math.max(0, Math.floor((now.getTime() - at) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function greetingForHour(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function friendlyFirstName(email: string | null | undefined): string {
  if (!email) return "there";
  const local = email.split("@")[0] ?? "";
  const first = local.split(/[._-]/)[0] ?? local;
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "there";
}

export default async function DashboardPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();
  const salesHref = `/company/${companyId}/sales`;
  const purchasingHref = `/company/${companyId}/purchasing`;
  const todayIso = new Date().toISOString().slice(0, 10);

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
  //
  // Phase 6 — `currentUserEmail` joins this exact group (the same
  // session accessor used elsewhere for a personalised greeting; zero
  // dependency on anything else here). PRECISIA rebrand: the hero no
  // longer repeats the company's name/industry/registration (the shell
  // header already names the company, as in the reference), so the
  // duplicate `getCompany` lookup this group used to carry was dropped.
  const [
    [journals, financialYears, currentUserEmail],
    [salesCustomers, salesInvoices, salesOrders],
    [purchasingSuppliers, allBills, purchaseOrders, supplierPayments],
    [inventoryItems],
    [importBatches, bankingExceptions],
    { items: matchingQueue },
    [vatReturnsForDashboard, vatExceptionsForDashboard],
  ] = previewMode
    ? [
        [MOCK_JOURNALS, MOCK_FINANCIAL_YEARS, "preview@precisia.app"],
        [MOCK_CUSTOMERS, MOCK_SALES_INVOICES, MOCK_SALES_ORDERS],
        [MOCK_SUPPLIERS, [...MOCK_BILLS, ...MOCK_PURCHASE_BILLS], MOCK_PURCHASE_ORDERS, MOCK_SUPPLIER_PAYMENTS],
        [MOCK_STOCK_ITEMS],
        [MOCK_IMPORT_BATCHES, MOCK_BANKING_EXCEPTIONS],
        { items: [] },
        [MOCK_VAT_RETURNS, MOCK_VAT_EXCEPTIONS],
      ]
    : await Promise.all([
        Promise.all([listJournals(companyId), listFinancialYears(companyId), getCurrentUserEmail()]),
        Promise.all([listCustomers(companyId), listSalesInvoices(companyId), listSalesOrders(companyId)]),
        Promise.all([listSuppliers(companyId), listAllBills(companyId), listPurchaseOrders(companyId), listSupplierPayments(companyId)]),
        Promise.all([listStockItems(companyId)]),
        Promise.all([listRecentImports(companyId), listBankingExceptions(companyId)]),
        getMatchingQueue(companyId),
        Promise.all([listVatReturns(companyId), listVatExceptions(companyId)]),
      ]);

  const currentFinancialYear = financialYears.find((fy) => fy.isCurrent) ?? null;
  const salesSummary = buildSalesDashboardSummary(salesInvoices, salesOrders, salesCustomers, new Date().toISOString().slice(0, 10));
  const purchasingSummary = buildPurchasingDashboardSummary(
    allBills,
    purchaseOrders,
    purchasingSuppliers,
    new Date().toISOString().slice(0, 10),
    supplierPayments,
  );

  // Finding #017 (RC-16/E12) — no aging breakdown existed anywhere on
  // the Dashboard, only the single "Outstanding Debtors"/"Outstanding
  // Creditors" totals above. `computeAgingBuckets` (src/server/shared/aging.ts)
  // already does this exact bucketing for Customer/Supplier Management;
  // reused here against the same `salesInvoices`/`allBills` this page
  // already loads for those totals, not a second data source.
  const debtorsAging = computeAgingBuckets(
    salesInvoices.filter((i) => i.documentType !== "Credit Note").map((i) => ({ outstanding: i.outstanding, dueDate: i.dueDate })),
    todayIso,
  );
  const creditorsAging = computeAgingBuckets(
    allBills.filter((b) => b.documentType !== "Credit Note").map((b) => ({ outstanding: b.outstanding, dueDate: b.dueDate })),
    todayIso,
  );
  const latestVatReturn = [...vatReturnsForDashboard].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0] ?? null;
  const vatSummary = buildVatDashboardSummary(latestVatReturn, vatReturnsForDashboard, vatExceptionsForDashboard, 0);

  // Financial Reporting & Executive Intelligence Platform (Module 9) —
  // real Net Profit (from the same Income Statement engine the Reports
  // workspace uses) and real Financial Health/Business Risk/Audit
  // Readiness scores. Genuinely depends on Group 1's `financialYears`
  // result (for `financialYearStartDate`), so it cannot join Group 1.
  //
  // PRECISIA rebrand — "Account Overview" (the reference's six-month
  // Income/Expenses/Profit chart) needs one Income Statement per month.
  // Same two-Trial-Balance-snapshot technique `getIncomeStatement` uses
  // (financial-statements-service.ts), with the snapshots shared between
  // adjacent months: 7 point-in-time Trial Balances cover all 6 months.
  // The final month (month-start → today) is exactly the statement this
  // page previously fetched on its own as `monthIncomeStatement`, so that
  // separate fetch is retired and the whole series joins the batched
  // group below — no extra await barrier. Preview Mode anchors the
  // series on the mock reporting period so the chart has mock data.
  const seriesEndIso = previewMode ? MOCK_REPORTING_PERIOD_END : todayIso;
  const seriesMonthStarts = Array.from({ length: 6 }, (_, i) => shiftMonthStart(`${seriesEndIso.slice(0, 7)}-01`, i - 5));
  const seriesBoundaries = [...seriesMonthStarts.map((start) => dayBefore(start)), seriesEndIso];
  // Workflow Completion Audit fix (Sidebar Audit, Phase 6): Recent
  // Activity used to read MOCK_RECENT_ACTIVITY unconditionally — even
  // outside Preview Mode, so a real production deployment would have
  // shown fake data forever, the same defect class the Bank Account
  // Summary fix above already closed. Real source: the real Automation
  // Audit Trail (Module 7, already built).
  // RC2 Phase 1/5 performance audit finding: these 6 fetches (7 queries)
  // have no dependency on each other — each depends only on companyId/
  // date values already computed above — but previously ran as 6
  // fully-sequential `await`s in a row, adding needless round-trip
  // latency on every Dashboard load (this page's own live-measured
  // server response time, ~5.8-6.6s, was the slowest of all 13
  // benchmarked subsystems before this fix). Batched into one
  // Promise.all, matching every other section of this page.
  // Phase 10 — Financial Intelligence Engine. `openingBalanceEntries`
  // and `transactionExplorerSummary` join this exact group: neither
  // depends on anything computed above beyond `companyId`, and both are
  // the SAME existing service calls Opening Balances' own page and
  // Transaction Intelligence's own header already use — no new query
  // shape, just one more independent call in an already-batched group.
  const [
    openExecutiveAlerts,
    recentAuditLog,
    auditFindingsForDashboard,
    assetFindingsForDashboard,
    bankAccountSummaries,
    openingBalanceEntries,
    transactionExplorerSummary,
    [seriesAccounts, seriesBalances],
  ] = previewMode
    ? [
        [],
        [],
        MOCK_AUDIT_FINDINGS,
        MOCK_ASSET_FINDINGS,
        MOCK_BANK_ACCOUNT_SUMMARIES,
        [],
        MOCK_TRANSACTION_SUMMARY,
        [MOCK_REPORTING_ACCOUNTS, seriesBoundaries.map((d) => trialBalanceRowsAsOf(d))] as const,
      ]
    : await Promise.all([
        listExecutiveAlerts(companyId, "Open"),
        listAuditLog(companyId, 5),
        listAuditFindings(companyId),
        listAssetFindings(companyId),
        listBankAccountSummaries(companyId),
        listOpeningBalanceEntries(companyId),
        getTransactionExplorerSummary(companyId),
        Promise.all([listChartOfAccounts(companyId), Promise.all(seriesBoundaries.map((d) => getTrialBalance(companyId, d).then((tb) => tb.rows)))]),
      ]);

  const monthlyStatements = seriesMonthStarts.map((start, i) =>
    buildIncomeStatement(seriesAccounts, seriesBalances[i], seriesBalances[i + 1], start, i < seriesMonthStarts.length - 1 ? dayBefore(seriesMonthStarts[i + 1]) : seriesEndIso),
  );
  const monthIncomeStatement = monthlyStatements[monthlyStatements.length - 1];
  const previousMonthProfit = monthlyStatements[monthlyStatements.length - 2]?.netProfit ?? null;
  const accountOverview: AccountOverviewPoint[] = monthlyStatements.map((st, i) => ({
    label: formatMonthShort(seriesMonthStarts[i]),
    income: st.revenue.total + st.otherIncome.total,
    expenses: st.costOfSales.total + st.operatingExpenses.total + st.otherExpense.total,
    profit: st.netProfit,
  }));
  // GL cash trend for the Cash at Bank sparkline — bank/cash asset
  // accounts (the same `identifyCashAccountIds` rule the Cash Flow
  // Statement uses) at each of the same 7 snapshot dates. Trend only;
  // the card's figure stays the live bank-account balance below.
  const cashAccountIds = new Set(identifyCashAccountIds(seriesAccounts));
  const glCashTrend = seriesBalances.map((rows) => rows.filter((r) => cashAccountIds.has(r.accountId)).reduce((sum, r) => sum + r.totalDebit - r.totalCredit, 0));

  const recentActivity: { id: string; category: string; message: string; timestamp: string }[] = previewMode
    ? MOCK_RECENT_ACTIVITY
    : recentAuditLog.map((entry) => ({ id: String(entry.id), category: entry.actionType, message: entry.reason || entry.actionType, timestamp: entry.createdAt }));


  // Workflow Completion Audit fix: Total Cash/Allocation Status used to
  // read `MOCK_BANK_ACCOUNT_SUMMARIES` unconditionally — even outside
  // Preview Mode, so a real production deployment would have shown fake
  // bank balances and fake allocation counts forever. Now real, gated by
  // `previewMode` like every other section of this page, via the SAME
  // `listBankAccountSummaries` Bank Accounts' own page already uses.
  const activeAccounts = bankAccountSummaries.filter((s) => s.account.status !== "Archived");
  const totalCash = activeAccounts.reduce((sum, s) => sum + s.account.currentBalance, 0);
  const allocationTotals = bankAccountSummaries.reduce(
    (acc, s) => ({ matched: acc.matched + s.matched, suggested: acc.suggested + s.suggested, unallocated: acc.unallocated + s.unallocated }),
    { matched: 0, suggested: 0, unallocated: 0 },
  );

  // Phase 10 — VYRON Intelligence. Pure — every input below is a real
  // value already fetched/computed on this page (see
  // `company-intelligence-service.ts` for the standalone fetch path
  // future consumers like an AI Bookkeeper would use; this page already
  // has almost everything on hand, so it calls the same pure engine
  // directly rather than re-fetching through that service). Same
  // "account needing reconciliation" rule Banking's own Command Centre
  // page uses (never reconciled, or over 30 days since the last one).
  const accountsNeedingReconciliation = activeAccounts.filter((s) => {
    const days = s.account.lastReconciliationDate ? Math.floor((new Date(todayIso).getTime() - new Date(s.account.lastReconciliationDate).getTime()) / 86_400_000) : null;
    return days === null || days > 30;
  }).length;
  // Phase 13 — `totalCash`/`monthIncomeStatement.netProfit`/
  // `assetFindingsForDashboard`/`auditFindingsForDashboard` are ALL
  // already fetched/computed above for this page's own KPI tiles and
  // Asset/Audit summaries — passing them costs zero new queries.
  // `financialIntelligenceReport`/`hasChartOfAccounts` are deliberately
  // NOT passed here (they'd need genuinely new fetches this page
  // doesn't otherwise need) — omitted rather than fetched just for
  // this, so those two rules simply produce no findings on this page;
  // the Intelligence Centre (via `company-intelligence-service.ts`)
  // still surfaces them company-wide.
  const financialIntelligence = buildFinancialIntelligenceSummary({
    companyId,
    hasBankAccount: activeAccounts.length > 0,
    hasBankTransactionsImported: importBatches.some((b) => b.importType === "bank_transactions"),
    hasOpeningBalanceEntries: openingBalanceEntries.length > 0,
    hasCustomers: salesCustomers.length > 0,
    hasSuppliers: purchasingSuppliers.length > 0,
    hasFinancialYearConfigured: currentFinancialYear !== null,
    openExceptions: bankingExceptions.filter((e) => e.status === "Open"),
    accountsNeedingReconciliation,
    awaitingReviewCount: transactionExplorerSummary.awaitingReview,
    unallocatedCount: transactionExplorerSummary.unmatched,
    debtorsAging,
    creditorsAging,
    vatSummary,
    openExecutiveAlerts,
    totalCash,
    netProfit: monthIncomeStatement.netProfit,
    openAssetFindings: assetFindingsForDashboard.filter((f) => f.status === "Open"),
    openAuditFindings: auditFindingsForDashboard.filter((f) => f.status === "Open"),
  });

  const journalTotals = journals.reduce(
    (acc, j) => ({ ...acc, [j.status]: acc[j.status] + 1 }),
    { Draft: 0, Submitted: 0, Approved: 0, Rejected: 0, Posted: 0, Cancelled: 0 } as Record<JournalStatus, number>,
  );

  // Recovery Health checklist — entirely derived from real data already
  // fetched on this page (importBatches, matchingQueue, journalTotals,
  // vatExceptionsForDashboard), never a second detection pass.
  //
  // Master Implementation Tracker — Epic E12, RC-14, Finding #214: this
  // was flagged as an "onboarding" checklist, but it tracks per-period
  // processing completeness for an ongoing company (statements imported,
  // matching cleared, journals posted, VAT exceptions cleared) — it
  // recurs every period and stays relevant indefinitely, unlike a
  // first-run/onboarding checklist that would be dismissed once and
  // never shown again. Finding's premise was false for this artifact —
  // tracker corrected, no code change warranted here.
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


  // Phase 6 — Executive Company Dashboard. Everything below this comment
  // is presentation only, built entirely from the real values computed
  // above. Nothing here fetches anything new.
  //
  // PRECISIA rebrand — laid out to the approved "Precisia Software Page"
  // reference: greeting hero with the five start-of-session actions, five
  // KPI cards, then PRECISIA Intelligence | Business Setup Progress +
  // Account Overview | Recent Activity + PRECISIA Ask.

  const now = new Date();
  const greeting = greetingForHour(now.getHours());
  const firstName = friendlyFirstName(currentUserEmail);

  // Executive KPI Cards — Phase 26G's five genuinely distinct tiles,
  // relabelled to the reference's wording. The line under each figure is
  // real context (never a fabricated "% vs last month"); sparklines are
  // drawn only where a real series exists (GL cash, monthly profit).
  const EXECUTIVE_KPIS: {
    label: string;
    value: string;
    caption: string;
    captionTone: "up" | "down" | "neutral";
    icon: ComponentType<{ className?: string }>;
    trend?: number[];
    trendColor?: string;
  }[] = [
    { label: "Cash at Bank", value: wholeRand(totalCash), caption: `${activeAccounts.length} active account${activeAccounts.length === 1 ? "" : "s"}`, captionTone: "neutral", icon: PIconWallet, trend: glCashTrend, trendColor: "#27d17f" },
    { label: "Outstanding Customers", value: wholeRand(salesSummary.outstandingDebtors), caption: `${salesCustomers.length} customer${salesCustomers.length === 1 ? "" : "s"}`, captionTone: "neutral", icon: PIconInvoice },
    { label: "Outstanding Suppliers", value: wholeRand(purchasingSummary.outstandingCreditors), caption: `${purchasingSuppliers.length} supplier${purchasingSuppliers.length === 1 ? "" : "s"}`, captionTone: "neutral", icon: PIconCart },
    {
      label: "Profit This Month",
      value: wholeRand(monthIncomeStatement.netProfit),
      caption: previousMonthProfit === null ? (monthIncomeStatement.netProfit >= 0 ? "Profit" : "Loss") : `Last month ${compactRand(previousMonthProfit)}`,
      captionTone: monthIncomeStatement.netProfit >= 0 ? "up" : "down",
      icon: PIconBars,
      trend: accountOverview.map((p) => p.profit),
      trendColor: monthIncomeStatement.netProfit >= 0 ? "#27d17f" : "#f0474f",
    },
    { label: "VAT Liability", value: wholeRand(vatSummary.vatPayable), caption: `${vatSummary.openExceptionCount} exception${vatSummary.openExceptionCount === 1 ? "" : "s"}`, captionTone: "neutral", icon: PIconPie },
  ];

  // Business Setup Progress — the 10 steps the brief names. Anything
  // this page has real evidence for is marked complete on that evidence
  // alone. Listed row-major, which lays out in the reference's two
  // columns exactly.
  const SETUP_STEPS: { label: string; complete: boolean }[] = [
    { label: "Company Created", complete: true },
    { label: "Accounting Configured", complete: currentFinancialYear !== null },
    { label: "Opening Balances", complete: openingBalanceEntries.length > 0 },
    { label: "Bank Connected", complete: activeAccounts.length > 0 },
    { label: "Customers", complete: salesCustomers.length > 0 },
    { label: "Suppliers", complete: purchasingSuppliers.length > 0 },
    { label: "Products", complete: inventoryItems.length > 0 },
    { label: "First Bank Import", complete: importBatches.length > 0 },
    { label: "First Reconciliation", complete: allocationTotals.matched > 0 },
    { label: "Month End Ready", complete: completionPercent >= 100 },
  ];
  const setupStepsComplete = SETUP_STEPS.filter((s) => s.complete).length;
  const setupPercent = Math.round((setupStepsComplete / SETUP_STEPS.length) * 100);
  const findings = financialIntelligence.findings;

  const HERO_ACTIONS: { label: string; href: string; icon: ComponentType<{ className?: string }>; primary?: boolean }[] = [
    { label: "Import Bank Statement", href: `/company/${companyId}/import-centre`, icon: PIconUpload, primary: true },
    { label: "Create Invoice", href: `${salesHref}?tab=invoices`, icon: PIconInvoice },
    { label: "Create Supplier Bill", href: `${purchasingHref}?tab=bills`, icon: PIconBill },
    { label: "Opening Balances", href: `/company/${companyId}/opening-balances`, icon: PIconDatabase },
    { label: "AI Assistant", href: `/company/${companyId}/copilot`, icon: PIconSparkles },
  ];

  return (
    <div className="flex w-full flex-col gap-4 font-sans text-white">
      {/* Greeting hero */}
      <section className="pc-panel pc-panel-glow relative overflow-hidden rounded-[16px] bg-[#000e1e] lg:min-h-[192px]">
        {/* The reference's mountain-sunrise photograph with its "Clarity
            Creates Opportunity" lettering — the "Precisia Software Page"
            reference's own pixels, measured from the panel's right edge.
            Split around the greeting and action buttons, which are real
            here. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
          <RefPiece name="dashboard-hero-a" right={769} top={0} w={218} h={87} fade={[{ edge: "left", size: 90 }, { edge: "bottom", size: 22 }]} />
          <RefPiece name="dashboard-hero-b" right={619} top={0} w={150} h={125} fade={[{ edge: "bottom", size: 18 }]} />
          <RefPiece name="dashboard-hero-c" right={0} top={0} w={619} h={192} />
        </div>
        <div className="relative px-6 pt-3 pb-[19px]">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[0.78rem] leading-4 font-semibold tracking-[0.08em] text-[#9cc9f5] uppercase">{formatLongDate(now)}</p>
            {previewMode && <span className="rounded-full bg-white/10 px-2.5 text-[0.7rem] leading-4 font-medium text-[#dbe4f1]">Preview Mode</span>}
          </div>
          <h1 className="pc-heading text-[2rem] leading-tight font-bold text-white sm:text-[2.6rem]">
            {greeting}, <span className="text-[#1d7dff]">{firstName}.</span>
          </h1>
          <p className="mt-2 max-w-[760px] text-[1.02rem] text-[#dbe4f1]">
            Your financial intelligence platform is ready — real data, clearer insights, stronger decisions.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {HERO_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.label}
                  href={action.href}
                  className={cn("pc-btn h-11 px-5 text-[0.82rem] font-medium", action.primary ? "pc-btn-primary" : "pc-btn-outline")}
                >
                  <Icon className="h-4.5 w-4.5" />
                  {action.label}
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Executive KPI cards */}
      <section>
        <h2 className="sr-only">Executive KPIs</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {EXECUTIVE_KPIS.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div key={kpi.label} className="pc-panel flex items-center gap-3.5 rounded-[14px] py-3 pr-3 pl-3">
                <span className="pc-icon-tile h-12 w-12 shrink-0">
                  <Icon className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8rem] text-[#dbe4f1]">{kpi.label}</p>
                  <p className="mt-0.5 text-[1.3rem] leading-tight font-bold tracking-[-0.02em] whitespace-nowrap tabular-nums text-white">{kpi.value}</p>
                  <p
                    className={cn(
                      "mt-0.5 flex items-center gap-1 truncate text-[0.72rem] whitespace-nowrap",
                      kpi.captionTone === "up" ? "text-[#27d17f]" : kpi.captionTone === "down" ? "text-[#f0474f]" : "text-[#9fb0c6]",
                    )}
                  >
                    {kpi.captionTone === "up" && <IconArrowUp className="h-3 w-3" />}
                    {kpi.captionTone === "down" && <IconArrowDown className="h-3 w-3" />}
                    {kpi.caption}
                  </p>
                </div>
                {kpi.trend && kpi.trendColor && (
                  <div className="hidden w-[70px] shrink-0 self-end pb-1 sm:block">
                    <KpiSparkline data={kpi.trend} color={kpi.trendColor} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.28fr_1.39fr_1fr]">
        {/* PRECISIA Intelligence — Phase 10. Every finding here is a real,
            normalized signal from `financial-intelligence-engine.ts`; see
            FINDINGS_INVENTORY.md. Never a fabricated conclusion. */}
        <section className="pc-panel rounded-[14px] px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <h2 className="pc-heading text-[1.1rem] font-semibold text-white">PRECISIA Intelligence</h2>
            <span className="rounded-md border border-[#3a92ff]/60 bg-[#0c2b57] px-2 py-0.5 text-[0.68rem] font-semibold text-[#8cc8ff]">AI</span>
            {findings.length > 5 && (
              <Link href={`/company/${companyId}/intelligence`} className="ml-auto text-[0.8rem] font-medium text-[#2f9bff] hover:underline">
                +{findings.length - 5} more →
              </Link>
            )}
          </div>
          <p className="mt-1 text-[0.84rem] text-[#9fb0c6]">
            {findings.length === 0 ? "Nothing requires attention right now" : "Issues requiring your attention"}
          </p>
          {findings.length === 0 ? (
            <div className="mt-5 rounded-[10px] border border-dashed border-white/12 px-5 py-8 text-center">
              <IconSparkles className="mx-auto h-5 w-5 text-[#3f9bff]" />
              <p className="mt-2 font-semibold text-white">Nothing to flag yet</p>
              <p className="mt-1 text-sm text-[#9fb0c6]">PRECISIA Intelligence will appear here once there&rsquo;s enough real activity to observe.</p>
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {findings.slice(0, 5).map((finding) => {
                const tone = SEVERITY_TONE[finding.severity];
                const body = (
                  <>
                    <span className={cn("flex w-[88px] shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 py-2 text-[0.78rem] font-semibold", tone.chip)}>
                      {tone.icon === "info" ? <IconHelpCircle className="h-4 w-4" /> : <IconAlertTriangle className="h-4 w-4" />}
                      {FINDING_SEVERITY_LABEL[finding.severity]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-[0.86rem] leading-tight font-semibold text-white" title={finding.title}>{finding.title}</span>
                      <span className="mt-1 line-clamp-2 text-[0.72rem] leading-[1.2] text-[#b4c1d6]">{finding.evidence}</span>
                    </span>
                    <PIconChevronRight className="h-4.5 w-4.5 shrink-0 text-[#c9d4e3]" />
                  </>
                );
                return (
                  <li key={finding.id}>
                    {finding.actionHref ? (
                      <Link href={finding.actionHref} className="pc-row flex items-center gap-4 px-3 py-[7px] transition-colors hover:border-[#3a92ff]/50" title={finding.recommendedAction ?? undefined}>
                        {body}
                      </Link>
                    ) : (
                      <div className="pc-row flex items-center gap-4 px-3 py-[7px]">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-4">
          {/* Phase 27 — hidden entirely once every setup step is complete. */}
          {setupStepsComplete < SETUP_STEPS.length && (
            <section className="pc-panel rounded-[14px] px-4 pt-3 pb-3.5">
              <h2 className="pc-heading text-[1.1rem] leading-tight font-semibold text-white">Business Setup Progress</h2>
              <div className="mt-1 flex items-center justify-between text-[0.78rem] text-[#b4c1d6]">
                <span>
                  {setupStepsComplete} of {SETUP_STEPS.length} steps completed
                </span>
                <span className="text-[#27d17f]">{setupPercent}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#132437]" role="progressbar" aria-valuenow={setupPercent} aria-valuemin={0} aria-valuemax={100} aria-label="Business setup progress">
                <div className="h-full rounded-full bg-gradient-to-r from-[#1fbf6c] to-[#25d380] transition-[width] duration-300 ease-vf-out" style={{ width: `${setupPercent}%` }} />
              </div>
              <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {SETUP_STEPS.map((step) => (
                  <li key={step.label} className="flex items-center gap-2.5 text-[0.8rem]">
                    {step.complete ? (
                      <PIconCheckCircle className="h-[18px] w-[18px] shrink-0 text-[#25d380]" />
                    ) : (
                      <span aria-hidden className="h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] border-[#8193ab]" />
                    )}
                    <span className={step.complete ? "text-[#5ee6a5]" : "text-[#dbe4f1]"}>
                      {step.label}
                      <span className="sr-only">{step.complete ? " — complete" : " — not yet complete"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="pc-panel flex flex-1 flex-col rounded-[14px] px-4 py-3">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h2 className="pc-heading text-[1.1rem] font-semibold text-white">Account Overview</h2>
              <span className="flex items-center gap-2 rounded-[8px] border border-[#29405c] bg-[#0b1a2b] px-3 py-1.5 text-[0.8rem] text-[#dbe4f1]" title="Income, expenses and profit from the General Ledger for the last six months">
                Last 6 months
              </span>
            </div>
            <div className="min-h-[100px] flex-1">
              <AccountOverviewChart data={accountOverview} />
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {/* Recent Activity — real audit-log data already fetched above. */}
          <section className="pc-panel rounded-[14px] px-4 py-3.5">
            <div className="flex items-center justify-between">
              <h2 className="pc-heading text-[1.1rem] font-semibold text-white">Recent Activity</h2>
              <Link href={`/company/${companyId}/automation-dashboard`} className="flex items-center gap-1.5 text-[0.82rem] font-medium text-[#2f9bff] hover:underline">
                View All
                <PIconArrowRight className="h-4 w-4" />
              </Link>
            </div>
            {recentActivity.length === 0 ? (
              <p className="mt-4 text-sm text-[#9fb0c6]">Actions across this company — imports, journals, matching, and more — will appear here as they happen.</p>
            ) : (
              <ul className="mt-2.5 flex flex-col gap-2">
                {recentActivity.slice(0, 5).map((a) => {
                  const Icon = ACTIVITY_ICON[a.category] ?? PIconUpload;
                  return (
                    <li key={a.id} className="flex items-start gap-3.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-white/10 bg-[#13243a] text-[#c9d4e3]">
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.8rem] leading-tight font-medium text-white" title={a.message}>{a.message}</p>
                        <p className="truncate text-[0.7rem] leading-tight text-[#9fb0c6]">{a.category}</p>
                      </div>
                      <span className="shrink-0 text-[0.72rem] text-[#9fb0c6]">{activityTimeAgo(a.timestamp, now)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* PRECISIA Ask — the evidence-grounded question box on the
              PRECISIA Intelligence page, reached from here. The reference's
              robot illustration is not available as a standalone image, so
              none is shown. */}
          <section className="relative flex-1 overflow-hidden rounded-[14px] border border-[#3a92ff]/60 bg-[linear-gradient(170deg,#052f5a_0%,#03284e_25%,#001c3a_60%,#011022_100%)] px-5 py-3.5 shadow-[0_18px_48px_-20px_rgba(22,112,255,0.7)]">
            <RefPiece name="dashboard-robot" right={2} top={2} w={170} h={161} fade={[{ edge: "left", size: 34 }, { edge: "bottom", size: 12 }]} className="pointer-events-none hidden sm:block" />
            <div className="relative max-w-[62%]">
              <h2 className="pc-heading text-[1.3rem] leading-[1.15] font-bold text-white">
                Get insights faster
                <br />
                with AI.
              </h2>
              <p className="mt-1.5 text-[0.8rem] leading-snug text-[#dbe4f1]">Ask PRECISIA about your numbers, trends, or exceptions.</p>
              <Link href={`/company/${companyId}/intelligence`} className="pc-btn pc-btn-primary mt-3 h-10 bg-gradient-to-r from-[#1d7dff] to-[#2a8cff] px-5 text-[0.86rem]">
                <PIconSparkles className="h-4.5 w-4.5" />
                PRECISIA Ask
                <PIconArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>
        </div>
      </div>

      {/* Phase 26G — the large "Detailed Financials" block was removed
          here; every figure in it duplicates that module's own page in
          more detail. PRECISIA Intelligence (Needs Attention) and Business
          Setup Progress above cover what's actually actionable from this
          page; the rest is a click away on its own module's page. */}
    </div>
  );
}
