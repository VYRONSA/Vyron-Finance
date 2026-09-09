"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { BalanceSheetView, CashFlowView, EquityStatementView, IncomeStatementView } from "./statement-views";
import type { IncomeStatement } from "@/server/reporting/income-statement-engine";
import type { BalanceSheet } from "@/server/reporting/balance-sheet-engine";
import type { CashFlowStatement } from "@/server/reporting/cash-flow-engine";
import type { StatementOfChangesInEquity } from "@/server/reporting/equity-engine";
import type { DisclosureNote } from "@/server/disclosures/types";
import type { FinancialYear } from "@/server/company-management/types";

/** Client-safe mirror of `financial-year-service.ts::computeFinancialYearBounds`/
 * `computeFinancialYearLabel` — that file also imports server-only
 * repositories at module scope, so it can't be imported directly into a
 * "use client" component. Duplicated here rather than restructuring that
 * module's boundary, matching the shape of the reference this app
 * already ports. Used only as a fallback when no real `FinancialYear`
 * record covers the requested date (see `resolveFinancialYearStart`). */
function computeFallbackFinancialYearStart(dateStr: string, startMonth: number): string {
  const [year, month] = dateStr.split("-").map(Number);
  const endCalendarYear = month >= startMonth ? year + 1 : year;
  const startYear = startMonth === 1 ? endCalendarYear : endCalendarYear - 1;
  return `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
}

/** Finding #044 — a comparative Balance Sheet's retained-earnings
 * roll-forward needs the CORRECT financial year start for whatever prior
 * `asOfDate` is being compared to, not the current period's own FY start
 * (wrong whenever the comparison crosses a financial year boundary).
 * Prefers a real, persisted `FinancialYear` record covering that date
 * (which may have been manually adjusted) over the computed fallback. */
function resolveFinancialYearStart(dateStr: string, financialYears: FinancialYear[], startMonth: number): string {
  const covering = financialYears.find((fy) => fy.startDate <= dateStr && dateStr <= fy.endDate);
  return covering?.startDate ?? computeFallbackFinancialYearStart(dateStr, startMonth);
}

/** One period back, same length, immediately preceding (non-overlapping)
 * — the standard "same period last time" comparative. */
function priorPeriod(periodStart: string, periodEnd: string): { start: string; end: string } {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T00:00:00Z`);
  const lengthMs = end.getTime() - start.getTime();
  const priorEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const priorStart = new Date(priorEnd.getTime() - lengthMs);
  return { start: priorStart.toISOString().slice(0, 10), end: priorEnd.toISOString().slice(0, 10) };
}

const STATEMENTS = ["Financial Position", "Profit or Loss", "Changes in Equity", "Cash Flows"] as const;

