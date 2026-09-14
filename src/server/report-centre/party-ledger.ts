/**
 * The Subsidiary Ledger engine — the ONE place the Reporting Centre
 * decides what a customer owes us or what we owe a supplier.
 *
 * Why not the existing `customer-statement-engine.ts` /
 * `supplier-statement-engine.ts`: both see only Sales/Purchasing
 * documents and the `customer_receipts`/`supplier_payments` tables. In
 * real VYRON data most money moves through the BANK: a bank transaction
 * allocated to a supplier (Transaction Explorer type "S") or customer
 * (type "C") posts straight to the Creditors/Debtors control account
 * (`journal-service.ts::buildJournalLinesForTransaction`, migration 0096)
 * without ever creating a payment/receipt record, and posted Customer/
 * Supplier opening balances also land on those control accounts. A
 * ledger that ignored either would never reconcile to the GL. This engine
 * includes every source that actually moves a control account, each
 * signed exactly the way the posting engine signs it:
 *
 *   Customer (balance = what the customer owes us; + is a debit to Debtors)
 *     Posted Invoice / Debit Note      +total
 *     Posted Credit Note               −total
 *     Posted Customer Receipt          −amount
 *     Posted bank txn, type "C"        +debit (refund out) −credit (money in)
 *     Posted Customer opening balance  +amount  (a positive entry debits Debtors)
 *
 *   Supplier (balance = what we owe the supplier; + is a credit to Creditors)
 *     Posted Bill / Debit Note         +total
 *     Posted Credit Note               −total
 *     Posted Supplier Payment          −amount
 *     Posted bank txn, type "S"        +credit (refund in) −debit (money out)
 *     Posted Supplier opening balance  −amount  (a positive entry debits Creditors)
 *
 * `ae_bank_transactions` uses the cashbook convention — `debit` is money
 * OUT, `credit` is money IN (migration 0093).
 */

import { computeAgingBuckets } from "@/server/shared/aging";
import type { BankTransactionRecord, ImportedBill } from "@/server/accounting/types";
import type { CustomerReceipt, SalesInvoice } from "@/server/sales/types";
import type { SupplierPayment } from "@/server/purchasing/types";
import type { OpeningBalanceEntry } from "@/server/opening-balances/types";
import { round2, type DocumentType } from "./types";

export type PartySide = "customer" | "supplier";

export type LedgerSource = "opening" | "document" | "payment" | "bank";

export type PartyLedgerEntry = {
  side: PartySide;
  partyId: number;
  date: string;
  /** Display type: Invoice, Credit Note, Debit Note, Receipt, Bill, Payment,
   * Bank Receipt, Bank Payment, Customer Refund, Supplier Refund, Opening Balance. */
  type: string;
  reference: string;
  description: string;
  /** Signed effect on the party's balance (see module docstring). */
  amount: number;
  source: LedgerSource;
  docType: DocumentType | null;
  docId: number | null;
  bankTransactionId: number | null;
  journalId: number | null;
  dueDate: string | null;
  /** Document VAT analysis, when the entry is a document. */
  netAmount: number | null;
  vatAmount: number | null;
  vatCode: string | null;
};

/** Has this bill actually affected the books? Imported bills that never
 * entered the posting workflow have neither a journal nor a posting
 * status — same real-financial-effect test the Supplier Statement
 * engine documents, extended to Purchasing's own `postingStatus`. */
export function isPostedBill(bill: Pick<ImportedBill, "journalId" | "postingStatus">): boolean {
  return bill.journalId !== null || bill.postingStatus === "Posted";
}

const SOURCE_ORDER: Record<LedgerSource, number> = { opening: 0, document: 1, payment: 2, bank: 3 };

function sortEntries(entries: PartyLedgerEntry[]): PartyLedgerEntry[] {
  return entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.source !== b.source) return SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
    return (a.docId ?? a.bankTransactionId ?? 0) - (b.docId ?? b.bankTransactionId ?? 0);
  });
}

