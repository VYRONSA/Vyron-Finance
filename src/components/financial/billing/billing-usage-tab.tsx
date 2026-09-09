import { cn } from "@/lib/utils";
import type { Entitlements, LimitKey, UsageMetricKey } from "@/server/billing-platform/types";

const LIMIT_ROWS: { limitKey: LimitKey; usageKey: UsageMetricKey; label: string }[] = [
  { limitKey: "max_users", usageKey: "users", label: "Users" },
  { limitKey: "max_companies", usageKey: "companies", label: "Companies" },
  { limitKey: "max_storage_mb", usageKey: "storage_mb", label: "Storage (MB)" },
  { limitKey: "max_documents", usageKey: "documents", label: "Documents" },
  { limitKey: "max_ai_requests_monthly", usageKey: "ai_requests", label: "AI Requests (this month)" },
  { limitKey: "max_automation_runs_monthly", usageKey: "automation_runs", label: "Automation Runs (this month)" },
  { limitKey: "max_api_calls_monthly", usageKey: "api_requests", label: "API Requests (this month)" },
];

const OTHER_METRICS: { usageKey: UsageMetricKey; label: string }[] = [
  { usageKey: "customers", label: "Customers" },
  { usageKey: "suppliers", label: "Suppliers" },
  { usageKey: "inventory_items", label: "Inventory Items" },
  { usageKey: "assets", label: "Fixed Assets" },
  { usageKey: "communications", label: "Communications sent (this month)" },
  { usageKey: "bank_imports", label: "Bank Imports (this month)" },
  { usageKey: "reports_generated", label: "Reports Generated (this month)" },
];

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const nearLimit = limit !== null && limit > 0 && used / limit >= 0.9;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-vf-ink-soft">{label}</span>
        <span className="font-mono tabular-nums text-vf-ink-faint">{used.toLocaleString()} / {limit === null ? "Unlimited" : limit.toLocaleString()}</span>
      </div>
      {limit !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-vf-paper-alt">
          <div className={cn("h-full rounded-full transition-all", nearLimit ? "bg-vf-danger" : "bg-vf-red-500")} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function BillingUsageTab({ entitlements, usage }: { entitlements: Entitlements; usage: Record<UsageMetricKey, number> }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h3 className="text-sm font-semibold text-vf-ink">Plan limits</h3>
        <p className="mt-1 text-xs text-vf-ink-faint">Live counts against your plan — never a cached figure that could drift from reality.</p>
        <div className="mt-4 flex flex-col gap-4">
          {LIMIT_ROWS.map((row) => (
            <UsageBar key={row.limitKey} label={row.label} used={usage[row.usageKey] ?? 0} limit={entitlements.limits[row.limitKey]} />
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-vf-ink">Other usage</h3>
        <p className="mt-1 text-xs text-vf-ink-faint">Tracked for visibility — not currently plan-limited.</p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {OTHER_METRICS.map((m) => (
            <div key={m.usageKey} className="rounded-xl border border-vf-paper-border p-3">
              <div className="font-mono text-xl font-semibold tabular-nums text-vf-ink">{(usage[m.usageKey] ?? 0).toLocaleString()}</div>
              <div className="mt-0.5 text-xs text-vf-ink-faint">{m.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
