/**
 * Document Centre — every customer and supplier document VYRON holds,
 * in one register, each one re-openable, reprintable and re-downloadable
 * from its document view. Statements are produced by the Customer and
 * Supplier Statement reports (also listed in the Document Centre).
 */

import { isPostedBill } from "../party-ledger";
import { col, F, numberFilter, periodLabel, row, section, summaryCount, summaryMoney, totalRow, drill, type ReportDefinition } from "../kit";
import { inRange, round2, sum, type DocumentType } from "../types";

export const DOCUMENT_KINDS = [
  "Quotation",
  "Sales Order",
  "Invoice",
  "Credit Note",
  "Debit Note",
  "Receipt",
  "Purchase Order",
  "Bill",
  "Supplier Credit Note",
  "Supplier Debit Note",
  "Remittance Advice",
] as const;

type Doc = { kind: string; date: string; number: string; party: string; amount: number; status: string; docType: DocumentType; id: number; customerId: number | null; supplierId: number | null };

export const DOCUMENT_REPORTS: ReportDefinition[] = [
  {
    id: "document-register",
    title: "Document Register",
    description: "Every quote, order, invoice, credit note, receipt, purchase order, bill and remittance advice — open any one to view, print or download it again.",
    categories: ["documents"],
    filters: [...F.period, F.documentType([...DOCUMENT_KINDS]), F.customer(), F.supplier()],
    async build(ctx) {
      const { dateFrom, dateTo, documentType } = ctx.filters;
      const customerId = numberFilter(ctx.filters.customerId);
      const supplierId = numberFilter(ctx.filters.supplierId);
      const [quotes, orders, invoices, receipts, pos, bills, payments, customers, suppliers] = await Promise.all([
        ctx.source.quotations(),
        ctx.source.salesOrders(),
        ctx.source.salesInvoices(),
        ctx.source.customerReceipts(),
        ctx.source.purchaseOrders(),
        ctx.source.bills(),
        ctx.source.supplierPayments(),
        ctx.source.customers(),
        ctx.source.suppliers(),
      ]);
      const cName = new Map(customers.map((c) => [c.id, c.name]));
      const sName = new Map(suppliers.map((s) => [s.id, s.name]));
      const docs: Doc[] = [];
      const c = (id: number) => cName.get(id) ?? `Customer #${id}`;
      const s = (id: number) => sName.get(id) ?? `Supplier #${id}`;
      for (const q of quotes) docs.push({ kind: "Quotation", date: q.quotationDate, number: q.quotationNumber, party: c(q.customerId), amount: sum(q.lines, (l) => l.lineTotal + l.vatAmount), status: q.status, docType: "quotation", id: q.id, customerId: q.customerId, supplierId: null });
      for (const o of orders) docs.push({ kind: "Sales Order", date: o.orderDate, number: o.orderNumber, party: c(o.customerId), amount: sum(o.lines, (l) => l.netAmount + l.vatAmount), status: o.status, docType: "sales-order", id: o.id, customerId: o.customerId, supplierId: null });
      for (const i of invoices) docs.push({ kind: i.documentType, date: i.invoiceDate, number: i.invoiceNumber, party: c(i.customerId), amount: i.total, status: i.status, docType: "sales-invoice", id: i.id, customerId: i.customerId, supplierId: null });
      for (const r of receipts) docs.push({ kind: "Receipt", date: r.receiptDate, number: r.receiptNumber || r.reference, party: c(r.customerId), amount: r.amount, status: r.status, docType: "customer-receipt", id: r.id, customerId: r.customerId, supplierId: null });
      for (const p of pos) docs.push({ kind: "Purchase Order", date: p.orderDate, number: p.orderNumber, party: s(p.supplierId), amount: sum(p.lines, (l) => l.netAmount + l.vatAmount), status: p.status, docType: "purchase-order", id: p.id, customerId: null, supplierId: p.supplierId });
      for (const b of bills) {
        if (!b.invoiceDate) continue;
        const kind = b.documentType === "Bill" ? "Bill" : `Supplier ${b.documentType}`;
        docs.push({ kind, date: b.invoiceDate, number: b.invoiceNumber, party: b.supplierId !== null ? s(b.supplierId) : b.supplierName, amount: b.total, status: isPostedBill(b) ? b.postingStatus ?? "Posted" : b.postingStatus ?? b.status, docType: "purchase-bill", id: b.id, customerId: null, supplierId: b.supplierId });
      }
      for (const p of payments) docs.push({ kind: "Remittance Advice", date: p.paymentDate, number: p.paymentNumber || p.reference, party: s(p.supplierId), amount: p.amount, status: p.status, docType: "supplier-payment", id: p.id, customerId: null, supplierId: p.supplierId });

      const list = docs
        .filter((d) => inRange(d.date, dateFrom, dateTo) && (!documentType || d.kind === documentType) && (customerId === null || d.customerId === customerId) && (supplierId === null || d.supplierId === supplierId))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
      const rows = list.map((d) => row({ date: d.date, kind: d.kind, number: d.number, party: d.party, amount: round2(d.amount), status: d.status }, { drill: drill.document(d.docType, d.id) }));
      rows.push(totalRow({ number: `${list.length} documents` }));
      const counts = DOCUMENT_KINDS.map((k) => ({ k, n: list.filter((d) => d.kind === k).length })).filter((x) => x.n > 0);
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Documents", list.length), ...counts.slice(0, 5).map((x) => summaryCount(x.k, x.n)), ...(documentType ? [summaryMoney("Total", sum(list, (d) => d.amount))] : [])],
        sections: [section([col("date", "Date", "date"), col("kind", "Document", "badge"), col("number", "Number"), col("party", "Customer / Supplier"), col("amount", "Amount", "money"), col("status", "Status", "badge")], rows, undefined, "No documents in this period.")],
        checks: [],
        notices: ["Click any document to open it for viewing, printing or downloading."],
      };
    },
  },
];
