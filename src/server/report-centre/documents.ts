/**
 * Document Centre — loads any customer or supplier document into ONE
 * printable shape, with the links that trace it through the books:
 * its journal, the payments/receipts that settled it, the bank
 * transactions behind them, and the orders/quotes it came from.
 * Read-only; figures are the document's own stored values.
 */

import { isPostedBill } from "./party-ledger";
import { drill } from "./kit";
import type { ReportDataSource } from "./source";
import { round2, type DocumentType, type DrillTarget } from "./types";

export const DOCUMENT_TYPES: DocumentType[] = ["quotation", "sales-order", "sales-invoice", "customer-receipt", "purchase-order", "purchase-bill", "supplier-payment"];

export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as string[]).includes(value);
}

export type DocumentParty = { kind: "Customer" | "Supplier"; id: number | null; name: string; code: string; vatNumber: string };

export type DocumentLine = { description: string; quantity: number | null; unitPrice: number | null; net: number; vat: number; total: number };

export type TraceLink = { label: string; detail: string; drill: DrillTarget };

export type BusinessDocument = {
  docType: DocumentType;
  id: number;
  /** e.g. "Quotation", "Tax Invoice", "Remittance Advice" */
  title: string;
  number: string;
  date: string;
  dueDate: string | null;
  status: string;
  reference: string;
  notes: string;
  party: DocumentParty;
  partyLabel: string;
  lines: DocumentLine[];
  /** Receipts/remittances list what they paid instead of item lines. */
  settlements: { reference: string; date: string; amount: number; drill: DrillTarget }[];
  totals: { net: number; vat: number; total: number; outstanding: number | null };
  trace: TraceLink[];
  /** A sales invoice/credit note is shown by the existing InvoiceDocument. */
  salesInvoiceId: number | null;
};

const INVOICE_TITLE = { Invoice: "Tax Invoice", "Credit Note": "Credit Note", "Debit Note": "Debit Note" } as const;

