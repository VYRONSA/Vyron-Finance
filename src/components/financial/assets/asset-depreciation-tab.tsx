"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import type { DepreciationRun } from "@/server/assets/types";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AssetDepreciationTab({ companyId, runs, previewMode }: { companyId: string; runs: DepreciationRun[]; previewMode: boolean }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(`${today.slice(0, 7)}-01`);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ assetsDepreciated: number; totalAmount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

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
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Period</TableHeadCell>
              <TableHeadCell>Run Date</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right">Total Amount</TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.periodStart} to {r.periodEnd}</TableCell>
                <TableCell>{r.runDate}</TableCell>
                <TableCell>
                  <Badge tone={r.status === "Posted" ? "good" : "warn"}>{r.status}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(r.totalAmount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
