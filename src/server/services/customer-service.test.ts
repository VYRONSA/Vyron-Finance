import { describe, expect, it } from "vitest";
import { validateCustomerInput, ValidationError } from "./customer-service";

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