export type CustomerLedgerInput = {
  invoices: SalesInvoice[];
  receipts: CustomerReceipt[];
  bankTransactions: BankTransactionRecord[];
  openingBalances: OpeningBalanceEntry[];
};

export function buildCustomerLedger(input: CustomerLedgerInput): PartyLedgerEntry[] {
  const entries: PartyLedgerEntry[] = [];
  for (const ob of input.openingBalances) {
    if (ob.category !== "Customer" || ob.status !== "posted" || ob.customerId === null) continue;
    entries.push({
      side: "customer", partyId: ob.customerId, date: ob.balanceDate, type: "Opening Balance", reference: ob.reference, description: ob.description || "Opening balance",
      amount: round2(ob.amount), source: "opening", docType: null, docId: null, bankTransactionId: null, journalId: ob.journalId, dueDate: null, netAmount: null, vatAmount: null, vatCode: null,
    });
  }
  for (const inv of input.invoices) {
    if (inv.status !== "Posted") continue;
    const sign = inv.documentType === "Credit Note" ? -1 : 1;
    entries.push({
      side: "customer", partyId: inv.customerId, date: inv.invoiceDate, type: inv.documentType, reference: inv.invoiceNumber, description: inv.reference || inv.lines[0]?.description || "",
      amount: round2(sign * inv.total), source: "document", docType: "sales-invoice", docId: inv.id, bankTransactionId: null, journalId: inv.journalId, dueDate: inv.dueDate,
      netAmount: round2(sign * inv.subtotal), vatAmount: round2(sign * inv.vatAmount), vatCode: inv.vatTreatmentCode || null,
    });
  }
  for (const r of input.receipts) {
    if (r.status !== "Posted") continue;
    entries.push({
      side: "customer", partyId: r.customerId, date: r.receiptDate, type: "Receipt", reference: r.receiptNumber || r.reference, description: r.reference || r.notes,
      amount: round2(-r.amount), source: "payment", docType: "customer-receipt", docId: r.id, bankTransactionId: null, journalId: r.journalId, dueDate: null, netAmount: null, vatAmount: null, vatCode: null,
    });
  }
  for (const t of input.bankTransactions) {
    if (!t.postedFlag || t.allocationType !== "C" || t.matchedCustomerId === null || !t.transactionDate) continue;
    const amount = round2(t.debit - t.credit);
    entries.push({
      side: "customer", partyId: t.matchedCustomerId, date: t.transactionDate, type: amount < 0 ? "Bank Receipt" : "Customer Refund", reference: t.reference, description: t.description,
      amount, source: "bank", docType: null, docId: null, bankTransactionId: t.id, journalId: t.journalId, dueDate: null, netAmount: null, vatAmount: null, vatCode: null,
    });
  }
  return sortEntries(entries);
}

export type SupplierLedgerInput = {
  bills: ImportedBill[];
  payments: SupplierPayment[];
  bankTransactions: BankTransactionRecord[];
  openingBalances: OpeningBalanceEntry[];
};

