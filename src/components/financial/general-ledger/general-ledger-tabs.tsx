"use client";

import { useUrlParam } from "@/hooks/use-url-param";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { ChartOfAccountsTab } from "./chart-of-accounts-tab";
import { JournalsTab } from "./journals-tab";
import { PostingRulesTab } from "./posting-rules-tab";
import { TrialBalanceTab } from "./trial-balance-tab";
import { GlInquiryTab } from "./gl-inquiry-tab";
import type { Journal } from "@/server/accounting/types";
import type { Branch, CostCentre, Department } from "@/server/company-management/types";
import type { ChartOfAccount, ChartOfAccountNode, GlInquiryPage, PostingRule, TrialBalance } from "@/server/general-ledger/types";

const TABS = ["Chart of Accounts", "Journals", "Posting Rules", "Trial Balance", "GL Inquiry"] as const;
type Tab = (typeof TABS)[number];

function slugFromTab(tab: Tab): string {
  return tab.toLowerCase().replace(/\s+/g, "-");
}

function tabFromSlug(slug: string): Tab {
  const found = TABS.find((t) => slugFromTab(t) === slug);
  return found ?? "Chart of Accounts";
}

export function GeneralLedgerTabs({
  companyId,
  previewMode,
  accounts,
  accountTree,
  journals,
  postingRules,
  trialBalance,
  initialGlPage,
  branches,
  departments,
  costCentres,
}: {
  companyId: string;
  previewMode: boolean;
  accounts: ChartOfAccount[];
  accountTree: ChartOfAccountNode[];
  journals: Journal[];
  postingRules: PostingRule[];
  trialBalance: TrialBalance;
  initialGlPage: GlInquiryPage;
  branches: Branch[];
  departments: Department[];
  costCentres: CostCentre[];
}) {
  // Finding #196 (RC-5) — the active tab survives a refresh and
  // participates in Back/Forward instead of resetting on every navigation.
  const [tabSlug, setTabSlug] = useUrlParam("tab", slugFromTab("Chart of Accounts"));
  const activeTab = tabFromSlug(tabSlug);
  const setActiveTab = (tab: Tab) => setTabSlug(slugFromTab(tab));

  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-vf-paper-border px-4 pt-3">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            aria-current={activeTab === tab ? "page" : undefined}
            className={cn(
              "rounded-t-lg px-3.5 py-2 text-sm font-medium transition",
              activeTab === tab ? "border-b-2 border-vf-red-600 text-vf-red-600" : "text-vf-ink-faint hover:text-vf-ink-soft",
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      <CardContent className="pt-5">
        {activeTab === "Chart of Accounts" && (
          <ChartOfAccountsTab companyId={companyId} accounts={accounts} accountTree={accountTree} previewMode={previewMode} />
        )}
        {activeTab === "Journals" && (
          <JournalsTab
            companyId={companyId}
            journals={journals}
            accounts={accounts}
            branches={branches}
            departments={departments}
            costCentres={costCentres}
            previewMode={previewMode}
          />
        )}
        {activeTab === "Posting Rules" && (
          <PostingRulesTab companyId={companyId} postingRules={postingRules} accounts={accounts} previewMode={previewMode} />
        )}
        {activeTab === "Trial Balance" && (
          <TrialBalanceTab companyId={companyId} trialBalance={trialBalance} previewMode={previewMode} />
        )}
        {activeTab === "GL Inquiry" && (
          <GlInquiryTab
            companyId={companyId}
            accounts={accounts}
            branches={branches}
            departments={departments}
            costCentres={costCentres}
            initialPage={initialGlPage}
            previewMode={previewMode}
          />
        )}
      </CardContent>
    </Card>
  );
}
