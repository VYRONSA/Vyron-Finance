/**
 * Sales and Purchasing analysis.
 *
 * Every analysis is built from posted document LINES, apportioned so the
 * lines of each document add up exactly to that document's net and VAT —
 * so any "Sales by …" total ties back to the invoices, and net sales tie
 * to the sales-invoice postings to revenue in the General Ledger (the
 * reconciliation every sales report carries). Purchasing is the same
 * over posted bills.
 *
 * Gross margin uses the stock item's CURRENT average cost — the only
 * per-line cost VYRON holds. Lines without a costed stock item are shown
 * as having no cost data and are left out of margin percentages rather
 * than assumed to cost nothing.
 */

import type { StockItem } from "@/server/inventory/types";
import { customerOpenItems, daysOverdue, isPostedBill, supplierOpenItems } from "../party-ledger";
import {
  asAtLabel,
  col,
  drill,
  F,
  monthKey,
  monthLabel,
  monthsBetween,
  numberFilter,
  periodLabel,
  row,
  section,
  shiftYears,
  summaryCount,
  summaryMoney,
  totalRow,
  type ReportContext,
  type ReportDefinition,
} from "../kit";
import { check, inRange, round2, sum, type ReconciliationCheck, type ReportCell, type ReportColumn, type ReportRow } from "../types";
import { accountsById } from "./shared";

export type TradeLine = {
  date: string;
  docId: number;
  number: string;
  documentType: string;
  partyId: number;
  partyName: string;
  description: string;
  stockItemId: number | null;
  quantity: number;
  net: number;
  vat: number;
  gross: number;
  vatCode: string;
  glAccount: string | null;
};

/** Split `total` across weights so the parts add up to `total` exactly. */
function apportion(total: number, weights: number[]): number[] {
  const base = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  if (base === 0) return weights.map((_, i) => (i === 0 ? round2(total) : 0));
  const parts = weights.map((w) => round2((total * w) / base));
  const drift = round2(total - parts.reduce((s, p) => s + p, 0));
  parts[parts.length - 1] = round2(parts[parts.length - 1] + drift);
  return parts;
}

export async function postedSalesLines(ctx: ReportContext, from: string, to: string): Promise<TradeLine[]> {
  const [invoices, customers] = await Promise.all([ctx.source.salesInvoices(), ctx.source.customers()]);
  const names = new Map(customers.map((c) => [c.id, c.name]));
  const lines: TradeLine[] = [];
  for (const inv of invoices) {
    if (inv.status !== "Posted" || !inRange(inv.invoiceDate, from, to)) continue;
    const sign = inv.documentType === "Credit Note" ? -1 : 1;
    const source = inv.lines.length ? [...inv.lines].sort((a, b) => a.lineOrder - b.lineOrder) : null;
    const weights = source ? source.map((l) => Math.abs(l.netAmount || l.lineTotal)) : [1];
    const nets = apportion(inv.subtotal, weights);
    const vats = apportion(inv.vatAmount, weights);
    (source ?? [null]).forEach((l, i) => {
      lines.push({
        date: inv.invoiceDate,
        docId: inv.id,
        number: inv.invoiceNumber,
        documentType: inv.documentType,
        partyId: inv.customerId,
        partyName: names.get(inv.customerId) ?? `Customer #${inv.customerId}`,
        description: l?.description || inv.reference || "Invoice total",
        stockItemId: l?.stockItemId ?? null,
        quantity: sign * (l?.quantity ?? 0),
        net: round2(sign * nets[i]),
        vat: round2(sign * vats[i]),
        gross: round2(sign * (nets[i] + vats[i])),
        vatCode: l?.vatCode || inv.vatTreatmentCode,
        glAccount: l?.glAccount ?? null,
      });
    });
  }
  return lines;
}