export function buildSupplierLedger(input: SupplierLedgerInput): PartyLedgerEntry[] {
  const entries: PartyLedgerEntry[] = [];
  for (const ob of input.openingBalances) {
    if (ob.category !== "Supplier" || ob.status !== "posted" || ob.supplierId === null) continue;
    entries.push({
      side: "supplier", partyId: ob.supplierId, date: ob.balanceDate, type: "Opening Balance", reference: ob.reference, description: ob.description || "Opening balance",
      amount: round2(-ob.amount), source: "opening", docType: null, docId: null, bankTransactionId: null, journalId: ob.journalId, dueDate: null, netAmount: null, vatAmount: null, vatCode: null,
    });
  }
  for (const bill of input.bills) {
    if (!isPostedBill(bill) || bill.supplierId === null || !bill.invoiceDate) continue;
    const sign = bill.documentType === "Credit Note" ? -1 : 1;
    entries.push({
      side: "supplier", partyId: bill.supplierId, date: bill.invoiceDate, type: bill.documentType, reference: bill.invoiceNumber, description: bill.supplierName,
      amount: round2(sign * bill.total), source: "document", docType: "purchase-bill", docId: bill.id, bankTransactionId: null, journalId: bill.journalId, dueDate: bill.dueDate,
      netAmount: round2(sign * (bill.total - bill.vat)), vatAmount: round2(sign * bill.vat), vatCode: bill.vatCode,
    });
  }
  for (const p of input.payments) {
    if (p.status !== "Posted") continue;
    entries.push({
      side: "supplier", partyId: p.supplierId, date: p.paymentDate, type: "Payment", reference: p.paymentNumber || p.reference, description: p.reference || p.notes,
      amount: round2(-p.amount), source: "payment", docType: "supplier-payment", docId: p.id, bankTransactionId: null, journalId: p.journalId, dueDate: null, netAmount: null, vatAmount: null, vatCode: null,
    });
  }
  for (const t of input.bankTransactions) {
    if (!t.postedFlag || t.allocationType !== "S" || t.matchedSupplierId === null || !t.transactionDate) continue;
    const amount = round2(t.credit - t.debit);
    entries.push({
      side: "supplier", partyId: t.matchedSupplierId, date: t.transactionDate, type: amount < 0 ? "Bank Payment" : "Supplier Refund", reference: t.reference, description: t.description,
      amount, source: "bank", docType: null, docId: null, bankTransactionId: t.id, journalId: t.journalId, dueDate: null, netAmount: null, vatAmount: null, vatCode: null,
    });
  }
  return sortEntries(entries);
}

/** Balance per party of every entry dated on/before `asAt` (all-time when
 * absent). */
export function balancesAt(entries: PartyLedgerEntry[], asAt?: string): Map<number, number> {
  const balances = new Map<number, number>();
  for (const e of entries) {
    if (asAt && e.date > asAt) continue;
    balances.set(e.partyId, round2((balances.get(e.partyId) ?? 0) + e.amount));
  }
  return balances;
}

export type OpenItem = {
  partyId: number;
  docType: DocumentType;
  docId: number;
  type: string;
  reference: string;
  date: string;
  dueDate: string | null;
  total: number;
  /** Signed: a credit note's unapplied credit is negative. */
  outstanding: number;
};

type Allocation = { documentId: number; amount: number; date: string };

/** A document's outstanding amount as at a date. At or after `today` the
 * stored `outstanding` is authoritative (it also reflects every
 * settlement mechanism, not just payment allocations); before it, the
 * balance is reconstructed as total − payment allocations dated on/before
 * `asAt`. */
function outstandingAt(total: number, stored: number, allocations: Allocation[] | undefined, asAt: string, today: string): number {
  if (asAt >= today) return round2(stored);
  const settled = (allocations ?? []).filter((a) => a.date <= asAt).reduce((s, a) => s + a.amount, 0);
  return round2(Math.max(0, total - settled));
}

export function customerOpenItems(invoices: SalesInvoice[], receipts: CustomerReceipt[], asAt: string, today: string): OpenItem[] {
  const allocationsByDoc = new Map<number, Allocation[]>();
  for (const r of receipts) {
    if (r.status !== "Posted") continue;
    for (const a of r.allocations) {
      const list = allocationsByDoc.get(a.invoiceId) ?? [];
      list.push({ documentId: a.invoiceId, amount: a.amountAllocated, date: r.receiptDate });
      allocationsByDoc.set(a.invoiceId, list);
    }
  }
  const items: OpenItem[] = [];
  for (const inv of invoices) {
    if (inv.status !== "Posted" || inv.invoiceDate > asAt) continue;
    const isCredit = inv.documentType === "Credit Note";
    const outstanding = outstandingAt(inv.total, inv.outstanding, isCredit ? undefined : allocationsByDoc.get(inv.id), asAt, today);
    if (outstanding === 0) continue;
    items.push({
      partyId: inv.customerId, docType: "sales-invoice", docId: inv.id, type: inv.documentType, reference: inv.invoiceNumber, date: inv.invoiceDate,
      dueDate: inv.dueDate, total: inv.total, outstanding: isCredit ? -outstanding : outstanding,
    });
  }
  return items;
}

