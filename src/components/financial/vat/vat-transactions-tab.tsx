import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconListChecks } from "@/components/ui/icons";
import type { VatDocument } from "@/server/vat/vat-intelligence";

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function drillThroughHref(companyId: string, doc: VatDocument): string | null {
  if (doc.partyId === null) return null;
  if (doc.documentType.startsWith("Customer")) return `/company/${companyId}/customers/${doc.partyId}`;
  if (doc.documentType.startsWith("Supplier")) return `/company/${companyId}/suppliers/${doc.partyId}`;
  return null;
}

/** Every VAT-bearing document real Sales/Purchasing already persists —
 * no separate "VAT transaction" object, just a VAT-focused view over
 * them, with drill-through to the originating party. */
export function VatTransactionsTab({ companyId, documents }: { companyId: string; documents: VatDocument[] }) {
  if (documents.length === 0) {
    return <EmptyState icon={<IconListChecks className="h-5 w-5" />} title="No VAT-bearing transactions yet." description="Sales Invoices and Supplier Bills with a VAT treatment will appear here." />;
  }

  const sorted = [...documents].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeadCell>Date</TableHeadCell>
          <TableHeadCell>Document</TableHeadCell>
          <TableHeadCell>Party</TableHeadCell>
          <TableHeadCell>VAT Treatment</TableHeadCell>
          <TableHeadCell className="text-right">Gross</TableHeadCell>
          <TableHeadCell className="text-right">VAT</TableHeadCell>
        </tr>
      </TableHead>
      <TableBody>
        {sorted.map((doc) => {
          const href = drillThroughHref(companyId, doc);
          return (
            <TableRow key={`${doc.documentType}-${doc.id}`}>
              <TableCell>{doc.date}</TableCell>
              <TableCell>
                <Badge tone="info">{doc.documentType}</Badge> #{doc.id}
              </TableCell>
              <TableCell className="font-medium text-vf-ink">
                {href ? (
                  <Link href={href} className="text-vf-red-600 hover:underline">
                    {doc.partyName}
                  </Link>
                ) : (
                  doc.partyName
                )}
              </TableCell>
              <TableCell>{doc.vatTreatmentCode || "—"}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(doc.grossAmount)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(doc.vatAmount)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
