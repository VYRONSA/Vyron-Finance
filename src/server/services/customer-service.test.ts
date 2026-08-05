import { describe, expect, it } from "vitest";
import { editRequiresElevatedPermission, validateCustomerInput, ValidationError } from "./customer-service";

describe("validateCustomerInput", () => {
  it("accepts a well-formed customer", () => {
    expect(() => validateCustomerInput({ customerCode: "CUST-1000", name: "Meridian Traders" })).not.toThrow();
  });

  it("rejects a blank customer code", () => {
    expect(() => validateCustomerInput({ customerCode: "  ", name: "Meridian Traders" })).toThrow(ValidationError);
  });

  it("rejects a customer code with disallowed characters", () => {
    expect(() => validateCustomerInput({ customerCode: "CUST 1000 / A", name: "Meridian Traders" })).toThrow(ValidationError);
  });

  it("rejects a blank name", () => {
    expect(() => validateCustomerInput({ customerCode: "CUST-1000", name: "  " })).toThrow(ValidationError);
  });
});

describe("editRequiresElevatedPermission", () => {
  it("requires elevated permission when credit limit is present", () => {
    expect(editRequiresElevatedPermission({ creditLimit: 50000 })).toBe(true);
  });

  it("requires elevated permission even when credit limit is set to zero", () => {
    expect(editRequiresElevatedPermission({ creditLimit: 0 })).toBe(true);
  });

  it("does not require elevated permission for non-sensitive fields", () => {
    expect(editRequiresElevatedPermission({ name: "New Name", industry: "Manufacturing", notes: "..." })).toBe(false);
  });

  it("does not require elevated permission for an empty edit", () => {
    expect(editRequiresElevatedPermission({})).toBe(false);
  });
});
