"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { ConfirmActionRow, useConfirmTarget } from "@/components/ui/confirm-action";
import { IconArrowDown } from "@/components/ui/icons";
import { downloadCsv } from "@/lib/csv-export";
import { REPORT_TYPES, type ReportColumn, type ReportDefinition, type ReportType } from "@/server/reporting/types";

/** Finding #045 — which date parameters each `ReportType`'s "Run" needs,
 * mirroring exactly what `report-run-service.ts::getRawRows` requires per
 * type (kept in sync deliberately, not derived, since the service is the
 * one source of truth for what's actually required). */
const RUN_PARAMS_BY_TYPE: Record<ReportType, ("asOfDate" | "periodStart" | "periodEnd" | "financialYearStartDate" | "financialYearLabel")[]> = {
  TrialBalance: ["asOfDate"],
  Custom: ["asOfDate"],
  IncomeStatement: ["periodStart", "periodEnd"],
  CashFlow: ["periodStart", "periodEnd"],
  BalanceSheet: ["asOfDate", "financialYearStartDate"],
  GLInquiry: ["periodStart", "periodEnd"],
  BudgetVsActual: ["financialYearLabel", "periodStart", "periodEnd"],
};

const PARAM_LABEL: Record<string, string> = {
  asOfDate: "As At",
  periodStart: "Period Start",
  periodEnd: "Period End",
  financialYearStartDate: "Financial Year Start",
  financialYearLabel: "Financial Year Label",
};

