"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import type { FinancialYear } from "@/server/company-management/types";

export function FinancialYearsTab({
  companyId,
  financialYears,
  suggested,
  previewMode,
}: {
  companyId: string;
  financialYears: FinancialYear[];
  suggested: { yearLabel: string; startDate: string; endDate: string };
  previewMode: boolean;
}) {
  const router = useRouter();
  const [yearLabel, setYearLabel] = useState(suggested.yearLabel);
  const [startDate, setStartDate] = useState(suggested.startDate);
  const [endDate, setEndDate] = useState(suggested.endDate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = `/api/companies/${companyId}/financial-years`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearLabel, startDate, endDate }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function runAction(id: number, action: "set-current" | "close") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {financialYears.length === 0 ? (
        <EmptyState title="No financial years yet." description="Create your first financial year below." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Year</TableHeadCell>
              <TableHeadCell>Start</TableHeadCell>
              <TableHeadCell>End</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right">
                <span className="sr-only">Actions</span>
              </TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {financialYears.map((fy) => (
              <TableRow key={fy.id}>
                <TableCell className="font-medium text-vf-ink">
                  {fy.yearLabel} {fy.isCurrent && <Badge tone="info">Current</Badge>}
                </TableCell>
                <TableCell>{fy.startDate}</TableCell>
                <TableCell>{fy.endDate}</TableCell>
                <TableCell>
                  <Badge tone={fy.status === "Open" ? "good" : "muted"}>{fy.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {!fy.isCurrent && (
                      <Button variant="subtle" size="sm" disabled={loading || previewMode} title={disabledTitle} onClick={() => runAction(fy.id, "set-current")}>
                        Mark Current
                      </Button>
                    )}
                    {fy.status === "Open" && (
                      <Button variant="subtle" size="sm" disabled={loading || previewMode} title={disabledTitle} onClick={() => runAction(fy.id, "close")}>
                        Close
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-vf-paper-border pt-4">
        <div className="w-32">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="fy-label">Year Label</label>
          <Input id="fy-label" value={yearLabel} onChange={(e) => setYearLabel(e.target.value)} />
        </div>
        <div className="w-36">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="fy-start">Start Date</label>
          <Input id="fy-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="w-36">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="fy-end">End Date</label>
          <Input id="fy-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <Button variant="primary" size="sm" disabled={loading || previewMode} title={disabledTitle} onClick={handleCreate}>
          Create Financial Year
        </Button>
      </div>

      {error && <p className="text-sm text-vf-danger">{error}</p>}
    </div>
  );
}
