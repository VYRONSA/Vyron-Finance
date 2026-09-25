import type { ComponentType, SVGProps } from "react";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/lib/format";
import { PlanePatches } from "@/components/ui/ref-plane";
import { DASHBOARD_HERO_PLANE } from "@/components/ui/ref-planes.generated";
import { IconArrowDown, IconArrowUp, IconCalendar } from "@/components/ui/icons";

/**
 * The top of the company dashboard, built to the owner's "Software Page"
 * reference (1672 x 941). The hero photograph is the reference's own
 * pixels at 1 image px : 1 CSS px (anchored right; never scaled). Every
 * figure below is the company's real data, computed on the dashboard page
 * from its General Ledger, bank accounts and sales invoices.
 */

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export type ReferenceKpi = { label: string; value: number; changePct: number | null; goodWhenUp: boolean; trend: number[]; icon: Icon };
export type MonthPair = { label: string; a: number; b: number };
export type Share = { label: string; amount: number; pct: number };

const rand = (v: number) => `R ${formatAmount(Math.round(v), 0)}`;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(Math.round(v));
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 68 + 1},${34 - ((v - min) / span) * 30}`).join(" ");
  return (
    <svg viewBox="0 0 70 36" className="h-[36px] w-[70px] overflow-visible" aria-hidden>
      <polyline points={`1,36 ${pts} 69,36`} fill={color} fillOpacity={0.14} stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function ReferenceHero({ greeting, firstName, periodLabel }: { greeting: string; firstName: string; periodLabel: string }) {
  const plane = DASHBOARD_HERO_PLANE;
  return (
    <section className="relative -mx-4 -mt-[19px] h-[300px] overflow-hidden sm:-mx-[17px] lg:h-[380px]" style={{ background: `${plane.bands.left} left top / 100% 100% no-repeat` }}>
      <div aria-hidden className="absolute top-0 right-0" style={{ width: plane.w, height: plane.h }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the reference's own pixels, served as-is */}
        <img src={plane.src} alt="" width={plane.w} height={plane.h} className="absolute inset-0 max-w-none" style={{ width: plane.w, height: plane.h }} draggable={false} />
        <PlanePatches patches={plane.patches} unit="px" />
      </div>
      <div className="relative px-6 pt-[44px] lg:pl-[33px]">
        <h1 className="pc-heading text-[2rem] leading-tight font-bold text-white lg:text-[2.15rem]">
          {greeting}, {firstName}
        </h1>
        <p className="mt-1 text-[1.12rem] text-[#e8ecf2]">Here&rsquo;s what&rsquo;s happening across your business today.</p>
      </div>
      {/* The figures below are for this month — shown as a label, not a
          selector (there is no period picker yet). */}
      <p className="absolute top-[26px] right-[444px] hidden h-[58px] items-center gap-2.5 rounded-[10px] border border-white/12 bg-[#0c1626]/80 px-4 text-[0.98rem] font-medium text-white xl:flex">
        <IconCalendar className="h-[18px] w-[18px]" />
        {periodLabel}
      </p>
    </section>
  );
}

export function ReferenceKpis({ kpis }: { kpis: ReferenceKpi[] }) {
  return (
    <section className="relative z-10 -mt-[2px] grid grid-cols-1 gap-[17px] sm:grid-cols-2 xl:grid-cols-4">
      <h2 className="sr-only">Key figures this month</h2>
      {kpis.map((k) => {
        const I = k.icon;
        const up = (k.changePct ?? 0) >= 0;
        const good = k.changePct === null ? null : up === k.goodWhenUp;
        const color = good === null ? "#9fb0c6" : good ? "#27d17f" : "#f0474f";
        return (
          <div key={k.label} className="flex h-[112px] items-center gap-4 rounded-[12px] border border-[#1f3550] bg-[#0b1627]/95 px-[14px] shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)]">
            <span className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-[10px] border border-[#23426a] bg-[#0e2340] text-[#3f9bff]">
              <I className="h-[30px] w-[30px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.84rem] text-[#dbe4f1]">{k.label}</p>
              <p className="mt-1 text-[1.5rem] leading-tight font-bold tracking-[-0.01em] whitespace-nowrap tabular-nums text-white">{rand(k.value)}</p>
              <p className="mt-1 flex items-center gap-1 text-[0.84rem] whitespace-nowrap" style={{ color }}>
                {k.changePct === null ? (
                  "No prior month"
                ) : (
                  <>
                    {up ? <IconArrowUp className="h-3.5 w-3.5" /> : <IconArrowDown className="h-3.5 w-3.5" />}
                    {Math.abs(Math.round(k.changePct))}% vs last month
                  </>
                )}
              </p>
            </div>
            <div className="hidden shrink-0 self-end pb-5 sm:block">
              <Sparkline data={k.trend} color={good === false ? "#f0474f" : good ? "#27d17f" : "#2f8cff"} />
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Panel({ title, legend, className, children }: { title: string; legend?: { label: string; color: string }[]; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-[12px] border border-[#1a2c44] bg-[#0a1524]/95 px-[17px] pt-[15px] pb-[14px]", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="pc-heading text-[1.02rem] font-semibold text-white">{title}</h2>
        {legend && (
          <p className="flex gap-4 text-[0.84rem] text-[#dbe4f1]">
            {legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="flex h-[150px] items-center justify-center text-center text-[0.84rem] text-[#8d9bb0]">{text}</p>;

function Axis({ max, height }: { max: number; height: number }) {
  return (
    <>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={34} x2={500} y1={height - f * height + 6} y2={height - f * height + 6} stroke="rgba(255,255,255,0.07)" />
          <text x={28} y={height - f * height + 10} textAnchor="end" fontSize={11} fill="#c9d4e3">
            {compact(max * f)}
          </text>
        </g>
      ))}
    </>
  );
}

export function RevenueVsCosts({ months }: { months: MonthPair[] }) {
  const max = niceMax(Math.max(0, ...months.flatMap((m) => [m.a, m.b])));
  const H = 130;
  const slot = 466 / Math.max(months.length, 1);
  const has = months.some((m) => m.a !== 0 || m.b !== 0);
  return (
    <Panel title="Revenue vs Costs" legend={[{ label: "Revenue", color: "#2f8cff" }, { label: "Costs", color: "#8b5cf6" }]}>
      {has ? (
        <svg viewBox={`0 0 500 ${H + 30}`} className="mt-2 h-[160px] w-full" role="img" aria-label="Revenue and costs per month">
          <Axis max={max} height={H} />
          {months.map((m, i) => {
            const x = 34 + i * slot + slot / 2;
            const ha = Math.max(0, (m.a / max) * H);
            const hb = Math.max(0, (m.b / max) * H);
            return (
              <g key={m.label}>
                <rect x={x - 11} y={H + 6 - hb} width={10} height={hb} rx={2} fill="#8b5cf6" />
                <rect x={x + 1} y={H + 6 - ha} width={10} height={ha} rx={2} fill="#2f8cff" />
                <text x={x} y={H + 26} textAnchor="middle" fontSize={11.5} fill="#dbe4f1">
                  {m.label}
                </text>
                <title>{`${m.label}: revenue ${rand(m.a)}, costs ${rand(m.b)}`}</title>
              </g>
            );
          })}
        </svg>
      ) : (
        <Empty text="Revenue and costs will chart here once transactions are posted to the General Ledger." />
      )}
    </Panel>
  );
}

const DONUT = ["#2f8cff", "#8b5cf6", "#f59e0b", "#22c55e", "#f0474f"];

export function ExpenseBreakdown({ shares }: { shares: Share[] }) {
  const segs = shares.map((s, i) => ({ ...s, color: DONUT[i % DONUT.length], offset: 25 - shares.slice(0, i).reduce((sum, p) => sum + p.pct, 0) }));
  return (
    <Panel title="Expense Breakdown">
      {shares.length ? (
        <div className="mt-3 flex items-center gap-6">
          <svg viewBox="0 0 42 42" className="h-[150px] w-[150px] shrink-0" role="img" aria-label="Expense breakdown this month">
            {segs.map((s) => (
              <circle key={s.label} cx="21" cy="21" r="15.9155" fill="none" stroke={s.color} strokeWidth="6" strokeDasharray={`${Math.max(s.pct - 0.8, 0.1)} ${100 - Math.max(s.pct - 0.8, 0.1)}`} strokeDashoffset={s.offset} />
            ))}
          </svg>
          <ul className="flex min-w-0 flex-1 flex-col gap-[13px]">
            {segs.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-3 text-[0.9rem] text-[#e6ebf2]">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="truncate" title={s.label}>{s.label}</span>
                </span>
                <span className="tabular-nums">{Math.round(s.pct)}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Empty text="No expenses posted this month yet." />
      )}
    </Panel>
  );
}

export function CashFlowTrend({ months }: { months: MonthPair[] }) {
  const max = niceMax(Math.max(0, ...months.flatMap((m) => [m.a, m.b])));
  const H = 130;
  const step = 466 / Math.max(months.length - 1, 1);
  const line = (key: "a" | "b") => months.map((m, i) => `${34 + i * step},${H + 6 - (m[key] / max) * H}`).join(" ");
  const has = months.some((m) => m.a !== 0 || m.b !== 0);
  return (
    <Panel title="Cash Flow Trend" legend={[{ label: "Inflow", color: "#27d17f" }, { label: "Outflow", color: "#f0474f" }]}>
      {has ? (
        <svg viewBox={`0 0 510 ${H + 30}`} className="mt-2 h-[160px] w-full overflow-visible" role="img" aria-label="Cash inflow and outflow per month">
          <Axis max={max} height={H} />
          {(["a", "b"] as const).map((k) => (
            <g key={k}>
              <polyline points={line(k)} fill="none" stroke={k === "a" ? "#27d17f" : "#f0474f"} strokeWidth={2} strokeLinejoin="round" />
              {months.map((m, i) => (
                <circle key={m.label} cx={34 + i * step} cy={H + 6 - (m[k] / max) * H} r={3.2} fill={k === "a" ? "#27d17f" : "#f0474f"} />
              ))}
            </g>
          ))}
          {months.map((m, i) => (
            <text key={m.label} x={34 + i * step} y={H + 26} textAnchor="middle" fontSize={11.5} fill="#dbe4f1">
              {m.label}
            </text>
          ))}
        </svg>
      ) : (
        <Empty text="Cash movements will chart here once bank transactions are posted." />
      )}
    </Panel>
  );
}

export function InvoicesCard({ outstanding, overdue, paid }: { outstanding: number; overdue: number; paid: number }) {
  const total = Math.max(outstanding + overdue + paid, 1);
  const items = [
    { value: outstanding, label: "Outstanding", color: "#2f9bff" },
    { value: overdue, label: "Overdue", color: "#f0474f" },
    { value: paid, label: "Paid in full", color: "#27d17f" },
  ];
  return (
    <Panel title="Invoices">
      <div className="mt-3 grid grid-cols-3 divide-x divide-white/10">
        {items.map((it) => (
          <div key={it.label} className="px-4 first:pl-1">
            <p className="text-[2.1rem] leading-none font-bold tabular-nums" style={{ color: it.color }}>
              {it.value}
            </p>
            <p className="mt-2 text-[0.9rem] text-[#dbe4f1]">{it.label}</p>
            <div className="mt-3 h-[5px] rounded-full bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${(it.value / total) * 100}%`, background: it.color }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function BankReconciliationCard({ matched, total }: { matched: number; total: number }) {
  const pct = total > 0 ? Math.round((matched / total) * 100) : null;
  return (
    <Panel title="Bank Reconciliation">
      {pct === null ? (
        <Empty text="No bank transactions imported yet." />
      ) : (
        <div className="mt-3 flex items-center gap-5">
          <svg viewBox="0 0 42 42" className="h-[84px] w-[84px] shrink-0" aria-hidden>
            <circle cx="21" cy="21" r="15.9155" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
            <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#27d17f" strokeWidth="6" strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={25} />
          </svg>
          <div>
            <p className="text-[1.7rem] leading-none font-bold text-white">{pct}%</p>
            <p className="mt-1 text-[0.9rem] text-[#dbe4f1]">Matched</p>
          </div>
          <ul className="ml-auto flex flex-col gap-2 text-[0.9rem] text-[#dbe4f1]">
            <li className="flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#27d17f]" />Matched <span className="ml-6 tabular-nums">{pct}%</span></li>
            <li className="flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#9aa6b6]" />Unmatched <span className="ml-3 tabular-nums">{100 - pct}%</span></li>
          </ul>
        </div>
      )}
    </Panel>
  );
}

const BARS = ["#2f8cff", "#8b5cf6", "#f59e0b", "#22c55e", "#9aa6b6"];

export function TopExpenses({ shares }: { shares: Share[] }) {
  return (
    <Panel title="Top 5 Expenses">
      {shares.length ? (
        <ul className="mt-3 flex flex-col gap-[7px]">
          {shares.map((s, i) => (
            <li key={s.label} className="grid grid-cols-[minmax(0,8rem)_1fr_2.6rem] items-center gap-3 text-[0.84rem] text-[#e6ebf2]" title={`${s.label}: ${rand(s.amount)}`}>
              <span className="truncate">{s.label}</span>
              <span className="h-[8px] rounded-full bg-white/10">
                <span className="block h-full rounded-full" style={{ width: `${s.pct}%`, background: BARS[i] }} />
              </span>
              <span className="text-right tabular-nums">{Math.round(s.pct)}%</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty text="No expenses posted this month yet." />
      )}
    </Panel>
  );
}
