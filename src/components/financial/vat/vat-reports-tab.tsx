"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBarChart } from "@/components/ui/icons";
import { buildVat201Summary } from "@/server/vat/vat-201-engine";
import type { VatReturn } from "@/server/vat/types";
import type { VatDocument } from "@/server/vat/vat-intelligence";
import type { VatTreatment } from "@/server/company-management/types";
import { formatAmount } from "@/lib/format";

function money(value: number): string {
  return formatAmount(value);
}

const CATEGORY_LABEL: Record<string, string> = {
  Standard: "Standard Rate",
  ZeroRated: "Zero-Rated",
  Exempt: "Exempt",
  OutsideScope: "Outside Scope",
  Import: "Import",
  Export: "Export",
  ReverseCharge: "Reverse Charge",
  Unclassified: "Unclassified (no VAT treatment)",
};

/** A real per-treatment breakdown of every VAT-bearing document on file
 * (a VAT201-style analysis), plus the Return history table — computed
 * from the same real `VatDocument`/`VatReturn` data every other tab
 * uses, not a separate reporting data source.
 *
 * Finding #106 — this used to aggregate every document ever captured,
 * unfiltered by period, which is far less useful for reconciling against
 * one VAT Return. Since `documents`/`vatReturns` are already fully
 * fetched and passed in (no new backend query needed), the date filter
 * runs entirely client-side. */
export function VatReportsTab({ documents, vatTreatments, vatReturns }: { documents: VatDocument[]; vatTreatments: VatTreatment[]; vatReturns: VatReturn[] }) {
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  const filteredDocuments = useMemo(
    () => documents.filter((d) => (!periodStart || d.date >= periodStart) && (!periodEnd || d.date <= periodEnd)),
    [documents, periodStart, periodEnd],
  );

  const rows = useMemo(() => {
    const byTreatment = new Map<string, { count: number; gross: number; vat: number }>();
    for (const doc of filteredDocuments) {
      const key = doc.vatTreatmentCode || "(none)";
      const entry = byTreatment.get(key) ?? { count: 0, gross: 0, vat: 0 };
      entry.count += 1;
      entry.gross += doc.grossAmount;
      entry.vat += doc.vatAmount;
      byTreatment.set(key, entry);
    }
    return [...byTreatment.entries()].sort((a, b) => b[1].vat - a[1].vat);
  }, [filteredDocuments]);

  // Finding #105 — reuses the same period-filtered `filteredDocuments`
  // Finding #106 already introduced, so this needs no separate fetch.
  const vat201 = useMemo(() => buildVat201Summary(filteredDocuments, periodStart, periodEnd), [filteredDocuments, periodStart, periodEnd]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-sm font-semibold text-vf-ink">VAT by Treatment {periodStart || periodEnd ? `(${periodStart || "…"} to ${periodEnd || "…"})` : "(all documents on file)"}</h3>
          <div className="flex items-end gap-2">
            <div className="w-36">
              <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="vat-rpt-start">Period Start</label>
              <Input id="vat-rpt-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="w-36">
              <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="vat-rpt-end">Period End</label>
              <Input id="vat-rpt-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<IconBarChart className="h-5 w-5" />} title="No VAT-bearing documents yet." description="A per-treatment breakdown will appear here once Sales Invoices or Supplier Bills exist." />
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeadCell>Treatment</TableHeadCell>
                <TableHeadCell>Type</TableHeadCell>
                <TableHeadCell className="text-right">Documents</TableHeadCell>
                <TableHeadCell className="text-right">Gross</TableHeadCell>
                <TableHeadCell className="text-right">VAT</TableHeadCell>
              </tr>
            </TableHead>
            <TableBody>
              {rows.map(([code, entry]) => (
                <TableRow key={code}>
                  <TableCell className="font-medium text-vf-ink">{code}</TableCell>
                  <TableCell>{vatTreatments.find((t) => t.code === code)?.vatType ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{entry.count}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{money(entry.gross)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{money(entry.vat)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-vf-ink">VAT201 Summary {periodStart || periodEnd ? `(${periodStart || "…"} to ${periodEnd || "…"})` : "(all documents on file)"}</h3>
          <p className="text-xs text-vf-ink-faint">Category labels — confirm against the current SARS VAT201 form before transcribing box numbers.</p>
        </div>
        {vat201.outputs.length === 0 && vat201.inputs.length === 0 ? (
          <EmptyState icon={<IconBarChart className="h-5 w-5" />} title="No VAT-bearing documents for this period." description="Set a Period Start/End above, or generate a VAT Return once documents exist." />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Outputs (Sales)</p>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeadCell>Category</TableHeadCell>
                    <TableHeadCell className="text-right">Docs</TableHeadCell>
                    <TableHeadCell className="text-right">Value</TableHeadCell>
                    <TableHeadCell className="text-right">VAT</TableHeadCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {vat201.outputs.map((c) => (
                    <TableRow key={c.category}>
                      <TableCell className="font-medium text-vf-ink">{CATEGORY_LABEL[c.category] ?? c.category}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{c.documentCount}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{money(c.netValue)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{money(c.vatValue)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold text-vf-ink">Total Output</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono tabular-nums font-semibold">{money(vat201.totalOutputValue)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-semibold">{money(vat201.totalOutputVat)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Inputs (Purchases)</p>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeadCell>Category</TableHeadCell>
                    <TableHeadCell className="text-right">Docs</TableHeadCell>
                    <TableHeadCell className="text-right">Value</TableHeadCell>
                    <TableHeadCell className="text-right">VAT</TableHeadCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {vat201.inputs.map((c) => (
                    <TableRow key={c.category}>
                      <TableCell className="font-medium text-vf-ink">{CATEGORY_LABEL[c.category] ?? c.category}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{c.documentCount}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{money(c.netValue)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{money(c.vatValue)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold text-vf-ink">Total Input</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono tabular-nums font-semibold">{money(vat201.totalInputValue)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-semibold">{money(vat201.totalInputVat)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        )}
        {(vat201.outputs.length > 0 || vat201.inputs.length > 0) && (
          <p className="mt-2 text-sm text-vf-ink">
            Net VAT {vat201.netVat >= 0 ? "Payable" : "Receivable"}: <span className="font-mono tabular-nums font-semibold">{money(Math.abs(vat201.netVat))}</span>
          </p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-vf-ink">VAT Return History</h3>
        {vatReturns.length === 0 ? (
          <p className="text-sm text-vf-ink-faint">No VAT Returns generated yet.</p>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeadCell>Period</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell className="text-right">Output</TableHeadCell>
                <TableHeadCell className="text-right">Input</TableHeadCell>
                <TableHeadCell className="text-right">Net</TableHeadCell>
              </tr>
            </TableHead>
            <TableBody>
              {vatReturns.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.periodStart} to {r.periodEnd}{r.isAmendment ? " (Amendment)" : ""}</TableCell>
                  <TableCell>{r.status}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{money(r.totalOutputVat)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{money(r.totalInputVat)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{money(r.netPayable)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
