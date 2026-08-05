import { describe, expect, it } from "vitest";
import { editRequiresElevatedPermission, ValidationError } from "./supplier-management-service";

describe("editRequiresElevatedPermission", () => {
  it("requires elevated permission when bank name is present", () => {
    expect(editRequiresElevatedPermission({ bankName: "First National Bank" })).toBe(true);
  });

  it("requires elevated permission when bank account number is present", () => {
    expect(editRequiresElevatedPermission({ bankAccountNumber: "62050837304" })).toBe(true);
  });

  it("requires elevated permission when bank branch code is present", () => {
    expect(editRequiresElevatedPermission({ bankBranchCode: "250655" })).toBe(true);
  });

  it("does not require elevated permission for non-banking fields", () => {
    expect(editRequiresElevatedPermission({ name: "New Supplier Name", supplierCategory: "Raw Materials", vatNumber: "4123456789" })).toBe(false);
  });

  it("does not require elevated permission for an empty edit", () => {
    expect(editRequiresElevatedPermission({})).toBe(false);
  });
});

describe("ValidationError", () => {
  it("is a real Error subclass", () => {
    expect(new ValidationError("test") instanceof Error).toBe(true);
  });
});
