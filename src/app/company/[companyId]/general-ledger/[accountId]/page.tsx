import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountActivityView } from "@/components/financial/general-ledger/account-activity-view";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getChartOfAccount } from "@/server/services/chart-of-accounts-service";
import { listFinancialYears } from "@/server/services/financial-year-service";
import { getAccountActivity, getAccountYearComparison } from "@/server/services/account-activity-service";
import { listGlTransactions } from "@/server/services/gl-inquiry-service";
import { getFinancialIntelligence } from "@/server/services/financial-intelligence-service";
import { listJournals } from "@/server/services/journal-workflow-service";
import { getAuditEvidenceForAccount } from "@/server/services/audit-evidence-service";
import { findRelatedAuditFindings, findRelatedWorkingPapers } from "@/server/reporting/audit-trail-link-engine";
import {
  MOCK_CHART_OF_ACCOUNTS,
  MOCK_FINANCIAL_INTELLIGENCE_REPORT,
  MOCK_GL_TRANSACTIONS,
  MOCK_JOURNALS,
  buildPreviewAccountActivity,
  buildPreviewYearComparison,
} from "@/lib/mock/general-ledger-data";
import { MOCK_FINANCIAL_YEARS } from "@/lib/mock/company-management-data";
import { MOCK_AUDIT_FINDINGS, MOCK_AUDIT_WORKING_PAPERS } from "@/lib/mock/audit-data";
import type { GlInquiryFilters } from "@/server/general-ledger/types";

export const metadata: Metadata = {
  title: "Account Activity — VYRON FINANCE",
};

function defaultDateRange(financialYears: { isCurrent: boolean; startDate: string; endDate: string }[]): { dateFrom: string; dateTo: string } {
  const today = new Date().toISOString().slice(0, 10);
  const current = financialYears.find((fy) => fy.isCurrent);
  if (current) return { dateFrom: current.startDate, dateTo: current.endDate < today ? current.endDate : today };
  const from = new Date();
  from.setDate(from.getDate() - 90);
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: today };
}

export default async function AccountActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; accountId: string }>;
  searchParams: Promise<{ dateFrom?: string; dateTo?: string }>;
}) {
  const { companyId, accountId } = await params;
  const query = await searchParams;
  const previewMode = !isSupabaseConfigured();
  const id = Number(accountId);

  const account = previewMode ? (MOCK_CHART_OF_ACCOUNTS.find((a) => a.id === id) ?? null) : await getChartOfAccount(companyId, id);
  if (!account) notFound();

  const financialYears = previewMode ? MOCK_FINANCIAL_YEARS : await listFinancialYears(companyId);
  const { dateFrom, dateTo } = query.dateFrom && query.dateTo ? { dateFrom: query.dateFrom, dateTo: query.dateTo } : defaultDateRange(financialYears);

  const glFilters: GlInquiryFilters = {
    dateFrom,
    dateTo,
    accountId: id,
    reference: null,
    search: null,
    branchId: null,
    departmentId: null,
    costCentreId: null,
    sourceType: null,
  };

  const [activity, yearComparison, glPage, intelligence, allJournals] = previewMode
    ? [
        buildPreviewAccountActivity(id, dateFrom, dateTo),
        buildPreviewYearComparison(id, dateFrom, dateTo),
        {
          transactions: MOCK_GL_TRANSACTIONS.filter((t) => t.accountId === id && t.postingDate >= dateFrom && t.postingDate <= dateTo),
          nextCursor: null,
          hasMore: false,
          runningBalances: null,
        },
        MOCK_FINANCIAL_INTELLIGENCE_REPORT,
        MOCK_JOURNALS,
      ]
    : await Promise.all([
        getAccountActivity(companyId, id, dateFrom, dateTo),
        getAccountYearComparison(companyId, id, dateFrom, dateTo),
        listGlTransactions(companyId, glFilters, null, 200),
        getFinancialIntelligence(companyId, dateFrom, dateTo),
        listJournals(companyId),
      ]);

  if (!activity) notFound();

  // GAAP-Compliant Financial Statements & Disclosure Engine (Module 13) —
  // the last two links of the drill-through chain (Working Paper ->
  // Audit Finding), surfaced here since this is the one page every
  // statement line already drills through to.
  const auditEvidence = previewMode
    ? { findings: findRelatedAuditFindings(MOCK_AUDIT_FINDINGS, { accountId: id }), workingPapers: findRelatedWorkingPapers(MOCK_AUDIT_WORKING_PAPERS, account.accountCode) }
    : await getAuditEvidenceForAccount(companyId, id, account.accountCode);

  const relatedJournalIds = [...new Set(glPage.transactions.map((t) => t.journalId))];
  const relatedJournals = relatedJournalIds
    .map((jid) => allJournals.find((j) => j.id === jid))
    .filter((j): j is NonNullable<typeof j> => j !== undefined)
    .sort((a, b) => (a.journalDate < b.journalDate ? 1 : -1));

  const accountIntelligence = {
    largestMovements: intelligence.largestMovements.filter((m) => m.accountId === id),
    possibleDuplicateJournals: intelligence.possibleDuplicateJournals.filter((d) => d.accountId === id),
    unusualGrowth: intelligence.unusualGrowth.filter((g) => g.accountId === id),
    missingPostings: intelligence.missingPostings.filter((m) => relatedJournalIds.includes(m.journalId)),
  };

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
              {account.accountType} · {account.normalBalance}-normal
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">
              {account.accountCode} — {account.description}
            </h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Opening balance, movements, closing balance, related journals, and Financial Intelligence for this
              account — the accountant&rsquo;s primary investigation screen.
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-4xl font-semibold tabular-nums text-vf-on-dark">
              {activity.closingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="mt-1 text-sm text-vf-on-dark-soft">Closing Balance</p>
          </div>
        </CardContent>
      </Card>

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-vf-md" />}>
        <AccountActivityView
          companyId={companyId}
          accountId={id}
          account={account}
          activity={activity}
          yearComparison={yearComparison}
          transactions={glPage.transactions}
          relatedJournals={relatedJournals}
          intelligence={accountIntelligence}
          auditEvidence={auditEvidence}
          previewMode={previewMode}
        />
      </Suspense>
    </div>
  );
}
