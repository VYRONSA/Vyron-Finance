import type { Metadata } from "next";
import type { ComponentType } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { BankAccountsGrid } from "@/components/financial/bank-accounts-grid";
import { ImportUploadCard } from "@/components/financial/import-upload-card";
import { ConnectedBanksCard, type ConnectedBankRow } from "@/components/financial/connected-banks-card";
import {
  IconAlertTriangle,
  IconBank,
  IconBanknote,
  IconClock,
  IconCopy,
  IconImport,
  IconListChecks,
  IconPlus,
  IconReconcile,
  IconShieldCheck,
  IconSliders,
  IconSparkles,
} from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCompany } from "@/server/services/company-service";
import { listBankAccountSummaries } from "@/server/services/bank-account-service";
import { listRecentImports } from "@/server/services/import-service";
import { getSummary as getTransactionExplorerSummary, getBankingAutomationAggregate } from "@/server/services/transaction-explorer-service";
import { listBankingExceptions } from "@/server/services/banking-exception-service";
import { listBankingRules, listRuleApplicationsSince, getRuleConflicts } from "@/server/services/banking-rule-service";
import { getMatchingQueue } from "@/server/services/matching-queue-service";
import { buildMatchingSummary } from "@/server/services/matching-summary-service";
import { buildBankingAutomationSummary } from "@/server/services/banking-summary-service";
import { listReconciliations } from "@/server/services/bank-reconciliation-service";
import { detectRuleConflicts } from "@/server/banking-rules/conflict-detection";
import { listConnectedBanksForDisplay } from "@/server/bank-connectivity/bank-connectivity-service";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";
import { MOCK_COMPANY } from "@/lib/mock/financial-data";
import { MOCK_COMPANIES_FULL } from "@/lib/mock/company-management-data";
import { MOCK_IMPORT_BATCHES } from "@/lib/mock/import-centre-data";
import { MOCK_TRANSACTION_SUMMARY, MOCK_BANKING_AGGREGATE } from "@/lib/mock/transaction-explorer-data";
import { MOCK_BANKING_EXCEPTIONS, MOCK_BANKING_RULES } from "@/lib/mock/banking-automation-data";
import { MOCK_MATCHING_QUEUE } from "@/lib/mock/matching-data";
import { MOCK_BANK_RECONCILIATIONS } from "@/lib/mock/cashbook-data";
import { formatAmount, formatCount, formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Banking Command Centre — VYRON FINANCE",
};

function money(value: number, currency: string) {
  return `${currency} ${formatAmount(value)}`;
}

/** Master Implementation Tracker — Programme 2, Root Cause RC-13,
 * Finding #018. Summing every account's balance regardless of currency
 * produced a meaningless number labelled "ZAR" even when accounts held
 * other currencies. Groups by currency instead — a single figure for a
 * single-currency book (the common case), an explicit per-currency
 * breakdown otherwise, never a silently-wrong cross-currency sum. Pure,
 * exported for direct testing. */
export function totalBalanceLabel(accounts: { currentBalance: number; currency: string }[]): string {
  const byCurrency = new Map<string, number>();
  for (const a of accounts) byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + a.currentBalance);
  const entries = [...byCurrency.entries()];
  if (entries.length === 0) return money(0, "ZAR");
  if (entries.length === 1) return money(entries[0][1], entries[0][0]);
  return entries.map(([currency, total]) => money(total, currency)).join(" + ");
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function mostRecentDate(dates: (string | null)[]): string | null {
  const real = dates.filter((d): d is string => Boolean(d));
  if (real.length === 0) return null;
  return real.reduce((latest, d) => (d > latest ? d : latest));
}

/** Phase 7 — Banking Command Centre. Four real states, derived entirely
 * from data already fetched elsewhere on this page — never a fabricated
 * score. Every reason string names the exact real count behind it, so
 * "why" is always traceable to a real figure shown elsewhere on the
 * page. Pure, exported for direct testing. */
export type BankingHealthStatus = "Healthy" | "Needs Attention" | "Action Required" | "Not Configured";

