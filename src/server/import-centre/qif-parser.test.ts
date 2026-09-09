import { describe, expect, it } from "vitest";
import { parseQifStatement } from "./qif-parser";

const VALID_QIF = `!Type:Bank
D06/15/2026
T-450.00
PTelkom SA
MMonthly line rental
NINV-9921
^
D06/16/2026
T2500.00
PAcme Customer
^
`;

describe("parseQifStatement", () => {
  it("parses debit and credit records with correct sign convention", () => {
    const result = parseQifStatement(VALID_QIF, "statement.qif", "BATCH-1");
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({ transactionDate: "2026-06-15", debit: 450, credit: 0, beneficiary: "Telkom SA", reference: "INV-9921", description: "Monthly line rental" });
    expect(result.transactions[1]).toMatchObject({ transactionDate: "2026-06-16", debit: 0, credit: 2500, beneficiary: "Acme Customer" });
  });

  it("flags a file with no !Type: header as an exception", () => {
    const result = parseQifStatement("D06/15/2026\nT-100\n^\n", "bad.qif", "BATCH-1");
    expect(result.transactions).toHaveLength(0);
    expect(result.exceptions[0].exceptionType).toBe("Invalid Template");
  });

  it("flags a record with an invalid date", () => {
    const bad = "!Type:Bank\nT-100\nPTest\n^\n";
    const result = parseQifStatement(bad, "bad.qif", "BATCH-1");
    expect(result.exceptions[0].exceptionType).toBe("Invalid Date");
  });

  it("flags a record missing a payee", () => {
    const bad = "!Type:Bank\nD06/15/2026\nT-100\n^\n";
    const result = parseQifStatement(bad, "bad.qif", "BATCH-1");
    expect(result.exceptions[0].exceptionType).toBe("Missing Beneficiary");
  });

  it("falls back to the payee when memo is absent for description", () => {
    const result = parseQifStatement(VALID_QIF, "statement.qif", "BATCH-1");
    expect(result.transactions[1].description).toBe("Acme Customer");
  });
});
