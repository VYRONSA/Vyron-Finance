import { describe, expect, it } from "vitest";
import { computeOpeningBalanceDelta, maskAccountNumber, validateCreateBankAccountInput, ValidationError } from "./bank-account-service";

describe("maskAccountNumber", () => {
  it("masks all but the last 4 digits", () => {
    expect(maskAccountNumber("62050837304")).toBe("•••• 7304");
  });

  it("leaves short numbers unmasked", () => {
    expect(maskAccountNumber("1234")).toBe("1234");
    expect(maskAccountNumber("12")).toBe("12");
  });

  it("trims surrounding whitespace before masking", () => {
    expect(maskAccountNumber("  1961234567  ")).toBe("•••• 4567");
  });
});

describe("validateCreateBankAccountInput", () => {
  const valid = { accountNumber: "123456", accountName: "Main Account", bankName: "FNB" };

  it("accepts a fully populated input", () => {
    expect(() => validateCreateBankAccountInput(valid)).not.toThrow();
  });

  it("rejects a missing account number", () => {
    expect(() => validateCreateBankAccountInput({ ...valid, accountNumber: "" })).toThrow(ValidationError);
    expect(() => validateCreateBankAccountInput({ ...valid, accountNumber: "   " })).toThrow(ValidationError);
  });

  it("rejects a missing account name", () => {
    expect(() => validateCreateBankAccountInput({ ...valid, accountName: "" })).toThrow(/account name/i);
  });

  it("rejects a missing bank name", () => {
    expect(() => validateCreateBankAccountInput({ ...valid, bankName: "" })).toThrow(/bank name/i);
  });
});

describe("computeOpeningBalanceDelta", () => {
  it("shifts current_balance by the same delta as the opening balance change", () => {
    // Account had opening balance 1000, and has since moved to 1500 via
    // real transactions (500 of real activity). Correcting the opening
    // balance to 1200 must preserve that 500 of real activity — the new
    // current_balance is 1700, not silently reset to 1200.
    expect(computeOpeningBalanceDelta(1000, 1500, 1200)).toEqual({ opening_balance: 1200, current_balance: 1700 });
  });

  it("applies a negative delta correctly", () => {
    expect(computeOpeningBalanceDelta(5000, 5000, 3000)).toEqual({ opening_balance: 3000, current_balance: 3000 });
  });

  it("is a no-op when the opening balance is unchanged", () => {
    expect(computeOpeningBalanceDelta(2000, 2750, 2000)).toEqual({ opening_balance: 2000, current_balance: 2750 });
  });

  it("handles a first-time opening balance set from zero", () => {
    expect(computeOpeningBalanceDelta(0, 0, 10000)).toEqual({ opening_balance: 10000, current_balance: 10000 });
  });
});
