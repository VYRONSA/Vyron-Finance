"use client";

import { useState } from "react";

export type BarPoint = { date: string; count: number };

/**
 * Single-series magnitude by day — Import Activity. Bars capped, rounded
 * data-end at the tip, square at the baseline, 2px surface gap between
 * bars, per-bar hover/focus tooltip (the mark is the hit target, no
 * crosshair needed for discrete bars).
 */
export function ActivityBarChart({
  data,
  color = "var(--color-vf-red-400)",
  height = 160,
  formatDate = (d: string) => new Date(d).toLocaleDateString(undefined, { weekday: "short" }),
}: {
  data: BarPoint[];
  color?: string;
  height?: number;
  formatDate?: (date: string) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.count), 1);
  const barAreaHeight = height - 20;

  return (
    <div className="relative">
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((d, i) => {
          const barHeight = Math.max((d.count / max) * barAreaHeight, d.count > 0 ? 3 : 1);
          const isActive = active === i;
          return (
            <div key={d.date} className="flex flex-1 flex-col items-center justify-end gap-1.5">
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                aria-label={`${formatDate(d.date)}: ${d.count} transactions imported`}
                className="w-full max-w-6 rounded-t-[4px] outline-none transition-[opacity,transform] focus-visible:ring-2 focus-visible:ring-vf-red-400"
                style={{
                  height: barHeight,
                  backgroundColor: color,
                  opacity: isActive ? 1 : d.count > 0 ? 0.75 : 0.25,
                  transform: isActive ? "scaleX(1.08)" : "scaleX(1)",
                }}
              />
              <span className="text-[0.65rem] text-vf-on-dark-faint">{formatDate(d.date)}</span>
            </div>
          );
        })}
      </div>

      {active !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-vf-sm border border-vf-dark-border bg-vf-canvas-raised px-2.5 py-1.5 text-xs shadow-vf-dark-card"
          style={{ left: `${((active + 0.5) / data.length) * 100}%`, top: -8 }}
        >
          <span className="font-mono font-semibold tabular-nums text-vf-on-dark">{data[active].count}</span>
          <span className="ml-1.5 text-vf-on-dark-faint">{formatDate(data[active].date)}</span>
        </div>
      )}
    </div>
  );
}
