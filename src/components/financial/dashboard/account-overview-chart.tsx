"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/lib/format";

export type AccountOverviewPoint = { label: string; income: number; expenses: number; profit: number };

const SERIES = [
  { key: "income", label: "Income", color: "var(--pc-chart-income)" },
  { key: "expenses", label: "Expenses", color: "var(--pc-chart-expenses)" },
  { key: "profit", label: "Profit", color: "var(--pc-chart-profit)" },
] as const;

const W = 600;
const H = 200;

function compactRand(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}R ${Math.round(abs / 1_000)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

function niceStep(range: number): number {
  const raw = range / 4;
  if (raw <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

/** Monotone cubic (Fritsch–Carlson) — smooth like the reference, but never
 * overshoots between two real monthly values, so the curve never implies
 * a peak or dip that didn't happen. */
function monotonePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  const n = pts.length;
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let path = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1].x - pts[i].x) / 3;
    path += ` C${pts[i].x + dx},${pts[i].y + m[i] * dx} ${pts[i + 1].x - dx},${pts[i + 1].y - m[i + 1] * dx} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return path;
}

/**
 * "Account Overview" from the PRECISIA Software Page reference — Income,
 * Expenses and Profit per month, drawn from the company's own General
 * Ledger (one Income Statement per month, see the dashboard page). One
 * shared y-axis (all three are rand amounts), a legend plus hover/focus
 * tooltip so identity is never carried by colour alone, and a visually
 * hidden table for screen readers.
 */
export function AccountOverviewChart({ data }: { data: AccountOverviewPoint[] }) {
  const uid = useId();
  const [active, setActive] = useState<number | null>(null);

  const values = data.flatMap((p) => [p.income, p.expenses, p.profit]);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  const step = niceStep(maxV - minV || 1);
  const lo = Math.floor(minV / step) * step;
  const hi = Math.max(Math.ceil(maxV / step) * step, lo + step);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);

  const x = (i: number) => (data.length > 1 ? (i / (data.length - 1)) * W : W / 2);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const baseline = y(Math.max(lo, 0));

  return (
    <div className="flex h-full flex-col">
      <ul className="mb-3 flex items-center justify-center gap-6 text-[0.78rem] text-[#dbe4f1]" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>

      <div className="relative flex min-h-[170px] flex-1 pl-[52px]">
        {/* y-axis labels */}
        <div aria-hidden className="absolute inset-y-0 left-0 w-[46px]">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 text-[0.7rem] whitespace-nowrap text-[#9fb0c6]" style={{ top: `${(y(t) / H) * 100}%` }}>
              {compactRand(t)}
            </span>
          ))}
        </div>

        <div className="relative flex-1">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            <defs>
              {SERIES.map((s) => (
                <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((t) => (
              <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="#ffffff" strokeOpacity={t === 0 ? 0.16 : 0.06} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {SERIES.map((s) => {
              const pts = data.map((p, i) => ({ x: x(i), y: y(p[s.key]) }));
              const line = monotonePath(pts);
              const area = pts.length > 1 ? `${line} L${pts[pts.length - 1].x},${baseline} L${pts[0].x},${baseline} Z` : "";
              return (
                <g key={s.key}>
                  {area && <path d={area} fill={`url(#${uid}-${s.key})`} />}
                  <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
            {active !== null && (
              <line x1={x(active)} x2={x(active)} y1={0} y2={H} stroke="#ffffff" strokeOpacity={0.25} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            )}
          </svg>

          {/* Markers for the active month (HTML so they stay round under the stretched SVG). */}
          {active !== null &&
            SERIES.map((s) => (
              <span
                key={s.key}
                aria-hidden
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#081926]"
                style={{ left: `${(x(active) / W) * 100}%`, top: `${(y(data[active][s.key]) / H) * 100}%`, background: s.color }}
              />
            ))}

          {/* Hit targets — one column per month, reachable by hover and keyboard focus. */}
          <div className="absolute inset-0 flex">
            {data.map((p, i) => (
              <button
                key={p.label}
                type="button"
                className="h-full flex-1 cursor-crosshair outline-none"
                aria-label={`${p.label}: income R ${formatAmount(p.income, 0)}, expenses R ${formatAmount(p.expenses, 0)}, profit R ${formatAmount(p.profit, 0)}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            ))}
          </div>

          {active !== null && (
            <div
              role="status"
              className={cn(
                "pointer-events-none absolute top-1 z-10 w-44 rounded-[10px] border border-[#29405c] bg-[#0b1a2b]/95 px-3 py-2.5 text-xs shadow-[0_12px_30px_-10px_rgba(0,0,0,0.8)]",
                active > data.length / 2 ? "-translate-x-[calc(100%+10px)]" : "translate-x-[10px]",
              )}
              style={{ left: `${(x(active) / W) * 100}%` }}
            >
              <p className="mb-1.5 font-semibold text-white">{data[active].label}</p>
              {SERIES.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-3 text-[#c9d4e3]">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-mono text-white tabular-nums">R {formatAmount(data[active][s.key], 0)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      <div aria-hidden className="mt-2 flex pl-[52px] text-[0.75rem] text-[#c9d4e3]">
        {data.map((p, i) => (
          <span key={p.label} className={cn("flex-1", i === 0 ? "text-left" : i === data.length - 1 ? "text-right" : "text-center")}>
            {p.label}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>Income, expenses and profit per month</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Income</th>
            <th>Expenses</th>
            <th>Profit</th>
          </tr>
        </thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.label}>
              <td>{p.label}</td>
              <td>R {formatAmount(p.income, 0)}</td>
              <td>R {formatAmount(p.expenses, 0)}</td>
              <td>R {formatAmount(p.profit, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** KPI-card sparkline (reference style: 2px line with a soft glow wash).
 * Decorative — the card's own figure carries the value. */
export function KpiSparkline({ data, color }: { data: number[]; color: string }) {
  const uid = useId();
  if (data.length < 2) return null;
  const w = 120;
  const h = 44;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => ({ x: (i / (data.length - 1)) * w, y: 4 + (1 - (v - min) / range) * (h - 8) }));
  const line = monotonePath(pts);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-10 w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${uid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  );
}
