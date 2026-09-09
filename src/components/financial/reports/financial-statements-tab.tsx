"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv-export";
import { IconArrowDown } from "@/components/ui/icons";
import type { IncomeStatement, StatementSection } from "@/server/reporting/income-statement-engine";
import type { BalanceSheet } from "@/server/reporting/balance-sheet-engine";
import type { CashFlowStatement } from "@/server/reporting/cash-flow-engine";
import type { ChartOfAccount } from "@/server/general-ledger/types";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SectionRows({ section, generalLedgerHref }: { section: StatementSection; generalLedgerHref: string }) {
  if (section.lines.length === 0) return <p className="py-1.5 text-xs text-vf-ink-faint">No activity this period.</p>;
  return (
    <div className="flex flex-col">
      {section.lines.map((l) => (
        <div key={l.accountId} className="flex items-center justify-between gap-2 border-t border-vf-paper-border py-1.5 text-sm first:border-0">
          <span className="text-vf-ink-soft">
            {l.accountCode && <span className="mr-1.5 font-mono text-xs text-vf-ink-faint">{l.accountCode}</span>}
            {l.accountCode ? (
              <Link href={`${generalLedgerHref}/${l.accountId}`} className="hover:text-vf-red-600 hover:underline">
                {l.description}
              </Link>
            ) : (
              l.description
            )}
          </span>
          <span className="font-mono tabular-nums text-vf-ink">{money(l.amount)}</span>
        </div>
      ))}
    </div>
  );
}

function StatementSectionBlock({ section, generalLedgerHref, tone = "default" }: { section: StatementSection; generalLedgerHref: string; tone?: "default" | "total" }) {
  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-vf-ink">{section.label}</h3>
        <span className={cn("font-mono text-sm tabular-nums", tone === "total" && "text-base font-semibold")}>{money(section.total)}</span>
      </div>
      <SectionRows section={section} generalLedgerHref={generalLedgerHref} />
    </div>
  );
}

function IncomeStatementView({ statement, generalLedgerHref }: { statement: IncomeStatement; generalLedgerHref: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-vf-ink-faint">
        {statement.periodStart} to {statement.periodEnd} — generated directly from the General Ledger (two Trial Balance snapshots, diffed). No duplicated calculations.
      </p>
      <StatementSectionBlock section={statement.revenue} generalLedgerHref={generalLedgerHref} />
      <StatementSectionBlock section={statement.costOfSales} generalLedgerHref={generalLedgerHref} />
      <div className="flex items-center justify-between rounded-vf-md bg-vf-red-500/5 px-4 py-3">
        <span className="text-sm font-semibold text-vf-ink">Gross Profit</span>
        <span className="font-mono text-base font-semibold tabular-nums text-vf-ink">{money(statement.grossProfit)}</span>
      </div>
      <StatementSectionBlock section={statement.operatingExpenses} generalLedgerHref={generalLedgerHref} />
      <div className="flex items-center justify-between rounded-vf-md bg-vf-red-500/5 px-4 py-3">
        <span className="text-sm font-semibold text-vf-ink">Operating Profit</span>
        <span className="font-mono text-base font-semibold tabular-nums text-vf-ink">{money(statement.operatingProfit)}</span>
      </div>
      <StatementSectionBlock section={statement.otherIncome} generalLedgerHref={generalLedgerHref} />
      <StatementSectionBlock section={statement.otherExpense} generalLedgerHref={generalLedgerHref} />
      <div className="flex items-center justify-between rounded-vf-md bg-vf-success/10 px-4 py-3">
        <span className="text-sm font-semibold text-vf-ink">Net Profit</span>
        <span className="font-mono text-lg font-semibold tabular-nums text-vf-ink">{money(statement.netProfit)}</span>
      </div>
    </div>
  );
}

function BalanceSheetView({ sheet, generalLedgerHref }: { sheet: BalanceSheet; generalLedgerHref: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-vf-ink-faint">As of {sheet.asOfDate}</p>
        <Badge tone={sheet.isBalanced ? "good" : "danger"}>{sheet.isBalanced ? "Balanced" : "Out of Balance"}</Badge>
      </div>
      <StatementSectionBlock section={sheet.assets} generalLedgerHref={generalLedgerHref} tone="total" />
      <StatementSectionBlock section={sheet.liabilities} generalLedgerHref={generalLedgerHref} tone="total" />
      <StatementSectionBlock section={sheet.equity} generalLedgerHref={generalLedgerHref} tone="total" />
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-vf-md bg-vf-red-500/5 px-4 py-3">
          <p className="text-xs text-vf-ink-faint">Total Assets</p>
          <p className="font-mono text-base font-semibold tabular-nums text-vf-ink">{money(sheet.totalAssets)}</p>
        </div>
        <div className="rounded-vf-md bg-vf-red-500/5 px-4 py-3">
          <p className="text-xs text-vf-ink-faint">Total Liabilities + Equity</p>
          <p className="font-mono text-base font-semibold tabular-nums text-vf-ink">{money(sheet.totalLiabilitiesAndEquity)}</p>
        </div>
      </div>
    </div>
  );
}

/** Finding #108 — every operating/investing/financing line already drills
 * down to its own GL account (see `SectionRows` above); only the
 * top-level `reconciliationVariance` was a dead end. Per
 * `cash-flow-engine.ts`'s own docstring, this figure is provably 0.00 by
 * construction (every posting is balanced) — a non-zero value is a
 * data-integrity signal (an unbalanced posting slipped through), not a
 * routine budget-style variance, so the drill-down below frames it as a
 * diagnostic: direct links into the actual cash/bank accounts' GL
 * activity for this exact period, where the discrepancy must live. */
