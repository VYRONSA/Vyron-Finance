import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * The PRECISIA dashboard as it appears on the monitor (hero) and laptop
 * (The Platform) in the approved "Precisia Landing Page" reference —
 * rebuilt in HTML/CSS/SVG rather than cropped from the reference, so it
 * stays sharp at every size.
 *
 * It is an ILLUSTRATION on the public marketing page, never the live
 * application: it reads no data, and every figure in it is a fixed
 * sample. The caption rendered under each device says so, and the
 * whole screen is hidden from assistive technology (its caption is
 * what a screen reader announces).
 */

const NAV = ["Dashboard", "Banking", "Transactions", "Sales & Invoicing", "Purchases", "VAT & Compliance", "Financial Reports", "Business Intelligence", "Automation", "Settings"];

const KPIS = [
  { label: "Total Revenue", value: "R 2,840,560", delta: "13% vs last month", up: true },
  { label: "Total Costs", value: "R 1,965,420", delta: "5% vs last month", up: false },
  { label: "Gross Profit", value: "R 875,140", delta: "18% vs last month", up: true },
  { label: "Cash Position", value: "R 1,420,680", delta: "7% vs last month", up: true },
];

// Revenue / cost bar pairs, Jan–Sep (sample shape only).
const BARS: [number, number][] = [
  [38, 26], [52, 34], [44, 30], [66, 40], [58, 36], [74, 48], [62, 42], [86, 52], [78, 50],
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];

const EXPENSES = [
  { label: "Raw Materials", pct: 32, color: "#3b82f6" },
  { label: "Labour", pct: 24, color: "#a855f7" },
  { label: "Overheads", pct: 18, color: "#f59e0b" },
  { label: "Transport", pct: 12, color: "#22c55e" },
  { label: "Other", pct: 14, color: "#ef4444" },
];

// Each segment starts where the previous ones end (circumference 100,
// starting at 12 o'clock).
const DONUT_SEGMENTS = EXPENSES.map((e, i) => ({
  ...e,
  offset: 25 - EXPENSES.slice(0, i).reduce((sum, prev) => sum + prev.pct, 0),
}));

function Donut() {
  return (
    <svg viewBox="0 0 42 42" className="h-full w-full">
      {DONUT_SEGMENTS.map((e) => (
        <circle
          key={e.label}
          cx="21"
          cy="21"
          r="15.9155"
          fill="none"
          stroke={e.color}
          strokeWidth="6"
          strokeDasharray={`${e.pct - 1.2} ${100 - e.pct + 1.2}`}
          strokeDashoffset={e.offset}
        />
      ))}
    </svg>
  );
}

function BarChart() {
  return (
    <svg viewBox="0 0 180 80" preserveAspectRatio="none" className="h-full w-full">
      {[0, 20, 40, 60].map((y) => (
        <line key={y} x1="0" x2="180" y1={70 - y} y2={70 - y} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
      ))}
      {BARS.map(([rev, cost], i) => (
        <g key={i}>
          <rect x={6 + i * 19.5} y={70 - rev * 0.78} width="5" height={rev * 0.78} rx="1.2" fill="#2f8cff" />
          <rect x={12 + i * 19.5} y={70 - cost * 0.78} width="5" height={cost * 0.78} rx="1.2" fill="#a855f7" opacity="0.85" />
        </g>
      ))}
      {MONTHS.map((m, i) => (
        <text key={m} x={11 + i * 19.5} y="78" fontSize="4.2" fill="#8193ab" textAnchor="middle">
          {m}
        </text>
      ))}
    </svg>
  );
}

function CashFlow() {
  return (
    <svg viewBox="0 0 180 50" preserveAspectRatio="none" className="h-full w-full">
      <polyline points="0,34 20,30 40,33 60,24 80,27 100,18 120,22 140,14 160,17 180,9" fill="none" stroke="#2f8cff" strokeWidth="1.4" />
      <polyline points="0,40 20,38 40,36 60,37 80,32 100,34 120,29 140,30 160,26 180,24" fill="none" stroke="#f59e0b" strokeWidth="1.2" />
    </svg>
  );
}

