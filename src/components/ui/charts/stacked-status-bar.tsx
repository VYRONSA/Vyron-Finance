"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type StatusSegment = {
  key: string;
  label: string;
  value: number;
  /** Status colors are reserved and fixed — pass the same hex used for
   * the equivalent Badge tone elsewhere (good/warn/danger), not an
   * arbitrary categorical hue. red-400 substitutes for the raw danger
   * token here because this bar sits on a dark charcoal card, where
   * danger (#c11c31) falls below the 3:1 mark-contrast floor — red-400
   * clears it. */
  color: string;
};

/**
 * Part-to-whole across a small number of named, meaningful categories —
 * a horizontal stacked bar (the dataviz skill's recommended form for
 * this job), not a donut. Always shown with a legend since there are
 * 2+ segments; each segment's own label is shown inline only if it fits.
 */
export function StackedStatusBar({ segments }: { segments: StatusSegment[] }) {
  const [active, setActive] = useState<string | null>(null);
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;

  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-full bg-white/5" role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}>
        {segments.map((s, i) => {
          const pct = (s.value / total) * 100;
          const wide = pct >= 12;
          return (
            <button
              key={s.key}
              type="button"
              onMouseEnter={() => setActive(s.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(s.key)}
              onBlur={() => setActive(null)}
              aria-label={`${s.label}: ${s.value} (${pct.toFixed(0)}%)`}
              className={cn(
                "flex h-full items-center justify-center text-[0.65rem] font-semibold text-vf-on-dark outline-none transition-opacity",
                i > 0 && "ml-[2px]",
              )}
              style={{ width: `${pct}%`, backgroundColor: s.color, opacity: active === null || active === s.key ? 1 : 0.45 }}
            >
              {wide ? s.value : ""}
            </button>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="text-vf-on-dark-soft">{s.label}</span>
            <span className="font-mono font-medium tabular-nums text-vf-on-dark">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