export function computeBankingHealth(input: {
  accountCount: number;
  accountsWithNoTransactions: number;
  accountsNeverImported: number;
  needingReconciliationCount: number;
  unallocatedCount: number;
  openExceptionsCount: number;
}): { status: BankingHealthStatus; reasons: string[] } {
  const { accountCount, accountsWithNoTransactions, accountsNeverImported, needingReconciliationCount, unallocatedCount, openExceptionsCount } = input;

  if (accountCount === 0) {
    return { status: "Not Configured", reasons: ["No bank accounts have been set up yet."] };
  }

  const reasons: string[] = [];
  if (accountsNeverImported > 0) reasons.push(`${accountsNeverImported} account${accountsNeverImported === 1 ? " has" : "s have"} no bank statement imported yet.`);
  if (accountsWithNoTransactions > 0) reasons.push(`${accountsWithNoTransactions} account${accountsWithNoTransactions === 1 ? " has" : "s have"} no transactions yet.`);
  if (unallocatedCount > 0) reasons.push(`${unallocatedCount} transaction${unallocatedCount === 1 ? " is" : "s are"} awaiting allocation.`);
  if (needingReconciliationCount > 0) reasons.push(`${needingReconciliationCount} account${needingReconciliationCount === 1 ? " has" : "s have"} reconciliation outstanding.`);
  if (openExceptionsCount > 0) reasons.push(`${openExceptionsCount} banking exception${openExceptionsCount === 1 ? " is" : "s are"} open.`);

  if (reasons.length === 0) return { status: "Healthy", reasons: ["Every account is imported, allocated, and reconciled."] };

  const status: BankingHealthStatus = openExceptionsCount > 0 ? "Action Required" : "Needs Attention";
  return { status, reasons };
}

const HEALTH_TONE: Record<BankingHealthStatus, "good" | "warn" | "danger" | "muted"> = {
  Healthy: "good",
  "Needs Attention": "warn",
  "Action Required": "danger",
  "Not Configured": "muted",
};

const HEALTH_REASON_DOT: Record<BankingHealthStatus, string> = {
  Healthy: "bg-vf-success",
  "Needs Attention": "bg-vf-warning",
  "Action Required": "bg-vf-danger",
  "Not Configured": "bg-vf-ink-faint",
};

