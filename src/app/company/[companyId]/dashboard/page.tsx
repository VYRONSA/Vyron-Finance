import type { Metadata } from "next";
import type { ComponentType } from "react";
import Link from "next/link";
import { cn, getInitials } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  IconAlertTriangle,
  IconArchive,
  IconBanknote,
  IconBarChart,
  IconBookOpen,
  IconBuilding,
  IconCalendar,
  IconClock,
  IconFileText,
  IconImport,
  IconReceipt,
  IconReconcile,
  IconRefresh,
  IconShieldCheck,
  IconSparkles,
  IconUsers,
} from "@/components/ui/icons";
import {
  MOCK_CHECKLIST,
  MOCK_COMPLETION_PERCENT,
  MOCK_COMPANY,
  MOCK_RECENT_ACTIVITY,
} from "@/lib/mock/financial-data";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";
import { MOCK_BILLS, MOCK_SUPPLIERS } from "@/lib/mock/supplier-reconciliation-data";
import { MOCK_JOURNALS } from "@/lib/mock/general-ledger-data";
import { MOCK_FINANCIAL_YEARS, MOCK_COMPANIES_FULL } from "@/lib/mock/company-management-data";
import { MOCK_CUSTOMERS } from "@/lib/mock/customer-management-data";
import { MOCK_SALES_INVOICES, MOCK_SALES_ORDERS } from "@/lib/mock/sales-data";
import { MOCK_PURCHASE_BILLS, MOCK_PURCHASE_ORDERS, MOCK_SUPPLIER_PAYMENTS } from "@/lib/mock/purchasing-data";
import { MOCK_STOCK_ITEMS } from "@/lib/mock/inventory-data";
import { MOCK_IMPORT_BATCHES } from "@/lib/mock/import-centre-data";
import { MOCK_BANKING_EXCEPTIONS } from "@/lib/mock/banking-automation-data";
import { MOCK_VAT_EXCEPTIONS, MOCK_VAT_RETURNS } from "@/lib/mock/vat-data";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCompany } from "@/server/services/company-service";
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
import { getIncomeStatement } from "@/server/services/financial-statements-service";
import { listExecutiveAlerts } from "@/server/services/executive-alert-service";
import { listAuditLog } from "@/server/services/automation-audit-service";
import { listAuditFindings } from "@/server/services/audit-finding-service";
import { listAssetFindings } from "@/server/services/asset-intelligence-service";
import { getMatchingQueue } from "@/server/services/matching-queue-service";
import { computeAgingBuckets } from "@/server/shared/aging";
import { buildFinancialIntelligenceSummary } from "@/server/financial-intelligence/financial-intelligence-engine";
import { FINDING_SEVERITY_LABEL, type FindingSeverity } from "@/server/financial-intelligence/types";
import { MOCK_TRANSACTION_SUMMARY } from "@/lib/mock/transaction-explorer-data";
import { MOCK_INCOME_STATEMENT } from "@/lib/mock/financial-reporting-data";
import { MOCK_AUDIT_FINDINGS } from "@/lib/mock/audit-data";
import { MOCK_ASSET_FINDINGS } from "@/lib/mock/asset-data";
import type { JournalStatus } from "@/server/accounting/types";

export const metadata: Metadata = {
  title: "Dashboard — VYRON FINANCE",
};

