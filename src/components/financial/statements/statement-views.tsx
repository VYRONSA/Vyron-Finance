"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { StatementSection } from "@/server/reporting/income-statement-engine";
import type { IncomeStatement } from "@/server/reporting/income-statement-engine";
import type { BalanceSheet } from "@/server/reporting/balance-sheet-engine";
import type { CashFlowStatement } from "@/server/reporting/cash-flow-engine";
import type { StatementOfChangesInEquity } from "@/server/reporting/equity-engine";

export function money(value: number): string {
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

function StatementSectionBlock({ section, generalLedgerHref }: { section: StatementSection; generalLedgerHref: string }) {
  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-vf-ink">{section.label}</h3>
        <span className="font-mono text-sm tabular-nums">{money(section.total)}</span>
      </div>
      <SectionRows section={section} generalLedgerHref={generalLedgerHref} />
    </div>
  );
}

export function IncomeStatementView({ statement, generalLedgerHref }: { statement: IncomeStatement; generalLedgerHref: string }) {
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

export function BalanceSheetView({ sheet, generalLedgerHref }: { sheet: BalanceSheet; generalLedgerHref: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-vf-ink-faint">As of {sheet.asOfDate}</p>
        <Badge tone={sheet.isBalanced ? "good" : "danger"}>{sheet.isBalanced ? "Balanced" : "Out of Balance"}</Badge>
      </div>
      <StatementSectionBlock section={sheet.assets} generalLedgerHref={generalLedgerHref} />
      <StatementSectionBlock section={sheet.liabilities} generalLedgerHref={generalLedgerHref} />
      <StatementSectionBlock section={sheet.equity} generalLedgerHref={generalLedgerHref} />
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

export function EquityStatementView({ statement, generalLedgerHref }: { statement: StatementOfChangesInEquity; generalLedgerHref: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-vf-ink-faint">{statement.periodStart} to {statement.periodEnd} — reconciles Opening Equity to Closing Equity via real account movements plus the period&rsquo;s Net Profit.</p>
      <div className="overflow-x-auto rounded-vf-md border border-vf-paper-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-vf-paper-border text-left text-xs text-vf-ink-faint">
              <th className="px-4 py-2 font-medium">Component</th>
              <th className="px-4 py-2 text-right font-medium">Opening Balance</th>
              <th className="px-4 py-2 text-right font-medium">Movements</th>
              <th className="px-4 py-2 text-right font-medium">Closing Balance</th>
            </tr>
          </thead>
          <tbody>
            {statement.rows.map((r) => (
              <tr key={r.accountId} className="border-b border-vf-paper-border last:border-0">
                <td className="px-4 py-2 text-vf-ink-soft">
                  {r.accountCode && <span className="mr-1.5 font-mono text-xs text-vf-ink-faint">{r.accountCode}</span>}
                  {r.accountId > 0 ? (
                    <Link href={`${generalLedgerHref}/${r.accountId}`} className="hover:text-vf-red-600 hover:underline">
                      {r.description}
                    </Link>
                  ) : (
                    r.description
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">{money(r.openingBalance)}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">{money(r.movements)}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">{money(r.closingBalance)}</td>
              </tr>
            ))}
            <tr className={cn("font-semibold text-vf-ink")}>
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">{money(statement.totalOpeningBalance)}</td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">{money(statement.totalMovements)}</td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">{money(statement.totalClosingBalance)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CashFlowView({ statement, generalLedgerHref }: { statement: CashFlowStatement; generalLedgerHref: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-vf-ink-faint">{statement.periodStart} to {statement.periodEnd} — indirect method.</p>
      <StatementSectionBlock section={statement.operatingActivities} generalLedgerHref={generalLedgerHref} />
      <StatementSectionBlock section={statement.investingActivities} generalLedgerHref={generalLedgerHref} />
      <StatementSectionBlock section={statement.financingActivities} generalLedgerHref={generalLedgerHref} />
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
    </div>
  );
}