export default async function BankAccountsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();
  const todayIso = new Date().toISOString().slice(0, 10);

  // Phase 7 — Banking Command Centre. Every fetch below is independent
  // of every other (none depends on another's result — each is keyed
  // only by companyId/todayIso), so — matching this codebase's own
  // established "one barrier when there's no true dependency" discipline
  // (see dashboard/page.tsx's own comment for the full rationale) —
  // they're batched into a single Promise.all rather than run
  // sequentially. `getCompany` is the same lookup the company layout
  // already runs for this exact companyId; every other call is either
  // already used elsewhere in this app (Dashboard, Import Centre,
  // Banking Rules, Banking Exceptions, Matching, Cashbook) or a direct,
  // undisguised reuse of an existing service export — nothing here is a
  // new API, a new query shape, or duplicated business logic.
  const [
    summaries,
    company,
    importBatches,
    transactionSummary,
    bankingAggregate,
    bankingExceptions,
    ruleApplicationsToday,
    bankingRules,
    ruleConflicts,
    { items: matchingQueue },
    reconciliations,
    connectedBankDisplayRows,
  ] = previewMode
    ? [
        MOCK_BANK_ACCOUNT_SUMMARIES,
        MOCK_COMPANIES_FULL.find((c) => c.id === MOCK_COMPANY.id) ?? MOCK_COMPANIES_FULL[0]!,
        MOCK_IMPORT_BATCHES,
        MOCK_TRANSACTION_SUMMARY,
        MOCK_BANKING_AGGREGATE,
        MOCK_BANKING_EXCEPTIONS,
        [],
        MOCK_BANKING_RULES.filter((r) => r.domain === "Banking"),
        detectRuleConflicts(MOCK_BANKING_RULES.filter((r) => r.domain === "Banking")),
        { items: MOCK_MATCHING_QUEUE },
        MOCK_BANK_RECONCILIATIONS,
        // Phase 16, Part 12 — never fabricate a connected bank account.
        // No mock fixture exists for this, deliberately: Preview Mode
        // shows the same honest "no banks connected" empty state a real,
        // freshly-provisioned company would see.
        [],
      ]
    : await Promise.all([
        listBankAccountSummaries(companyId),
        getCompany(companyId),
        listRecentImports(companyId),
        getTransactionExplorerSummary(companyId),
        getBankingAutomationAggregate(companyId),
        listBankingExceptions(companyId),
        listRuleApplicationsSince(companyId, `${todayIso}T00:00:00.000Z`),
        listBankingRules(companyId, "Banking"),
        getRuleConflicts(companyId, "Banking"),
        getMatchingQueue(companyId),
        listReconciliations(companyId),
        listConnectedBanksForDisplay(companyId),
      ]);

  const connectedBankRows: ConnectedBankRow[] = connectedBankDisplayRows.map((r) => ({
    connectionId: r.connection.id,
    linkedAccountId: r.linkedAccount.id,
    provider: r.connection.provider,
    status: r.connection.status,
    bankAccountName: r.bankAccountName,
    maskedAccountNumber: r.linkedAccount.maskedAccountNumber,
    currentBalance: r.currentBalance,
    currency: r.currency,
    lastSyncAt: r.linkedAccount.lastSyncAt,
    lastSyncStatus: r.linkedAccount.lastSyncStatus,
    lastTransactionReceivedAt: r.linkedAccount.lastTransactionReceivedAt,
  }));

  const activeAccounts = summaries.filter((s) => s.account.status !== "Archived");
  const totalBalanceDisplay = totalBalanceLabel(activeAccounts.map((s) => s.account));
  const needingReconciliationAccounts = activeAccounts.filter((s) => {
    const days = daysSince(s.account.lastReconciliationDate);
    return days === null || days > 30;
  });
  const needingReconciliation = needingReconciliationAccounts.length;
  const recentImportCount = activeAccounts.filter((s) => {
    const days = daysSince(s.lastImport);
    return days !== null && days <= 14;
  }).length;
  const importHealthPct = activeAccounts.length > 0 ? Math.round((recentImportCount / activeAccounts.length) * 100) : 0;
  const lastBankActivity = mostRecentDate(activeAccounts.map((s) => s.lastImport));
  const accountsWithNoTransactions = activeAccounts.filter((s) => s.transactionCount === 0).length;
  const accountsNeverImported = activeAccounts.filter((s) => !s.lastImport).length;

  const bankingAutomationSummary = buildBankingAutomationSummary(bankingAggregate, importBatches.map((b) => b.createdAt), bankingExceptions, ruleApplicationsToday, todayIso);
  const matchingSummary = buildMatchingSummary(bankingAggregate, matchingQueue, bankingAutomationSummary.automationRatePercent, bankingAutomationSummary.exceptionsAwaitingReview);
  const openExceptions = bankingExceptions.filter((e) => e.status === "Open");
  const unusualActivityCount = openExceptions.filter((e) => e.exceptionType === "LargeUnusualPayment").length;

  const health = computeBankingHealth({
    accountCount: activeAccounts.length,
    accountsWithNoTransactions,
    accountsNeverImported,
    needingReconciliationCount: needingReconciliation,
    unallocatedCount: transactionSummary.unmatched,
    openExceptionsCount: openExceptions.length,
  });

  // Import Bank Statement — recent bank-statement batches only (bills
  // import batches share the same feed but aren't a "bank statement").
  // `listRecentImports` is capped to the most recent 20 imports
  // company-wide (see import-service.ts), so these figures are "recent",
  // matching Import Centre's own existing framing — never claimed as
  // all-time totals.
  const bankStatementBatches = importBatches.filter((b) => b.importType === "bank_transactions");
  const bankStatementDuplicates = bankStatementBatches.reduce((sum, b) => sum + b.duplicateCount, 0);
  const bankStatementExceptions = bankStatementBatches.reduce((sum, b) => sum + b.exceptionCount, 0);

  // Reconciliation — a real, cumulative pipeline built from six already-
  // fetched real signals. Each stage requires the one before it, so an
  // account with zero transactions can never show "Matching" as complete
  // just because there's nothing left to match — see computeBankingHealth
  // for the same "no fabricated percentage" discipline.
  const hasStatement = bankStatementBatches.length > 0;
  const hasTransactions = hasStatement && activeAccounts.some((s) => s.transactionCount > 0);
  const isMatched = hasTransactions && transactionSummary.unmatched === 0 && transactionSummary.awaitingReview === 0;
  const isAllocated = hasTransactions && transactionSummary.matched > 0;
  const reconciliationStarted = reconciliations.length > 0;
  const reconciliationCompleted = reconciliations.some((r) => r.status === "Completed");
  const PIPELINE_STAGES: { label: string; complete: boolean }[] = [
    { label: "Bank Statement Imported", complete: hasStatement },
    { label: "Transactions In The Ledger", complete: hasTransactions },
    { label: "Matching", complete: isMatched },
    { label: "Allocation", complete: isAllocated },
    { label: "Reconciliation Started", complete: reconciliationStarted },
    { label: "Completed", complete: reconciliationCompleted },
  ];
  const reconciliationsCompletedCount = reconciliations.filter((r) => r.status === "Completed").length;
  const reconciliationsInProgressCount = reconciliations.filter((r) => r.status === "InProgress" || r.status === "Reopened").length;

  // Banking Rules
  const activeRulesCount = bankingRules.filter((r) => r.isActive).length;

  // Transaction Workspace — the real AllocationStatus buckets (Matched
  // and Allocated are one combined DB bucket, see
  // fn_transaction_explorer_summary — honestly labelled as one tile
  // rather than split into a number that doesn't exist).
  const WORKSPACE_STATUSES: { label: string; value: number; tone: "good" | "warn" | "info" | "danger"; icon: ComponentType<{ className?: string }> }[] = [
    { label: "Unallocated", value: transactionSummary.unmatched, tone: "warn", icon: IconListChecks },
    { label: "Matched / Allocated", value: transactionSummary.matched, tone: "good", icon: IconReconcile },
    { label: "Needs Review", value: transactionSummary.awaitingReview, tone: "info", icon: IconClock },
    { label: "Duplicate", value: bankingAutomationSummary.duplicateDetectionCount, tone: "danger", icon: IconCopy },
  ];

  // AI Banking Intelligence — every card here reuses a number already
  // computed above (Banking Exceptions, Matching Queue, Transaction
  // Explorer Summary); nothing is a separate "AI model" call. See
  // banking-intelligence.ts's own docstring: this is deterministic,
  // explainable logic, not an ML claim.
  const AI_INSIGHTS: { label: string; value: number; message: string; icon: ComponentType<{ className?: string }>; href: string }[] = [
    { label: "Transactions Requiring Attention", value: matchingSummary.manualQueueCount, message: "In the Matching review queue.", icon: IconAlertTriangle, href: `/company/${companyId}/matching` },
    { label: "Duplicate Concerns", value: bankingAutomationSummary.duplicateDetectionCount, message: "Open possible-duplicate exceptions.", icon: IconCopy, href: `/company/${companyId}/banking-exceptions` },
    { label: "Unusual Transaction Activity", value: unusualActivityCount, message: "Open large/unusual payment exceptions.", icon: IconSparkles, href: `/company/${companyId}/banking-exceptions` },
    { label: "Allocation Opportunities", value: transactionSummary.unmatched, message: "Unallocated transactions ready to process.", icon: IconListChecks, href: `/company/${companyId}/transactions` },
    { label: "Reconciliation Issues", value: needingReconciliation, message: "Accounts with reconciliation outstanding.", icon: IconReconcile, href: `/company/${companyId}/cashbook` },
  ];

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Banking Hero */}
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-col gap-6 p-8 lg:p-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Banking</span>
              <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Banking Command Centre</h1>
              <p className="mt-1.5 max-w-[58ch] text-sm text-vf-on-dark-soft">
                {company?.name ?? "This company"} — every bank account, its balance, and its recovery status, in one place.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-vf-on-dark-faint">
                <span className="flex items-center gap-1.5">
                  <IconBank className="h-3.5 w-3.5" />
                  {activeAccounts.length} connected account{activeAccounts.length === 1 ? "" : "s"}
                </span>
                <span className="flex items-center gap-1.5">
                  <IconClock className="h-3.5 w-3.5" />
                  Last activity {lastBankActivity ? formatDate(lastBankActivity) : "— no activity yet"}
                </span>
                <Badge tone={HEALTH_TONE[health.status]} className="bg-white/12">
                  {health.status}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <Button href={`/company/${companyId}/import-centre`} variant="ghostDark" size="sm">
              <IconImport className="h-4 w-4" />
              Import Bank Statement
            </Button>
            <Button href={`/company/${companyId}/bank-accounts/new`} variant="ghostDark" size="sm">
              <IconPlus className="h-4 w-4" />
              Add Bank Account
            </Button>
            <Button href={`/company/${companyId}/cashbook`} variant="ghostDark" size="sm">
              <IconReconcile className="h-4 w-4" />
              Reconciliation
            </Button>
            <Button href={`/company/${companyId}/banking-rules`} variant="ghostDark" size="sm">
              <IconSliders className="h-4 w-4" />
              Banking Rules
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Executive Summary */}
      <ExecutiveSummaryBar
        items={[
          { key: "accounts", label: "Bank Accounts", value: String(activeAccounts.length), icon: IconBank },
          { key: "balance", label: "Total Balance", value: totalBalanceDisplay, icon: IconBanknote },
          { key: "health", label: "Banking Health", value: health.status, icon: IconShieldCheck },
          {
            key: "reconciliation",
            label: "Needing Reconciliation",
            value: String(needingReconciliation),
            trend: needingReconciliation > 0 ? "↓ Over 30 days" : undefined,
            icon: IconAlertTriangle,
          },
          { key: "importHealth", label: "Import Health", value: `${importHealthPct}%`, icon: IconImport },
        ]}
      />

      {summaries.length === 0 ? (
        // Empty State — direct bank-feed connections aren't implemented
        // in this codebase (confirmed by research); importing a bank
        // statement is the real way an account gets connected here — an
        // unrecognised account number on the statement creates the
        // account automatically. That's the honest primary path, with
        // manual creation offered as the alternative, not the headline.
        <Card>
          <EmptyState
            icon={<IconImport className="h-5 w-5" />}
            title="Import your first bank statement"
            description="VYRON doesn't yet connect directly to your bank — importing a statement is how an account gets connected. If the account number on the statement isn't recognised, VYRON creates it automatically."
            action={
              <div className="flex flex-wrap items-center gap-3">
                <Button href={`/company/${companyId}/import-centre`} variant="primary" size="sm">
                  Import Bank Statement
                </Button>
                <Button href={`/company/${companyId}/bank-accounts/new`} variant="subtle" size="sm">
                  Or create a bank account manually
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          {/* Bank Account Overview */}
          <BankAccountsGrid summaries={summaries} companyId={companyId} />

          {/* Connected Banks — Phase 16, Part 9 */}
          <ConnectedBanksCard companyId={companyId} rows={connectedBankRows} previewMode={previewMode} />

          {/* Banking Health */}
          <Card tone="dark">
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2.5">
                <IconShieldCheck className="h-4 w-4 text-vf-on-dark" />
                <div>
                  <CardTitle className="text-vf-on-dark">Banking Health</CardTitle>
                  <CardDescription className="text-vf-on-dark-faint">Computed from real account, import, allocation, and exception data.</CardDescription>
                </div>
              </div>
              <Badge tone={HEALTH_TONE[health.status]}>{health.status}</Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="flex flex-col gap-2.5">
                {health.reasons.map((reason) => (
                  <li key={reason} className="flex items-start gap-2.5 text-sm text-vf-on-dark-soft">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${HEALTH_REASON_DOT[health.status]}`} aria-hidden />
                    {reason}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Transaction Workspace + Unmatched Transactions */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Transaction Workspace</CardTitle>
                  <CardDescription>Every bank transaction&rsquo;s real status, at a glance.</CardDescription>
                </div>
                <Button href={`/company/${companyId}/transactions`} variant="subtle" size="sm">
                  Open Transaction Explorer
                </Button>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {WORKSPACE_STATUSES.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="flex flex-col gap-2 rounded-vf-md border border-vf-paper-border p-3.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-vf-red-500/10 text-vf-red-600">
                          <Icon className="h-4 w-4" />
                        </span>
                        <p className="font-mono text-xl font-semibold tabular-nums text-vf-ink">{formatCount(item.value)}</p>
                        <Badge tone={item.tone}>{item.label}</Badge>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-vf-ink-faint">
                  Reconciled transactions are tracked per bank statement, not individually — see Reconciliation below.
                </p>
              </CardContent>
            </Card>

            {/* Unmatched Transactions — high visibility */}
            <Card tone={matchingSummary.manualQueueCount > 0 ? "dark" : "paper"}>
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <IconAlertTriangle className={matchingSummary.manualQueueCount > 0 ? "h-4 w-4 text-vf-on-dark" : "h-4 w-4 text-vf-ink-faint"} />
                  <CardTitle className={matchingSummary.manualQueueCount > 0 ? "text-vf-on-dark" : undefined}>Needs Your Attention</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {matchingSummary.manualQueueCount > 0 ? (
                  <>
                    <p className="font-display text-4xl font-medium text-vf-on-dark">{matchingSummary.manualQueueCount}</p>
                    <p className="mt-1 text-sm text-vf-on-dark-soft">
                      transaction{matchingSummary.manualQueueCount === 1 ? "" : "s"} need{matchingSummary.manualQueueCount === 1 ? "s" : ""} your attention.
                    </p>
                    <Button href={`/company/${companyId}/matching`} variant="ghostDark" size="sm" className="mt-4">
                      Review Now
                    </Button>
                  </>
                ) : (
                  <EmptyState icon={<IconShieldCheck className="h-5 w-5" />} title="You're all caught up." description="Nothing in the matching queue needs review right now." />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Import Bank Statement */}
          <Card>
            <CardHeader>
              <CardTitle>Import Bank Statement</CardTitle>
              <CardDescription>Import → Review → Allocate → Reconcile — every statement follows the same pipeline.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 pt-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-vf-ink-faint">
                <span className="rounded-full bg-vf-paper-alt px-3 py-1">1. Import</span>
                <span aria-hidden>→</span>
                <span className="rounded-full bg-vf-paper-alt px-3 py-1">2. Review</span>
                <span aria-hidden>→</span>
                <span className="rounded-full bg-vf-paper-alt px-3 py-1">3. Allocate</span>
                <span aria-hidden>→</span>
                <span className="rounded-full bg-vf-paper-alt px-3 py-1">4. Reconcile</span>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <p className="font-mono text-lg font-semibold tabular-nums text-vf-ink">{bankStatementBatches.length}</p>
                  <p className="text-xs text-vf-ink-faint">Recent Statements</p>
                </div>
                <div>
                  <p className="font-mono text-lg font-semibold tabular-nums text-vf-ink">{bankStatementDuplicates}</p>
                  <p className="text-xs text-vf-ink-faint">Duplicates Skipped</p>
                </div>
                <div>
                  <p className="font-mono text-lg font-semibold tabular-nums text-vf-ink">{bankStatementExceptions}</p>
                  <p className="text-xs text-vf-ink-faint">Exceptions Flagged</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-vf-ink">{bankStatementBatches[0] ? formatDate(bankStatementBatches[0].createdAt) : "Never"}</p>
                  <p className="text-xs text-vf-ink-faint">Last Statement Imported</p>
                </div>
              </div>

              <ImportUploadCard
                companyId={companyId}
                kind="bank-transactions"
                title="Bank Statement"
                description="Standard VYRON Bank Import Template (CSV or Excel), OFX, QIF, or PDF."
                templateHint="Supported formats: CSV, Excel, OFX, QIF, PDF. PDF statements go through a review step before anything is committed; every other format imports and applies Banking Rules immediately. Balance and VAT are optional but must be numbers if provided."
                previewMode={previewMode}
              />
            </CardContent>
          </Card>

          {/* Banking Rules */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2.5">
                <IconSliders className="h-4 w-4 text-vf-red-600" />
                <div>
                  <CardTitle>Banking Rules</CardTitle>
                  <CardDescription>Let VYRON automatically recognise recurring transactions.</CardDescription>
                </div>
              </div>
              <Button href={`/company/${companyId}/banking-rules`} variant="subtle" size="sm">
                Manage Rules
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="font-mono text-lg font-semibold tabular-nums text-vf-ink">{activeRulesCount}</p>
                  <p className="text-xs text-vf-ink-faint">Active Rules</p>
                </div>
                <div>
                  <p className="font-mono text-lg font-semibold tabular-nums text-vf-ink">{ruleConflicts.length}</p>
                  <p className="text-xs text-vf-ink-faint">Requiring Attention</p>
                </div>
                <div>
                  <p className="font-mono text-lg font-semibold tabular-nums text-vf-ink">{ruleApplicationsToday.length}</p>
                  <p className="text-xs text-vf-ink-faint">Applied Today</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Reconciliation */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2.5">
                <IconReconcile className="h-4 w-4 text-vf-red-600" />
                <div>
                  <CardTitle>Reconciliation</CardTitle>
                  <CardDescription>{reconciliationsInProgressCount} in progress · {reconciliationsCompletedCount} completed, most recent first</CardDescription>
                </div>
              </div>
              <Button href={`/company/${companyId}/cashbook`} variant="subtle" size="sm">
                Open Cashbook &amp; Reconciliation
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              <ol className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                {PIPELINE_STAGES.map((stage, i) => (
                  <li key={stage.label} className="flex items-center gap-2 text-sm">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold ${
                        stage.complete ? "bg-vf-success/20 text-vf-success" : "border border-vf-paper-border text-vf-ink-faint"
                      }`}
                    >
                      {stage.complete ? "✓" : ""}
                    </span>
                    <span className={stage.complete ? "text-vf-ink" : "text-vf-ink-faint"}>{stage.label}</span>
                    {i < PIPELINE_STAGES.length - 1 && <span className="hidden text-vf-ink-faint sm:inline" aria-hidden>→</span>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {/* AI Banking Intelligence */}
          <Card tone="dark" className="relative overflow-hidden">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-1/4 -right-1/4 h-[60%] w-[60%] rounded-full opacity-30"
              style={{ background: "radial-gradient(circle, rgba(47,151,224,0.35), transparent 70%)" }}
            />
            <CardHeader className="relative flex flex-row items-center gap-2">
              <IconSparkles className="h-4 w-4 text-vf-red-300" />
              <div>
                <CardTitle className="text-vf-on-dark">AI Banking Intelligence</CardTitle>
                <CardDescription className="text-vf-on-dark-faint">
                  Real signals from Banking Exceptions and the Matching Engine — not a separate model.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="relative grid grid-cols-1 gap-3 pt-0 sm:grid-cols-2 lg:grid-cols-5">
              {AI_INSIGHTS.map((insight) => {
                const Icon = insight.icon;
                return (
                  <Link
                    key={insight.label}
                    href={insight.href}
                    className="flex flex-col gap-2 rounded-vf-md border border-white/10 p-3.5 transition-colors hover:bg-white/5"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-vf-red-300">
                      <Icon className="h-4 w-4" />
                    </span>
                    <p className="font-mono text-xl font-semibold tabular-nums text-vf-on-dark">{formatCount(insight.value)}</p>
                    <p className="text-xs font-medium text-vf-on-dark">{insight.label}</p>
                    <p className="text-[0.7rem] leading-snug text-vf-on-dark-faint">{insight.message}</p>
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
