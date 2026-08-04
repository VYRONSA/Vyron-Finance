/**
 * Customer Statement — a genuinely new capability (confirmed absent
 * anywhere in this codebase by research before building it): a
 * chronological Invoice/Credit Note/Debit Note/Receipt list with a real
 * running balance, built entirely from documents Sales already owns.
 * "One Business Object" — no new statement table, nothing cached; the
 * statement is recomputed live from `SalesInvoice[]`/`CustomerReceipt[]`
 * every time, same discipline as Trial Balance.
 */

import type { CustomerReceipt, SalesInvoice } from "@/server/sales/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type StatementEntryType = "Invoice" | "Credit Note" | "Debit Note" | "Receipt";

export type StatementEntry = {
  date: string;
  type: StatementEntryType;
  reference: string;
  documentId: number;
  debit: number;
  credit: number;
  balance: number;
};

/** A Credit Note reduces the amount the customer owes (a credit to their
 * account); an Invoice or Debit Note increases it — the same sign
 * convention `customer-financial-service.ts::signedOutstanding` already
 * uses for aging, reused here rather than reinvented. A Receipt always
 * reduces the balance owed. */
export function buildCustomerStatement(invoices: SalesInvoice[], receipts: CustomerReceipt[]): StatementEntry[] {
  const events: { date: string; type: StatementEntryType; reference: string; documentId: number; amount: number }[] = [];

  for (const invoice of invoices) {
    if (invoice.status !== "Posted") continue;
    const amount = invoice.documentType === "Credit Note" ? -invoice.total : invoice.total;
    events.push({ date: invoice.invoiceDate, type: invoice.documentType, reference: invoice.invoiceNumber, documentId: invoice.id, amount });
  }
  for (const receipt of receipts) {
    if (receipt.status !== "Posted") continue;
    events.push({ date: receipt.receiptDate, type: "Receipt", reference: receipt.receiptNumber || receipt.reference, documentId: receipt.id, amount: -receipt.amount });
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.documentId - b.documentId));

  let balance = 0;
  return events.map((e) => {
    balance = round2(balance + e.amount);
    return {
      date: e.date,
      type: e.type,
      reference: e.reference,
      documentId: e.documentId,
      debit: e.amount > 0 ? e.amount : 0,
      credit: e.amount < 0 ? round2(-e.amount) : 0,
      balance,
    };
  });
}
