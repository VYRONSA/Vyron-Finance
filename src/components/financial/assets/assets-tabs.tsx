"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { AssetsDashboardTab } from "./assets-dashboard-tab";
import { AssetRegisterTab } from "./asset-register-tab";
import { AssetDepreciationTab } from "./asset-depreciation-tab";
import { AssetFindingsTab } from "./asset-findings-tab";
import type { AssetClass, AssetFinding, AssetLifecycleEvent, DepreciationRun, FixedAssetWithNetBookValue } from "@/server/assets/types";
import type { AssetDashboardSummary } from "@/server/services/asset-dashboard-summary-service";

const TABS = ["Dashboard", "Register", "Depreciation", "Findings"] as const;
type Tab = (typeof TABS)[number];

function tabFromSlug(slug: string | null): Tab {
  const found = TABS.find((t) => t.toLowerCase().replace(/\s+/g, "-") === slug);
  return found ?? "Dashboard";
}

export function AssetsTabs({
  companyId,
  summary,
  assets,
  assetClasses,
  lifecycleEventsByAsset,
  depreciationRuns,
  findings,
  previewMode,
}: {
  companyId: string;
  summary: AssetDashboardSummary;
  assets: FixedAssetWithNetBookValue[];
  assetClasses: AssetClass[];
  lifecycleEventsByAsset: Record<number, AssetLifecycleEvent[]>;
  depreciationRuns: DepreciationRun[];
  findings: AssetFinding[];
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
        {activeTab === "Dashboard" && <AssetsDashboardTab summary={summary} />}
        {activeTab === "Register" && (
          <AssetRegisterTab companyId={companyId} assets={assets} assetClasses={assetClasses} lifecycleEventsByAsset={lifecycleEventsByAsset} previewMode={previewMode} />
        )}
        {activeTab === "Depreciation" && <AssetDepreciationTab companyId={companyId} runs={depreciationRuns} previewMode={previewMode} />}
        {activeTab === "Findings" && <AssetFindingsTab companyId={companyId} findings={findings} assets={assets} previewMode={previewMode} />}
      </CardContent>
    </Card>
  );
}
