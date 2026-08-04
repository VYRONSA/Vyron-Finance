import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBarChart } from "@/components/ui/icons";
import type { VatReturn } from "@/server/vat/types";
import type { VatDocument } from "@/server/vat/vat-intelligence";
import type { VatTreatment } from "@/server/company-management/types";

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A real per-treatment breakdown of every VAT-bearing document on file
 * (a VAT201-style analysis), plus the Return history table — computed
 * from the same real `VatDocument`/`VatReturn` data every other tab
 * uses, not a separate reporting data source. */
export function VatReportsTab({ documents, vatTreatments, vatReturns }: { documents: VatDocument[]; vatTreatments: VatTreatment[]; vatReturns: VatReturn[] }) {
  const byTreatment = new Map<string, { count: number; gross: number; vat: number }>();
  for (const doc of documents) {
    const key = doc.vatTreatmentCode || "(none)";
    const entry = byTreatment.get(key) ?? { count: 0, gross: 0, vat: 0 };
    entry.count += 1;
    entry.gross += doc.grossAmount;
    entry.vat += doc.vatAmount;
    byTreatment.set(key, entry);
  }

  const rows = [...byTreatment.entries()].sort((a, b) => b[1].vat - a[1].vat);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-vf-ink">VAT by Treatment (all documents on file)</h3>
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
