import { Badge } from "@/components/ui/badge";
import { IconShieldCheck } from "@/components/ui/icons";
import type { AssetDashboardSummary } from "@/server/services/asset-dashboard-summary-service";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "danger" }) {
  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-vf-ink-faint">{label}</p>
        {tone && <Badge tone={tone}>{tone === "good" ? "OK" : tone === "warn" ? "Attention" : "Critical"}</Badge>}
      </div>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-vf-ink">{value}</p>
    </div>
  );
}

export function AssetsDashboardTab({ summary }: { summary: AssetDashboardSummary }) {
  const healthTone = summary.assetHealthScore >= 80 ? "good" : summary.assetHealthScore >= 50 ? "warn" : "danger";

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-vf-md border border-vf-paper-border p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-vf-ink">Asset Health Score</p>
          <span className="flex items-center gap-1.5 font-mono text-lg tabular-nums text-vf-ink">
            <IconShieldCheck className={`h-4 w-4 ${healthTone === "good" ? "text-vf-success" : healthTone === "warn" ? "text-vf-warning" : "text-vf-danger"}`} />
            {summary.assetHealthScore}%
          </span>
        </div>
        <p className="mt-1 text-xs text-vf-ink-faint">100, minus a real penalty per open Asset Finding (weighted by how material the signal is) — every point traces to a specific, visible cause below.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total Asset Value" value={money(summary.totalAssetValue)} />
        <Metric label="Net Book Value" value={money(summary.netBookValue)} />
        <Metric label="Depreciation This Month" value={money(summary.depreciationThisMonth)} />
        <Metric label="Assets Due for Replacement" value={String(summary.assetsDueForReplacementCount)} tone={summary.assetsDueForReplacementCount === 0 ? "good" : "warn"} />
        <Metric label="Warranty Expiry" value={String(summary.warrantyExpiryCount)} tone={summary.warrantyExpiryCount === 0 ? "good" : "warn"} />
        <Metric label="Impairment Alerts" value={String(summary.impairmentAlertCount)} tone={summary.impairmentAlertCount === 0 ? "good" : "danger"} />
      </div>
    </div>
  );
}
