"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconAlertTriangle, IconArrowDown, IconBarChart, IconChevronDown, IconChevronLeft } from "@/components/ui/icons";
import type { TrialBalance, TrialBalanceRow } from "@/server/general-ledger/types";

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function TrialBalanceTab({ companyId, trialBalance, previewMode }: { companyId: string; trialBalance: TrialBalance; previewMode: boolean }) {
  const [data, setData] = useState(trialBalance);
  const [asOfDate, setAsOfDate] = useState("");
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const outOfBalance = Math.round((data.totalDebit - data.totalCredit) * 100) / 100;
  const isBalanced = Math.abs(outOfBalance) <= 0.01;
  const exportBase = `/api/companies/${companyId}/general-ledger/trial-balance/export`;
  const exportQuery = asOfDate ? `?asOfDate=${asOfDate}` : "";

  async function applyAsOfDate() {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/companies/${companyId}/general-ledger/trial-balance${asOfDate ? `?asOfDate=${asOfDate}` : ""}`;
      const res = await fetch(url);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setData(body.trialBalance);
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data.rows;
    return data.rows.filter((r) => r.accountCode.toLowerCase().includes(term) || r.description.toLowerCase().includes(term));
  }, [data.rows, search]);

  const groups = useMemo(() => {
    const map = new Map<string, TrialBalanceRow[]>();
    for (const row of filteredRows) {
      const list = map.get(row.accountType) ?? [];
      list.push(row);
      map.set(row.accountType, list);
    }
    return [...map.entries()];
  }, [filteredRows]);

  const filteredTotalDebit = useMemo(() => Math.round(filteredRows.reduce((s, r) => s + r.debitBalance, 0) * 100) / 100, [filteredRows]);
  const filteredTotalCredit = useMemo(() => Math.round(filteredRows.reduce((s, r) => s + r.creditBalance, 0) * 100) / 100, [filteredRows]);

  function toggleGroup(type: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  let runningDebit = 0;
  let runningCredit = 0;

  return (
    <div id="trial-balance-printable" className="flex flex-col gap-4">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #trial-balance-printable, #trial-balance-printable * { visibility: visible; }
          #trial-balance-printable { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print flex flex-wrap items-end gap-2">
        <div className="w-44">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="tb-as-of">As Of Date</label>
          <Input id="tb-as-of" type="date" value={asOfDate} disabled={previewMode} onChange={(e) => setAsOfDate(e.target.value)} />
        </div>
        <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={applyAsOfDate}>
          {loading ? "Loading…" : "Apply"}
        </Button>
        <div className="min-w-[200px] flex-1">
          <Input placeholder="Search by code or description…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search trial balance" />
        </div>
        <Button variant="subtle" size="sm" onClick={() => window.open(`${exportBase}${exportQuery}`, "_blank")}>
          <IconArrowDown className="h-4 w-4" /> Export CSV
        </Button>
        <Button variant="subtle" size="sm" onClick={() => window.open(`${exportBase}${exportQuery ? `${exportQuery}&` : "?"}format=xlsx`, "_blank")}>
          <IconArrowDown className="h-4 w-4" /> Export Excel
        </Button>
        <Button variant="subtle" size="sm" onClick={() => window.print()}>
          Print / Export PDF
        </Button>
      </div>

      {error && <p className="no-print text-sm text-vf-danger">{error}</p>}

      <div className="flex items-center gap-2 text-sm">
        <Badge tone={isBalanced ? "good" : "danger"}>{isBalanced ? "Balanced" : "Out of Balance"}</Badge>
        <span className="text-vf-ink-faint">
          Total Debit {money(data.totalDebit)} · Total Credit {money(data.totalCredit)}
          {data.asOfDate && ` · as of ${data.asOfDate}`}
        </span>
      </div>

      {!isBalanced && (
        <div className="flex items-start gap-2.5 rounded-vf-md border border-vf-danger/40 bg-vf-danger/8 p-3 text-sm text-vf-danger">
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            This trial balance is out of balance by <span className="font-mono font-semibold tabular-nums">{money(Math.abs(outOfBalance))}</span>.
            Every real posting is double-entry-balanced by construction, so this points at a data problem worth
            investigating (e.g. a partial import or a manual database edit) rather than a normal outcome.
          </p>
        </div>
      )}

      {filteredRows.length === 0 ? (
        <EmptyState icon={<IconBarChart className="h-5 w-5" />} title="No accounts to show." description="Try a different search term or date." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Account</TableHeadCell>
              <TableHeadCell className="text-right">Debit</TableHeadCell>
              <TableHeadCell className="text-right">Credit</TableHeadCell>
              <TableHeadCell className="no-print text-right">Running Debit</TableHeadCell>
              <TableHeadCell className="no-print text-right">Running Credit</TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {groups.map(([type, rows]) => {
              const isCollapsed = collapsedGroups.has(type);
              const groupDebit = rows.reduce((s, r) => s + r.debitBalance, 0);
              const groupCredit = rows.reduce((s, r) => s + r.creditBalance, 0);
              return (
                <Fragment key={type}>
                  <TableRow className="bg-vf-paper-alt/50">
                    <TableCell colSpan={5} className="font-medium text-vf-ink">
                      <button type="button" onClick={() => toggleGroup(type)} className="flex items-center gap-1.5">
                        {isCollapsed ? <IconChevronLeft className="h-3.5 w-3.5" /> : <IconChevronDown className="h-3.5 w-3.5" />}
                        {type} <span className="font-mono text-xs text-vf-ink-faint">({rows.length})</span>
                      </button>
                    </TableCell>
                  </TableRow>
                  {!isCollapsed &&
                    rows.map((r) => {
                      runningDebit = Math.round((runningDebit + r.debitBalance) * 100) / 100;
                      runningCredit = Math.round((runningCredit + r.creditBalance) * 100) / 100;
                      return (
                        <TableRow key={r.accountId}>
                          <TableCell>
                            <Link href={`/company/${companyId}/general-ledger/${r.accountId}`} className="font-mono text-xs text-vf-red-600 hover:underline">
                              {r.accountCode}
                            </Link>
                            <span className="ml-2 text-vf-ink">{r.description}</span>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{r.debitBalance > 0 ? money(r.debitBalance) : ""}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{r.creditBalance > 0 ? money(r.creditBalance) : ""}</TableCell>
                          <TableCell className="no-print text-right font-mono text-xs tabular-nums text-vf-ink-faint">{money(runningDebit)}</TableCell>
                          <TableCell className="no-print text-right font-mono text-xs tabular-nums text-vf-ink-faint">{money(runningCredit)}</TableCell>
                        </TableRow>
                      );
                    })}
                  {!isCollapsed && (
                    <TableRow key={`subtotal-${type}`} className="border-t border-vf-paper-border/70">
                      <TableCell className="text-xs font-medium text-vf-ink-faint">Subtotal</TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium tabular-nums text-vf-ink-faint">{money(groupDebit)}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium tabular-nums text-vf-ink-faint">{money(groupCredit)}</TableCell>
                      <TableCell className="no-print" />
                      <TableCell className="no-print" />
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
            <TableRow className="border-t-2 border-vf-paper-border">
              <TableCell className="font-semibold text-vf-ink">{search.trim() ? "Total (filtered)" : "Total"}</TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">{money(filteredTotalDebit)}</TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">{money(filteredTotalCredit)}</TableCell>
              <TableCell className="no-print" />
              <TableCell className="no-print" />
            </TableRow>
          </TableBody>
        </Table>
      )}
    </div>
  );
}