function CashFlowView({ statement, cashAccounts, generalLedgerHref }: { statement: CashFlowStatement; cashAccounts: ChartOfAccount[]; generalLedgerHref: string }) {
  const hasVariance = statement.reconciliationVariance !== 0;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-vf-ink-faint">{statement.periodStart} to {statement.periodEnd} — indirect method.</p>
      <StatementSectionBlock section={statement.operatingActivities} generalLedgerHref={generalLedgerHref} tone="total" />
      <StatementSectionBlock section={statement.investingActivities} generalLedgerHref={generalLedgerHref} tone="total" />
      <StatementSectionBlock section={statement.financingActivities} generalLedgerHref={generalLedgerHref} tone="total" />
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-vf-md bg-vf-red-500/5 px-4 py-3">
          <p className="text-xs text-vf-ink-faint">Opening Cash</p>
          <p className="font-mono text-base font-semibold tabular-nums text-vf-ink">{money(statement.openingCash)}</p>
        </div>
        <div className="rounded-vf-md bg-vf-red-500/5 px-4 py-3">
          <p className="text-xs text-vf-ink-faint">Closing Cash</p>
          <p className="font-mono text-base font-semibold tabular-nums text-vf-ink">{money(statement.closingCash)}</p>
        </div>
      </div>
      <p className="text-xs text-vf-ink-faint">
        Net change in cash (indirect): {money(statement.netChangeInCash)} · Direct cash movement: {money(statement.actualCashMovement)} · Reconciliation
        variance: <span className={statement.reconciliationVariance === 0 ? "text-vf-success" : "text-vf-danger"}>{money(statement.reconciliationVariance)}</span>
      </p>
      {hasVariance && cashAccounts.length > 0 && (
        <div className="rounded-vf-md border border-vf-danger/25 bg-vf-danger/8 p-4">
          <p className="text-sm font-medium text-vf-danger">
            This should always be R 0.00 — every posting in this platform is balanced by construction, so a non-zero variance means an unbalanced entry
            reached the cash/bank accounts. Investigate directly:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {cashAccounts.map((a) => (
              <Link
                key={a.id}
                href={`${generalLedgerHref}/${a.id}?dateFrom=${statement.periodStart}&dateTo=${statement.periodEnd}`}
                className="rounded-vf-sm border border-vf-danger/30 bg-vf-paper px-2.5 py-1 text-xs font-medium text-vf-danger hover:bg-vf-danger/10"
              >
                {a.accountCode} — {a.description}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const STATEMENTS = ["Income Statement", "Balance Sheet", "Cash Flow"] as const;

export function FinancialStatementsTab({
  companyId,
  incomeStatement,
  balanceSheet,
  cashFlowStatement,
  cashAccounts,
}: {
  companyId: string;
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  cashFlowStatement: CashFlowStatement;
  cashAccounts: ChartOfAccount[];
}) {
  const [active, setActive] = useState<(typeof STATEMENTS)[number]>("Income Statement");
  const generalLedgerHref = `/company/${companyId}/general-ledger`;

  // Finding #046 — Financial Statements/Report Designer/Management
  // Reports had no export/download/print anywhere (unlike Trial Balance,
  // which already has the full CSV/XLSX/Print trio). CSV export here is
  // client-side over the statement's already-rendered sections — no new
  // fetch, mirroring `report-viewer.tsx`'s established lightweight
  // pattern for a dynamic, already-loaded data shape.
  function exportActiveStatementCsv() {
    const sections: StatementSection[] =
      active === "Income Statement"
        ? [incomeStatement.revenue, incomeStatement.costOfSales, incomeStatement.operatingExpenses, incomeStatement.otherIncome, incomeStatement.otherExpense]
        : active === "Balance Sheet"
          ? [balanceSheet.assets, balanceSheet.liabilities, balanceSheet.equity]
          : [cashFlowStatement.operatingActivities, cashFlowStatement.investingActivities, cashFlowStatement.financingActivities];
    const rows = sections.flatMap((s) => [
      ...s.lines.map((l) => [s.label, l.accountCode, l.description, l.amount.toFixed(2)]),
      [s.label, "", "Section Total", s.total.toFixed(2)],
    ]);
    downloadCsv(`${active.replace(/\s+/g, "-").toLowerCase()}.csv`, ["Section", "Account Code", "Description", "Amount"], rows);
  }

  return (
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
          <Button variant="subtle" size="sm" onClick={exportActiveStatementCsv}>
            <IconArrowDown className="h-4 w-4" /> Export CSV
          </Button>
          <Button variant="subtle" size="sm" onClick={() => window.print()}>
            Print / Export PDF
          </Button>
          <Button href={`${generalLedgerHref}?tab=trial-balance`} variant="subtle" size="sm">
            Trial Balance
          </Button>
          <Button href={`${generalLedgerHref}?tab=gl-inquiry`} variant="subtle" size="sm">
            GL Inquiry
          </Button>
        </div>
      </div>
      <CardContent className="pt-5">
        {active === "Income Statement" && <IncomeStatementView statement={incomeStatement} generalLedgerHref={generalLedgerHref} />}
        {active === "Balance Sheet" && <BalanceSheetView sheet={balanceSheet} generalLedgerHref={generalLedgerHref} />}
        {active === "Cash Flow" && <CashFlowView statement={cashFlowStatement} cashAccounts={cashAccounts} generalLedgerHref={generalLedgerHref} />}
      </CardContent>
    </Card>
  );
}
