import { describe, expect, it } from "vitest";
import { maskAccountNumber, validateCreateBankAccountInput, ValidationError } from "./bank-account-service";

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
