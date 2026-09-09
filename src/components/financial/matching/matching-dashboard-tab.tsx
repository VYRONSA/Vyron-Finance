"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MatchingSummary } from "@/server/services/matching-summary-service";
import type { MatchingQueueItem } from "@/server/services/matching-queue-service";

function scoreTone(value: number): "good" | "warn" | "danger" {
  if (value >= 80) return "good";
  if (value >= 50) return "warn";
  return "danger";
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "danger" }) {
  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <p className="text-xs text-vf-ink-faint">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className="font-mono text-xl font-semibold tabular-nums text-vf-ink">{value}</span>
        {tone && <Badge tone={tone}>{tone === "good" ? "Healthy" : tone === "warn" ? "Watch" : "Attention"}</Badge>}
      </div>
    </div>
  );
}

/** "One Matching Engine. No module may calculate its own confidence." —
 * every figure here is `matching-summary-service.ts::buildMatchingSummary`'s
 * own output; this tab does no math of its own. */
export function MatchingDashboardTab({ summary, queue }: { summary: MatchingSummary; queue: MatchingQueueItem[] }) {
  const byType = new Map<string, number>();
  for (const item of queue) byType.set(item.itemType, (byType.get(item.itemType) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Matching Accuracy" value={`${summary.matchingAccuracyPercent}%`} tone={scoreTone(summary.matchingAccuracyPercent)} />
        <Metric label="Auto Match %" value={`${summary.autoMatchPercent}%`} tone={scoreTone(summary.autoMatchPercent)} />
        <Metric label="Manual Queue" value={String(summary.manualQueueCount)} />
        <Metric label="Duplicate Risk" value={String(summary.duplicateRiskCount)} tone={summary.duplicateRiskCount > 0 ? "warn" : "good"} />
        <Metric label="Rule Success Rate" value={`${summary.ruleSuccessRatePercent}%`} tone={scoreTone(summary.ruleSuccessRatePercent)} />
        <Metric label="AI Confidence" value={`${summary.aiConfidencePercent}%`} tone={scoreTone(summary.aiConfidencePercent)} />
        <Metric label="Unresolved Exceptions" value={String(summary.unresolvedExceptionsCount)} tone={summary.unresolvedExceptionsCount > 0 ? "warn" : "good"} />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <h3 className="text-sm font-semibold text-vf-ink">Items Awaiting Review, by Type</h3>
          {byType.size === 0 ? (
            <p className="text-sm text-vf-ink-faint">Nothing awaiting review — the queue is empty.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between rounded-vf-sm border border-vf-paper-border p-2.5 text-sm">
                  <span className="text-vf-ink">{type}</span>
                  <span className="font-mono tabular-nums text-vf-ink-faint">{count}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
