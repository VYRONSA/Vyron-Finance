/**
 * Xero Client Import — Sales Invoices / Bills CSV parser. Both exports
 * share the EXACT same column layout (confirmed by reading both real
 * files header-for-header), one row per LINE ITEM with the invoice/bill
 * header fields (ContactName, InvoiceNumber, dates, Total, TaxTotal,
 * amounts, Currency, Type, Status) repeated identically on every line —
 * so this groups rows by InvoiceNumber into one header + N lines, unlike
 * `xero-bills-parser.ts` (which reads header-only report exports with no
 * line-item detail and treats each CSV row as a whole document). The
 * task's own instruction — "do not simply import invoice totals if
 * line-level accounting data is available" — is the reason this parser
 * exists rather than reusing that one.
 *
 * "Sales overpayment"/"Bill overpayment" rows all share a BLANK
 * InvoiceNumber (confirmed: every such row collapses to the same empty
 * key) and their AccountCode is always 610/800 (Accounts Receivable/
 * Payable) — these are payment-application events, the exact same
 * events the bank transactions export already carries as "Receivable
 * Overpayment"/"Payable Overpayment" rows, not real invoices with
 * meaningful line items. Importing them here would double-count what
 * the bank transaction import already captures, so they are
 * deliberately excluded and reported as skipped (never silently
 * dropped — see `skipped` on the result).
 */
import { cleanText, isBlankRow, parseAmount, parseCsvText, parseDate, round2 } from "./csv-utils";

const HEADERS = [
  "ContactName", "InvoiceNumber", "Reference", "InvoiceDate", "DueDate", "Total", "TaxTotal",
  "InvoiceAmountPaid", "InvoiceAmountDue", "InventoryItemCode", "Description", "Quantity",
  "UnitAmount", "Discount", "LineAmount", "AccountCode", "TaxType", "TaxAmount",
  "TrackingName1", "TrackingOption1", "TrackingName2", "TrackingOption2", "Currency", "Type", "Status",
] as const;

export type XeroInvoiceLineRow = {
  description: string;
  quantity: number;
  unitAmount: number;
  discount: number;
  lineAmount: number;
  accountCode: string;
  taxType: string;
  taxAmount: number;
  tracking: string;
  rowNumber: number;
};

export type XeroInvoiceGroup = {
  contactName: string;
  invoiceNumber: string;
  reference: string;
  invoiceDate: string;
  dueDate: string | null;
  total: number;
  taxTotal: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  xeroType: string;
  xeroStatus: string;
  lines: XeroInvoiceLineRow[];
  sourceFilename: string;
};

export type XeroInvoiceParseResult = {
  invoices: XeroInvoiceGroup[];
  skipped: { rowNumber: number; contactName: string; invoiceNumber: string; reason: string }[];
};

const OVERPAYMENT_TYPES = new Set(["sales overpayment", "bill overpayment", "receive money", "spend money"]);

export function parseXeroInvoiceLinesCsv(fileText: string, sourceFilename: string): XeroInvoiceParseResult {
  const rawRows = parseCsvText(fileText);
  const skipped: XeroInvoiceParseResult["skipped"] = [];
  const groups = new Map<string, XeroInvoiceGroup>();
  const groupOrder: string[] = [];

  const headerIndex = rawRows.findIndex((row) => !isBlankRow(row));
  if (headerIndex === -1) return { invoices: [], skipped };

  const headers = rawRows[headerIndex].map(cleanText);
  const colIndex: Record<string, number> = {};
  for (const name of HEADERS) colIndex[name] = headers.indexOf(name);
  if (colIndex.ContactName === -1 || colIndex.InvoiceNumber === -1) {
    skipped.push({ rowNumber: headerIndex + 1, contactName: "", invoiceNumber: "", reason: `Missing required column(s) (headers found: ${headers.join(", ")}).` });
    return { invoices: [], skipped };
  }

  const dataRows = rawRows.slice(headerIndex + 1);
  dataRows.forEach((rawRow, offset) => {
    const rowNumber = headerIndex + 2 + offset;
    if (isBlankRow(rawRow)) return;

    const get = (name: (typeof HEADERS)[number]): string => {
      const idx = colIndex[name];
      return idx >= 0 && idx < rawRow.length ? cleanText(rawRow[idx]) : "";
    };

    const contactName = get("ContactName");
    const invoiceNumber = get("InvoiceNumber");
    const xeroType = get("Type");

    if (OVERPAYMENT_TYPES.has(xeroType.trim().toLowerCase())) {
      skipped.push({ rowNumber, contactName, invoiceNumber, reason: `Type "${xeroType}" is a payment-application event, not a document with line items — already represented by the bank transaction import. Not imported as an invoice/bill.` });
      return;
    }
    if (!contactName) {
      skipped.push({ rowNumber, contactName, invoiceNumber, reason: "Missing ContactName." });
      return;
    }
    if (!invoiceNumber) {
      skipped.push({ rowNumber, contactName, invoiceNumber, reason: "Missing InvoiceNumber." });
      return;
    }

    const invoiceDate = parseDate(get("InvoiceDate"));
    if (!invoiceDate) {
      skipped.push({ rowNumber, contactName, invoiceNumber, reason: `Invalid or missing InvoiceDate: "${get("InvoiceDate")}".` });
      return;
    }

    let group = groups.get(invoiceNumber);
    if (!group) {
      group = {
        contactName,
        invoiceNumber,
        reference: get("Reference"),
        invoiceDate,
        dueDate: parseDate(get("DueDate")),
        total: round2(parseAmount(get("Total")) ?? 0),
        taxTotal: round2(parseAmount(get("TaxTotal")) ?? 0),
        amountPaid: round2(parseAmount(get("InvoiceAmountPaid")) ?? 0),
        amountDue: round2(parseAmount(get("InvoiceAmountDue")) ?? 0),
        currency: get("Currency") || "ZAR",
        xeroType,
        xeroStatus: get("Status"),
        lines: [],
        sourceFilename,
      };
      groups.set(invoiceNumber, group);
      groupOrder.push(invoiceNumber);
    }

    const trackingParts: string[] = [];
    const t1n = get("TrackingName1"), t1o = get("TrackingOption1");
    const t2n = get("TrackingName2"), t2o = get("TrackingOption2");
    if (t1n && t1o) trackingParts.push(`${t1n}: ${t1o}`);
    if (t2n && t2o) trackingParts.push(`${t2n}: ${t2o}`);

    group.lines.push({
      description: get("Description") || "(no description)",
      quantity: parseAmount(get("Quantity")) ?? 1,
      unitAmount: parseAmount(get("UnitAmount")) ?? 0,
      discount: parseAmount(get("Discount")) ?? 0,
      lineAmount: round2(parseAmount(get("LineAmount")) ?? 0),
      accountCode: get("AccountCode"),
      taxType: get("TaxType"),
      taxAmount: round2(parseAmount(get("TaxAmount")) ?? 0),
      tracking: trackingParts.join("; "),
      rowNumber,
    });
  });

  const invoices = groupOrder.map((key) => groups.get(key)!).filter((g) => g.lines.length > 0);
  return { invoices, skipped };
}
