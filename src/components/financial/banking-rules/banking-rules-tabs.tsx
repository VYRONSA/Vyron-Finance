"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { BankingRulesTab } from "./banking-rules-tab";
import { BankingRulesAnalyticsTab } from "./banking-rules-analytics-tab";
import { useUrlParam } from "@/hooks/use-url-param";
import type { BankingRule } from "@/server/banking-rules/types";

const TABS = ["Rules", "Analytics"] as const;
type Tab = (typeof TABS)[number];

function slugFromTab(tab: Tab): string {
  return tab.toLowerCase();
}

function tabFromSlug(slug: string): Tab {
  const found = TABS.find((t) => t.toLowerCase() === slug);
  return found ?? "Rules";
}

export function BankingRulesTabs({ companyId, rules, previewMode }: { companyId: string; rules: BankingRule[]; previewMode: boolean }) {
  // Finding #196 (RC-5) — the active tab survives a refresh and
  // participates in Back/Forward instead of resetting on every navigation.
  const [tabSlug, setTabSlug] = useUrlParam("tab", slugFromTab("Rules"));
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
        {activeTab === "Rules" && <BankingRulesTab companyId={companyId} rules={rules} previewMode={previewMode} />}
        {activeTab === "Analytics" && <BankingRulesAnalyticsTab companyId={companyId} previewMode={previewMode} />}
      </CardContent>
    </Card>
  );
}
