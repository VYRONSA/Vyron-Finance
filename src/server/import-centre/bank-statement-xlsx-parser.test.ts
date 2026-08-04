import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseBankStatementXlsx } from "./bank-statement-xlsx-parser";

const HEADERS = ["Date", "Reference", "Description", "Beneficiary", "Debit", "Credit", "Balance", "Bank Account", "VAT", "GL Account", "Notes"];

async function buildWorkbookBuffer(rows: (string | number)[][]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Statement");
  sheet.addRow(HEADERS);
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

describe("parseBankStatementXlsx", () => {
  it("parses a well-formed Standard Template workbook", async () => {
    const buffer = await buildWorkbookBuffer([
      ["2026-06-15", "INV-1", "Line rental", "Telkom SA", 450, 0, 10000, "Main Account", "", "", ""],
      ["2026-06-16", "", "Customer receipt", "Acme Customer", 0, 2500, 12500, "Main Account", "", "", ""],
    ]);
    const result = await parseBankStatementXlsx(buffer, "statement.xlsx", "BATCH-1");
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({ transactionDate: "2026-06-15", debit: 450, credit: 0, beneficiary: "Telkom SA" });
    expect(result.transactions[1]).toMatchObject({ transactionDate: "2026-06-16", debit: 0, credit: 2500, beneficiary: "Acme Customer" });
  });

  it("rejects a workbook whose headers don't match the template", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["Wrong", "Headers"]);
    const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
    const result = await parseBankStatementXlsx(buffer, "bad.xlsx", "BATCH-1");
    expect(result.transactions).toHaveLength(0);
    expect(result.exceptions[0].exceptionType).toBe("Invalid Template");
  });

  it("flags a row missing beneficiary", async () => {
    const buffer = await buildWorkbookBuffer([["2026-06-15", "INV-1", "Line rental", "", 450, 0, "", "", "", "", ""]]);
    const result = await parseBankStatementXlsx(buffer, "statement.xlsx", "BATCH-1");
    expect(result.exceptions[0].exceptionType).toBe("Missing Beneficiary");
  });

  it("flags a row with both debit and credit populated", async () => {
    const buffer = await buildWorkbookBuffer([["2026-06-15", "INV-1", "Line rental", "Telkom SA", 450, 100, "", "", "", "", ""]]);
    const result = await parseBankStatementXlsx(buffer, "statement.xlsx", "BATCH-1");
    expect(result.exceptions[0].exceptionType).toBe("Ambiguous Debit/Credit");
  });
});