function RunReportPanel({ companyId, definition, onClose }: { companyId: string; definition: ReportDefinition; onClose: () => void }) {
  const neededParams = RUN_PARAMS_BY_TYPE[definition.reportType];
  const today = new Date().toISOString().slice(0, 10);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(neededParams.map((p) => [p, p === "financialYearLabel" ? "" : today])),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams(Object.fromEntries(neededParams.map((p) => [p, values[p] ?? ""])));
      const res = await fetch(`/api/companies/${companyId}/report-definitions/${definition.id}/run?${query.toString()}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setRows(body.rows);
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  const columnFields = [...definition.columns.map((c) => c.field), ...definition.calculatedFields.map((f) => f.name)];
  const columnLabels = [...definition.columns.map((c) => c.label), ...definition.calculatedFields.map((f) => f.name)];

  function exportCsv() {
    if (!rows) return;
    downloadCsv(
      `${definition.name.replace(/\s+/g, "-").toLowerCase()}.csv`,
      columnLabels,
      rows.map((r) => columnFields.map((f) => String(r[f] ?? ""))),
    );
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-vf-ink">Run: {definition.name}</p>
        <Button variant="subtle" size="sm" onClick={onClose}>Close</Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {neededParams.map((p) => (
          <div key={p}>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">{PARAM_LABEL[p]}</label>
            <Input
              type={p === "financialYearLabel" ? "text" : "date"}
              value={values[p] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))}
              className="w-40"
              placeholder={p === "financialYearLabel" ? "e.g. FY2026" : undefined}
            />
          </div>
        ))}
        <Button variant="primary" size="sm" disabled={loading} onClick={run}>
          {loading ? "Running…" : "Run Report"}
        </Button>
        {rows && rows.length > 0 && (
          <>
            <Button variant="subtle" size="sm" onClick={exportCsv}>
              <IconArrowDown className="h-4 w-4" /> Export CSV
            </Button>
            <Button variant="subtle" size="sm" onClick={() => window.print()}>
              Print / Export PDF
            </Button>
          </>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
      {rows && (
        rows.length === 0 ? (
          <p className="mt-3 text-sm text-vf-ink-faint">No rows for these parameters.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHead>
                <tr>
                  {columnLabels.map((label) => (
                    <TableHeadCell key={label}>{label}</TableHeadCell>
                  ))}
                </tr>
              </TableHead>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i}>
                    {columnFields.map((field) => (
                      <TableCell key={field}>{String(row[field] ?? "")}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}
    </div>
  );
}

/** Fixed, real per-type column lists — a form-based designer, not
 * drag-and-drop, but nothing about a report's layout is hardcoded in a
 * page template: it's picked here and persisted to `report_definitions`,
 * then read back to render. */
const COLUMNS_BY_TYPE: Record<ReportType, ReportColumn[]> = {
  TrialBalance: [{ field: "accountCode", label: "Account Code" }, { field: "description", label: "Description" }, { field: "debitBalance", label: "Debit" }, { field: "creditBalance", label: "Credit" }],
  IncomeStatement: [{ field: "accountCode", label: "Account Code" }, { field: "description", label: "Description" }, { field: "reportingGroup", label: "Reporting Group" }, { field: "amount", label: "Amount" }],
  BalanceSheet: [{ field: "accountCode", label: "Account Code" }, { field: "description", label: "Description" }, { field: "reportingGroup", label: "Reporting Group" }, { field: "amount", label: "Amount" }],
  CashFlow: [{ field: "description", label: "Description" }, { field: "amount", label: "Amount" }],
  GLInquiry: [{ field: "postingDate", label: "Date" }, { field: "accountCode", label: "Account" }, { field: "reference", label: "Reference" }, { field: "debit", label: "Debit" }, { field: "credit", label: "Credit" }],
  BudgetVsActual: [{ field: "accountCode", label: "Account" }, { field: "budget", label: "Budget" }, { field: "actual", label: "Actual" }, { field: "variance", label: "Variance" }],
  Custom: [{ field: "accountCode", label: "Account Code" }, { field: "description", label: "Description" }, { field: "amount", label: "Amount" }],
};

export function ReportDesignerTab({ companyId, reportDefinitions, previewMode }: { companyId: string; reportDefinitions: ReportDefinition[]; previewMode: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [reportType, setReportType] = useState<ReportType>("IncomeStatement");
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  // Finding #249 — mirrors the RC-3 `ConfirmActionRow`/`useConfirmTarget`
  // pattern already established for every other destructive action.
  const deleteConfirm = useConfirmTarget<number>();
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  const availableColumns = COLUMNS_BY_TYPE[reportType];

  function toggleField(field: string) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function save() {
    setLoading(true);
    setError(null);
    try {
      const columns = availableColumns.filter((c) => selectedFields.has(c.field));
      const res = await fetch(`/api/companies/${companyId}/report-definitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, reportType, columns, groups: [], filters: {}, calculatedFields: [] }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setName("");
      setSelectedFields(new Set());
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: number) {
    setLoading(true);
    try {
      await fetch(`/api/companies/${companyId}/report-definitions/${id}`, { method: "DELETE" });
      deleteConfirm.cancel();
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Report Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monthly Income Statement" className="w-64" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Report Type</label>
              <select
                value={reportType}
                onChange={(e) => {
                  setReportType(e.target.value as ReportType);
                  setSelectedFields(new Set());
                }}
                className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink"
              >
                {REPORT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-vf-ink-faint">Columns</p>
            <div className="flex flex-wrap gap-2">
              {availableColumns.map((c) => (
                <button
                  key={c.field}
                  type="button"
                  onClick={() => toggleField(c.field)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    selectedFields.has(c.field) ? "border-vf-red-500 bg-vf-red-500/10 text-vf-red-600" : "border-vf-paper-border text-vf-ink-soft hover:border-vf-red-400"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <Button variant="primary" size="sm" className="self-start" disabled={previewMode || loading || !name.trim() || selectedFields.size === 0} title={disabledTitle} onClick={save}>
            Save Report
          </Button>
          {error && <p className="text-sm text-vf-danger">{error}</p>}
        </CardContent>
      </Card>

      {reportDefinitions.length === 0 ? (
        <EmptyState title="No saved reports yet." description="Design one above — it's persisted and reusable, not a hardcoded layout." />
      ) : (
        <div className="flex flex-col gap-3">
          {reportDefinitions.map((r) => (
            <div key={r.id} className="rounded-vf-md border border-vf-paper-border p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-vf-ink">{r.name}</p>
                    <Badge tone="info">{r.reportType}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-vf-ink-faint">{r.columns.map((c) => c.label).join(", ")}</p>
                </div>
                {deleteConfirm.isConfirming(r.id) ? (
                  <ConfirmActionRow
                    message={`Delete "${r.name}"?`}
                    loading={loading}
                    tone="danger"
                    onConfirm={() => remove(r.id)}
                    onCancel={deleteConfirm.cancel}
                  />
                ) : (
                  <div className="flex gap-2">
                    <Button variant="subtle" size="sm" onClick={() => setRunningId(runningId === r.id ? null : r.id)}>
                      {runningId === r.id ? "Hide" : "Run"}
                    </Button>
                    <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => deleteConfirm.request(r.id)}>
                      Delete
                    </Button>
                  </div>
                )}
              </div>
              {runningId === r.id && (
                <div className="mt-3">
                  <RunReportPanel companyId={companyId} definition={r} onClose={() => setRunningId(null)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