export async function postedPurchaseLines(ctx: ReportContext, from: string, to: string): Promise<TradeLine[]> {
  const [bills, billLines, suppliers] = await Promise.all([ctx.source.bills(), ctx.source.billLines(), ctx.source.suppliers()]);
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const linesByBill = new Map<number, typeof billLines>();
  for (const l of billLines) linesByBill.set(l.billId, [...(linesByBill.get(l.billId) ?? []), l]);
  const lines: TradeLine[] = [];
  for (const bill of bills) {
    if (!isPostedBill(bill) || bill.supplierId === null || !bill.invoiceDate || !inRange(bill.invoiceDate, from, to)) continue;
    const sign = bill.documentType === "Credit Note" ? -1 : 1;
    const own = (linesByBill.get(bill.id) ?? []).sort((a, b) => a.lineOrder - b.lineOrder);
    const weights = own.length ? own.map((l) => Math.abs(l.netAmount || l.lineTotal)) : [1];
    const nets = apportion(round2(bill.total - bill.vat), weights);
    const vats = apportion(bill.vat, weights);
    (own.length ? own : [null]).forEach((l, i) => {
      lines.push({
        date: bill.invoiceDate as string,
        docId: bill.id,
        number: bill.invoiceNumber,
        documentType: bill.documentType,
        partyId: bill.supplierId as number,
        partyName: names.get(bill.supplierId as number) ?? bill.supplierName,
        description: l?.description || (bill.glAccount ? `GL ${bill.glAccount}` : "Bill total"),
        stockItemId: null,
        quantity: sign * (l?.quantity ?? 0),
        net: round2(sign * nets[i]),
        vat: round2(sign * vats[i]),
        gross: round2(sign * (nets[i] + vats[i])),
        vatCode: l?.vatCode || bill.vatCode || "",
        glAccount: l?.glAccount || bill.glAccount,
      });
    });
  }
  return lines;
}

/** Net sales (or purchases) agree with the revenue (or expense) side of
 * the sales-invoice (or purchase-bill) journals in the GL. */
async function glCheck(ctx: ReportContext, side: "sales" | "purchases", from: string, to: string, net: number): Promise<ReconciliationCheck[]> {
  const [gl, accounts, controls] = await Promise.all([ctx.source.glTransactions({ from, to }), ctx.source.accounts(), ctx.source.controlAccounts()]);
  const byId = accountsById(accounts);
  const vatIds = new Set(controls.vat.map((v) => v.accountId));
  const control = side === "sales" ? controls.debtors : controls.creditors;
  const sourceType = side === "sales" ? "sales_invoice" : "purchase_bill";
  let value = 0;
  for (const t of gl.items) {
    if (t.sourceType !== sourceType || vatIds.has(t.accountId)) continue;
    const account = byId.get(t.accountId);
    if (!account || account.accountCode === control) continue;
    value += side === "sales" ? t.credit - t.debit : t.debit - t.credit;
  }
  return [
    check(
      side === "sales" ? "Net sales agree with sales-invoice postings to revenue in the GL" : "Net purchases agree with purchase-bill postings to expense and stock in the GL",
      round2(value),
      net,
      "A difference usually means a document dated in this period was posted to the ledger in another period.",
    ),
  ];
}

type Group = { key: string; label: string; lines: TradeLine[] };

function groupBy(lines: TradeLine[], keyOf: (l: TradeLine) => string, labelOf: (l: TradeLine) => string): Group[] {
  const map = new Map<string, Group>();
  for (const l of lines) {
    const key = keyOf(l);
    const g = map.get(key) ?? { key, label: labelOf(l), lines: [] };
    g.lines.push(l);
    map.set(key, g);
  }
  return [...map.values()];
}

function stockLookup(items: StockItem[]) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    product: (l: TradeLine) => (l.stockItemId !== null && byId.get(l.stockItemId) ? `${byId.get(l.stockItemId)!.stockCode} ${byId.get(l.stockItemId)!.description}` : l.description || "Unspecified"),
    productKey: (l: TradeLine) => (l.stockItemId !== null ? `s${l.stockItemId}` : `d${(l.description || "").trim().toLowerCase()}`),
    category: (l: TradeLine) => (l.stockItemId !== null ? byId.get(l.stockItemId)?.category || "Uncategorised stock" : "Non-stock / services"),
    unitCost: (l: TradeLine) => {
      const item = l.stockItemId !== null ? byId.get(l.stockItemId) : undefined;
      const cost = item ? item.averageCost || item.costPrice : 0;
      return cost > 0 ? cost : null;
    },
  };
}

type AnalysisSpec = {
  id: string;
  title: string;
  description: string;
  side: "sales" | "purchases";
  categories: ReportDefinition["categories"];
  groupLabel: string;
  extraFilters?: ReportDefinition["filters"];
  group: (lines: TradeLine[], ctx: ReportContext, stock: ReturnType<typeof stockLookup>) => Group[];
  withQuantity?: boolean;
  drillOf?: (g: Group, ctx: ReportContext) => ReportRow["drill"];
  sortBy?: "value" | "label";
};