const FINDING_SEVERITY_DOT: Record<FindingSeverity, string> = {
  Critical: "text-vf-danger",
  High: "text-vf-warning",
  Medium: "text-vf-info",
  Low: "text-vf-info",
};
const FINDING_SEVERITY_BADGE_TONE: Record<FindingSeverity, "danger" | "warn" | "info"> = {
  Critical: "danger",
  High: "warn",
  Medium: "info",
  Low: "info",
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

function greetingForHour(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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
  // Phase 6 — `company` and `currentUserEmail` join this exact group.
  // Neither is new to the request: `company` is the same `getCompany`
  // lookup `company/[companyId]/layout.tsx` already runs for every page
  // under this route (the Hero needs the name/industry/registration
  // number/currency this page previously never displayed), and
  // `currentUserEmail` is the same session accessor already used
  // elsewhere in this app for a personalised greeting. Both have zero
  // dependency on anything else in this group, so batching them here
  // costs nothing and keeps the "one barrier" discipline intact.
  const [
    [journals, financialYears, company, currentUserEmail],
    [salesCustomers, salesInvoices, salesOrders],
    [purchasingSuppliers, allBills, purchaseOrders, supplierPayments],
    [inventoryItems],
    [importBatches, bankingExceptions],
    { items: matchingQueue },
    [vatReturnsForDashboard, vatExceptionsForDashboard],
  ] = previewMode
    ? [
        [MOCK_JOURNALS, MOCK_FINANCIAL_YEARS, MOCK_COMPANIES_FULL.find((c) => c.id === MOCK_COMPANY.id) ?? MOCK_COMPANIES_FULL[0]!, "preview@vyron.finance"],
        [MOCK_CUSTOMERS, MOCK_SALES_INVOICES, MOCK_SALES_ORDERS],
        [MOCK_SUPPLIERS, [...MOCK_BILLS, ...MOCK_PURCHASE_BILLS], MOCK_PURCHASE_ORDERS, MOCK_SUPPLIER_PAYMENTS],
        [MOCK_STOCK_ITEMS],
        [MOCK_IMPORT_BATCHES, MOCK_BANKING_EXCEPTIONS],
        { items: [] },
        [MOCK_VAT_RETURNS, MOCK_VAT_EXCEPTIONS],
      ]
    : await Promise.all([
        Promise.all([listJournals(companyId), listFinancialYears(companyId), getCompany(companyId), getCurrentUserEmail()]),
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
  const monthStartIso = `${todayIso.slice(0, 7)}-01`;
  const monthIncomeStatement = previewMode ? MOCK_INCOME_STATEMENT : await getIncomeStatement(companyId, monthStartIso, todayIso);
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
  ] = previewMode
    ? [[], [], MOCK_AUDIT_FINDINGS, MOCK_ASSET_FINDINGS, MOCK_BANK_ACCOUNT_SUMMARIES, [], MOCK_TRANSACTION_SUMMARY]
    : await Promise.all([
        listExecutiveAlerts(companyId, "Open"),
        listAuditLog(companyId, 5),
        listAuditFindings(companyId),
        listAssetFindings(companyId),
        listBankAccountSummaries(companyId),
        listOpeningBalanceEntries(companyId),
        getTransactionExplorerSummary(companyId),
      ]);

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
  // above (plus the two additive lookups joined into Group 1). Nothing
  // here fetches anything new.

  const greeting = greetingForHour(new Date().getHours());
  const companyInitials = getInitials(company?.name ?? undefined, "Co");

  // Executive KPI Cards — Phase 26G trimmed this from 8 tiles (including
  // 2 permanent "Coming Soon" placeholders with no real data source, and
  // a redundant "Bank Accounts" count already shown as Cash Balance's own
  // caption) down to the ones that are both genuinely distinct and
  // actionable: what's in the bank, what's owed to/by the company, and
  // this month's profit/VAT position.
  const EXECUTIVE_KPIS: { label: string; value: string; caption?: string; icon: ComponentType<{ className?: string }> }[] = [
    { label: "Cash Balance", value: money(totalCash, true), caption: `${activeAccounts.length} active account${activeAccounts.length === 1 ? "" : "s"}`, icon: IconBanknote },
    { label: "Outstanding Customers", value: money(salesSummary.outstandingDebtors, true), caption: `${salesCustomers.length} customer${salesCustomers.length === 1 ? "" : "s"}`, icon: IconUsers },
    { label: "Outstanding Suppliers", value: money(purchasingSummary.outstandingCreditors, true), caption: `${purchasingSuppliers.length} supplier${purchasingSuppliers.length === 1 ? "" : "s"}`, icon: IconArchive },
    { label: "Profit This Month", value: money(monthIncomeStatement.netProfit, true), caption: monthIncomeStatement.netProfit >= 0 ? "↑ Profit" : "↓ Loss", icon: IconBarChart },
    { label: "VAT Due", value: money(vatSummary.vatPayable, true), caption: `${vatSummary.openExceptionCount} exception${vatSummary.openExceptionCount === 1 ? "" : "s"}`, icon: IconReceipt },
  ];

  // Business Setup Progress — the 10 steps the brief names. Anything
  // this page has real evidence for is marked complete on that evidence
  // alone. "Opening Balances" now has a real signal, via Phase 10's
  // `openingBalanceEntries` fetch (previously unavailable on this page,
  // so it defaulted to open rather than guessed either way).
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

  return (
    <div className="flex w-full flex-col gap-10">
      {/* Executive Hero — company identity, at-a-glance context, and the
          handful of actions a CEO actually starts a session with. */}
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-col gap-7 p-6 lg:p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/12 font-display text-lg font-semibold text-vf-on-dark">
                {companyInitials}
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="font-display text-2xl font-medium text-vf-on-dark sm:text-3xl">{company?.name ?? "This company"}</h1>
                  {previewMode && (
                    <Badge tone="muted" className="bg-white/12 text-vf-on-dark">
                      Preview Mode
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-vf-on-dark-soft">
                  {greeting}{currentUserEmail ? `, ${getInitials(currentUserEmail, "").length > 0 ? currentUserEmail.split("@")[0] : ""}` : ""} — here&rsquo;s where {company?.name ?? "this company"} stands today.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-vf-on-dark-faint">
                  <span className="flex items-center gap-1.5">
                    <IconBuilding className="h-3.5 w-3.5" />
                    {company?.industry || "Industry not set"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <IconFileText className="h-3.5 w-3.5" />
                    Reg. {company?.registrationNumber || "not set"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <IconCalendar className="h-3.5 w-3.5" />
                    {currentFinancialYear ? currentFinancialYear.yearLabel : "Financial Year not set"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <IconRefresh className="h-3.5 w-3.5" />
                    Updated {new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <Button href={`/company/${companyId}/import-centre`} variant="ghostDark" size="sm">Import Bank Statement</Button>
            <Button href={`${salesHref}?tab=invoices`} variant="ghostDark" size="sm">Create Invoice</Button>
            <Button href={`${purchasingHref}?tab=bills`} variant="ghostDark" size="sm">Create Supplier Bill</Button>
            <Button href={`/company/${companyId}/opening-balances`} variant="ghostDark" size="sm">Opening Balances</Button>
            <Button href={`/company/${companyId}/copilot`} variant="ghostDark" size="sm">AI Assistant</Button>
          </div>
        </CardContent>
      </Card>

      {/* Executive KPI Cards */}
      <div>
        <h2 className="mb-4 text-sm font-semibold tracking-[-0.01em] text-vf-on-dark">Executive KPIs</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {EXECUTIVE_KPIS.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <Card key={kpi.label} tone="dark">
                <CardContent className="flex flex-col gap-3 p-5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/12 text-vf-on-dark">
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <p className="font-mono text-xl font-semibold tabular-nums text-vf-on-dark sm:text-2xl">{kpi.value}</p>
                    <p className="mt-1 text-xs text-vf-on-dark-faint">{kpi.label}</p>
                    {kpi.caption && <p className="mt-0.5 text-[0.7rem] text-vf-on-dark-faint/80">{kpi.caption}</p>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* VYRON Intelligence — Phase 10. Every finding here is a real,
          normalized signal from `financial-intelligence-engine.ts`; see
          FINDINGS_INVENTORY.md for exactly which existing system backs
          each one. Never a fabricated conclusion. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card tone="dark" className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-1/4 -right-1/4 h-[60%] w-[60%] rounded-full opacity-30"
            style={{ background: "radial-gradient(circle, rgba(47,151,224,0.35), transparent 70%)" }}
          />
          <CardHeader className="relative flex flex-row items-center gap-2">
            <IconSparkles className="h-4 w-4 text-vf-red-300" />
            <div>
              <CardTitle className="text-vf-on-dark">VYRON Intelligence</CardTitle>
              <CardDescription className="text-vf-on-dark-faint">
                {financialIntelligence.findings.length === 0
                  ? "Nothing requires attention right now"
                  : `${financialIntelligence.findings.length} item${financialIntelligence.findings.length === 1 ? "" : "s"} require attention`}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="relative pt-0">
            {financialIntelligence.findings.length === 0 ? (
              <EmptyState icon={<IconSparkles className="h-5 w-5" />} title="Nothing to flag yet" description="VYRON Intelligence will appear here once there's enough real activity to observe." />
            ) : (
              <ul className="flex flex-col gap-3.5">
                {financialIntelligence.findings.slice(0, 6).map((finding) => (
                  <li key={finding.id} className="flex items-start gap-3 rounded-vf-sm border border-white/10 p-3 text-sm">
                    <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10", FINDING_SEVERITY_DOT[finding.severity])}>
                      <IconAlertTriangle className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={FINDING_SEVERITY_BADGE_TONE[finding.severity]}>{FINDING_SEVERITY_LABEL[finding.severity]}</Badge>
                        <p className="font-medium text-vf-on-dark">{finding.title}</p>
                      </div>
                      <p className="mt-0.5 text-vf-on-dark-soft">{finding.evidence}</p>
                      {finding.recommendedAction && finding.actionHref && (
                        <Link href={finding.actionHref} className="mt-1 inline-block text-xs font-medium text-vf-red-300 hover:text-vf-red-200">
                          {finding.recommendedAction} →
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {financialIntelligence.findings.length > 6 && (
              <p className="relative mt-3 text-xs text-vf-on-dark-faint">+{financialIntelligence.findings.length - 6} more finding(s).</p>
            )}
          </CardContent>
        </Card>

        {/* Phase 27 — Production Readiness Audit, Part 7. Genuinely useful
         * while onboarding, purely decorative afterward — a company using
         * this as a real, ongoing accounting workspace has no use for a
         * permanent "steps complete" checklist once every step already
         * is. Hidden entirely once complete rather than always shown;
         * nothing about setup itself changes, still reachable via
         * Settings for whoever wants to revisit it. */}
        {setupStepsComplete < SETUP_STEPS.length && (
          <Card tone="dark">
            <CardHeader>
              <CardTitle className="text-vf-on-dark">Business Setup Progress</CardTitle>
              <CardDescription className="text-vf-on-dark-faint">{setupStepsComplete} of {SETUP_STEPS.length} steps complete</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-vf-red-400 transition-[width] duration-300 ease-vf-out"
                  style={{ width: `${Math.round((setupStepsComplete / SETUP_STEPS.length) * 100)}%` }}
                />
              </div>
              <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {SETUP_STEPS.map((step) => (
                  <li key={step.label} className="flex items-center gap-2.5 text-sm">
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold",
                        step.complete ? "bg-vf-success/20 text-vf-success" : "border border-white/20 text-vf-on-dark-faint",
                      )}
                    >
                      {step.complete ? "✓" : ""}
                    </span>
                    <span className={step.complete ? "text-vf-on-dark" : "text-vf-on-dark-faint"}>{step.label}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent Activity Timeline — real audit-log data already fetched
          above, unchanged, restyled as a timeline. */}
      <Card tone="dark">
        <CardHeader>
          <CardTitle className="text-vf-on-dark">Recent Activity</CardTitle>
          <CardDescription className="text-vf-on-dark-faint">Live feed across this company</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {recentActivity.length === 0 ? (
            <EmptyState
              icon={<IconClock className="h-5 w-5" />}
              title="No activity yet"
              description="Actions across this company — imports, journals, matching, and more — will appear here as they happen."
            />
          ) : (
            <ol className="relative flex flex-col gap-5 border-l border-white/10 pl-5">
              {recentActivity.slice(0, 8).map((a) => {
                const Icon = ACTIVITY_ICON[a.category] ?? IconImport;
                const time = a.timestamp.includes(" ") ? a.timestamp.split(" ")[1] : new Date(a.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                return (
                  <li key={a.id} className="relative">
                    <span className="absolute top-1 -left-[1.65rem] flex h-6 w-6 items-center justify-center rounded-full border-2 border-vf-red-900 bg-white/10 text-vf-red-300" aria-hidden>
                      <Icon className="h-3 w-3" />
                    </span>
                    <p className="text-sm text-vf-on-dark-soft">{a.message}</p>
                    <p className="mt-0.5 text-xs text-vf-on-dark-faint">{time}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Phase 26G — the large "Detailed Financials" block (Executive
          Summary 54-tile strip, Recovery Trend/Import Activity/Allocation
          Status/Cash Position/AI Insights row, Age Analysis, Top Suppliers/
          Largest Journals/Recovery Alerts/2nd Recent Activity row, Top
          Customers/Largest Sales/Largest Bills/Top Moving Products row,
          Recent Journal Entries, Copilot Insights) was removed here. A
          fresh audit (Phase 26G) confirmed every figure in it duplicates
          that module's own page in more detail (Sales/Purchasing/
          Inventory/General Ledger/Copilot all already show the same real
          data), and the underlying `build*DashboardSummary`/`list*` calls
          those pages use are untouched — only this page's second rendering
          of the same numbers was removed, per "do not delete underlying
          components globally." Needs-Attention (VYRON Intelligence) and
          Business Setup Progress above already cover what's actually
          actionable from this page; the rest is a click away on its own
          module's page. */}
    </div>
  );
}
