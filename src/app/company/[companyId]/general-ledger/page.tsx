import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { GeneralLedgerTabs } from "@/components/financial/general-ledger/general-ledger-tabs";
import { IconBookOpen, IconClock, IconFileText, IconImport, IconShieldCheck } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listChartOfAccounts, buildAccountTree } from "@/server/services/chart-of-accounts-service";
import { listJournals } from "@/server/services/journal-workflow-service";
import { listPostingRules } from "@/server/services/posting-rule-service";
import { getTrialBalance } from "@/server/services/trial-balance-service";
import { listGlTransactions } from "@/server/services/gl-inquiry-service";
import { listBranches, listCostCentres, listDepartments } from "@/server/services/org-master-data-service";
import {
  MOCK_CHART_OF_ACCOUNTS,
  MOCK_GL_TRANSACTIONS,
  MOCK_JOURNALS,
  MOCK_POSTING_RULES,
  MOCK_TRIAL_BALANCE,
} from "@/lib/mock/general-ledger-data";
import { MOCK_BRANCHES, MOCK_COST_CENTRES, MOCK_DEPARTMENTS } from "@/lib/mock/company-management-data";
import type { GlInquiryFilters } from "@/server/general-ledger/types";

export const metadata: Metadata = {
  title: "General Ledger — VYRON FINANCE",
};

const EMPTY_GL_FILTERS: GlInquiryFilters = {
  dateFrom: null,
  dateTo: null,
  accountId: null,
  reference: null,
  search: null,
  branchId: null,
  departmentId: null,
  costCentreId: null,
  sourceType: null,
};

export default async function GeneralLedgerPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const [accounts, journals, postingRules, trialBalance, glPage, branches, departments, costCentres] = previewMode
    ? [
        MOCK_CHART_OF_ACCOUNTS,
        MOCK_JOURNALS,
        MOCK_POSTING_RULES,
        MOCK_TRIAL_BALANCE,
        { transactions: MOCK_GL_TRANSACTIONS, nextCursor: null, hasMore: false, runningBalances: null },
        MOCK_BRANCHES,
        MOCK_DEPARTMENTS,
        MOCK_COST_CENTRES,
      ]
    : await Promise.all([
        listChartOfAccounts(companyId),
        listJournals(companyId),
        listPostingRules(companyId),
        getTrialBalance(companyId, null),
        listGlTransactions(companyId, EMPTY_GL_FILTERS, null),
        listBranches(companyId),
        listDepartments(companyId),
        listCostCentres(companyId),
      ]);

  const accountTree = buildAccountTree(accounts);

  const activeAccounts = accounts.filter((a) => a.isActive).length;
  const draftJournals = journals.filter((j) => j.status === "Draft").length;
  const approvedAwaitingPosting = journals.filter((j) => j.status === "Approved").length;
  const postedJournals = journals.filter((j) => j.status === "Posted").length;
  const isBalanced = Math.abs(trialBalance.totalDebit - trialBalance.totalCredit) <= 0.01;

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
              Financial Workspace
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">General Ledger</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              The accounting engine every module posts through — Chart of Accounts, journal workflow, the one
              Posting Engine, Posting Rules, Trial Balance, and GL Inquiry.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "accounts", label: "Active Accounts", value: String(activeAccounts), icon: IconBookOpen },
          { key: "drafts", label: "Draft Journals", value: String(draftJournals), icon: IconFileText },
          { key: "awaiting", label: "Awaiting Posting", value: String(approvedAwaitingPosting), icon: IconClock },
          { key: "posted", label: "Posted Journals", value: String(postedJournals), icon: IconShieldCheck },
          { key: "balance", label: "Trial Balance", value: isBalanced ? "Balanced" : "Out of Balance", icon: IconShieldCheck },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample chart of accounts, journals, posting rules, and postings. Every action is
          disabled until Supabase is configured.
        </p>
      )}

      <GeneralLedgerTabs
        companyId={companyId}
        previewMode={previewMode}
        accounts={accounts}
        accountTree={accountTree}
        journals={journals}
        postingRules={postingRules}
        trialBalance={trialBalance}
        initialGlPage={glPage}
        branches={branches}
        departments={departments}
        costCentres={costCentres}
      />
    </div>
  );
}
