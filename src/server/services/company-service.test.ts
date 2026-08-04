import { describe, expect, it } from "vitest";
import { resolveOrganisationBootstrap, validateCreateCompanyInput, ValidationError } from "./company-service";

describe("resolveOrganisationBootstrap", () => {
  it("does not bootstrap when the user already belongs to an organisation", () => {
    expect(resolveOrganisationBootstrap("org-1", "Acme Ltd")).toEqual({ needsBootstrap: false });
  });

  it("bootstraps a new organisation named after the company when the user has none", () => {
    expect(resolveOrganisationBootstrap(null, "Acme Ltd")).toEqual({
      needsBootstrap: true,
      organisationName: "Acme Ltd Organisation",
    });
  });

  it("trims the company name before deriving the organisation name", () => {
    expect(resolveOrganisationBootstrap(null, "  Acme Ltd  ")).toEqual({
      needsBootstrap: true,
      organisationName: "Acme Ltd Organisation",
    });
  });
});

describe("validateCreateCompanyInput", () => {
  it("accepts a minimal valid input", () => {
    expect(() => validateCreateCompanyInput({ name: "Acme Ltd" })).not.toThrow();
  });

  it("rejects a missing or blank name", () => {
    expect(() => validateCreateCompanyInput({ name: "" })).toThrow(ValidationError);
    expect(() => validateCreateCompanyInput({ name: "   " })).toThrow(ValidationError);
  });

  it("rejects a financial year start month outside 1-12", () => {
    expect(() => validateCreateCompanyInput({ name: "Acme Ltd", financialYearStartMonth: 0 })).toThrow(ValidationError);
    expect(() => validateCreateCompanyInput({ name: "Acme Ltd", financialYearStartMonth: 13 })).toThrow(ValidationError);
  });

  it("accepts every valid financial year start month", () => {
    for (let month = 1; month <= 12; month++) {
      expect(() => validateCreateCompanyInput({ name: "Acme Ltd", financialYearStartMonth: month })).not.toThrow();
    }
  });
});
