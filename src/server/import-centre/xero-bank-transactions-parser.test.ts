import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseXeroBankTransactionsXlsx } from "./xero-bank-transactions-parser";

/** Builds a real .xlsx in memory, matching the exact shape of Xero's
 * "Account Transactions by date" report (confirmed against the real
 * client file): title/company/period rows, then per account a " - Name"
 * section header, Opening Balance, transaction rows, a "Total ..."
 * subtotal, a Closing Balance, and a blank separator before the next
 * section. */
async function buildWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Account Transactions");
  sheet.addRow(["Account Transactions"]);
  sheet.addRow(["Metanoia Hospitality (Pty) Ltd"]);
  sheet.addRow(["For the period 1 March 2026 to 30 September 2026"]);
  sheet.addRow([]);
  sheet.addRow(["Date", "Contact", "Source", "Reference", "Debit", "Credit", "Running Balance", "Gross", "Tax", "Related Account"]);
  sheet.addRow([]);

  sheet.addRow([" - HANDCRAFTED FOOD PRODUCTS"]);
  sheet.addRow(["Opening Balance", null, null, null, 0, 0, 0, 0, 0, null]);
  sheet.addRow([new Date("2026-03-06"), "Dulcenbosch (Pty) Ltd", "Receivable Payment", "INV-3051", 3202.6, 0, 3202.6, 3202.6, 0, "610 - Accounts Receivable"]);
  sheet.addRow([new Date("2026-03-19"), "Capitec Bank", "Spend Money", null, 0, 50, 3152.6, -50, 0, "3030 - Bank Charges, 820 - VAT"]);
  sheet.addRow(["Total  - HANDCRAFTED FOOD PRODUCTS", null, null, null, 3202.6, 50, 3152.6, 3152.6, 0, null]);
  sheet.addRow(["Closing Balance", null, null, null, 3152.6, 0, 3152.6, 0, 0, null]);
  sheet.addRow([]);

  sheet.addRow([" - Metanoia Hospitality"]);
  sheet.addRow(["Opening Balance", null, null, null, 0, 0, 0, 0, 0, null]);
  sheet.addRow([new Date("2026-06-13"), "Three Streams", "Payable Payment", null, 0, 55973.28, -55973.28, -55973.28, 0, "800 - Accounts Payable"]);
  sheet.addRow(["Total  - Metanoia Hospitality", null, null, null, 0, 55973.28, -55973.28, -55973.28, 0, null]);
  sheet.addRow(["Closing Balance", null, null, null, 0, 55973.28, -55973.28, 0, 0, null]);
  sheet.addRow([]);
  sheet.addRow(["Total", null, null, null, 3202.6, 56023.28, null, null, null, null]);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("parseXeroBankTransactionsXlsx", () => {
  it("splits the sheet into one section PER real bank account, not one flat transaction list", async () => {
    const buffer = await buildWorkbook();
    const { accounts, skipped } = await parseXeroBankTransactionsXlsx(buffer, "bank.xlsx");
    expect(skipped).toHaveLength(0);
    expect(accounts).toHaveLength(2);
    expect(accounts[0].accountName).toBe("HANDCRAFTED FOOD PRODUCTS");
    expect(accounts[1].accountName).toBe("Metanoia Hospitality");
  });

  it("captures every transaction field for each row, reading Xero's Debit column as money IN and its Credit column as money OUT", async () => {
    const buffer = await buildWorkbook();
    const { accounts } = await parseXeroBankTransactionsXlsx(buffer, "bank.xlsx");
    expect(accounts[0].transactions).toHaveLength(2);
    // A "Receivable Payment" is a customer paying: money ARRIVES in the
    // bank. Xero reports that in its Debit column (the bank is an asset,
    // so an inflow debits it) — the opposite of VYRON's cashbook `debit`,
    // which means a payment out.
    expect(accounts[0].transactions[0]).toMatchObject({
      date: "2026-03-06", contact: "Dulcenbosch (Pty) Ltd", source: "Receivable Payment", reference: "INV-3051",
      moneyIn: 3202.6, moneyOut: 0, relatedAccount: "610 - Accounts Receivable",
    });
  });

  it("does not treat 'Opening Balance'/'Closing Balance'/'Total ...' subtotal rows as transactions", async () => {
    const buffer = await buildWorkbook();
    const { accounts } = await parseXeroBankTransactionsXlsx(buffer, "bank.xlsx");
    const allDescriptions = accounts.flatMap((a) => a.transactions.map((t) => t.source));
    expect(allDescriptions).not.toContain(undefined);
    expect(accounts[0].transactions.every((t) => t.source !== "")).toBe(true);
    expect(accounts.reduce((sum, a) => sum + a.transactions.length, 0)).toBe(3); // 2 in section 1, 1 in section 2
  });

  it("second account's transactions are correctly attributed to the second section, not merged with the first", async () => {
    const buffer = await buildWorkbook();
    const { accounts } = await parseXeroBankTransactionsXlsx(buffer, "bank.xlsx");
    expect(accounts[1].transactions).toHaveLength(1);
    // A "Payable Payment" is paying a supplier: money LEAVES the bank,
    // which Xero reports in its Credit column.
    expect(accounts[1].transactions[0]).toMatchObject({ contact: "Three Streams", source: "Payable Payment", moneyOut: 55973.28, moneyIn: 0, relatedAccount: "800 - Accounts Payable" });
  });
});
