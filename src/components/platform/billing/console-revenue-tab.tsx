import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import type { CommercialReportingSnapshot, RevenueMetric } from "@/server/billing-platform/engine/commercial-reporting-engine";

function money(amount: number): string {
  return `R ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function MetricTile({ label, metric, format }: { label: string; metric: RevenueMetric; format?: (v: number) => string }) {
  if (metric.quality === "NotAvailable") {
    return (
      <div className="rounded-xl border border-vf-paper-border p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">{label}</div>
        <div className="mt-2 text-sm text-vf-ink-faint">No production data yet</div>
        {metric.note && <div className="mt-1 text-xs text-vf-ink-faint">{metric.note}</div>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-vf-paper-border p-4">
      <StatTile value={format ? format(metric.value!) : String(metric.value)} label={label} />
    </div>
  );
}

/** "No fabricated values. If insufficient data exists, clearly show
 * 'No production data yet.'" — every tile below either shows a real
 * computed figure (including a real `0`) or the honest fallback,
 * driven entirely by `commercial-reporting-engine.ts`'s own
 * `RevenueMetric.quality` field — this component makes no judgment
 * calls of its own about what counts as "enough data." */
export function ConsoleRevenueTab({ reporting }: { reporting: CommercialReportingSnapshot }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        <Badge tone="info">{reporting.activePaidSubscriptions} active paid</Badge>
        <Badge tone="muted">{reporting.trialSubscriptions} on trial</Badge>
        {reporting.failedPaymentsCount > 0 && <Badge tone="danger">{reporting.failedPaymentsCount} failed payment(s)</Badge>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Monthly Recurring Revenue" metric={reporting.mrr} format={money} />
        <MetricTile label="Annual Recurring Revenue" metric={reporting.arr} format={money} />
        <MetricTile label="Average Revenue Per Customer" metric={reporting.averageRevenuePerCustomer} format={money} />
        <MetricTile label="Outstanding Revenue" metric={reporting.outstandingRevenue} format={money} />
        <MetricTile label="Trial Conversion Rate" metric={reporting.trialConversionRate} format={(v) => `${v}%`} />
        <MetricTile label="Churn Rate" metric={reporting.churnRate} format={(v) => `${v}%`} />
        <MetricTile label="Customer Lifetime Value" metric={reporting.lifetimeValue} format={money} />
        <MetricTile label="Subscription Growth" metric={reporting.subscriptionGrowth} format={(v) => `${v}%`} />
      </div>
    </div>
  );
}
