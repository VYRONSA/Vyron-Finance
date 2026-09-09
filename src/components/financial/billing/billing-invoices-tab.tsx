"use client";

import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { IconReceipt } from "@/components/ui/icons";
import type { BillingCredit, Invoice, InvoiceLine, InvoiceStatus, Payment, PaymentStatus } from "@/server/billing-platform/types";

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

// Finding #126 (RC-16/E13) — the Invoices table had no detail-view or
// download action at all. "Download" would be a fabricated capability
// right now — invoices have no real PDF/hosted URL until a payment
// provider is actually connected (Sub-Phase 8, not built yet) — but a
// detail view is real and buildable today from data that already
// exists (`listInvoiceLines`, newly re-exported from billing-engine.ts),
// so this adds an expandable line-item breakdown per invoice.
export function BillingInvoicesTab({
  invoices,
  payments,
  credits,
  invoiceLinesById,
}: {
  invoices: Invoice[];
  payments: Payment[];
  credits: BillingCredit[];
  invoiceLinesById?: Record<string, InvoiceLine[]>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
            <TableHead><TableRow><TableHeadCell>Number</TableHeadCell><TableHeadCell>Status</TableHeadCell><TableHeadCell>Issued</TableHeadCell><TableHeadCell>Total</TableHeadCell><TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell></TableRow></TableHead>
            <TableBody>
              {invoices.map((inv) => {
                const lines = invoiceLinesById?.[inv.id] ?? [];
                const isOpen = expandedId === inv.id;
                return (
                  <Fragment key={inv.id}>
                    <TableRow>
                      <TableCell>{inv.invoiceNumber}</TableCell>
                      <TableCell><Badge tone={INVOICE_STATUS_TONE[inv.status]}>{inv.status}</Badge></TableCell>
                      <TableCell>{inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="font-mono tabular-nums">{money(inv.total, inv.currencyCode)}</TableCell>
                      <TableCell className="text-right">
                        {invoiceLinesById && (
                          <button type="button" className="text-xs font-medium text-vf-red-600 hover:underline" onClick={() => setExpandedId(isOpen ? null : inv.id)}>
                            {isOpen ? "Hide Details" : "View Details"}
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-vf-paper-alt/40">
                          {lines.length === 0 ? (
                            <p className="py-2 text-xs text-vf-ink-faint">No line items recorded for this invoice.</p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-vf-ink-faint">
                                  <th className="py-1 pr-2 font-medium">Description</th>
                                  <th className="py-1 pr-2 text-right font-medium">Qty</th>
                                  <th className="py-1 pr-2 text-right font-medium">Unit</th>
                                  <th className="py-1 text-right font-medium">Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((line) => (
                                  <tr key={line.id} className="border-t border-vf-paper-border/60">
                                    <td className="py-1 pr-2">{line.description}</td>
                                    <td className="py-1 pr-2 text-right font-mono tabular-nums">{line.quantity}</td>
                                    <td className="py-1 pr-2 text-right font-mono tabular-nums">{money(line.unitAmount, inv.currencyCode)}</td>
                                    <td className="py-1 text-right font-mono tabular-nums">{money(line.amount, inv.currencyCode)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          <p className="mt-2 text-[0.65rem] text-vf-ink-faint">
                            PDF download isn&apos;t available yet — invoices don&apos;t have a real, provider-hosted document until a payment provider is connected.
                          </p>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
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
