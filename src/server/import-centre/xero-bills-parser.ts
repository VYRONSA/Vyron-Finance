/**
 * Xero Bills / Credit Notes CSV parser — ported field-for-field from
 * `import_centre/xero_csv_parser.py`. Xero's own CSV export layout varies
 * by report (Bills list, Aged Payables Detail, Purchases by Contact, ...),
 * so header recognition is alias-based via FIELD_ALIASES rather than a
 * fixed column order.
 *
 * `parseBillsCsv` never throws for a bad row: anything that can't be read
 * is captured as an ImportExceptionRecord and the rest of the file keeps
 * processing, per the reference's "continue processing" requirement.
 */

import { cleanText, isBlankRow, normalizeHeader, parseAmount, parseDate, parseCsvText, round2 } from "./csv-utils";
import type { BillsParseResult, DocumentType, ImportExceptionRecord, ParsedBillTransaction } from "./types";

const FIELD_ALIASES: Record<string, string[]> = {
  supplier: [
    "contactname", "contact name", "contact", "supplier", "suppliername",
    "supplier name", "vendor", "vendorname", "vendor name", "payee", "name",
    "xerocontactname", "accountname", "account name",
  ],
  invoice_number: [
    "invoicenumber", "invoice number", "billnumber", "bill number",
    "invoiceno", "invoice no", "billno", "bill no", "number", "creditnotenumber",
    "credit note number", "documentnumber", "document number", "docnumber",
    "transactionnumber", "transaction number",
  ],
  reference: [
    "reference", "ref", "yourreference", "your reference", "supplierreference",
    "supplier reference", "purchaseorder", "purchase order", "ponumber", "po number",
  ],
  document_type: [
    "type", "invoicetype", "documenttype", "document type", "transactiontype",
    "transaction type",
  ],
  invoice_date: [
    "invoicedate", "date", "billdate", "bill date", "transactiondate",
    "transaction date", "creditnotedate", "credit note date", "issuedate", "issue date",
  ],
  due_date: [
    "duedate", "due date", "paymentdue", "payment due", "datedue", "date due",
  ],
  status: [
    "status", "invoicestatus", "invoice status", "paymentstatus", "payment status",
  ],
  currency: [
    "currency", "currencycode", "currency code",
  ],
  subtotal: [
    "subtotal", "sub total", "net", "nettotal", "net total", "netamount",
    "net amount", "linenet", "amountnet", "amount net",
  ],
  vat: [
    "vat", "totaltax", "total tax", "tax", "taxtotal", "tax total",
    "vatamount", "vat amount", "salestax", "sales tax", "taxamount", "tax amount",
  ],
  total: [
    "total", "invoicetotal", "invoice total", "invoiceamount", "invoice amount",
    "grosstotal", "gross total", "gross", "grossamount", "gross amount",
    "amountgross", "amount gross",
  ],
  amount_due: [
    "amountdue", "amount due", "invoiceamountdue", "invoice amount due",
    "balancedue", "balance due", "outstanding", "outstandingbalance",
    "outstanding balance", "balance", "due",
  ],
};

const CREDIT_TOKEN = "credit";
const REQUIRED_FIELDS = ["supplier", "invoice_number"];
const VAT_TOLERANCE = 0.01;

function buildHeaderMapping(headers: string[]): Map<number, string> {
  const normalizedLookup = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) normalizedLookup.set(normalizeHeader(alias), canonical);
  }

  const mapping = new Map<number, string>();
  const matchedFields = new Set<string>();
  headers.forEach((header, index) => {
    const canonical = normalizedLookup.get(normalizeHeader(header));
    if (canonical && !matchedFields.has(canonical)) {
      mapping.set(index, canonical);
      matchedFields.add(canonical);
    }
  });
  return mapping;
}

function trackingColumns(headers: string[]): number[] {
  return headers.reduce<number[]>((acc, header, index) => {
    if (normalizeHeader(header).startsWith("tracking")) acc.push(index);
    return acc;
  }, []);
}

function detectDocumentType(value: string): DocumentType | null {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  return normalized.includes(CREDIT_TOKEN) ? "Credit Note" : "Bill";
}

function detectTypeFromFilename(filename: string): DocumentType {
  return normalizeHeader(filename).includes(CREDIT_TOKEN) ? "Credit Note" : "Bill";
}

function rowEqualsHeaders(rawRow: string[], headers: string[]): boolean {
  if (rawRow.length !== headers.length) return false;
  return rawRow.every((cell, index) => cleanText(cell) === headers[index]);
}

