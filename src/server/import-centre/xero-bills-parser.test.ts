import { describe, expect, it } from "vitest";
import { parseBillsCsv } from "./xero-bills-parser";

// Same fixture as the reference implementation's
// import_centre/sample_data/Bills_Supplier_Export.csv — kept byte-for-byte
// identical so the expected-outcome numbers below double as a fidelity
// check against the ported Python parser.
const BILLS_FIXTURE = `ContactName,InvoiceNumber,Reference,Type,InvoiceDate,DueDate,Status,Currency,SubTotal,TotalTax,Total,AmountDue,TrackingName1,TrackingOption1
ABC Ltd,BILL-1001,PO-501,ACCPAY,2026-01-05,2026-02-04,AUTHORISED,GBP,1000.00,200.00,1200.00,1200.00,Region,North
XYZ Supplies,BILL-1002,PO-502,ACCPAY,2026-01-06,2026-02-05,PAID,GBP,500.00,100.00,600.00,0.00,Region,South
ABC Ltd,BILL-1003,PO-503,ACCPAY,2026-01-05,2026-02-04,AUTHORISED,GBP,250.00,50.00,300.00,300.00,Region,North
,,,,,,,,,,,,,
ContactName,InvoiceNumber,Reference,Type,InvoiceDate,DueDate,Status,Currency,SubTotal,TotalTax,Total,AmountDue,TrackingName1,TrackingOption1
,BILL-1004,PO-504,ACCPAY,2026-01-07,2026-02-06,AUTHORISED,GBP,100.00,20.00,120.00,120.00,Region,North
Global Traders,BILL-1005,PO-505,ACCPAY,not-a-date,2026-02-07,AUTHORISED,GBP,300.00,60.00,360.00,360.00,Region,East
Prime Vendors,BILL-1006,PO-506,ACCPAY,2026-01-09,2026-02-08,AUTHORISED,GBP,not-a-number,40.00,not-a-number,240.00,Region,West
ABC Ltd,BILL-1007,PO-507,ACCPAY,2026-01-10,2026-02-09,AUTHORISED,GBP,100.00,,100.00,100.00,Region,North
Prime Vendors,BILL-1008,PO-508,ACCPAY,2026-01-11,2026-02-10,AUTHORISED,GBP,100.00,20.00,125.00,125.00,Region,West
`;

describe("parseBillsCsv", () => {
  it("matches the reference fixture's row-level outcome", () => {
    const { transactions, outcome } = parseBillsCsv(BILLS_FIXTURE, "Bills_Supplier_Export.csv", "batch-1");

    expect(outcome).toEqual({
      filename: "Bills_Supplier_Export.csv",
      documentTypeDetected: "Bill",
      rowsRead: 8,
      rowsImported: 5,
      rowsSkipped: 3,
    });
    expect(transactions).toHaveLength(5);
    expect(transactions.map((t) => t.invoiceNumber)).toEqual([
      "BILL-1001", "BILL-1002", "BILL-1003", "BILL-1007", "BILL-1008",
    ]);
  });

  it("silently skips blank rows and repeated header rows (no exception raised for either)", () => {
    const { exceptions } = parseBillsCsv(BILLS_FIXTURE, "Bills_Supplier_Export.csv", "batch-1");
    // 4 real exceptions in the fixture: Missing Supplier, Invalid Date,
    // Invalid Amount, VAT Mismatch — the blank row and duplicate header
    // row contribute none of them.
    expect(exceptions).toHaveLength(4);
  });

  it("flags a missing supplier without aborting the file", () => {
    const { exceptions } = parseBillsCsv(BILLS_FIXTURE, "Bills_Supplier_Export.csv", "batch-1");
    const missingSupplier = exceptions.find((e) => e.exceptionType === "Missing Supplier");
    expect(missingSupplier).toMatchObject({ rowNumber: 7, invoiceNumber: "BILL-1004" });
  });

  it("flags an invalid date without aborting the file", () => {
    const { exceptions } = parseBillsCsv(BILLS_FIXTURE, "Bills_Supplier_Export.csv", "batch-1");
    const invalidDate = exceptions.find((e) => e.exceptionType === "Invalid Date");
    expect(invalidDate).toMatchObject({ rowNumber: 8, supplier: "Global Traders" });
  });

  it("flags an unusable amount when Subtotal/VAT/Total can't be derived", () => {
    const { exceptions } = parseBillsCsv(BILLS_FIXTURE, "Bills_Supplier_Export.csv", "batch-1");
    const invalidAmount = exceptions.find((e) => e.exceptionType === "Invalid Amount");
    expect(invalidAmount).toMatchObject({ rowNumber: 9, invoiceNumber: "BILL-1006" });
  });

  it("derives a missing VAT from Subtotal and Total, reconciling cleanly", () => {
    const { transactions } = parseBillsCsv(BILLS_FIXTURE, "Bills_Supplier_Export.csv", "batch-1");
    const row = transactions.find((t) => t.invoiceNumber === "BILL-1007");
    expect(row).toMatchObject({ subtotal: 100, vat: 0, total: 100, vatReconciles: true });
  });

  it("flags — but still imports — a row where Subtotal + VAT != Total", () => {
    const { transactions, exceptions } = parseBillsCsv(BILLS_FIXTURE, "Bills_Supplier_Export.csv", "batch-1");
    const row = transactions.find((t) => t.invoiceNumber === "BILL-1008");
    expect(row).toMatchObject({ subtotal: 100, vat: 20, total: 125, vatReconciles: false });
    expect(exceptions.find((e) => e.exceptionType === "VAT Mismatch")).toMatchObject({ invoiceNumber: "BILL-1008" });
  });

  it("rejects the whole file when supplier/invoice-number columns can't be found", () => {
    const badCsv = "Description,Amount\nSomething,100\n";
    const { transactions, exceptions, outcome } = parseBillsCsv(badCsv, "bad.csv", "batch-1");
    expect(transactions).toHaveLength(0);
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0].exceptionType).toBe("Missing Required Column");
    expect(outcome.rowsRead).toBe(0);
  });

  it("recognises alternate Xero column names via alias matching", () => {
    const csv = "Vendor Name,Bill No,Bill Date,Net Total,VAT Amount,Gross Total\nAcme Co,B-99,2026-02-01,100.00,20.00,120.00\n";
    const { transactions } = parseBillsCsv(csv, "aged-payables.csv", "batch-1");
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ supplier: "Acme Co", invoiceNumber: "B-99", subtotal: 100, vat: 20, total: 120 });
  });

  it("detects Credit Note document type from the filename when no Type column exists", () => {
    const csv = "Vendor Name,Bill No,Bill Date,Net Total,VAT Amount,Gross Total\nAcme Co,CN-1,2026-02-01,100.00,20.00,120.00\n";
    const { transactions, outcome } = parseBillsCsv(csv, "CreditNotes_Export.csv", "batch-1");
    expect(transactions[0].documentType).toBe("Credit Note");
    expect(outcome.documentTypeDetected).toBe("Credit Note");
  });
});