export function supplierOpenItems(bills: ImportedBill[], payments: SupplierPayment[], asAt: string, today: string): OpenItem[] {
  const allocationsByDoc = new Map<number, Allocation[]>();
  for (const p of payments) {
    if (p.status !== "Posted") continue;
    for (const a of p.allocations) {
      const list = allocationsByDoc.get(a.billId) ?? [];
      list.push({ documentId: a.billId, amount: a.amountAllocated, date: p.paymentDate });
      allocationsByDoc.set(a.billId, list);
    }
  }
  const items: OpenItem[] = [];
  for (const bill of bills) {
    if (!isPostedBill(bill) || bill.supplierId === null || !bill.invoiceDate || bill.invoiceDate > asAt) continue;
    const isCredit = bill.documentType === "Credit Note";
    const outstanding = outstandingAt(bill.total, bill.outstanding, isCredit ? undefined : allocationsByDoc.get(bill.id), asAt, today);
    if (outstanding === 0) continue;
    items.push({
      partyId: bill.supplierId, docType: "purchase-bill", docId: bill.id, type: bill.documentType, reference: bill.invoiceNumber, date: bill.invoiceDate,
      dueDate: bill.dueDate, total: bill.total, outstanding: isCredit ? -outstanding : outstanding,
    });
  }
  return items;
}

export const AGING_BUCKETS = [
  { key: "current", label: "Current" },
  { key: "days30", label: "1–30 Days" },
  { key: "days60", label: "31–60 Days" },
  { key: "days90", label: "61–90 Days" },
  { key: "days120Plus", label: "90+ Days" },
] as const;
export type AgingBucketKey = (typeof AGING_BUCKETS)[number]["key"];

export type PartyAging = {
  partyId: number;
  current: number;
  days30: number;
  days60: number;
  days90: number;
  days120Plus: number;
  /** Credits the ledger holds that are not applied to a specific open
   * document — bank-posted payments, unapplied credit notes, opening
   * balances. Always `balance − Σ document buckets`, so every aging row
   * adds up to the party's ledger balance. */
  unallocated: number;
  balance: number;
};

/** Days past due as at `asAt`, 0 when not yet due or no due date. */
export function daysOverdue(dueDate: string | null, asAt: string): number {
  if (!dueDate) return 0;
  return Math.max(0, Math.floor((Date.parse(asAt) - Date.parse(dueDate)) / 86_400_000));
}

export function bucketFor(dueDate: string | null, asAt: string): AgingBucketKey {
  const d = daysOverdue(dueDate, asAt);
  if (d <= 0) return "current";
  if (d <= 30) return "days30";
  if (d <= 60) return "days60";
  if (d <= 90) return "days90";
  return "days120Plus";
}

/** Aging per party. Document buckets use the shared
 * `computeAgingBuckets` (the same bucketing Customer/Supplier Management
 * already show); unapplied credits sit in `unallocated` so that each
 * row's total equals the party's ledger balance as at the date. */
export function buildAging(entries: PartyLedgerEntry[], openItems: OpenItem[], asAt: string): PartyAging[] {
  const balances = balancesAt(entries, asAt);
  const itemsByParty = new Map<number, OpenItem[]>();
  for (const item of openItems) {
    const list = itemsByParty.get(item.partyId) ?? [];
    list.push(item);
    itemsByParty.set(item.partyId, list);
  }
  const partyIds = new Set<number>([...balances.keys(), ...itemsByParty.keys()]);
  const rows: PartyAging[] = [];
  for (const partyId of partyIds) {
    const items = itemsByParty.get(partyId) ?? [];
    const buckets = computeAgingBuckets(items.filter((i) => i.outstanding > 0), asAt);
    const bucketTotal = round2(buckets.current + buckets.days30 + buckets.days60 + buckets.days90 + buckets.days120Plus);
    const balance = balances.get(partyId) ?? 0;
    const row: PartyAging = { partyId, ...buckets, unallocated: round2(balance - bucketTotal), balance };
    if (Object.values(row).some((v, i) => i > 0 && v !== 0)) rows.push(row);
  }
  return rows;
}
