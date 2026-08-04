import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { IconReceipt } from "@/components/ui/icons";
import type { BillingCredit, Invoice, InvoiceStatus, Payment, PaymentStatus } from "@/server/billing-platform/types";

const INVOICE_STATUS_TONE: Record<InvoiceStatus, "good" | "warn" | "info" | "danger" | "muted"> = {
  draft: "muted", open: "info", paid: "good", void: "muted", uncollectible: "danger",
};
const PAYMENT_STATUS_TONE: Record<PaymentStatus, "good" | "warn" | "info" | "danger" | "muted"> = {
  pending: "info", succeeded: "good", failed: "danger", refunded: "warn", partially_refunded: "warn",
};

function money(amount: number, currencyCode: string): string {
  const symbol = currencyCode === "ZAR" ? "R" : `${currencyCode} `;
  return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BillingInvoicesTab({ invoices, payments, credits }: { invoices: Invoice[]; payments: Payment[]; credits: BillingCredit[] }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h3 className="text-sm font-semibold text-vf-ink">Invoices</h3>
        {invoices.length === 0 ? (
          <EmptyState
            icon={<IconReceipt className="h-5 w-5" />}
            title="No invoices yet"
            description="Invoices appear here once your trial converts to a paid, provider-billed plan."
            className="mt-2"
          />
        ) : (
          <Table className="mt-3">
            <TableHead><TableRow><TableHeadCell>Number</TableHeadCell><TableHeadCell>Status</TableHeadCell><TableHeadCell>Issued</TableHeadCell><TableHeadCell>Total</TableHeadCell></TableRow></TableHead>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>{inv.invoiceNumber}</TableCell>
                  <TableCell><Badge tone={INVOICE_STATUS_TONE[inv.status]}>{inv.status}</Badge></TableCell>
                  <TableCell>{inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="font-mono tabular-nums">{money(inv.total, inv.currencyCode)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-vf-ink">Payments</h3>
        {payments.length === 0 ? (
          <EmptyState title="No payments yet" description="Payment history appears here once your first charge is processed." className="mt-2" />
        ) : (
          <Table className="mt-3">
            <TableHead><TableRow><TableHeadCell>Date</TableHeadCell><TableHeadCell>Status</TableHeadCell><TableHeadCell>Amount</TableHeadCell></TableRow></TableHead>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell><Badge tone={PAYMENT_STATUS_TONE[p.status]}>{p.status}</Badge></TableCell>
                  <TableCell className="font-mono tabular-nums">{money(p.amount, p.currencyCode)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-vf-ink">Credits</h3>
        {credits.length === 0 ? (
          <EmptyState title="No account credits" description="Any credits applied to your account (goodwill, refund offsets) appear here." className="mt-2" />
        ) : (
          <Table className="mt-3">
            <TableHead><TableRow><TableHeadCell>Date</TableHeadCell><TableHeadCell>Reason</TableHeadCell><TableHeadCell>Amount</TableHeadCell></TableRow></TableHead>
            <TableBody>
              {credits.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>{c.reason || "—"}</TableCell>
                  <TableCell className="font-mono tabular-nums">{money(c.amount, c.currencyCode)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
