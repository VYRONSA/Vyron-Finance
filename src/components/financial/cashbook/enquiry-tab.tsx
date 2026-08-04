"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import type { BankTransactionRecord } from "@/server/accounting/types";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SOURCES = ["All", "Imported", "Manual"] as const;

/** Cashbook Enquiry — every entry, any source, any direction, real
 * search/filter, and a real drill-through to the General Ledger's own
 * Journals tab wherever a journal exists — no separate "Cashbook
 * transaction" concept to look up. */
export function EnquiryTab({ companyId, entries }: { companyId: string; entries: BankTransactionRecord[] }) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<(typeof SOURCES)[number]>("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (source !== "All" && e.entrySource !== source) return false;
      if (dateFrom && (!e.transactionDate || e.transactionDate < dateFrom)) return false;
      if (dateTo && (!e.transactionDate || e.transactionDate > dateTo)) return false;
      const term = search.trim().toLowerCase();
      if (!term) return true;
      return e.description.toLowerCase().includes(term) || e.reference.toLowerCase().includes(term) || e.bankAccount.toLowerCase().includes(term);
    });
  }, [entries, source, dateFrom, dateTo, search]);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="cb-enq-source" className="mb-1 block text-xs font-medium text-vf-ink-faint">Source</label>
            <select id="cb-enq-source" value={source} onChange={(e) => setSource(e.target.value as (typeof SOURCES)[number])} className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cb-enq-from" className="mb-1 block text-xs font-medium text-vf-ink-faint">From</label>
            <Input id="cb-enq-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
          </div>
          <div>
            <label htmlFor="cb-enq-to" className="mb-1 block text-xs font-medium text-vf-ink-faint">To</label>
            <Input id="cb-enq-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="cb-enq-search" className="mb-1 block text-xs font-medium text-vf-ink-faint">Search</label>
            <Input id="cb-enq-search" placeholder="Description, reference, bank account…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <p className="text-xs text-vf-ink-faint">{filtered.length} of {entries.length} entries.</p>

        {filtered.length === 0 ? (
          <EmptyState title="No entries match this filter." description="Widen the date range or clear the search." />
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeadCell>Date</TableHeadCell>
                <TableHeadCell>Bank Account</TableHeadCell>
                <TableHeadCell>Description</TableHeadCell>
                <TableHeadCell>Source</TableHeadCell>
                <TableHeadCell className="text-right">Debit</TableHeadCell>
                <TableHeadCell className="text-right">Credit</TableHeadCell>
                <TableHeadCell>Journal</TableHeadCell>
              </tr>
            </TableHead>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.transactionDate}</TableCell>
                  <TableCell>{e.bankAccount}</TableCell>
                  <TableCell className="max-w-xs truncate">{e.description}</TableCell>
                  <TableCell>
                    <Badge tone={e.entrySource === "Manual" ? "info" : "muted"}>{e.entrySource}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{e.debit > 0 ? money(e.debit) : ""}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{e.credit > 0 ? money(e.credit) : ""}</TableCell>
                  <TableCell>
                    {e.journalId ? (
                      <Link href={`/company/${companyId}/general-ledger?tab=journals`} className="text-xs text-vf-red-600 hover:underline">
                        View Journal
                      </Link>
                    ) : (
                      <span className="text-xs text-vf-ink-faint">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
