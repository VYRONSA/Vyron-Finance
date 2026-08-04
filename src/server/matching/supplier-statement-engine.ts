/**
 * Supplier Statement — the AP mirror of `customer-statement-engine.ts`.
 * A Bill or Debit Note increases the amount owed to the supplier; a
 * Credit Note reduces it; a Payment always reduces it. Recomputed live
 * from `ImportedBill[]`/`SupplierPayment[]`, no new persisted table.
 */

import type { ImportedBill } from "@/server/accounting/types";
import type { SupplierPayment } from "@/server/purchasing/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type StatementEntryType = "Bill" | "Credit Note" | "Debit Note" | "Payment";

export type StatementEntry = {
  date: string;
  type: StatementEntryType;
  reference: string;
  documentId: number;
  debit: number;
  credit: number;
  balance: number;
};

export function buildSupplierStatement(bills: ImportedBill[], payments: SupplierPayment[]): StatementEntry[] {
  const events: { date: string; type: StatementEntryType; reference: string; documentId: number; amount: number }[] = [];

  for (const bill of bills) {
    // `status` is free text (imported bills and Purchasing-origin bills
    // don't share one literal vocabulary) — `journalId !== null` is the
    // one reliable signal a bill has actually affected the books, the
    // same real-financial-effect test `journalId`/postedAt already means
    // everywhere else in this codebase.
    if (!bill.invoiceDate || bill.journalId === null) continue;
    const amount = bill.documentType === "Credit Note" ? -bill.total : bill.total;
    events.push({ date: bill.invoiceDate, type: bill.documentType, reference: bill.invoiceNumber, documentId: bill.id, amount });
  }
  for (const payment of payments) {
    if (payment.status !== "Posted") continue;
    events.push({ date: payment.paymentDate, type: "Payment", reference: payment.paymentNumber || payment.reference, documentId: payment.id, amount: -payment.amount });
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
