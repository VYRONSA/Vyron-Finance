import { describe, expect, it } from "vitest";
import { parseBankStatementCsv, STANDARD_HEADERS } from "./bank-statement-parser";

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

  // Phase 32 — points the user at the template instead of leaving them to guess.
  it("the mismatch error points the user at the Bank Transactions Import Template", () => {
    const badCsv = "Description,Amount\nSomething,100\n";
    const { exceptions } = parseBankStatementCsv(badCsv, "not-standard.csv", "batch-1");
    expect(exceptions[0].description).toContain("Download the Bank Transactions Import Template");
  });

  // Phase 32A — a non-blank Balance/VAT that fails to parse must reject
  // the row as an "Invalid Amount" exception, never silently vanish as if
  // the column were empty (the old bug: `parseAmount` alone can't tell
  // "blank" and "garbage" apart, so garbage text was previously imported
  // with balance/vat simply dropped to null with no error shown).
  it("flags a non-numeric Balance as an Invalid Amount exception rather than silently dropping it", () => {
    const csv = [
      "Date,Reference,Description,Beneficiary,Debit,Credit,Balance,Bank Account,VAT,GL Account,Notes",
      "2026-03-10,REF-201,Payment,ABC Supplies,100.00,0,not-a-number,MAIN-001,,,",
    ].join("\n");
    const { transactions, exceptions } = parseBankStatementCsv(csv, "bad-balance.csv", "batch-1");
    expect(transactions).toHaveLength(0);
    expect(exceptions).toMatchObject([{ exceptionType: "Invalid Amount", rowNumber: 2, beneficiary: "ABC Supplies" }]);
    expect(exceptions[0].description).toContain("Invalid Balance value");
  });

  it("flags a non-numeric VAT as an Invalid Amount exception rather than silently dropping it", () => {
    const csv = [
      "Date,Reference,Description,Beneficiary,Debit,Credit,Balance,Bank Account,VAT,GL Account,Notes",
      "2026-03-11,REF-202,Payment,ABC Supplies,100.00,0,9000.00,MAIN-001,garbage,,",
    ].join("\n");
    const { transactions, exceptions } = parseBankStatementCsv(csv, "bad-vat.csv", "batch-1");
    expect(transactions).toHaveLength(0);
    expect(exceptions).toMatchObject([{ exceptionType: "Invalid Amount", rowNumber: 2, beneficiary: "ABC Supplies" }]);
    expect(exceptions[0].description).toContain("Invalid VAT value");
  });

  it("still treats a genuinely blank Balance/VAT as null, not an error", () => {
    const csv = [
      "Date,Reference,Description,Beneficiary,Debit,Credit,Balance,Bank Account,VAT,GL Account,Notes",
      "2026-03-12,REF-203,Payment,ABC Supplies,100.00,0,,MAIN-001,,,",
    ].join("\n");
    const { transactions, exceptions } = parseBankStatementCsv(csv, "blank-optional.csv", "batch-1");
    expect(exceptions).toEqual([]);
    expect(transactions[0]).toMatchObject({ balance: null, vat: null });
  });
});

// Phase 32 — `STANDARD_HEADERS` is the SAME array both the "Download
// Template" button and the header-match check read — this locks in
// that a file built from exactly these headers, in this exact order,
// is genuinely accepted (never a hand-copied, driftable duplicate).
describe("STANDARD_HEADERS (Phase 32)", () => {
  it("a file using exactly STANDARD_HEADERS, in order, is accepted (no Invalid Template exception)", () => {
    const csv = [STANDARD_HEADERS.join(","), "2026-03-01,REF-1,Payment,ABC Supplies,100.00,0,,,,,"].join("\n");
    const { exceptions, transactions } = parseBankStatementCsv(csv, "template.csv", "batch-1");
    expect(exceptions.find((e) => e.exceptionType === "Invalid Template")).toBeUndefined();
    expect(transactions).toHaveLength(1);
  });
});