export async function loadBusinessDocument(source: ReportDataSource, docType: DocumentType, id: number): Promise<BusinessDocument | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [customers, suppliers] = await Promise.all([source.customers(), source.suppliers()]);
  const customerParty = (cid: number): DocumentParty => {
    const c = customers.find((x) => x.id === cid);
    return { kind: "Customer", id: cid, name: c?.name ?? `Customer #${cid}`, code: c?.customerCode ?? "", vatNumber: c?.vatNumber ?? "" };
  };
  const supplierParty = (sid: number | null, fallback = ""): DocumentParty => {
    const s = sid !== null ? suppliers.find((x) => x.id === sid) : undefined;
    return { kind: "Supplier", id: sid, name: s?.name ?? (fallback || `Supplier #${sid}`), code: s?.supplierCode ?? "", vatNumber: s?.vatNumber ?? "" };
  };
  const base = { settlements: [] as BusinessDocument["settlements"], trace: [] as TraceLink[], salesInvoiceId: null as number | null, notes: "", reference: "", dueDate: null as string | null };

  switch (docType) {
    case "quotation": {
      const q = (await source.quotations()).find((x) => x.id === id);
      if (!q) return null;
      const orders = (await source.salesOrders()).filter((o) => o.quotationId === q.id);
      const lines = q.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, net: l.lineTotal, vat: l.vatAmount, total: round2(l.lineTotal + l.vatAmount) }));
      return {
        ...base, docType, id, title: "Quotation", number: q.quotationNumber, date: q.quotationDate, dueDate: q.expiryDate, status: q.status, notes: q.notes, party: customerParty(q.customerId), partyLabel: "Quotation For",
        lines, totals: totalsOf(lines, null), trace: orders.map((o) => ({ label: "Converted to sales order", detail: o.orderNumber, drill: drill.document("sales-order", o.id) })),
      };
    }
    case "sales-order": {
      const o = (await source.salesOrders()).find((x) => x.id === id);
      if (!o) return null;
      const invoices = (await source.salesInvoices()).filter((i) => i.orderId === o.id);
      const lines = o.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, net: l.netAmount, vat: l.vatAmount, total: round2(l.netAmount + l.vatAmount) }));
      const trace: TraceLink[] = invoices.map((i) => ({ label: `Invoiced (${i.documentType})`, detail: `${i.invoiceNumber} · ${i.status}`, drill: drill.document("sales-invoice", i.id) }));
      if (o.quotationId) trace.unshift({ label: "From quotation", detail: `#${o.quotationId}`, drill: drill.document("quotation", o.quotationId) });
      return { ...base, docType, id, title: "Sales Order", number: o.orderNumber, date: o.orderDate, status: o.status, notes: o.notes, party: customerParty(o.customerId), partyLabel: "Order For", lines, totals: totalsOf(lines, null), trace };
    }
    case "sales-invoice": {
      const inv = (await source.salesInvoices()).find((x) => x.id === id);
      if (!inv) return null;
      const receipts = (await source.customerReceipts()).filter((r) => r.allocations.some((a) => a.invoiceId === inv.id));
      const lines = inv.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, net: l.netAmount || l.lineTotal, vat: l.vatAmount, total: round2((l.netAmount || l.lineTotal) + l.vatAmount) }));
      const trace: TraceLink[] = [];
      if (inv.journalId !== null) trace.push({ label: "Posted in journal", detail: `Journal #${inv.journalId}`, drill: drill.journal(inv.journalId) });
      for (const r of receipts) trace.push({ label: "Paid by receipt", detail: `${r.receiptNumber || r.reference} · ${r.receiptDate} · ${r.allocations.filter((a) => a.invoiceId === inv.id).reduce((s, a) => s + a.amountAllocated, 0).toFixed(2)}`, drill: drill.document("customer-receipt", r.id) });
      if (inv.orderId) trace.push({ label: "From sales order", detail: `#${inv.orderId}`, drill: drill.document("sales-order", inv.orderId) });
      if (inv.originalInvoiceId) trace.push({ label: "Against invoice", detail: `#${inv.originalInvoiceId}`, drill: drill.document("sales-invoice", inv.originalInvoiceId) });
      trace.push({ label: "Customer statement", detail: "Every transaction on this customer's account", drill: drill.report("customer-statement", { customerId: String(inv.customerId) }) });
      return {
        ...base, docType, id, title: INVOICE_TITLE[inv.documentType], number: inv.invoiceNumber, date: inv.invoiceDate, dueDate: inv.dueDate, status: inv.status, reference: inv.reference, notes: inv.notes,
        party: customerParty(inv.customerId), partyLabel: "Bill To", lines, totals: { net: inv.subtotal, vat: inv.vatAmount, total: inv.total, outstanding: inv.outstanding }, trace, salesInvoiceId: inv.id,
      };
    }
    case "customer-receipt": {
      const r = (await source.customerReceipts()).find((x) => x.id === id);
      if (!r) return null;
      const invoices = await source.salesInvoices();
      const settlements = r.allocations.map((a) => {
        const inv = invoices.find((i) => i.id === a.invoiceId);
        return { reference: inv?.invoiceNumber ?? `#${a.invoiceId}`, date: inv?.invoiceDate ?? "", amount: a.amountAllocated, drill: drill.document("sales-invoice", a.invoiceId) };
      });
      const trace: TraceLink[] = r.journalId !== null ? [{ label: "Posted in journal", detail: `Journal #${r.journalId}`, drill: drill.journal(r.journalId) }] : [];
      trace.push({ label: "Customer statement", detail: "Every transaction on this customer's account", drill: drill.report("customer-statement", { customerId: String(r.customerId) }) });
      return {
        ...base, docType, id, title: "Receipt", number: r.receiptNumber || r.reference, date: r.receiptDate, status: r.status, reference: r.reference, notes: r.notes, party: customerParty(r.customerId), partyLabel: "Received From",
        lines: [], settlements, totals: { net: r.amount, vat: 0, total: r.amount, outstanding: round2(r.amount - settlements.reduce((s, x) => s + x.amount, 0)) }, trace,
      };
    }
    case "purchase-order": {
      const o = (await source.purchaseOrders()).find((x) => x.id === id);
      if (!o) return null;
      const bills = (await source.bills()).filter((b) => b.purchaseOrderId === o.id);
      const lines = o.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, net: l.netAmount, vat: l.vatAmount, total: round2(l.netAmount + l.vatAmount) }));
      return {
        ...base, docType, id, title: "Purchase Order", number: o.orderNumber, date: o.orderDate, status: o.status, notes: o.notes, party: supplierParty(o.supplierId), partyLabel: "Supplier",
        lines, totals: totalsOf(lines, null), trace: bills.map((b) => ({ label: "Billed", detail: `${b.invoiceNumber} · ${b.postingStatus ?? b.status}`, drill: drill.document("purchase-bill", b.id) })),
      };
    }
    case "purchase-bill": {
      const b = (await source.bills()).find((x) => x.id === id);
      if (!b) return null;
      const [billLines, payments, bank] = await Promise.all([source.billLines(), source.supplierPayments(), source.bankTransactions({})]);
      const own = billLines.filter((l) => l.billId === b.id).sort((x, y) => x.lineOrder - y.lineOrder);
      const lines = own.length
        ? own.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitCost, net: l.netAmount, vat: l.vatAmount, total: l.lineTotal }))
        : [{ description: b.glAccount ? `As captured (GL ${b.glAccount})` : "As captured", quantity: null, unitPrice: null, net: round2(b.total - b.vat), vat: b.vat, total: b.total }];
      const trace: TraceLink[] = [];
      if (b.journalId !== null) trace.push({ label: "Posted in journal", detail: `Journal #${b.journalId}`, drill: drill.journal(b.journalId) });
      else if (!isPostedBill(b)) trace.push({ label: "Not posted", detail: "This bill has not entered the General Ledger", drill: drill.report("supplier-bill-register", {}) });
      for (const p of payments.filter((x) => x.allocations.some((a) => a.billId === b.id))) trace.push({ label: "Paid by payment", detail: `${p.paymentNumber || p.reference} · ${p.paymentDate}`, drill: drill.document("supplier-payment", p.id) });
      for (const t of bank.items.filter((x) => x.matchedBillId === b.id)) trace.push({ label: "Paid from bank", detail: `${t.transactionDate ?? ""} · ${t.description} · ${t.debit.toFixed(2)}`, drill: drill.bank(t.id) });
      if (b.purchaseOrderId) trace.push({ label: "From purchase order", detail: `#${b.purchaseOrderId}`, drill: drill.document("purchase-order", b.purchaseOrderId) });
      if (b.supplierId !== null) trace.push({ label: "Supplier statement", detail: "Every transaction on this supplier's account", drill: drill.report("supplier-statement", { supplierId: String(b.supplierId) }) });
      return {
        ...base, docType, id, title: b.documentType === "Bill" ? "Supplier Bill" : `Supplier ${b.documentType}`, number: b.invoiceNumber, date: b.invoiceDate ?? "", dueDate: b.dueDate, status: b.postingStatus ?? b.status,
        party: supplierParty(b.supplierId, b.supplierName), partyLabel: "Supplier", lines, totals: { net: round2(b.total - b.vat), vat: b.vat, total: b.total, outstanding: b.outstanding }, trace,
      };
    }
    case "supplier-payment": {
      const p = (await source.supplierPayments()).find((x) => x.id === id);
      if (!p) return null;
      const bills = await source.bills();
      const settlements = p.allocations.map((a) => {
        const b = bills.find((x) => x.id === a.billId);
        return { reference: b?.invoiceNumber ?? `#${a.billId}`, date: b?.invoiceDate ?? "", amount: a.amountAllocated, drill: drill.document("purchase-bill", a.billId) };
      });
      const trace: TraceLink[] = p.journalId !== null ? [{ label: "Posted in journal", detail: `Journal #${p.journalId}`, drill: drill.journal(p.journalId) }] : [];
      trace.push({ label: "Supplier statement", detail: "Every transaction on this supplier's account", drill: drill.report("supplier-statement", { supplierId: String(p.supplierId) }) });
      return {
        ...base, docType, id, title: "Remittance Advice", number: p.paymentNumber || p.reference, date: p.paymentDate, status: p.status, reference: p.reference, notes: p.notes, party: supplierParty(p.supplierId), partyLabel: "Paid To",
        lines: [], settlements, totals: { net: p.amount, vat: 0, total: p.amount, outstanding: round2(p.amount - settlements.reduce((s, x) => s + x.amount, 0)) }, trace,
      };
    }
  }
}

function totalsOf(lines: DocumentLine[], outstanding: number | null) {
  return { net: round2(lines.reduce((s, l) => s + l.net, 0)), vat: round2(lines.reduce((s, l) => s + l.vat, 0)), total: round2(lines.reduce((s, l) => s + l.total, 0)), outstanding };
}
