"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { IconSparkles } from "@/components/ui/icons";
import type { StockItemIntelligenceSignal } from "@/server/services/inventory-intelligence-service";

export function IntelligenceTab({ signals }: { signals: { stockCode: string; description: string; signal: StockItemIntelligenceSignal }[] }) {
  if (signals.length === 0) {
    return <EmptyState icon={<IconSparkles className="h-5 w-5" />} title="No Inventory Intelligence signals yet." description="Signals appear once stock items have activity." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {signals.map((s, i) => (
        <li key={i} className="rounded-vf-sm border border-vf-paper-border p-3 text-sm">
          <p className="font-medium text-vf-ink">
            <span className="font-mono text-xs text-vf-ink-faint">{s.stockCode}</span> {s.signal.message}
          </p>
          <p className="mt-1 text-xs text-vf-ink-faint">{s.signal.reasoning}</p>
        </li>
      ))}
    </ul>
  );
}