function Screen({ extended }: { extended: boolean }) {
  return (
    <div className="flex h-full w-full bg-[#060f1c] text-left font-sans text-white">
      <div className="hidden w-[18%] shrink-0 flex-col gap-[0.35em] border-r border-white/5 bg-[#040b16] px-[0.7em] py-[0.9em] sm:flex">
        <p className="mb-[0.6em] font-[family-name:var(--font-brand)] text-[1.35em] leading-none">
          PRECISI<span className="text-[#1d8dff]">A</span>
        </p>
        {NAV.map((item, i) => (
          <p key={item} className={cn("truncate rounded-[0.35em] px-[0.5em] py-[0.3em] text-[0.62em]", i === 0 ? "bg-[#1459d9]/60 text-white" : "text-[#8193ab]")}>
            {item}
          </p>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[0.6em] p-[0.9em]">
        <div className="flex items-center justify-between">
          <p className="text-[0.95em] font-semibold">Good morning</p>
          <div className="flex gap-[0.4em] text-[0.55em] text-[#9fb0c6]">
            <span className="rounded-[0.4em] border border-white/10 px-[0.6em] py-[0.2em]">This month</span>
            <span className="rounded-[0.4em] border border-white/10 px-[0.6em] py-[0.2em]">All Companies</span>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-[0.5em]">
          {KPIS.map((k) => (
            <div key={k.label} className="rounded-[0.45em] border border-white/8 bg-[#0b1a2c] px-[0.55em] py-[0.5em]">
              <p className="truncate text-[0.55em] text-[#9fb0c6]">{k.label}</p>
              <p className="mt-[0.15em] truncate text-[0.9em] font-bold tabular-nums">{k.value}</p>
              <p className={cn("truncate text-[0.5em]", k.up ? "text-[#27d17f]" : "text-[#f0474f]")}>
                {k.up ? "▲" : "▼"} {k.delta}
              </p>
            </div>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[1.35fr_1fr] gap-[0.5em]">
          <div className="flex min-h-0 flex-col rounded-[0.45em] border border-white/8 bg-[#0b1a2c] p-[0.55em]">
            <div className="flex items-center justify-between">
              <p className="text-[0.62em] font-semibold">Revenue vs Costs</p>
              <p className="flex gap-[0.6em] text-[0.5em] text-[#9fb0c6]">
                <span><span className="text-[#2f8cff]">●</span> Revenue</span>
                <span><span className="text-[#a855f7]">●</span> Costs</span>
              </p>
            </div>
            <div className="mt-[0.3em] min-h-0 flex-1">
              <BarChart />
            </div>
          </div>
          <div className="flex min-h-0 flex-col rounded-[0.45em] border border-white/8 bg-[#0b1a2c] p-[0.55em]">
            <p className="text-[0.62em] font-semibold">Expense Breakdown</p>
            <div className="mt-[0.3em] flex min-h-0 flex-1 items-center gap-[0.6em]">
              <div className="aspect-square h-full max-h-[5.5em]">
                <Donut />
              </div>
              <ul className="flex flex-1 flex-col gap-[0.25em]">
                {EXPENSES.map((e) => (
                  <li key={e.label} className="flex items-center justify-between gap-[0.4em] text-[0.5em] text-[#c9d4e3]">
                    <span className="flex items-center gap-[0.4em] truncate">
                      <span className="h-[0.7em] w-[0.7em] shrink-0 rounded-[0.15em]" style={{ background: e.color }} />
                      {e.label}
                    </span>
                    <span className="tabular-nums">{e.pct}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-[1.35fr_1fr] gap-[0.5em]">
          <div className="rounded-[0.45em] border border-white/8 bg-[#0b1a2c] p-[0.55em]">
            <p className="text-[0.62em] font-semibold">Invoices</p>
            <div className="mt-[0.3em] grid grid-cols-3 divide-x divide-white/10">
              {[
                { v: "48", l: "Outstanding", c: "text-[#2f9bff]" },
                { v: "24", l: "Overdue", c: "text-[#f0474f]" },
                { v: "152", l: "Paid this month", c: "text-[#27d17f]" },
              ].map((x) => (
                <div key={x.l} className="px-[0.5em]">
                  <p className={cn("text-[1.05em] font-bold tabular-nums", x.c)}>{x.v}</p>
                  <p className="truncate text-[0.5em] text-[#9fb0c6]">{x.l}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-[0.6em] rounded-[0.45em] border border-white/8 bg-[#0b1a2c] p-[0.55em]">
            <div className="flex-1">
              <p className="text-[0.62em] font-semibold">Bank Reconciliation</p>
              <p className="mt-[0.2em] text-[1.05em] font-bold tabular-nums">
                96% <span className="text-[0.5em] font-normal text-[#9fb0c6]">Matched</span>
              </p>
            </div>
            <div className="flex h-[2.2em] items-end gap-[0.18em]">
              {[30, 42, 38, 55, 62, 70, 84, 100].map((h, i) => (
                <span key={i} className="w-[0.32em] rounded-t-[0.1em] bg-[#2f8cff]" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        </div>
        {extended && (
          <div className="grid grid-cols-[1fr_1.35fr] gap-[0.5em]">
            <div className="rounded-[0.45em] border border-white/8 bg-[#0b1a2c] p-[0.55em]">
              <p className="text-[0.62em] font-semibold">Top Expenses</p>
              <ul className="mt-[0.3em] flex flex-col gap-[0.3em]">
                {EXPENSES.slice(0, 4).map((e, i) => (
                  <li key={e.label} className="flex items-center gap-[0.4em] text-[0.5em] text-[#c9d4e3]">
                    <span className="w-[5.5em] truncate">{e.label}</span>
                    <span className="h-[0.5em] rounded-full" style={{ width: `${80 - i * 15}%`, background: e.color }} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col rounded-[0.45em] border border-white/8 bg-[#0b1a2c] p-[0.55em]">
              <p className="text-[0.62em] font-semibold">Cash Flow</p>
              <div className="mt-[0.3em] h-[3.2em]">
                <CashFlow />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A caption under a device; omitted where the page places its own. */
function Caption({ show, className }: { show: boolean; className: string }) {
  return show ? <figcaption className={className}>Illustrative product preview — sample figures, not live data.</figcaption> : null;
}

/** Hero: the dashboard on a slightly angled desktop monitor. `screenStyle`
 * sets the screen's font size (every measurement inside is in em), so a
 * fixed-coordinate composition can scale it with its own unit. */
export function MonitorPreview({ className, screenStyle, caption = true, stand = false }: { className?: string; screenStyle?: CSSProperties; caption?: boolean; stand?: boolean }) {
  return (
    <figure className={cn("[perspective:1600px]", className)}>
      <div aria-hidden className="origin-left [transform:rotateY(-14deg)_rotateX(2deg)]">
        <div className="rounded-[14px] border border-[#2a3f5c] bg-[#0a121e] p-[0.6%] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9),0_0_60px_-20px_rgba(47,155,255,0.45)]">
          <div className="aspect-[16/10] overflow-hidden rounded-[9px] text-[clamp(7px,0.95vw,15px)]" style={screenStyle}>
            <Screen extended={false} />
          </div>
        </div>
        {stand && (
          <>
            <div className="mx-auto h-[5%] w-[9%] bg-gradient-to-b from-[#1a2230] to-[#0c1118]" />
            <div className="mx-auto h-[1.6%] w-[30%] rounded-[50%] bg-gradient-to-b from-[#2a3342] to-[#0c1118] shadow-[0_10px_20px_-6px_rgba(0,0,0,0.9)]" />
          </>
        )}
      </div>
      <Caption show={caption} className="mt-3 text-center text-[0.7rem] text-[#7f8da6]" />
    </figure>
  );
}

/** The Platform: the dashboard on an open laptop. */
export function LaptopPreview({ className, screenStyle, caption = true }: { className?: string; screenStyle?: CSSProperties; caption?: boolean }) {
  return (
    <figure className={cn("[perspective:1800px]", className)}>
      <div aria-hidden className="[transform:rotateY(-16deg)_rotateX(4deg)]">
        <div className="rounded-t-[16px] border border-[#1b2533] bg-[#0b0f16] p-[1.6%] shadow-[0_40px_80px_-30px_rgba(10,22,64,0.65)]">
          <div className="aspect-[16/10.4] overflow-hidden rounded-[6px] text-[clamp(7px,0.9vw,14px)]" style={screenStyle}>
            <Screen extended />
          </div>
        </div>
        <div className="mx-[-4%] h-[14px] rounded-b-[18px] bg-gradient-to-b from-[#c9d1dc] to-[#8e98a6] shadow-[0_24px_40px_-18px_rgba(10,22,64,0.6)]" />
      </div>
      <Caption show={caption} className="mt-4 text-center text-[0.7rem] text-[#5d6a82]" />
    </figure>
  );
}
