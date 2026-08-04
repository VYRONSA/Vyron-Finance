"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { CopilotAskTab } from "./copilot-ask-tab";
import { CopilotNarrativesTab } from "./copilot-narratives-tab";
import { CopilotScenariosTab } from "./copilot-scenarios-tab";
import { CopilotBriefingTab } from "./copilot-briefing-tab";
import type { CopilotBriefing, CopilotNarrative, CopilotScenario } from "@/server/copilot/types";

const TABS = ["Ask", "Narratives", "What-If", "Briefing"] as const;
type Tab = (typeof TABS)[number];

function tabFromSlug(slug: string | null): Tab {
  const found = TABS.find((t) => t.toLowerCase().replace(/\s+/g, "-") === slug);
  return found ?? "Ask";
}

type AssetOption = { id: number; assetNumber: string; description: string };

export function CopilotTabs({
  companyId,
  narratives,
  scenarios,
  briefing,
  assetOptions,
  periodStart,
  periodEnd,
  financialYearStartDate,
  financialYearLabel,
  previewMode,
}: {
  companyId: string;
  narratives: CopilotNarrative[];
  scenarios: CopilotScenario[];
  briefing: CopilotBriefing | null;
  assetOptions: AssetOption[];
  periodStart: string;
  periodEnd: string;
  financialYearStartDate: string;
  financialYearLabel: string;
  previewMode: boolean;
}) {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => tabFromSlug(searchParams.get("tab")));

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
        {activeTab === "Ask" && <CopilotAskTab companyId={companyId} periodStart={periodStart} periodEnd={periodEnd} financialYearStartDate={financialYearStartDate} previewMode={previewMode} />}
        {activeTab === "Narratives" && (
          <CopilotNarrativesTab
            companyId={companyId}
            narratives={narratives}
            periodStart={periodStart}
            periodEnd={periodEnd}
            financialYearStartDate={financialYearStartDate}
            financialYearLabel={financialYearLabel}
            previewMode={previewMode}
          />
        )}
        {activeTab === "What-If" && (
          <CopilotScenariosTab companyId={companyId} scenarios={scenarios} periodStart={periodStart} periodEnd={periodEnd} assetOptions={assetOptions} previewMode={previewMode} />
        )}
        {activeTab === "Briefing" && <CopilotBriefingTab companyId={companyId} briefing={briefing} financialYearStartDate={financialYearStartDate} previewMode={previewMode} />}
      </CardContent>
    </Card>
  );
}
