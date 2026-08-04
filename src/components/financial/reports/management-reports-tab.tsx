"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { StatementSection } from "@/server/reporting/income-statement-engine";
import type { Budget } from "@/server/reporting/types";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Budget vs Actual — Actuals come straight from the Income Statement
 * engine (no second calculation), scoped to whole-company budgets only
 * for now (dimension-scoped budgets are real schema — see the `budgets`
 * table — but this tab's first pass keeps the comparison simple). */
export function ManagementReportsTab({
  companyId,
  financialYearLabel,
  budgets,
  accounts,
  actualSections,
  previewMode,
}: {
  companyId: string;
  financialYearLabel: string;
  budgets: Budget[];
  accounts: ChartOfAccount[];
  actualSections: StatementSection[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  const actualByAccountId = new Map(actualSections.flatMap((s) => s.lines).map((l) => [l.accountId, l.amount]));
  const budgetableAccounts = accounts.filter((a) => a.accountType === "Income" || a.accountType === "Cost of Sales" || a.accountType === "Expense");

  const rows = budgets.map((b) => {
    const account = accounts.find((a) => a.id === b.accountId);
    const actual = actualByAccountId.get(b.accountId) ?? 0;
    const variance = actual - b.amount;
    const variancePercent = b.amount !== 0 ? Math.round((variance / Math.abs(b.amount)) * 1000) / 10 : null;
    return { budget: b, account, actual, variance, variancePercent };
  });

  async function addBudget() {
    if (!accountId || !amount) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/budgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: Number(accountId), financialYearLabel, amount: Number(amount) }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setAccountId("");
      setAmount("");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Account</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="min-w-[220px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink"
            >
              <option value="">Select an account…</option>
              {budgetableAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountCode} — {a.description}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Budget Amount ({financialYearLabel})</label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-40" />
          </div>
          <Button variant="primary" size="sm" disabled={previewMode || loading || !accountId || !amount} title={disabledTitle} onClick={addBudget}>
            Save Budget
          </Button>
          {error && <p className="text-sm text-vf-danger">{error}</p>}
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="No budgets set for this financial year." description="Add a budget above to start tracking Budget vs Actual." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Account</TableHeadCell>
              <TableHeadCell className="text-right">Budget</TableHeadCell>
              <TableHeadCell className="text-right">Actual</TableHeadCell>
              <TableHeadCell className="text-right">Variance</TableHeadCell>
              <TableHeadCell className="text-right">Variance %</TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {rows.map(({ budget, account, actual, variance, variancePercent }) => (
              <TableRow key={budget.id}>
                <TableCell>
                  <span className="font-mono text-xs text-vf-ink-faint">{account?.accountCode}</span> {account?.description ?? `Account #${budget.accountId}`}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(budget.amount)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(actual)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(variance)}</TableCell>
                <TableCell className="text-right">
                  {variancePercent === null ? (
                    "—"
                  ) : (
                    <Badge tone={Math.abs(variancePercent) <= 10 ? "good" : Math.abs(variancePercent) <= 25 ? "warn" : "danger"}>{variancePercent}%</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
