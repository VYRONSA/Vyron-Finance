import { describe, expect, it } from "vitest";
import {
  extractFnbCreditCardMetadata,
  extractFnbCreditCardTransactions,
  extractFnbCreditCardTurnoverSummary,
} from "./fnb-credit-card-statement-parser";

// Real content extracted (via this app's own `extractPdfText`) from the
// Product Review Board's supplied real FNB Business Credit Card sample —
// Northwood Management Investments, control account 8812 7100 1280
// 6001, statement 254, 09 April 2025 — not fabricated, tabs included
// (this statement's real text layer joins table columns with a literal
// tab, unlike the sibling Platinum statement).
const HEADER_TEXT = `NORTHWOOD MANAGEMENT INVESTMENTS (PTY)
P O BOX 815
MILNERTON
7435 Statement Date
Statement Number
Payment Due Date
Account Number
Amount Owing 	35 479.56 	Balance 	0.00
Purchases 	17.95%
Cash 	17.95%
Petrol 	17.95%
Credit Limit 	59 000.00 	Budget Limit 	0.00
Credit Balance 	336.48Cr Available Budget 	0.00
Balance Brought Forward 	35 413.88 	Balance Brought Forward 	0.00
Vat on Fees 	60.32
09 April 2025
254
Page 1 of 6
14 April 2025
Business Card Account 8812 7100 1280 6001`;

const CLOSING_TEXT = `Closing Balance 	35 479.56 	0.00`;

const TRANSACTION_TEXT = `Sue-ann Damons
Balance Brought Forward 	0.00 	0.00
31 Mar Checkers Noordheuwel 	Noorheuwel 	1 426.54
09 Apr Balance Transferred 	4 081.60 Cr
26 Mar 1bb FNB Ob Trf Bus Cred 	C26mvodsytkgp 7DN 	2 000.00 Cr
09 Apr #Declined Auth Fee 	18.00
09 Apr Adele M Van Pletzen 	4 081.60`;

describe("extractFnbCreditCardMetadata", () => {
  const metadata = extractFnbCreditCardMetadata(HEADER_TEXT + "\n" + CLOSING_TEXT);

  it("extracts the account holder from the first line", () => {
    expect(metadata.accountHolder).toBe("NORTHWOOD MANAGEMENT INVESTMENTS (PTY)");
  });

  it("extracts the control account number from the self-labelled anchor", () => {
    expect(metadata.accountNumber).toBe("8812710012806001");
  });

  it("extracts statement number, statement date, and payment due date from the positionally-separate value block", () => {
    expect(metadata.statementNumber).toBe("254");
    expect(metadata.statementDate).toBe("2025-04-09");
    expect(metadata.paymentDueDate).toBe("2025-04-14");
  });

  it("extracts opening/closing balance as positive figures (no Dr/Cr marker on this statement type)", () => {
    expect(metadata.openingBalance).toBe(35413.88);
    expect(metadata.closingBalance).toBe(35479.56);
  });

  it("extracts credit limit, available balance (mapped from Credit Balance), and VAT with space-grouped thousands handled correctly", () => {
    expect(metadata.creditLimit).toBe(59000);
    expect(metadata.availableBalance).toBe(336.48);
    expect(metadata.vat).toBe(60.32);
  });

  it("summarises the per-rate interest information", () => {
    expect(metadata.interestSummary).toBe("Purchases: 17.95%; Cash: 17.95%; Petrol: 17.95%");
  });

  it("never prints a statement period on this statement type, so leaves it null rather than guessing", () => {
    expect(metadata.statementPeriodStart).toBeNull();
    expect(metadata.statementPeriodEnd).toBeNull();
  });
});

describe("extractFnbCreditCardTurnoverSummary", () => {
  it("returns null — this statement type prints no turnover footer, confirmed against the real PDF", () => {
    expect(extractFnbCreditCardTurnoverSummary(HEADER_TEXT)).toBeNull();
  });
});

describe("extractFnbCreditCardTransactions", () => {
  const transactions = extractFnbCreditCardTransactions(HEADER_TEXT + "\n" + TRANSACTION_TEXT, "8812710012806001", "statement.pdf", "BATCH-1");

  it("parses a space-grouped-thousands debit amount without truncating the description", () => {
    const row = transactions.find((t) => t.description.startsWith("Checkers"));
    expect(row).toBeDefined();
    expect(row!.description).toBe("Checkers Noordheuwel - Noorheuwel");
    expect(row!.debit).toBe(1426.54);
    expect(row!.credit).toBe(0);
  });

  it("has no per-row running balance — never printed on this statement type, never fabricated", () => {
    expect(transactions.every((t) => t.balance === null)).toBe(true);
  });

  it("excludes a 'Balance Transferred' row as an internal consolidation entry, not a real transaction", () => {
    expect(transactions.some((t) => t.description === "Balance Transferred")).toBe(false);
  });

  it("excludes the later name-labelled re-statement of the same transferred amount (real duplicate found in the actual statement)", () => {
    expect(transactions.some((t) => t.description === "Adele M Van Pletzen")).toBe(false);
  });

  it("parses a credit row (Cr-suffixed) with its reference text folded into the description", () => {
    const row = transactions.find((t) => t.description.includes("1bb FNB Ob Trf Bus Cred"));
    expect(row).toBeDefined();
    expect(row!.credit).toBe(2000);
    expect(row!.debit).toBe(0);
  });

  it("parses a fee row with only one field before the amount (no location)", () => {
    const row = transactions.find((t) => t.description === "#Declined Auth Fee");
    expect(row).toBeDefined();
    expect(row!.debit).toBe(18);
  });

  it("applies the control account number to every row", () => {
    expect(transactions.every((t) => t.bankAccount === "8812710012806001")).toBe(true);
  });
});