export function parseBillsCsv(fileText: string, filename: string, importBatch: string): BillsParseResult {
  const transactions: ParsedBillTransaction[] = [];
  const exceptions: ImportExceptionRecord[] = [];
  let rowsRead = 0;

  const rawRows = parseCsvText(fileText);

  const headerIndex = rawRows.findIndex((row) => !isBlankRow(row));
  if (headerIndex === -1) {
    return { transactions, exceptions, outcome: { filename, documentTypeDetected: null, rowsRead: 0, rowsImported: 0, rowsSkipped: 0 } };
  }

  const headers = rawRows[headerIndex].map(cleanText);
  const headerMapping = buildHeaderMapping(headers);
  const trackingIndexes = trackingColumns(headers);
  const missingRequired = REQUIRED_FIELDS.filter((field) => ![...headerMapping.values()].includes(field));

  if (missingRequired.length > 0) {
    exceptions.push({
      sourceFilename: filename,
      rowNumber: headerIndex + 1,
      exceptionType: "Missing Required Column",
      description: `Missing required column(s): ${missingRequired.sort().join(", ")} (headers found: ${headers.join(", ")})`,
    });
    return { transactions, exceptions, outcome: { filename, documentTypeDetected: null, rowsRead: 0, rowsImported: 0, rowsSkipped: 0 } };
  }

  const filenameDocType = detectTypeFromFilename(filename);
  let docTypeColumn: number | null = null;
  for (const [index, field] of headerMapping) {
    if (field === "document_type") {
      docTypeColumn = index;
      break;
    }
  }

  const dataRows = rawRows.slice(headerIndex + 1);

  for (let offset = 0; offset < dataRows.length; offset++) {
    const rawRow = dataRows[offset];
    const rowNumber = headerIndex + 2 + offset;

    if (isBlankRow(rawRow)) continue;
    if (rowEqualsHeaders(rawRow, headers)) continue;

    rowsRead++;
    let supplier = "";
    let invoiceNumber = "";

    try {
      const values: Record<string, string> = {};
      for (const [index, field] of headerMapping) {
        values[field] = index < rawRow.length ? cleanText(rawRow[index]) : "";
      }

      supplier = values.supplier ?? "";
      invoiceNumber = values.invoice_number ?? "";
      if (!supplier) {
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Missing Supplier", description: "Missing supplier name", supplier, invoiceNumber });
        continue;
      }
      if (!invoiceNumber) {
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Missing Invoice Number", description: "Missing invoice/bill number", supplier, invoiceNumber });
        continue;
      }

      const invoiceDateRaw = values.invoice_date ?? "";
      const invoiceDate = parseDate(invoiceDateRaw);
      if (invoiceDate === null) {
        exceptions.push({
          sourceFilename: filename, rowNumber, exceptionType: "Invalid Date",
          description: `Invalid or missing invoice date: '${invoiceDateRaw}'`, supplier, invoiceNumber,
        });
        continue;
      }

      let subtotal = parseAmount(values.subtotal);
      let vat = parseAmount(values.vat);
      let total = parseAmount(values.total);

      if (total === null && subtotal !== null && vat !== null) total = subtotal + vat;
      if (subtotal === null && total !== null && vat !== null) subtotal = total - vat;
      if (vat === null && total !== null && subtotal !== null) vat = total - subtotal;

      if (total === null) {
        exceptions.push({
          sourceFilename: filename, rowNumber, exceptionType: "Invalid Amount",
          description: "Invalid or missing amount (Subtotal/VAT/Total all unusable)", supplier, invoiceNumber,
        });
        continue;
      }

      subtotal = subtotal !== null ? subtotal : total;
      vat = vat !== null ? vat : 0;

      let amountDue = parseAmount(values.amount_due);
      if (amountDue === null) amountDue = total;

      const dueDate = parseDate(values.due_date);

      const rowDocType = docTypeColumn !== null ? detectDocumentType(docTypeColumn < rawRow.length ? cleanText(rawRow[docTypeColumn]) : "") : null;
      const documentType = rowDocType ?? filenameDocType;

      const trackingParts: string[] = [];
      for (const idx of trackingIndexes) {
        if (idx < rawRow.length) {
          const cellValue = cleanText(rawRow[idx]);
          if (cellValue) trackingParts.push(`${headers[idx]}: ${cellValue}`);
        }
      }

      const roundedSubtotal = round2(subtotal);
      const roundedVat = round2(vat);
      const roundedTotal = round2(total);
      const roundedAmountDue = round2(amountDue);
      const vatReconciles = Math.abs(roundedSubtotal + roundedVat - roundedTotal) <= VAT_TOLERANCE;

      transactions.push({
        supplier,
        invoiceNumber,
        reference: values.reference ?? "",
        documentType,
        invoiceDate,
        dueDate,
        status: values.status ?? "",
        currency: values.currency || "GBP",
        subtotal: roundedSubtotal,
        vat: roundedVat,
        total: roundedTotal,
        amountDue: roundedAmountDue,
        trackingCategory: trackingParts.join("; "),
        sourceFilename: filename,
        importBatch,
        rowNumber,
        vatReconciles,
      });

      if (!vatReconciles) {
        exceptions.push({
          sourceFilename: filename, rowNumber, exceptionType: "VAT Mismatch",
          description: `Subtotal (${roundedSubtotal.toFixed(2)}) + VAT (${roundedVat.toFixed(2)}) != Total (${roundedTotal.toFixed(2)})`,
          supplier, invoiceNumber,
        });
      }
    } catch (exc) {
      exceptions.push({
        sourceFilename: filename, rowNumber, exceptionType: "Corrupt Row",
        description: `Corrupt row: ${exc instanceof Error ? exc.message : String(exc)}`, supplier, invoiceNumber,
      });
      continue;
    }
  }

  let detectedType: DocumentType | null = null;
  if (transactions.length > 0) detectedType = transactions[0].documentType;
  else if (docTypeColumn === null) detectedType = filenameDocType;

  const outcome = {
    filename,
    documentTypeDetected: detectedType,
    rowsRead,
    rowsImported: transactions.length,
    rowsSkipped: exceptions.filter((e) => e.exceptionType !== "VAT Mismatch").length,
  };

  return { transactions, exceptions, outcome };
}
