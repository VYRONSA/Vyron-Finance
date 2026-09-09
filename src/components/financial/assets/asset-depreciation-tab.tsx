"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { IconArrowDown } from "@/components/ui/icons";
import { downloadCsv } from "@/lib/csv-export";
import type { DepreciationRun, DepreciationRunLine, FixedAsset } from "@/server/assets/types";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Finding #110 — the depreciation SCHEDULE (per-asset lines within a
 * run) had a real, working backend (`listDepreciationRunLines` + its own
 * API route) with zero UI ever calling it, and no export existed for
 * either the schedule or the run summary list. "View Schedule" fetches
 * lazily per run (only once expanded) and exports via the same shared
 * CSV helper the Asset Register now uses (Finding #046's precedent). */
function DepreciationScheduleRows({ companyId, run, assets }: { companyId: string; run: DepreciationRun; assets: FixedAsset[] }) {
  const [lines, setLines] = useState<DepreciationRunLine[] | null>(null);
  const [loading, setLoading] = useState(true);
  const assetById = new Map(assets.map((a) => [a.id, a]));

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/companies/${companyId}/assets/depreciation-runs/${run.id}/lines`)
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setLines(body.lines ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, run.id]);

  function exportCsv() {
    if (!lines) return;
    downloadCsv(
      `depreciation-schedule-${run.periodStart}-to-${run.periodEnd}.csv`,
      ["Asset Number", "Description", "Depreciation Amount", "Accumulated Depreciation After", "Net Book Value After"],
      lines.map((l) => {
        const asset = assetById.get(l.assetId);
        return [asset?.assetNumber ?? String(l.assetId), asset?.description ?? "", l.depreciationAmount.toFixed(2), l.accumulatedDepreciationAfter.toFixed(2), l.netBookValueAfter.toFixed(2)];
      }),
    );
  }

  if (loading) return <p className="mt-2 text-xs text-vf-ink-faint">Loading schedule…</p>;
  if (!lines || lines.length === 0) return <p className="mt-2 text-xs text-vf-ink-faint">No lines recorded for this run.</p>;

  return (
    <div className="mt-2">
      <div className="mb-2 flex justify-end">
        <Button variant="subtle" size="sm" onClick={exportCsv}>
          <IconArrowDown className="h-4 w-4" /> Export CSV
        </Button>
      </div>
      <Table>
        <TableHead>
          <tr>
            <TableHeadCell>Asset</TableHeadCell>
            <TableHeadCell className="text-right">Depreciation</TableHeadCell>
            <TableHeadCell className="text-right">Accumulated Depreciation</TableHeadCell>
            <TableHeadCell className="text-right">Net Book Value</TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {lines.map((l) => {
            const asset = assetById.get(l.assetId);
            return (
              <TableRow key={l.id}>
                <TableCell>
                  <span className="font-mono text-xs text-vf-ink-faint">{asset?.assetNumber ?? l.assetId}</span> {asset?.description ?? ""}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(l.depreciationAmount)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(l.accumulatedDepreciationAfter)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(l.netBookValueAfter)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function AssetDepreciationTab({ companyId, runs, assets, previewMode }: { companyId: string; runs: DepreciationRun[]; assets: FixedAsset[]; previewMode: boolean }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(`${today.slice(0, 7)}-01`);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ assetsDepreciated: number; totalAmount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  function exportRunsCsv() {
    downloadCsv(
      "depreciation-runs.csv",
      ["Period Start", "Period End", "Run Date", "Status", "Total Amount"],
      runs.map((r) => [r.periodStart, r.periodEnd, r.runDate, r.status, r.totalAmount.toFixed(2)]),
    );
  }

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/assets/depreciation-runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periodStart, periodEnd }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setResult({ assetsDepreciated: data.assetsDepreciated, totalAmount: data.totalAmount });
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
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Period Start</label>
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-40" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Period End</label>
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-40" />
          </div>
          <Button variant="primary" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={run}>
            {loading ? "Running…" : "Run Depreciation"}
          </Button>
          {error && <p className="text-sm text-vf-danger">{error}</p>}
          {result && <p className="text-sm text-vf-ink-soft">{result.assetsDepreciated} asset(s) depreciated, {money(result.totalAmount)} posted.</p>}
        </CardContent>
      </Card>

      {runs.length === 0 ? (
        <EmptyState title="No depreciation runs yet." description="Run one above — it posts a single consolidated journal through the Posting Engine." />
      ) : (
        <>
          <div className="flex justify-end">
            <Button variant="subtle" size="sm" onClick={exportRunsCsv}>
              <IconArrowDown className="h-4 w-4" /> Export CSV
            </Button>
          </div>
          <Table>
            <TableHead>
              <tr>
                <TableHeadCell>Period</TableHeadCell>
                <TableHeadCell>Run Date</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell className="text-right">Total Amount</TableHeadCell>
                <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
              </tr>
            </TableHead>
            <TableBody>
              {runs.map((r) => (
                <Fragment key={r.id}>
                  <TableRow>
                    <TableCell>{r.periodStart} to {r.periodEnd}</TableCell>
                    <TableCell>{r.runDate}</TableCell>
                    <TableCell>
                      <Badge tone={r.status === "Posted" ? "good" : "warn"}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{money(r.totalAmount)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="subtle" size="sm" onClick={() => setExpandedRunId(expandedRunId === r.id ? null : r.id)}>
                        {expandedRunId === r.id ? "Hide Schedule" : "View Schedule"}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expandedRunId === r.id && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <DepreciationScheduleRows companyId={companyId} run={r} assets={assets} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