function analysis(spec: AnalysisSpec): ReportDefinition {
  return {
    id: spec.id,
    title: spec.title,
    description: spec.description,
    categories: spec.categories,
    filters: [...F.period, ...(spec.extraFilters ?? [])],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const [all, stockItems] = await Promise.all([spec.side === "sales" ? postedSalesLines(ctx, dateFrom, dateTo) : postedPurchaseLines(ctx, dateFrom, dateTo), ctx.source.stockItems()]);
      const stock = stockLookup(stockItems);
      const customerId = numberFilter(ctx.filters.customerId);
      const supplierId = numberFilter(ctx.filters.supplierId);
      const lines = all.filter((l) => (spec.side !== "sales" || customerId === null || l.partyId === customerId) && (spec.side !== "purchases" || supplierId === null || l.partyId === supplierId) && (!ctx.filters.category || stock.category(l) === ctx.filters.category) && (!ctx.filters.product || l.stockItemId === numberFilter(ctx.filters.product)));
      const totalNet = sum(lines, (l) => l.net);
      const groups = spec.group(lines, ctx, stock);
      if (spec.sortBy === "label") groups.sort((a, b) => (a.key < b.key ? -1 : 1));
      else groups.sort((a, b) => sum(b.lines, (l) => l.net) - sum(a.lines, (l) => l.net));
      const rows: ReportRow[] = groups.map((g) => {
        const net = sum(g.lines, (l) => l.net);
        const documents = new Set(g.lines.map((l) => l.docId)).size;
        const cells: Record<string, ReportCell> = { label: g.label, documents, net, vat: sum(g.lines, (l) => l.vat), gross: sum(g.lines, (l) => l.gross), share: totalNet ? round2((net / totalNet) * 100) : null };
        if (spec.withQuantity) cells.quantity = round2(sum(g.lines, (l) => l.quantity));
        return row(cells, { drill: spec.drillOf?.(g, ctx) });
      });
      rows.push(totalRow({ label: `Total — ${groups.length}`, documents: new Set(lines.map((l) => l.docId)).size, net: totalNet, vat: sum(lines, (l) => l.vat), gross: sum(lines, (l) => l.gross), ...(spec.withQuantity ? { quantity: round2(sum(lines, (l) => l.quantity)) } : {}) }));
      const columns: ReportColumn[] = [col("label", spec.groupLabel), col("documents", "Documents", "number"), ...(spec.withQuantity ? [col("quantity", "Quantity", "number")] : []), col("net", "Net", "money"), col("vat", "VAT", "money"), col("gross", "Gross", "money"), col("share", "% of Net", "percent")];
      const filtered = customerId !== null || supplierId !== null || !!ctx.filters.category || !!ctx.filters.product;
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney(spec.side === "sales" ? "Net Sales" : "Net Purchases", totalNet), summaryMoney("VAT", sum(lines, (l) => l.vat)), summaryMoney("Gross", sum(lines, (l) => l.gross)), summaryCount("Documents", new Set(lines.map((l) => l.docId)).size)],
        sections: [section(columns, rows, undefined, `No posted ${spec.side === "sales" ? "sales" : "purchase"} documents in this period.`)],
        checks: filtered ? [] : await glCheck(ctx, spec.side, dateFrom, dateTo, totalNet),
        notices: ["Built from posted documents; credit notes reduce the figures."],
      };
    },
  };
}

const byParty = (lines: TradeLine[]) => groupBy(lines, (l) => String(l.partyId), (l) => l.partyName);
const byMonth = (lines: TradeLine[]) => groupBy(lines, (l) => monthKey(l.date), (l) => monthLabel(monthKey(l.date)));
const byDay = (lines: TradeLine[]) => groupBy(lines, (l) => l.date, (l) => l.date);

