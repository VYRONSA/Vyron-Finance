import { describe, expect, it } from "vitest";
import { parseOfxStatement } from "./ofx-parser";

const VALID_OFX = `
OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKACCTFROM>
<ACCTID>1234567890
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260615120000[+2:GMT]
<TRNAMT>-450.00
<FITID>202606150001
<NAME>Telkom SA
<MEMO>Monthly line rental
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260616
<TRNAMT>2500.00
<FITID>202606160001
<NAME>Acme Customer
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

describe("parseOfxStatement", () => {
  it("parses debit and credit transactions with correct sign convention", () => {
    const result = parseOfxStatement(VALID_OFX, "statement.ofx", "BATCH-1");
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({ transactionDate: "2026-06-15", debit: 450, credit: 0, beneficiary: "Telkom SA", reference: "202606150001", bankAccount: "1234567890" });
    expect(result.transactions[1]).toMatchObject({ transactionDate: "2026-06-16", debit: 0, credit: 2500, beneficiary: "Acme Customer" });
  });

  it("flags a file with no STMTTRN blocks as an exception", () => {
    const result = parseOfxStatement("not an ofx file", "bad.ofx", "BATCH-1");
    expect(result.transactions).toHaveLength(0);
    expect(result.exceptions[0].exceptionType).toBe("Invalid Template");
  });

  it("flags a transaction with an invalid date", () => {
    const bad = `<STMTTRN>\n<TRNAMT>-100\n<NAME>Test\n</STMTTRN>`;
    const result = parseOfxStatement(bad, "bad.ofx", "BATCH-1");
    expect(result.transactions).toHaveLength(0);
    expect(result.exceptions[0].exceptionType).toBe("Invalid Date");
  });

  it("flags a transaction missing a beneficiary", () => {
    const bad = `<STMTTRN>\n<DTPOSTED>20260101\n<TRNAMT>-100\n</STMTTRN>`;
    const result = parseOfxStatement(bad, "bad.ofx", "BATCH-1");
    expect(result.exceptions[0].exceptionType).toBe("Missing Beneficiary");
  });
});
