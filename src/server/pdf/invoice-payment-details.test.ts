/**
 * Phase 5I — what appears in an invoice's payment block.
 *
 * The rule under test is restraint: nothing is printed unless the company
 * explicitly configured it. A company that ticks no bank account and
 * writes no footer gets exactly the document it gets today.
 */
import { describe, expect, it } from "vitest";
import { invoicePaymentDetails } from "./pdf-documents";

const account = (overrides: Partial<Parameters<typeof invoicePaymentDetails>[1][number]> = {}) => ({
  showOnDocuments: false,
  bankName: "First National Bank",
  accountName: "Acme Ltd",
  accountNumber: "62050837304",
  branch: "250655",
  ...overrides,
});

describe("invoicePaymentDetails", () => {
  it("prints nothing when nothing is configured", () => {
    expect(invoicePaymentDetails({ paymentInstructions: "", invoiceFooter: "" }, [account()])).toBeUndefined();
    expect(invoicePaymentDetails(null, [])).toBeUndefined();
  });

  it("does NOT print a bank account merely because one exists", () => {
    // The whole point of the opt-in: a company's accounts are not
    // customer-facing by default.
    expect(invoicePaymentDetails(null, [account({ showOnDocuments: false })])).toBeUndefined();
  });

  it("prints only the account explicitly ticked for documents", () => {
    const result = invoicePaymentDetails(null, [
      account({ showOnDocuments: false, accountNumber: "111" }),
      account({ showOnDocuments: true, accountNumber: "222" }),
      account({ showOnDocuments: false, accountNumber: "333" }),
    ]);
    expect(result?.bankAccount?.accountNumber).toBe("222");
  });

  it("carries the full banking detail a payer needs", () => {
    const result = invoicePaymentDetails(null, [account({ showOnDocuments: true })]);
    expect(result?.bankAccount).toEqual({
      bankName: "First National Bank",
      accountName: "Acme Ltd",
      accountNumber: "62050837304",
      branch: "250655",
    });
  });

  it("prints footer and instructions even with no bank account ticked", () => {
    const result = invoicePaymentDetails(
      { paymentInstructions: "Use the invoice number as your reference.", invoiceFooter: "E&OE" },
      [account({ showOnDocuments: false })],
    );
    expect(result?.bankAccount).toBeNull();
    expect(result?.paymentInstructions).toBe("Use the invoice number as your reference.");
    expect(result?.footer).toBe("E&OE");
  });

  it("treats whitespace-only text as not configured", () => {
    expect(invoicePaymentDetails({ paymentInstructions: "   ", invoiceFooter: "  " }, [])).toBeUndefined();
  });

  it("combines a ticked account with the company's own text", () => {
    const result = invoicePaymentDetails(
      { paymentInstructions: "EFT only.", invoiceFooter: "Standard terms apply." },
      [account({ showOnDocuments: true })],
    );
    expect(result?.bankAccount?.bankName).toBe("First National Bank");
    expect(result?.paymentInstructions).toBe("EFT only.");
    expect(result?.footer).toBe("Standard terms apply.");
  });
});