export const SALES_REPORTS: ReportDefinition[] = [
  {
    id: "sales-summary",
    title: "Sales Summary",
    description: "Invoices, credit notes and debit notes for the period, net sales, VAT, and the revenue per the Profit & Loss for comparison.",
    categories: ["sales", "management"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const lines = await postedSalesLines(ctx, dateFrom, dateTo);
      const types = ["Invoice", "Debit Note", "Credit Note"];
      const rows = types.map((t) => {
        const own = lines.filter((l) => l.documentType === t);
        return row({ label: `${t}s`, documents: new Set(own.map((l) => l.docId)).size, net: sum(own, (l) => l.net), vat: sum(own, (l) => l.vat), gross: sum(own, (l) => l.gross) }, { drill: drill.report(t === "Credit Note" ? "customer-credit-notes" : "customer-invoice-register", { dateFrom, dateTo }) });
      });
      const net = sum(lines, (l) => l.net);
      rows.push(totalRow({ label: "Net Sales", documents: new Set(lines.map((l) => l.docId)).size, net, vat: sum(lines, (l) => l.vat), gross: sum(lines, (l) => l.gross) }));
      const invoiceCount = new Set(lines.filter((l) => l.documentType === "Invoice").map((l) => l.docId)).size;
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney("Net Sales", net), summaryCount("Invoices", invoiceCount), summaryMoney("Average Invoice (net)", invoiceCount ? round2(sum(lines.filter((l) => l.documentType === "Invoice"), (l) => l.net) / invoiceCount) : 0), summaryCount("Customers Invoiced", new Set(lines.map((l) => l.partyId)).size)],
        sections: [section([col("label", ""), col("documents", "Documents", "number"), col("net", "Net", "money"), col("vat", "VAT", "money"), col("gross", "Gross", "money")], rows)],
        checks: await glCheck(ctx, "sales", dateFrom, dateTo, net),
        notices: ["Revenue in the Profit & Loss can also include income allocated directly from the bank, which is not a sales document."],
      };
    },
  },
  analysis({ id: "sales-by-customer", title: "Sales by Customer", description: "Net sales, VAT and gross per customer, with each customer's share of sales.", side: "sales", categories: ["sales", "customers"], groupLabel: "Customer", group: byParty, drillOf: (g, ctx) => drill.report("customer-invoice-register", { customerId: g.key, dateFrom: ctx.filters.dateFrom, dateTo: ctx.filters.dateTo }) }),
  analysis({ id: "sales-by-product", title: "Sales by Product", description: "Quantity and value sold per product or service line.", side: "sales", categories: ["sales", "inventory"], groupLabel: "Product / Service", withQuantity: true, extraFilters: [F.category], group: (lines, _ctx, s) => groupBy(lines, s.productKey, s.product) }),
  analysis({ id: "sales-by-date", title: "Sales by Date", description: "Net sales per day.", side: "sales", categories: ["sales"], groupLabel: "Date", group: byDay, sortBy: "label" }),
  analysis({ id: "sales-by-month", title: "Sales by Month", description: "Net sales per month.", side: "sales", categories: ["sales"], groupLabel: "Month", group: byMonth, sortBy: "label" }),
  analysis({ id: "sales-by-category", title: "Sales by Category", description: "Net sales per stock category; lines without a stock item are shown as non-stock / services.", side: "sales", categories: ["sales", "inventory"], groupLabel: "Category", group: (lines, _ctx, s) => groupBy(lines, s.category, s.category) }),
  analysis({ id: "sales-by-vat-treatment", title: "Sales by VAT Treatment", description: "Net sales and output VAT per VAT treatment.", side: "sales", categories: ["sales", "vat"], groupLabel: "VAT Treatment", group: (lines) => groupBy(lines, (l) => l.vatCode || "No VAT code", (l) => l.vatCode || "No VAT code") }),
  analysis({ id: "sales-by-customer-product", title: "Sales by Customer / Product", description: "What each customer bought.", side: "sales", categories: ["sales", "customers"], groupLabel: "Customer — Product", withQuantity: true, extraFilters: [F.customer(), F.category], group: (lines, _ctx, s) => groupBy(lines, (l) => `${l.partyId}|${s.productKey(l)}`, (l) => `${l.partyName} — ${s.product(l)}`) }),
  analysis({ id: "customer-sales-analysis", title: "Customer Sales Analysis", description: "Each customer's net sales, document count and share of total sales.", side: "sales", categories: ["customers"], groupLabel: "Customer", extraFilters: [F.category], group: byParty, drillOf: (g, ctx) => drill.report("sales-by-customer-product", { customerId: g.key, dateFrom: ctx.filters.dateFrom, dateTo: ctx.filters.dateTo }) }),
  {
    id: "sales-trends",
    title: "Sales Trends",
    description: "Monthly net sales with month-on-month and year-on-year growth.",
    categories: ["sales", "management"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const months = monthsBetween(dateFrom, dateTo).slice(-24);
      const [current, prior] = await Promise.all([postedSalesLines(ctx, `${months[0]}-01`, dateTo), postedSalesLines(ctx, shiftYears(`${months[0]}-01`, -1), shiftYears(dateTo, -1))]);
      const byKey = (lines: TradeLine[]) => {
        const m = new Map<string, number>();
        for (const l of lines) m.set(monthKey(l.date), round2((m.get(monthKey(l.date)) ?? 0) + l.net));
        return m;
      };
      const cur = byKey(current);
      const pri = byKey(prior);
      const rows = months.map((m, i) => {
        const value = cur.get(m) ?? 0;
        const prev = i > 0 ? cur.get(months[i - 1]) ?? 0 : null;
        const lastYearKey = `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
        const lastYear = pri.get(lastYearKey) ?? 0;
        return row({ month: monthLabel(m), net: value, mom: prev ? round2(((value - prev) / Math.abs(prev)) * 100) : null, lastYear, yoy: lastYear ? round2(((value - lastYear) / Math.abs(lastYear)) * 100) : null }, { drill: drill.report("sales-by-customer", { dateFrom: `${m}-01`, dateTo: m === monthKey(dateTo) ? dateTo : `${m}-31` }) });
      });
      const total = sum(current, (l) => l.net);
      rows.push(totalRow({ month: "Total", net: total, lastYear: sum(prior, (l) => l.net) }));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney("Net Sales", total), summaryMoney("Same period last year", sum(prior, (l) => l.net))],
        sections: [section([col("month", "Month"), col("net", "Net Sales", "money"), col("mom", "vs Prior Month", "percent"), col("lastYear", "Same Month Last Year", "money"), col("yoy", "vs Last Year", "percent")], rows)],
        checks: [],
        notices: ["Growth is blank where the comparison month had no sales."],
      };
    },
  },
  {
    id: "outstanding-sales",
    title: "Outstanding Sales",
    description: "Every posted sales document with an amount still outstanding, with days overdue.",
    categories: ["sales"],
    filters: [F.asAt, F.customer()],
    async build(ctx) {
      const { asAt } = ctx.filters;
      const customerId = numberFilter(ctx.filters.customerId);
      const [invoices, receipts, customers] = await Promise.all([ctx.source.salesInvoices(), ctx.source.customerReceipts(), ctx.source.customers()]);
      const names = new Map(customers.map((c) => [c.id, c.name]));
      const items = customerOpenItems(invoices, receipts, asAt, ctx.today).filter((i) => customerId === null || i.partyId === customerId).sort((a, b) => (a.dueDate ?? a.date) < (b.dueDate ?? b.date) ? -1 : 1);
      const rows = items.map((i) => row({ date: i.date, number: i.reference, type: i.type, customer: names.get(i.partyId) ?? `Customer #${i.partyId}`, due: i.dueDate, days: daysOverdue(i.dueDate, asAt), total: i.total, outstanding: i.outstanding }, { drill: drill.document(i.docType, i.docId) }));
      rows.push(totalRow({ number: `${items.length} documents`, outstanding: sum(items, (i) => i.outstanding) }));
      return {
        subtitle: asAtLabel(asAt),
        summary: [summaryMoney("Outstanding", sum(items, (i) => i.outstanding)), summaryMoney("Overdue", sum(items.filter((i) => daysOverdue(i.dueDate, asAt) > 0), (i) => i.outstanding)), summaryCount("Documents", items.length)],
        sections: [section([col("date", "Date", "date"), col("number", "Number"), col("type", "Type", "badge"), col("customer", "Customer"), col("due", "Due", "date"), col("days", "Days Overdue", "number"), col("total", "Total", "money"), col("outstanding", "Outstanding", "money")], rows, undefined, "No outstanding sales documents.")],
        checks: [],
        notices: ["Open documents only. Receipts settled against the Debtors account as a whole (e.g. bank-posted) appear as Unallocated in the Customer Aging rather than here."],
      };
    },
  },
  marginReport("gross-margin", "Gross Margin", "Sales, cost and gross margin per product where cost data exists.", ["sales", "inventory"], "product"),
  marginReport("customer-profitability", "Customer Profitability", "Net sales, cost of sales and gross margin per customer, where cost data exists.", ["customers", "management"], "customer"),
];

function marginReport(id: string, title: string, description: string, categories: ReportDefinition["categories"], by: "product" | "customer"): ReportDefinition {
  return {
    id,
    title,
    description,
    categories,
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const [lines, stockItems] = await Promise.all([postedSalesLines(ctx, dateFrom, dateTo), ctx.source.stockItems()]);
      const stock = stockLookup(stockItems);
      const groups = by === "product" ? groupBy(lines, stock.productKey, stock.product) : groupBy(lines, (l) => String(l.partyId), (l) => l.partyName);
      const rows = groups
        .map((g) => {
          const net = sum(g.lines, (l) => l.net);
          const costed = g.lines.filter((l) => stock.unitCost(l) !== null);
          const costedNet = sum(costed, (l) => l.net);
          const cost = round2(costed.reduce((s, l) => s + l.quantity * (stock.unitCost(l) ?? 0), 0));
          return { g, net, costedNet, cost, margin: round2(costedNet - cost), coverage: net ? round2((costedNet / net) * 100) : 0 };
        })
        .sort((a, b) => b.net - a.net)
        .map((r) => row({ label: r.g.label, net: r.net, costedNet: r.costedNet, cost: r.costedNet ? r.cost : null, margin: r.costedNet ? r.margin : null, marginPct: r.costedNet ? round2((r.margin / r.costedNet) * 100) : null, coverage: r.coverage }));
      const all = lines;
      const costedAll = all.filter((l) => stock.unitCost(l) !== null);
      const costedNet = sum(costedAll, (l) => l.net);
      const cost = round2(costedAll.reduce((s, l) => s + l.quantity * (stock.unitCost(l) ?? 0), 0));
      rows.push(totalRow({ label: "Total", net: sum(all, (l) => l.net), costedNet, cost: costedNet ? cost : null, margin: costedNet ? round2(costedNet - cost) : null, marginPct: costedNet ? round2(((costedNet - cost) / costedNet) * 100) : null }));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney("Net Sales", sum(all, (l) => l.net)), summaryMoney("Sales with cost data", costedNet), ...(costedNet ? [summaryMoney("Gross Margin (costed sales)", round2(costedNet - cost))] : [])],
        sections: [section([col("label", by === "product" ? "Product / Service" : "Customer"), col("net", "Net Sales", "money"), col("costedNet", "Sales with Cost Data", "money"), col("cost", "Cost", "money"), col("margin", "Gross Margin", "money"), col("marginPct", "Margin %", "percent"), col("coverage", "Cost Coverage %", "percent")], rows, undefined, "No posted sales in this period.")],
        checks: [],
        notices: [
          "Cost is quantity × the stock item's current average cost (cost price where no average exists) — VYRON does not hold a historical cost for each sale. Lines with no costed stock item are excluded from margin and shown in 'Cost Coverage'.",
          "The company's overall gross profit from the General Ledger is on the Profit & Loss.",
        ],
      };
    },
  };
}

