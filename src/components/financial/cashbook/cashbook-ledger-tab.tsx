"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import type { BankTransactionRecord } from "@/server/accounting/types";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Receipts Cashbook (direction="credit") and Payments Cashbook
 * (direction="debit") are the SAME real view over `ae_bank_transactions`
 * — every entry regardless of origin (imported or manually captured),
 * split by direction — not a parallel ledger. */
export function CashbookLedgerTab({ title, direction, entries }: { title: string; direction: "credit" | "debit"; entries: BankTransactionRecord[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const rows = entries.filter((e) => (direction === "credit" ? e.credit > 0 : e.debit > 0));
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((e) => e.description.toLowerCase().includes(term) || e.reference.toLowerCase().includes(term) || e.bankAccount.toLowerCase().includes(term));
  }, [entries, direction, search]);

  const total = filtered.reduce((sum, e) => sum + (direction === "credit" ? e.credit : e.debit), 0);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-vf-ink">{title}</h3>
            <p className="mt-1 text-xs text-vf-ink-faint">{filtered.length} entries · Total {money(total)}</p>
          </div>
          <Input aria-label="Search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
        </div>

        {filtered.length === 0 ? (
          <EmptyState title="No entries." description="Nothing matches this filter yet." />
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeadCell>Date</TableHeadCell>
                <TableHeadCell>Bank Account</TableHeadCell>
                <TableHeadCell>Description</TableHeadCell>
                <TableHeadCell>Reference</TableHeadCell>
                <TableHeadCell>Source</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell className="text-right">Amount</TableHeadCell>
              </tr>
            </TableHead>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.transactionDate}</TableCell>
                  <TableCell>{e.bankAccount}</TableCell>
                  <TableCell className="max-w-xs truncate">{e.description}</TableCell>
                  <TableCell className="font-mono text-xs">{e.reference}</TableCell>
                  <TableCell>
                    <Badge tone={e.entrySource === "Manual" ? "info" : "muted"}>{e.entrySource}</Badge>
                  </TableCell>
                  <TableCell>
                    {e.entrySource === "Manual" ? <Badge tone={e.captureStatus === "Posted" ? "good" : "muted"}>{e.captureStatus}</Badge> : <Badge tone={e.journalId ? "good" : "warn"}>{e.journalId ? "Journaled" : "Unprocessed"}</Badge>}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{money(direction === "credit" ? e.credit : e.debit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