function NoteCard({ companyId, note, previewMode }: { companyId: string; note: DisclosureNote; previewMode: boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [userNotes, setUserNotes] = useState(note.userNotes);
  const [saving, setSaving] = useState(false);
  const content = note.generatedContent as { facts?: string[]; placeholders?: string[] };
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/companies/${companyId}/disclosures/${note.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userNotes }) });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-vf-ink">{note.title}</p>
          {note.requiresUserInput && note.userNotes.trim() === "" && <Badge tone="warn">Requires Completion</Badge>}
          {note.requiresUserInput && note.userNotes.trim() !== "" && <Badge tone="good">Completed</Badge>}
        </div>
        <Button variant="subtle" size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide" : "View"}
        </Button>
      </div>
      {expanded && (
        <div className="mt-3 flex flex-col gap-3">
          {(content.facts?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-medium text-vf-ink-faint">Facts (from live data)</p>
              <ul className="mt-1 list-disc pl-4 text-sm text-vf-ink-soft">
                {content.facts!.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {(content.placeholders?.length ?? 0) > 0 && (
            <div className="rounded-vf-sm bg-vf-warning/10 p-2">
              <p className="text-xs font-medium text-vf-ink-faint">Requires Completion</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-vf-ink-soft">
                {content.placeholders!.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">User Commentary</label>
            <textarea
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              rows={3}
              disabled={previewMode}
              placeholder="Add preparer commentary to complete this note…"
              className="w-full rounded-lg border border-vf-paper-border bg-vf-paper px-3.5 py-2.5 text-sm text-vf-ink outline-none focus:border-vf-red-500"
            />
            <div className="mt-2 flex justify-end">
              <Button variant="primary" size="sm" disabled={previewMode || saving || userNotes === note.userNotes} title={disabledTitle} onClick={save}>
                {saving ? "Saving…" : "Save Commentary"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function StatementsNotesTab({
  companyId,
  incomeStatement,
  balanceSheet,
  cashFlowStatement,
  equityStatement,
  disclosureNotes,
  periodStart: initialPeriodStart,
  periodEnd: initialPeriodEnd,
  financialYearStartDate,
  financialYears,
  financialYearStartMonth,
  previewMode,
}: {
  companyId: string;
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  cashFlowStatement: CashFlowStatement;
  equityStatement: StatementOfChangesInEquity;
  disclosureNotes: DisclosureNote[];
  periodStart: string;
  periodEnd: string;
  financialYearStartDate: string;
  financialYears: FinancialYear[];
  financialYearStartMonth: number;
  previewMode: boolean;
}) {
  const router = useRouter();
  const [active, setActive] = useState<(typeof STATEMENTS)[number]>("Financial Position");
  const [generating, setGenerating] = useState(false);
  const generalLedgerHref = `/company/${companyId}/general-ledger`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  // Finding #009 — Financial Statements had no period selector at all,
  // hardcoded to month-to-date server-side. Finding #044 — optional
  // comparative (prior-period) figures.
  const [periodStart, setPeriodStart] = useState(initialPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(initialPeriodEnd);
  const [pendingPeriodStart, setPendingPeriodStart] = useState(initialPeriodStart);
  const [pendingPeriodEnd, setPendingPeriodEnd] = useState(initialPeriodEnd);
  const [compare, setCompare] = useState(false);
  const [income, setIncome] = useState(incomeStatement);
  const [balance, setBalance] = useState(balanceSheet);
  const [cashFlow, setCashFlow] = useState(cashFlowStatement);
  const [equity, setEquity] = useState(equityStatement);
  const [priorIncome, setPriorIncome] = useState<IncomeStatement | undefined>(undefined);
  const [priorBalance, setPriorBalance] = useState<BalanceSheet | undefined>(undefined);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  async function applyPeriod() {
    setApplying(true);
    setApplyError(null);
    try {
      const fyStart = resolveFinancialYearStart(pendingPeriodEnd, financialYears, financialYearStartMonth);
      const [incomeRes, balanceRes, cashFlowRes, equityRes] = await Promise.all([
        fetch(`/api/companies/${companyId}/financial-statements/income-statement?periodStart=${pendingPeriodStart}&periodEnd=${pendingPeriodEnd}`),
        fetch(`/api/companies/${companyId}/financial-statements/balance-sheet?asOfDate=${pendingPeriodEnd}&financialYearStartDate=${fyStart}`),
        fetch(`/api/companies/${companyId}/financial-statements/cash-flow?periodStart=${pendingPeriodStart}&periodEnd=${pendingPeriodEnd}`),
        fetch(`/api/companies/${companyId}/financial-statements/equity?periodStart=${fyStart}&periodEnd=${pendingPeriodEnd}&financialYearStartDate=${fyStart}`),
      ]);
      if (!incomeRes.ok || !balanceRes.ok || !cashFlowRes.ok || !equityRes.ok) {
        setApplyError("Couldn't load statements for that period.");
        return;
      }
      setIncome((await incomeRes.json()).incomeStatement);
      setBalance((await balanceRes.json()).balanceSheet);
      setCashFlow((await cashFlowRes.json()).cashFlowStatement);
      setEquity((await equityRes.json()).statementOfChangesInEquity);
      setPeriodStart(pendingPeriodStart);
      setPeriodEnd(pendingPeriodEnd);

      if (compare) {
        const prior = priorPeriod(pendingPeriodStart, pendingPeriodEnd);
        const priorFyStart = resolveFinancialYearStart(prior.end, financialYears, financialYearStartMonth);
        const [priorIncomeRes, priorBalanceRes] = await Promise.all([
          fetch(`/api/companies/${companyId}/financial-statements/income-statement?periodStart=${prior.start}&periodEnd=${prior.end}`),
          fetch(`/api/companies/${companyId}/financial-statements/balance-sheet?asOfDate=${prior.end}&financialYearStartDate=${priorFyStart}`),
        ]);
        setPriorIncome(priorIncomeRes.ok ? (await priorIncomeRes.json()).incomeStatement : undefined);
        setPriorBalance(priorBalanceRes.ok ? (await priorBalanceRes.json()).balanceSheet : undefined);
      } else {
        setPriorIncome(undefined);
        setPriorBalance(undefined);
      }
    } catch {
      setApplyError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setApplying(false);
    }
  }

  async function generateNotes() {
    setGenerating(true);
    try {
      await fetch(`/api/companies/${companyId}/disclosures`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periodStart, periodEnd, financialYearStartDate }) });
      router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-5">
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="fs-period-start">Period Start</label>
            <Input id="fs-period-start" type="date" value={pendingPeriodStart} disabled={previewMode} onChange={(e) => setPendingPeriodStart(e.target.value)} />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="fs-period-end">Period End</label>
            <Input id="fs-period-end" type="date" value={pendingPeriodEnd} disabled={previewMode} onChange={(e) => setPendingPeriodEnd(e.target.value)} />
          </div>
          <label className="flex items-center gap-1.5 pb-2 text-sm text-vf-ink-soft">
            <input type="checkbox" checked={compare} disabled={previewMode} onChange={(e) => setCompare(e.target.checked)} />
            Compare to prior period
          </label>
          <Button variant="subtle" size="sm" disabled={previewMode || applying} title={disabledTitle} onClick={applyPeriod}>
            {applying ? "Loading…" : "Apply"}
          </Button>
          {applyError && <p className="text-sm text-vf-danger">{applyError}</p>}
        </CardContent>
      </Card>

      <Card>
        <div className="flex flex-wrap gap-1 border-b border-vf-paper-border px-4 pt-3">
          {STATEMENTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setActive(s)}
              aria-current={active === s ? "page" : undefined}
              className={cn(
                "rounded-t-lg px-3.5 py-2 text-sm font-medium transition",
                active === s ? "border-b-2 border-vf-red-600 text-vf-red-600" : "text-vf-ink-faint hover:text-vf-ink-soft",
              )}
            >
              {s}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 py-2">
            <Button href={`${generalLedgerHref}?tab=trial-balance`} variant="subtle" size="sm">
              Trial Balance
            </Button>
            <Button href={`${generalLedgerHref}?tab=gl-inquiry`} variant="subtle" size="sm">
              General Ledger
            </Button>
          </div>
        </div>
        <CardContent className="pt-5">
          {active === "Financial Position" && <BalanceSheetView sheet={balance} priorSheet={priorBalance} generalLedgerHref={generalLedgerHref} />}
          {active === "Profit or Loss" && <IncomeStatementView statement={income} priorStatement={priorIncome} generalLedgerHref={generalLedgerHref} />}
          {active === "Changes in Equity" && <EquityStatementView statement={equity} generalLedgerHref={generalLedgerHref} />}
          {active === "Cash Flows" && <CashFlowView statement={cashFlow} generalLedgerHref={generalLedgerHref} />}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-vf-ink">Notes to the Financial Statements</h3>
              <p className="mt-1 text-xs text-vf-ink-faint">Real data where it exists; sections requiring preparer completion are clearly flagged, never fabricated.</p>
            </div>
            <Button variant="primary" size="sm" disabled={previewMode || generating} title={disabledTitle} onClick={generateNotes}>
              {generating ? "Generating…" : "Generate from Live Data"}
            </Button>
          </div>
          {disclosureNotes.length === 0 ? (
            <EmptyState title="No disclosure notes generated yet." description="Generate them above — Accounting Policies, Fixed Assets, Inventory, VAT, Revenue, Expenses, and more." />
          ) : (
            <div className="flex flex-col gap-3">
              {disclosureNotes.map((n) => (
                <NoteCard key={n.id} companyId={companyId} note={n} previewMode={previewMode} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
