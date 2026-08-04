import { describe, expect, it } from "vitest";
import { createVatTreatment, validateVatTreatmentInput, ValidationError } from "./vat-treatment-service";

describe("validateVatTreatmentInput", () => {
  it("accepts a valid rate", () => {
    expect(() => validateVatTreatmentInput({ code: "Standard Rated", rate: 15 })).not.toThrow();
  });

  it("accepts the boundary rates 0 and 100", () => {
    expect(() => validateVatTreatmentInput({ code: "X", rate: 0 })).not.toThrow();
    expect(() => validateVatTreatmentInput({ code: "X", rate: 100 })).not.toThrow();
  });

  it("rejects a blank code", () => {
    expect(() => validateVatTreatmentInput({ code: "", rate: 15 })).toThrow(ValidationError);
  });

  it("rejects a negative or out-of-range rate", () => {
    expect(() => validateVatTreatmentInput({ code: "X", rate: -1 })).toThrow(ValidationError);
    expect(() => validateVatTreatmentInput({ code: "X", rate: 101 })).toThrow(ValidationError);
  });

  it("rejects a non-finite rate", () => {
    expect(() => validateVatTreatmentInput({ code: "X", rate: NaN })).toThrow(ValidationError);
  });
});

describe("createVatTreatment", () => {
  it("rejects a blank name even with a valid code/rate", () => {
    return expect(createVatTreatment("co_1", { code: "X", name: "", rate: 15 })).rejects.toThrow(ValidationError);
  });
});
