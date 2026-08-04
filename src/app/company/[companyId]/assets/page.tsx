import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { AssetsTabs } from "@/components/financial/assets/assets-tabs";
import { IconAlertTriangle, IconBanknote, IconImport, IconShieldCheck } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCompany } from "@/server/services/company-service";
import { listAssetClasses, listFixedAssets, listAllAssetLifecycleEvents, withNetBookValue } from "@/server/services/asset-register-service";
import { listDepreciationRuns } from "@/server/services/depreciation-run-service";
import { listAssetFindings } from "@/server/services/asset-intelligence-service";
import { buildAssetDashboardSummary } from "@/server/services/asset-dashboard-summary-service";
import { MOCK_COMPANIES_FULL } from "@/lib/mock/company-management-data";
import { MOCK_ASSET_CLASSES, MOCK_FIXED_ASSETS, MOCK_ASSET_LIFECYCLE_EVENTS, MOCK_DEPRECIATION_RUNS, MOCK_ASSET_FINDINGS } from "@/lib/mock/asset-data";
import type { AssetLifecycleEvent } from "@/server/assets/types";

export const metadata: Metadata = {
  title: "Fixed Assets — VYRON FINANCE",
};

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function AssetsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const company = previewMode ? MOCK_COMPANIES_FULL.find((c) => c.id === companyId) : await getCompany(companyId);
  if (!company) notFound();

  const [assetClasses, rawAssets, lifecycleEvents, depreciationRuns, findings] = previewMode
    ? [MOCK_ASSET_CLASSES, MOCK_FIXED_ASSETS, MOCK_ASSET_LIFECYCLE_EVENTS, MOCK_DEPRECIATION_RUNS, MOCK_ASSET_FINDINGS]
    : await Promise.all([listAssetClasses(companyId), listFixedAssets(companyId), listAllAssetLifecycleEvents(companyId), listDepreciationRuns(companyId), listAssetFindings(companyId)]);

  const assets = rawAssets.map(withNetBookValue);
  const lifecycleEventsByAsset = lifecycleEvents.reduce<Record<number, AssetLifecycleEvent[]>>((acc, e) => {
    acc[e.assetId] = [...(acc[e.assetId] ?? []), e];
    return acc;
  }, {});

  const latestPostedRun = [...depreciationRuns].filter((r) => r.status === "Posted").sort((a, b) => (a.runDate < b.runDate ? 1 : -1))[0] ?? null;
  const summary = buildAssetDashboardSummary(rawAssets, findings, latestPostedRun?.totalAmount ?? 0);

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
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Fixed Assets & Asset Intelligence</span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Fixed Assets</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              One Depreciation Engine, one Posting Engine — every acquisition, improvement, revaluation, and
              disposal is a real Business Event, fully traceable to its journal and the General Ledger.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "totalAssetValue", label: "Total Asset Value", value: money(summary.totalAssetValue), icon: IconBanknote },
          { key: "netBookValue", label: "Net Book Value", value: money(summary.netBookValue), icon: IconBanknote },
          { key: "depreciationThisMonth", label: "Depreciation This Month", value: money(summary.depreciationThisMonth), icon: IconBanknote },
          { key: "dueForReplacement", label: "Due for Replacement", value: String(summary.assetsDueForReplacementCount), icon: IconAlertTriangle },
          { key: "impairmentAlerts", label: "Impairment Alerts", value: String(summary.impairmentAlertCount), icon: IconAlertTriangle },
          { key: "assetHealth", label: "Asset Health Score", value: `${summary.assetHealthScore}%`, icon: IconShieldCheck },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample asset data. Every action is disabled until Supabase is configured.
        </p>
      )}

      <AssetsTabs
        companyId={companyId}
        summary={summary}
        assets={assets}
        assetClasses={assetClasses}
        lifecycleEventsByAsset={lifecycleEventsByAsset}
        depreciationRuns={depreciationRuns}
        findings={findings}
        previewMode={previewMode}
      />
    </div>
  );
}
