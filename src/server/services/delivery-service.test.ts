import { describe, expect, it } from "vitest";
import { validateDeliveryLines, ValidationError } from "./delivery-service";

describe("validateDeliveryLines", () => {
  it("rejects an empty line list", () => {
    expect(() => validateDeliveryLines([])).toThrow(ValidationError);
  });

  it("rejects a line with no description", () => {
    expect(() => validateDeliveryLines([{ description: "", quantity: 1 }])).toThrow(ValidationError);
  });

  it("rejects a line with zero or negative quantity", () => {
    expect(() => validateDeliveryLines([{ description: "Freight", quantity: 0 }])).toThrow(ValidationError);
    expect(() => validateDeliveryLines([{ description: "Freight", quantity: -1 }])).toThrow(ValidationError);
  });

  it("accepts a valid line list", () => {
    expect(() => validateDeliveryLines([{ description: "Freight", quantity: 1 }])).not.toThrow();
  });
});
