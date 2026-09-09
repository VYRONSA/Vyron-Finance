import { Badge } from "@/components/ui/badge";
import type { Metric } from "@/server/operations/types";

/** Renders any `Metric<T>` honestly — a real Live/Calculated value, or a
 * "Not Available" badge (never a fabricated 0 or dash that looks like a
 * tracked zero). This is the ONE place that distinction is rendered, so
 * every dashboard section shows it identically. */
export function MetricValue({ metric, format }: { metric: Metric<unknown>; format?: (value: unknown) => string }) {
  if (metric.quality === "NotAvailable" || metric.value === null) {
    return (
      <span className="inline-flex items-center gap-1" title={metric.note}>
        <Badge tone="muted">Not Available</Badge>
      </span>
    );
  }
  const display = format ? format(metric.value) : String(metric.value);
  return (
    <span className="inline-flex items-center gap-1.5" title={metric.note}>
      <span className="font-mono tabular-nums text-vf-ink">{display}</span>
      {metric.quality === "Calculated" && <Badge tone="info">Calculated</Badge>}
    </span>
  );
}