export const PURCHASING_REPORTS: ReportDefinition[] = [
  {
    id: "purchase-summary",
    title: "Purchase Summary",
    description: "Bills, supplier credit notes and debit notes for the period with net purchases and input VAT.",
    categories: ["purchasing", "management"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const lines = await postedPurchaseLines(ctx, dateFrom, dateTo);
      const rows = ["Bill", "Debit Note", "Credit Note"].map((t) => {
        const own = lines.filter((l) => l.documentType === t);
        return row({ label: `${t}s`, documents: new Set(own.map((l) => l.docId)).size, net: sum(own, (l) => l.net), vat: sum(own, (l) => l.vat), gross: sum(own, (l) => l.gross) }, { drill: drill.report(t === "Credit Note" ? "supplier-credit-notes" : "supplier-bill-register", { dateFrom, dateTo }) });
      });
      const net = sum(lines, (l) => l.net);
      rows.push(totalRow({ label: "Net Purchases", documents: new Set(lines.map((l) => l.docId)).size, net, vat: sum(lines, (l) => l.vat), gross: sum(lines, (l) => l.gross) }));
      const billCount = new Set(lines.filter((l) => l.documentType === "Bill").map((l) => l.docId)).size;
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney("Net Purchases", net), summaryCount("Bills", billCount), summaryMoney("Average Bill (net)", billCount ? round2(sum(lines.filter((l) => l.documentType === "Bill"), (l) => l.net) / billCount) : 0), summaryCount("Suppliers Billed", new Set(lines.map((l) => l.partyId)).size)],
        sections: [section([col("label", ""), col("documents", "Documents", "number"), col("net", "Net", "money"), col("vat", "VAT", "money"), col("gross", "Gross", "money")], rows)],
        checks: await glCheck(ctx, "purchases", dateFrom, dateTo, net),
        notices: ["Posted bills only. Expenses paid straight from the bank without a bill appear in Supplier Spend and the Profit & Loss."],
      };
    },
  },
  analysis({ id: "purchases-by-supplier", title: "Purchases by Supplier", description: "Net purchases, VAT and gross per supplier.", side: "purchases", categories: ["purchasing", "suppliers"], groupLabel: "Supplier", group: byParty, drillOf: (g, ctx) => drill.report("supplier-bill-register", { supplierId: g.key, dateFrom: ctx.filters.dateFrom, dateTo: ctx.filters.dateTo }) }),
  analysis({ id: "purchases-by-product", title: "Purchases by Product", description: "Purchases per bill line description.", side: "purchases", categories: ["purchasing", "inventory"], groupLabel: "Product / Service", withQuantity: true, group: (lines) => groupBy(lines, (l) => l.description.trim().toLowerCase(), (l) => l.description) }),
  analysis({ id: "purchases-by-date", title: "Purchases by Date", description: "Net purchases per day.", side: "purchases", categories: ["purchasing"], groupLabel: "Date", group: byDay, sortBy: "label" }),
  analysis({ id: "purchases-by-month", title: "Purchases by Month", description: "Net purchases per month.", side: "purchases", categories: ["purchasing"], groupLabel: "Month", group: byMonth, sortBy: "label" }),
  analysis({ id: "purchases-by-supplier-product", title: "Purchases by Supplier / Product", description: "What was bought from each supplier.", side: "purchases", categories: ["purchasing", "suppliers"], groupLabel: "Supplier — Product", withQuantity: true, extraFilters: [F.supplier()], group: (lines) => groupBy(lines, (l) => `${l.partyId}|${l.description.trim().toLowerCase()}`, (l) => `${l.partyName} — ${l.description}`) }),
  analysis({ id: "purchase-analysis", title: "Purchase Analysis", description: "Each supplier's net purchases, bill count and share of total purchases.", side: "purchases", categories: ["suppliers"], groupLabel: "Supplier", group: byParty, drillOf: (g, ctx) => drill.report("purchases-by-supplier-product", { supplierId: g.key, dateFrom: ctx.filters.dateFrom, dateTo: ctx.filters.dateTo }) }),
  {
    id: "supplier-spend",
    title: "Supplier Spend Analysis",
    description: "Total spend per supplier — posted bills plus bank payments allocated straight to an expense account with the supplier identified — by GL account.",
    categories: ["suppliers", "purchasing", "management"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const [lines, bank, suppliers, accounts] = await Promise.all([postedPurchaseLines(ctx, dateFrom, dateTo), ctx.source.bankTransactions({ from: dateFrom, to: dateTo }), ctx.source.suppliers(), ctx.source.accounts()]);
      const names = new Map(suppliers.map((s) => [s.id, s.name]));
      const accountName = new Map(accounts.map((a) => [a.accountCode, a.description]));
      type Spend = { supplierId: number; name: string; billed: number; direct: number; byAccount: Map<string, number> };
      const spend = new Map<number, Spend>();
      const at = (id: number, name: string) => {
        const s = spend.get(id) ?? { supplierId: id, name, billed: 0, direct: 0, byAccount: new Map() };
        spend.set(id, s);
        return s;
      };
      for (const l of lines) {
        const s = at(l.partyId, l.partyName);
        s.billed = round2(s.billed + l.net);
        const key = l.glAccount || "Unassigned";
        s.byAccount.set(key, round2((s.byAccount.get(key) ?? 0) + l.net));
      }
      for (const t of bank.items) {
        if (!t.postedFlag || t.allocationType === "S" || t.allocationType === "C" || t.matchedSupplierId === null || t.debit <= 0) continue;
        const s = at(t.matchedSupplierId, names.get(t.matchedSupplierId) ?? t.matchedSupplierName ?? `Supplier #${t.matchedSupplierId}`);
        const net = round2(t.debit - Math.abs(t.vat ?? 0));
        s.direct = round2(s.direct + net);
        const key = t.suggestedGlAccount || "Unassigned";
        s.byAccount.set(key, round2((s.byAccount.get(key) ?? 0) + net));
      }
      const list = [...spend.values()].sort((a, b) => b.billed + b.direct - (a.billed + a.direct));
      const total = sum(list, (s) => s.billed + s.direct);
      const rows: ReportRow[] = list.map((s) =>
        row(
          { supplier: s.name, billed: s.billed, direct: s.direct, total: round2(s.billed + s.direct), share: total ? round2(((s.billed + s.direct) / total) * 100) : null, accounts: [...s.byAccount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([code]) => (accountName.has(code) ? `${code} ${accountName.get(code)}` : code)).join(", ") },
          { drill: drill.report("supplier-detailed-ledger", { supplierId: String(s.supplierId), dateFrom, dateTo }) },
        ),
      );
      rows.push(totalRow({ supplier: "Total", billed: sum(list, (s) => s.billed), direct: sum(list, (s) => s.direct), total }));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney("Total Spend (net)", total), summaryMoney("Billed", sum(list, (s) => s.billed)), summaryMoney("Paid directly from bank", sum(list, (s) => s.direct)), summaryCount("Suppliers", list.length)],
        sections: [section([col("supplier", "Supplier"), col("billed", "Billed (net)", "money"), col("direct", "Direct Bank Spend (net)", "money"), col("total", "Total Spend", "money"), col("share", "% of Spend", "percent"), col("accounts", "Main GL Accounts")], rows, undefined, "No supplier spend in this period.")],
        checks: [],
        notices: ["Direct bank spend is posted bank payments allocated to a GL account (not settled against Creditors) where the supplier is identified, net of VAT. Payments that settle a supplier's bills are not counted again."],
      };
    },
  },
  {
    id: "outstanding-purchases",
    title: "Outstanding Purchases",
    description: "Every posted bill with an amount still outstanding, with days overdue.",
    categories: ["purchasing"],
    filters: [F.asAt, F.supplier()],
    async build(ctx) {
      const { asAt } = ctx.filters;
      const supplierId = numberFilter(ctx.filters.supplierId);
      const [bills, payments, suppliers] = await Promise.all([ctx.source.bills(), ctx.source.supplierPayments(), ctx.source.suppliers()]);
      const names = new Map(suppliers.map((s) => [s.id, s.name]));
      const items = supplierOpenItems(bills, payments, asAt, ctx.today).filter((i) => supplierId === null || i.partyId === supplierId).sort((a, b) => ((a.dueDate ?? a.date) < (b.dueDate ?? b.date) ? -1 : 1));
      const rows = items.map((i) => row({ date: i.date, number: i.reference, type: i.type, supplier: names.get(i.partyId) ?? `Supplier #${i.partyId}`, due: i.dueDate, days: daysOverdue(i.dueDate, asAt), total: i.total, outstanding: i.outstanding }, { drill: drill.document(i.docType, i.docId) }));
      rows.push(totalRow({ number: `${items.length} documents`, outstanding: sum(items, (i) => i.outstanding) }));
      return {
        subtitle: asAtLabel(asAt),
        summary: [summaryMoney("Outstanding", sum(items, (i) => i.outstanding)), summaryMoney("Overdue", sum(items.filter((i) => daysOverdue(i.dueDate, asAt) > 0), (i) => i.outstanding)), summaryCount("Documents", items.length)],
        sections: [section([col("date", "Date", "date"), col("number", "Number"), col("type", "Type", "badge"), col("supplier", "Supplier"), col("due", "Due", "date"), col("days", "Days Overdue", "number"), col("total", "Total", "money"), col("outstanding", "Outstanding", "money")], rows, undefined, "No outstanding bills.")],
        checks: [],
        notices: ["Open bills only. Bank payments settled against the Creditors account as a whole appear as Unallocated in the Supplier Aging rather than here."],
      };
    },
  },
  {
    id: "cost-trends",
    title: "Cost Trends",
    description: "Monthly cost of sales and operating expenses by account category, from the General Ledger.",
    categories: ["purchasing", "management"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const months = monthsBetween(dateFrom, dateTo).slice(-24);
      const [gl, accounts] = await Promise.all([ctx.source.glTransactions({ from: `${months[0]}-01`, to: dateTo }), ctx.source.accounts()]);
      const byId = accountsById(accounts);
      const matrix = new Map<string, Map<string, number>>();
      for (const t of gl.items) {
        const a = byId.get(t.accountId);
        if (!a || (a.accountType !== "Cost of Sales" && a.accountType !== "Expense")) continue;
        const group = `${a.accountType === "Cost of Sales" ? "Cost of Sales" : "Expense"} — ${a.category || a.description}`;
        const m = matrix.get(group) ?? new Map();
        m.set(monthKey(t.postingDate), round2((m.get(monthKey(t.postingDate)) ?? 0) + t.debit - t.credit));
        matrix.set(group, m);
      }
      const rows = [...matrix.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([group, m]) => row({ label: group, ...Object.fromEntries(months.map((k) => [k, m.get(k) ?? 0])), total: sum(months, (k) => m.get(k) ?? 0) }));
      rows.push(totalRow({ label: "Total", ...Object.fromEntries(months.map((k) => [k, sum([...matrix.values()], (m) => m.get(k) ?? 0)])), total: sum([...matrix.values()], (m) => sum(months, (k) => m.get(k) ?? 0)) }));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney("Total costs", sum([...matrix.values()], (m) => sum(months, (k) => m.get(k) ?? 0)))],
        sections: [section([col("label", "Cost Category"), ...months.map((k) => col(k, monthLabel(k), "money")), col("total", "Total", "money")], rows, undefined, "No cost postings in this period.")],
        checks: [],
        notices: gl.truncated ? ["The GL exceeded the report read limit; narrow the date range."] : [],
      };
    },
  },
];

export { stockLookup };
