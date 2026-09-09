import { describe, expect, it } from "vitest";
import { parseXeroInvoiceLinesCsv } from "./xero-invoices-bills-parser";

const HEADER =
  "ContactName,EmailAddress,POAddressLine1,POAddressLine2,POAddressLine3,POAddressLine4,POCity,PORegion,POPostalCode,POCountry,SAAddressLine1,SAAddressLine2,SAAddressLine3,SAAddressLine4,SACity,SARegion,SAPostalCode,SACountry,InvoiceNumber,Reference,InvoiceDate,DueDate,PlannedDate,Total,TaxTotal,InvoiceAmountPaid,InvoiceAmountDue,InventoryItemCode,Description,Quantity,UnitAmount,Discount,LineAmount,AccountCode,TaxType,TaxAmount,TrackingName1,TrackingOption1,TrackingName2,TrackingOption2,Currency,Type,Sent,Status";

function line(fields: Partial<Record<string, string>>): string {
  const defaults: Record<string, string> = {
    ContactName: "AL Lifestyle (Pty) Ltd T/A Jellyfish", EmailAddress: "", POAddressLine1: "", POAddressLine2: "", POAddressLine3: "", POAddressLine4: "",
    POCity: "", PORegion: "", POPostalCode: "", POCountry: "", SAAddressLine1: "", SAAddressLine2: "", SAAddressLine3: "", SAAddressLine4: "",
    SACity: "", SARegion: "", SAPostalCode: "", SACountry: "", InvoiceNumber: "INV-3440", Reference: "jellyfish", InvoiceDate: "11/06/2026",
    DueDate: "11/06/2026", PlannedDate: "", Total: "1580.94", TaxTotal: "206.22", InvoiceAmountPaid: "0.00", InvoiceAmountDue: "1580.94",
    InventoryItemCode: "166", Description: "KAROO LAMB 280GR(1 box)", Quantity: "16", UnitAmount: "28.64", Discount: "", LineAmount: "458.24",
    AccountCode: "1000", TaxType: "Standard Rate Sales", TaxAmount: "68.74", TrackingName1: "", TrackingOption1: "", TrackingName2: "", TrackingOption2: "",
    Currency: "ZAR", Type: "Sales invoice", Sent: "Unsent", Status: "Awaiting Payment",
    ...fields,
  };
  return HEADER.split(",").map((h) => defaults[h] ?? "").join(",");
}

describe("parseXeroInvoiceLinesCsv", () => {
  it("groups multiple line rows sharing the same InvoiceNumber into ONE invoice with N lines", () => {
    const csv = [
      HEADER,
      line({ Description: "KAROO LAMB 280GR(1 box)", LineAmount: "458.24" }),
      line({ Description: "ECHT CONFIT CHICKEN (1 box)", LineAmount: "458.24", InventoryItemCode: "169" }),
    ].join("\n");
    const { invoices, skipped } = parseXeroInvoiceLinesCsv(csv, "SalesInvoices.csv");
    expect(skipped).toHaveLength(0);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].invoiceNumber).toBe("INV-3440");
    expect(invoices[0].lines).toHaveLength(2);
    expect(invoices[0].lines.map((l) => l.description)).toEqual(["KAROO LAMB 280GR(1 box)", "ECHT CONFIT CHICKEN (1 box)"]);
  });

  it("preserves header fields (Total/TaxTotal/AmountDue/Reference/dates/Currency/Status) exactly, not recomputed", () => {
    const csv = [HEADER, line({ Total: "1580.94", TaxTotal: "206.22", InvoiceAmountDue: "1580.94", Reference: "jellyfish", Status: "Awaiting Payment" })].join("\n");
    const { invoices } = parseXeroInvoiceLinesCsv(csv, "SalesInvoices.csv");
    expect(invoices[0]).toMatchObject({ total: 1580.94, taxTotal: 206.22, amountDue: 1580.94, reference: "jellyfish", xeroStatus: "Awaiting Payment", invoiceDate: "2026-06-11", dueDate: "2026-06-11" });
  });

  it("preserves every line-level field: quantity, unit price, discount, account code, tax type, tax amount, line amount", () => {
    const csv = [HEADER, line({ Quantity: "16", UnitAmount: "28.64", Discount: "5", AccountCode: "1000", TaxType: "Standard Rate Sales", TaxAmount: "68.74", LineAmount: "458.24" })].join("\n");
    const { invoices } = parseXeroInvoiceLinesCsv(csv, "SalesInvoices.csv");
    expect(invoices[0].lines[0]).toMatchObject({ quantity: 16, unitAmount: 28.64, discount: 5, accountCode: "1000", taxType: "Standard Rate Sales", taxAmount: 68.74, lineAmount: 458.24 });
  });

  it("excludes 'Sales overpayment'/'Bill overpayment' rows (payment events, not documents with lines) and reports why", () => {
    const csv = [HEADER, line({ Type: "Sales overpayment", InvoiceNumber: "", AccountCode: "610" })].join("\n");
    const { invoices, skipped } = parseXeroInvoiceLinesCsv(csv, "SalesInvoices.csv");
    expect(invoices).toHaveLength(0);
    expect(skipped[0].reason).toContain("payment-application event");
  });

  it("imports a 'Sales credit note' as its own document, distinct from the invoice it doesn't share an InvoiceNumber with", () => {
    const csv = [HEADER, line({ Type: "Sales credit note", InvoiceNumber: "CN-0091" })].join("\n");
    const { invoices } = parseXeroInvoiceLinesCsv(csv, "SalesInvoices.csv");
    expect(invoices).toHaveLength(1);
    expect(invoices[0].xeroType).toBe("Sales credit note");
  });

  it("skips a row with an invalid/missing date and reports why, without dropping the rest of the file", () => {
    const csv = [HEADER, line({ InvoiceDate: "not-a-date" }), line({ InvoiceNumber: "INV-9999", InvoiceDate: "01/07/2026" })].join("\n");
    const { invoices, skipped } = parseXeroInvoiceLinesCsv(csv, "SalesInvoices.csv");
    expect(invoices).toHaveLength(1);
    expect(invoices[0].invoiceNumber).toBe("INV-9999");
    expect(skipped.some((s) => s.reason.includes("Invalid or missing InvoiceDate"))).toBe(true);
  });

  it("does not choke on Bills.csv's identical column layout with a different Type vocabulary", () => {
    const csv = [HEADER, line({ ContactName: "NICHECO", InvoiceNumber: "016083", Type: "Bill", AccountCode: "1825", TaxType: "Standard Rate Purchases", Description: "pest control service" })].join("\n");
    const { invoices } = parseXeroInvoiceLinesCsv(csv, "Bills.csv");
    expect(invoices[0]).toMatchObject({ contactName: "NICHECO", invoiceNumber: "016083", xeroType: "Bill" });
    expect(invoices[0].lines[0]).toMatchObject({ accountCode: "1825", taxType: "Standard Rate Purchases", description: "pest control service" });
  });
});
