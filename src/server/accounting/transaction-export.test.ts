import { describe, expect, it } from "vitest";
import { buildTransactionsCsv, buildTransactionsWorkbook, transactionsToExportRows } from "./transaction-export";
import type { BankTransactionRecord } from "./types";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1,
    companyId: "co_1",
    transactionDate: "2026-07-01",
    reference: "REF-101",
    description: "Payment to ABC Supplies",
    beneficiary: "ABC Supplies",
    debit: 500,
    credit: 0,
    balance: 9500,
    bankAccount: "MAIN-001",
    bankAccountId: 1,
    glAccount: "",
    vat: 75,
    notes: "",
    importBatch: "BATCH-1",
    sourceFilename: "statement.csv",
    createdAt: "2026-07-01T00:00:00Z",
    allocationStatus: "Matched",
    matchedSupplierId: 1,
    matchedSupplierName: "ABC Supplies",
    matchedBillId: 1,
    confidenceScore: 98,
    rulesTriggered: ["Exact Supplier Name", "Exact Amount"],
    matchReason: "Matched on exact name + amount",
    requiredAction: null,
    suggestedGlAccount: "6000",
    suggestedVatCode: "Standard",
    allocationMethod: "Matched Bill",
    allocationReason: "",
    isManualOverride: false,
    reviewStatus: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    journalId: null,
    matchedCustomerId: null,
    matchedMerchantId: null,
    ruleId: null,
    entrySource: "Imported",
    captureStatus: null,
    cashbookBatchId: null,
    reconciliationId: null,
    reversalOfTransactionId: null,
    isSplit: false,
    ...overrides,
  };
}

describe("transactionsToExportRows", () => {
  it("prefers the matched supplier name over the raw beneficiary", () => {
    const rows = transactionsToExportRows([txn()]);
    expect(rows[0].supplier).toBe("ABC Supplies");
  });

  it("falls back to the raw beneficiary when there is no matched supplier", () => {
    const rows = transactionsToExportRows([txn({ matchedSupplierName: null, beneficiary: "Unknown EFT" })]);
    expect(rows[0].supplier).toBe("Unknown EFT");
  });

  it("joins multiple triggered rules with a semicolon", () => {
    const rows = transactionsToExportRows([txn()]);
    expect(rows[0].rulesApplied).toBe("Exact Supplier Name; Exact Amount");
  });

  it("renders a journal-linked transaction's journal number", () => {
    const rows = transactionsToExportRows([txn({ journalId: 42 })]);
    expect(rows[0].journalNumber).toBe("#42");
  });
});

describe("buildTransactionsCsv", () => {
  it("includes a header row, one row per transaction, and a TOTAL row", () => {
    const csv = buildTransactionsCsv([txn({ id: 1, debit: 500, credit: 0 }), txn({ id: 2, debit: 0, credit: 300 })]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("Date,Description");
    expect(lines).toHaveLength(4); // header + 2 rows + total
    expect(lines.at(-1)).toContain("TOTAL");
    expect(lines.at(-1)).toContain("500.00");
    expect(lines.at(-1)).toContain("300.00");
  });

  it("quotes and escapes fields containing commas or quotes", () => {
    const csv = buildTransactionsCsv([txn({ description: 'Payment, incl. "urgent" note' })]);
    expect(csv).toContain('"Payment, incl. ""urgent"" note"');
  });

  it("produces an empty-but-valid export (header + zero-value TOTAL) for no transactions", () => {
    const csv = buildTransactionsCsv([]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("TOTAL");
    expect(lines[1]).toContain("0.00");
  });
});

describe("buildTransactionsWorkbook", () => {
  it("produces a workbook with a bold frozen header, autofilter, and a bold TOTAL row", async () => {
    const workbook = await buildTransactionsWorkbook([txn({ id: 1, debit: 500 }), txn({ id: 2, debit: 0, credit: 300 })]);
    const sheet = workbook.getWorksheet("Transactions");
    expect(sheet).toBeDefined();
    if (!sheet) return;

    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBeDefined();

    // header + 2 data rows + total row
    expect(sheet.rowCount).toBe(4);
    const totalRow = sheet.getRow(4);
    expect(totalRow.font?.bold).toBe(true);
    expect(totalRow.getCell("description").value).toBe("TOTAL");
    expect(totalRow.getCell("debit").value).toBe(500);
    expect(totalRow.getCell("credit").value).toBe(300);
  });

  it("applies currency number formatting to debit/credit/balance cells", async () => {
    const workbook = await buildTransactionsWorkbook([txn({ debit: 500, balance: 9500 })]);
    const sheet = workbook.getWorksheet("Transactions");
    const dataRow = sheet?.getRow(2);
    expect(dataRow?.getCell("debit").numFmt).toBe("#,##0.00");
    expect(dataRow?.getCell("balance").numFmt).toBe("#,##0.00");
  });
});
