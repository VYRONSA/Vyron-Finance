"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";

export type TrendPoint = { date: string; value: number };

/**
 * Single-series magnitude-over-time — Recovery Progress trend. Per the
 * dataviz skill: one series needs no legend (the card title names it);
 * 2px line, ~10% opacity area wash, direct end-label, hairline recessive
 * gridlines, crosshair + per-point tooltip reachable by hover and focus.
 */
export function TrendChart({
  data,
  color = "var(--color-vf-red-400)",
  suffix = "",
  height = 160,
  formatDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
}: {
  data: TrendPoint[];
  color?: string;
  suffix?: string;
  height?: number;
  formatDate?: (date: string) => string;
}) {
  const gradientId = useId();
  const [active, setActive] = useState<number | null>(null);

  const width = 100; // percentage-based viewBox; scales via CSS width
  const padding = { top: 12, right: 4, bottom: 4, left: 4 };
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * (width - padding.left - padding.right);
    const y = padding.top + (1 - (d.value - min) / range) * (height - padding.top - padding.bottom);
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${height} L${points[0].x},${height} Z`;

  const activePoint = active !== null ? points[active] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full overflow-visible"
        role="img"
        aria-label={`Trend from ${formatDate(data[0].date)} to ${formatDate(data[data.length - 1].date)}, ending at ${data[data.length - 1].value}${suffix}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.14" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive gridline at the baseline */}
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />

        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="0.9" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

        {activePoint && (
          <line
            x1={activePoint.x}
            y1={padding.top}
            x2={activePoint.x}
            y2={height - padding.bottom}
            stroke="currentColor"
            strokeOpacity="0.18"
            strokeWidth="0.4"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* End marker + direct label */}
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="1.6" fill={color} stroke="var(--color-vf-charcoal)" strokeWidth="0.6" />

        {points.map((p, i) => (
          <circle
            key={p.date}
            cx={p.x}
            cy={p.y}
            r="3.2"
            fill="transparent"
            tabIndex={0}
            role="img"
            aria-label={`${formatDate(p.date)}: ${p.value}${suffix}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className="cursor-pointer outline-none"
          />
        ))}
      </svg>

      <span
        className="pointer-events-none absolute font-mono text-xs font-semibold tabular-nums text-vf-on-dark"
        style={{
          left: `${points[points.length - 1].x}%`,
          top: `${(points[points.length - 1].y / height) * 100}%`,
          transform: "translate(-100%, -140%)",
        }}
      >
        {points[points.length - 1].value}
        {suffix}
      </span>

      {activePoint && (
        <div
          className={cn(
            "pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-vf-sm border border-vf-dark-border bg-vf-canvas-raised px-2.5 py-1.5 text-xs shadow-vf-dark-card",
          )}
          style={{ left: `${activePoint.x}%`, top: `${(activePoint.y / height) * 100}%` }}
        >
          <span className="font-mono font-semibold tabular-nums text-vf-on-dark">
            {activePoint.value}
            {suffix}
          </span>
          <span className="ml-1.5 text-vf-on-dark-faint">{formatDate(activePoint.date)}</span>
        </div>
      )}
    </div>
  );
}
