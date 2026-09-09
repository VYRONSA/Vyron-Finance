import { describe, expect, it } from "vitest";
import { extractFnbAccountHeader, extractFnbStatementMetadata, extractFnbTransactions, extractFnbTurnoverSummary } from "./fnb-bank-statement-parser";

// Real content from the Product Review Board's supplied sample statement
// (Northwood Management Investments, FNB Platinum Business Account
// 62050837304, 31 Jan – 28 Feb 2026) — not fabricated. See this parser's
// own module docstring for the known fidelity gap between this text and
// the actual PDF's real text layer (some descriptions, e.g. "#Monthly
// Credit Fee", are missing here) — the description-less rows below are
// a genuine reproduction of that gap, not an invented edge case.
const HEADER_TEXT = `Branch Number Account Number Date DDA BH/46/BV/Y8/Y8/BF/CZ/C6/PH/N FN
024 62050837304 2026/02/28 PLATINUM BUSINESS ACCOUNT
*NORTHWOOD MANAGEMENT INVESTMENTS (PTY)
LTD
P O BOX 815
MILNERTON
7435
Platinum Business Account : 62050837304
Statement Period : 31 January 2026 to 28 February 2026
Statement Date : 28 February 2026
Statement Balances
Opening Balance 1,229,915.14 Dr
Closing Balance 1,028,644.96 Dr`;

const TRANSACTION_TEXT = `02 Feb FNB OB Pmt FNB OB 000026004 Gap Gap Refund Cb 28 Jan 29,556.38 1,259,471.52
06 Feb Rtc Credit Loan From Ccb 161A2D3D53 10,000.00Cr 1,342,901.47
03 Feb 1,875.00 1,324,355.87
02 Feb Magtape Debit Advice Fee Db 247191018 60.00 1,273,923.44 12.00`;

const TURNOVER_TEXT = `Turnover for Statement Period
No. Credit Transactions 14 3,524,738.43Cr
No. Debit Transactions 198 3,323,468.25Dr`;

describe("extractFnbAccountHeader", () => {
  it("extracts branch number, account number, and statement date from the repeated header row", () => {
    expect(extractFnbAccountHeader(HEADER_TEXT)).toEqual({
      branchNumber: "024",
      accountNumber: "62050837304",
      statementDate: "2026-02-28",
    });
  });

  it("returns null when no header row is present", () => {
    expect(extractFnbAccountHeader("nothing relevant here")).toBeNull();
  });
});

describe("extractFnbStatementMetadata", () => {
  const metadata = extractFnbStatementMetadata(HEADER_TEXT);

  it("extracts the account holder across the wrapped name lines", () => {
    expect(metadata.accountHolder).toBe("NORTHWOOD MANAGEMENT INVESTMENTS (PTY) LTD");
  });

  it("extracts the account number from the header row", () => {
    expect(metadata.accountNumber).toBe("62050837304");
  });

  it("extracts the statement period as ISO dates", () => {
    expect(metadata.statementPeriodStart).toBe("2026-01-31");
    expect(metadata.statementPeriodEnd).toBe("2026-02-28");
  });

  it("extracts opening/closing balance as negative when the statement shows Dr (overdrawn)", () => {
    expect(metadata.openingBalance).toBe(-1229915.14);
    expect(metadata.closingBalance).toBe(-1028644.96);
  });

  it("reconciles against the statement's own real turnover totals (opening + credits - debits = closing)", () => {
    const turnover = extractFnbTurnoverSummary(TURNOVER_TEXT)!;
    const expectedClosing = metadata.openingBalance! + turnover.creditTotal - turnover.debitTotal;
    expect(Math.round(expectedClosing * 100) / 100).toBe(metadata.closingBalance);
  });
});

describe("extractFnbTurnoverSummary", () => {
  it("extracts credit/debit transaction counts and totals from the statement's own footer", () => {
    expect(extractFnbTurnoverSummary(TURNOVER_TEXT)).toEqual({
      creditTransactionCount: 14,
      creditTotal: 3524738.43,
      debitTransactionCount: 198,
      debitTotal: 3323468.25,
    });
  });

  it("returns null when the turnover summary isn't present", () => {
    expect(extractFnbTurnoverSummary("nothing relevant here")).toBeNull();
  });
});

describe("extractFnbTransactions", () => {
  const transactions = extractFnbTransactions(TRANSACTION_TEXT, "62050837304", "2026-01-31", "2026-02-28", "statement.pdf", "BATCH-1", -1);

  it("parses a debit row (no Cr suffix) with its description", () => {
    const row = transactions[0];
    expect(row.transactionDate).toBe("2026-02-02");
    expect(row.description).toContain("Gap Refund Cb 28 Jan");
    expect(row.debit).toBe(29556.38);
    expect(row.credit).toBe(0);
    expect(row.balance).toBe(-1259471.52);
  });

  it("parses a credit row (Cr suffix directly on the amount) correctly", () => {
    const row = transactions[1];
    expect(row.description).toContain("Rtc Credit Loan From Ccb");
    expect(row.debit).toBe(0);
    expect(row.credit).toBe(10000);
    expect(row.balance).toBe(-1342901.47);
  });

  it("tolerates a row with no description text at all (the real fidelity-gap case)", () => {
    const row = transactions[2];
    expect(row.description).toBe("");
    expect(row.debit).toBe(1875);
    expect(row.balance).toBe(-1324355.87);
  });

  it("parses a row with a trailing accrued-bank-charges value without including it in debit/credit", () => {
    const row = transactions[3];
    expect(row.debit).toBe(60);
    expect(row.balance).toBe(-1273923.44);
  });

  it("applies the account number to every row for bank-account resolution", () => {
    expect(transactions.every((t) => t.bankAccount === "62050837304")).toBe(true);
  });

  it("assigns sequential row numbers only to matched transaction rows", () => {
    expect(transactions.map((t) => t.rowNumber)).toEqual([1, 2, 3, 4]);
  });

  it("skips non-transaction lines (headers, footers, summaries) entirely", () => {
    const withNoise = `Date Description Amount Balance\n${TRANSACTION_TEXT}\nTurnover for Statement Period`;
    const parsed = extractFnbTransactions(withNoise, "62050837304", "2026-01-31", "2026-02-28", "statement.pdf", "BATCH-1", -1);
    expect(parsed).toHaveLength(4);
  });
});
