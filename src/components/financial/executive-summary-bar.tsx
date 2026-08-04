import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SummaryItem = {
  key: string;
  label: string;
  value: string;
  trend?: string;
  icon: ComponentType<{ className?: string }>;
};

/**
 * The white "Executive Summary" bar — icon + value + label per metric,
 * used identically on Dashboard, Bank Accounts, and Supplier
 * Reconciliation so every top-level stats row in the Financial Workspace
 * looks like one family rather than a bespoke KPI grid per page.
 */
export function ExecutiveSummaryBar({ items, trailing }: { items: SummaryItem[]; trailing?: ReactNode }) {
  return (
    <div className="rounded-vf-lg bg-vf-paper p-4 shadow-vf-paper-lg sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.key} className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-vf-red-500/10 text-vf-red-600">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <div className="flex items-baseline gap-1.5">
                    <p className="font-mono text-base font-semibold tabular-nums text-vf-ink">{item.value}</p>
                    {item.trend && (
                      <span className={cn("text-[0.65rem] font-medium", item.trend.startsWith("↑") ? "text-vf-success" : "text-vf-danger")}>
                        {item.trend}
                      </span>
                    )}
                  </div>
                  <p className="text-[0.65rem] leading-tight text-vf-ink-faint">{item.label}</p>
                </div>
              </div>
            );
          })}
        </div>
        {trailing}
      </div>
    </div>
  );
}
