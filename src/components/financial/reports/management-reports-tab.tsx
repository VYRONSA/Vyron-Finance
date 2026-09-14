"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { IconArrowDown } from "@/components/ui/icons";
import { downloadCsv } from "@/lib/csv-export";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { StatementSection } from "@/server/reporting/income-statement-engine";
import type { Budget } from "@/server/reporting/types";
import type { Branch, CostCentre, Department, Project } from "@/server/company-management/types";
import { formatAmount } from "@/lib/format";

function money(value: number): string {
  return `R ${formatAmount(value)}`;
}

/** Finding #107 — a Budget was always compared against the *whole
 * company's* actual for its account, even though `budgets` (and
 * `chart_of_accounts` itself) already carry real branch/department/cost
 * centre/project dimensions. Actuals still come from one Income Statement
 * (no second GL query path) — an account's own activity IS already
 * scoped to whichever dimension that account itself belongs to (the
 * platform's dimension model lives on `chart_of_accounts`, not on
 * individual postings), so filtering budgets by dimension and letting the
 * accountant pick a dimension-tagged account when saving one is the whole
 * fix — no new actual-computation engine needed. */
export function ManagementReportsTab({
  companyId,
  financialYearLabel,
  budgets,
  accounts,
  branches,
  departments,
  costCentres,
  projects,
  actualSections,
  previewMode,
}: {
  companyId: string;
  financialYearLabel: string;
  budgets: Budget[];
  accounts: ChartOfAccount[];
  branches: Branch[];
  departments: Department[];
  costCentres: CostCentre[];
  projects: Project[];
  actualSections: StatementSection[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [branchId, setBranchId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [costCentreId, setCostCentreId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [filterBranchId, setFilterBranchId] = useState("");
  const [filterDepartmentId, setFilterDepartmentId] = useState("");
  const [filterCostCentreId, setFilterCostCentreId] = useState("");
  const [filterProjectId, setFilterProjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  const actualByAccountId = new Map(actualSections.flatMap((s) => s.lines).map((l) => [l.accountId, l.amount]));
  const budgetableAccounts = accounts.filter((a) => a.accountType === "Income" || a.accountType === "Cost of Sales" || a.accountType === "Expense");

  const filteredBudgets = budgets.filter(
    (b) =>
      (!filterBranchId || b.branchId === Number(filterBranchId)) &&
      (!filterDepartmentId || b.departmentId === Number(filterDepartmentId)) &&
      (!filterCostCentreId || b.costCentreId === Number(filterCostCentreId)) &&
      (!filterProjectId || b.projectId === Number(filterProjectId)),
  );

  const rows = filteredBudgets.map((b) => {
    const account = accounts.find((a) => a.id === b.accountId);
    const actual = actualByAccountId.get(b.accountId) ?? 0;
    const variance = actual - b.amount;
    const variancePercent = b.amount !== 0 ? Math.round((variance / Math.abs(b.amount)) * 1000) / 10 : null;
    return { budget: b, account, actual, variance, variancePercent };
  });

  function dimensionLabel(b: Budget): string {
    const parts = [
      b.branchId !== null ? branches.find((x) => x.id === b.branchId)?.name : null,
      b.departmentId !== null ? departments.find((x) => x.id === b.departmentId)?.name : null,
      b.costCentreId !== null ? costCentres.find((x) => x.id === b.costCentreId)?.name : null,
      b.projectId !== null ? projects.find((x) => x.id === b.projectId)?.name : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" / ") : "Whole Company";
  }

  function exportCsv() {
    downloadCsv(
      "budget-vs-actual.csv",
      ["Account Code", "Account", "Dimension", "Budget", "Actual", "Variance", "Variance %"],
      rows.map(({ budget, account, actual, variance, variancePercent }) => [
        account?.accountCode ?? "",
        account?.description ?? `Account #${budget.accountId}`,
        dimensionLabel(budget),
        budget.amount.toFixed(2),
        actual.toFixed(2),
        variance.toFixed(2),
        variancePercent === null ? "" : `${variancePercent}%`,
      ]),
    );
  }

  async function addBudget() {
    if (!accountId || !amount) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/budgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: Number(accountId),
          financialYearLabel,
          amount: Number(amount),
          branchId: branchId ? Number(branchId) : null,
          departmentId: departmentId ? Number(departmentId) : null,
          costCentreId: costCentreId ? Number(costCentreId) : null,
          projectId: projectId ? Number(projectId) : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setAccountId("");
      setAmount("");
      setBranchId("");
      setDepartmentId("");
      setCostCentreId("");
      setProjectId("");
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
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Branch</label>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-40">
              <option value="">Whole Company</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Department</label>
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="w-40">
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Cost Centre</label>
            <Select value={costCentreId} onChange={(e) => setCostCentreId(e.target.value)} className="w-40">
              <option value="">All Cost Centres</option>
              {costCentres.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Project</label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-40">
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <Button variant="primary" size="sm" disabled={previewMode || loading || !accountId || !amount} title={disabledTitle} onClick={addBudget}>
            Save Budget
          </Button>
          {error && <p className="text-sm text-vf-danger">{error}</p>}
        </CardContent>
      </Card>

      {budgets.length > 0 && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Filter: Branch</label>
              <Select value={filterBranchId} onChange={(e) => setFilterBranchId(e.target.value)} className="w-40">
                <option value="">All Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Filter: Department</label>
              <Select value={filterDepartmentId} onChange={(e) => setFilterDepartmentId(e.target.value)} className="w-40">
                <option value="">All Departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Filter: Cost Centre</label>
              <Select value={filterCostCentreId} onChange={(e) => setFilterCostCentreId(e.target.value)} className="w-40">
                <option value="">All Cost Centres</option>
                {costCentres.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Filter: Project</label>
              <Select value={filterProjectId} onChange={(e) => setFilterProjectId(e.target.value)} className="w-40">
                <option value="">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>
          </div>
          {rows.length > 0 && (
            <div className="flex gap-2">
              <Button variant="subtle" size="sm" onClick={exportCsv}>
                <IconArrowDown className="h-4 w-4" /> Export CSV
              </Button>
              <Button variant="subtle" size="sm" onClick={() => window.print()}>
                Print / Export PDF
              </Button>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No budgets set for this financial year." description="Add a budget above to start tracking Budget vs Actual." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Account</TableHeadCell>
              <TableHeadCell>Dimension</TableHeadCell>
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
                <TableCell className="text-xs text-vf-ink-faint">{dimensionLabel(budget)}</TableCell>
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
