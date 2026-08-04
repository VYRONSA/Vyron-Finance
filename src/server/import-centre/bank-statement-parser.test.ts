import { describe, expect, it } from "vitest";
import { parseBankStatementCsv } from "./bank-statement-parser";

// Same fixture as the reference implementation's
// bank_import/sample_data/BankImport_Standard_Batch1.csv.
const BANK_FIXTURE = `Date,Reference,Description,Beneficiary,Debit,Credit,Balance,Bank Account,VAT,GL Account,Notes
2026-03-01,REF-101,Payment to ABC Supplies,ABC Supplies,500.00,0,9500.00,MAIN-001,75.00,5000,Invoice 1001
2026-03-02,REF-102,Receipt from Customer X,Customer X,0,1200.00,10700.00,MAIN-001,,,
2026-03-03,REF-103,Payment to ABC Supplies,ABC Supplies,300.00,0,10400.00,MAIN-001,45.00,5000,
,,,,,,,,,,
Date,Reference,Description,Beneficiary,Debit,Credit,Balance,Bank Account,VAT,GL Account,Notes
2026-03-05,REF-105,Payment to XYZ Traders,,250.00,0,10150.00,MAIN-001,,,
not-a-date,REF-106,Payment to Delta Ltd,Delta Ltd,400.00,0,9750.00,MAIN-001,,,
2026-03-07,REF-107,Confusing Row,Delta Ltd,100.00,50.00,9800.00,MAIN-001,,,
2026-03-08,REF-108,Empty Movement,Delta Ltd,0,0,9800.00,MAIN-001,,,
2026-03-09,REF-109,Payment to ABC Supplies,ABC Supplies,150.00,0,9650.00,MAIN-001,,,
`;

describe("parseBankStatementCsv", () => {
  it("matches the reference fixture's row-level outcome", () => {
    const { transactions, outcome } = parseBankStatementCsv(BANK_FIXTURE, "BankImport_Standard_Batch1.csv", "batch-1");

    expect(outcome).toEqual({
      filename: "BankImport_Standard_Batch1.csv",
      rowsRead: 8,
      rowsImported: 4,
      rowsSkipped: 4,
    });
    expect(transactions.map((t) => t.reference)).toEqual(["REF-101", "REF-102", "REF-103", "REF-109"]);
  });

  it("passes VAT through as supplied without calculating it", () => {
    const { transactions } = parseBankStatementCsv(BANK_FIXTURE, "BankImport_Standard_Batch1.csv", "batch-1");
    const row = transactions.find((t) => t.reference === "REF-101");
    expect(row).toMatchObject({ debit: 500, credit: 0, vat: 75, glAccount: "5000", notes: "Invoice 1001" });

    const noVatRow = transactions.find((t) => t.reference === "REF-102");
    expect(noVatRow?.vat).toBeNull();
  });

  it("flags a missing beneficiary without aborting the file", () => {
    const { exceptions } = parseBankStatementCsv(BANK_FIXTURE, "BankImport_Standard_Batch1.csv", "batch-1");
    expect(exceptions.find((e) => e.exceptionType === "Missing Beneficiary")).toMatchObject({ rowNumber: 7 });
  });

  it("flags an invalid transaction date without aborting the file", () => {
    const { exceptions } = parseBankStatementCsv(BANK_FIXTURE, "BankImport_Standard_Batch1.csv", "batch-1");
    expect(exceptions.find((e) => e.exceptionType === "Invalid Date")).toMatchObject({ rowNumber: 8 });
  });

  it("flags a row with both Debit and Credit populated as ambiguous", () => {
    const { exceptions } = parseBankStatementCsv(BANK_FIXTURE, "BankImport_Standard_Batch1.csv", "batch-1");
    expect(exceptions.find((e) => e.exceptionType === "Ambiguous Debit/Credit")).toMatchObject({ rowNumber: 9, beneficiary: "Delta Ltd" });
  });

  it("flags a row with neither Debit nor Credit populated", () => {
    const { exceptions } = parseBankStatementCsv(BANK_FIXTURE, "BankImport_Standard_Batch1.csv", "batch-1");
    expect(exceptions.find((e) => e.exceptionType === "Missing Debit/Credit Amount")).toMatchObject({ rowNumber: 10 });
  });

  it("rejects the whole file when the header doesn't match the Standard Template exactly", () => {
    const badCsv = "Date,Description,Amount\n2026-01-01,Something,100\n";
    const { transactions, exceptions, outcome } = parseBankStatementCsv(badCsv, "not-standard.csv", "batch-1");
    expect(transactions).toHaveLength(0);
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0].exceptionType).toBe("Invalid Template");
    expect(outcome.rowsRead).toBe(0);
  });
});
