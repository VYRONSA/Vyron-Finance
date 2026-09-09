import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/company-repository", () => ({ getCompany: vi.fn(), updateCompany: vi.fn(), createCompany: vi.fn() }));
vi.mock("@/server/repositories/journal-repository", () => ({ hasAnyPostedJournal: vi.fn() }));

import { resolveOrganisationBootstrap, validateCreateCompanyInput, updateCompany, ValidationError } from "./company-service";
import * as companyRepo from "@/server/repositories/company-repository";
import type { Company } from "@/server/company-management/types";

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "company-a", organisationId: "org_1", name: "Fenwick & Rowe Ltd", industry: "Professional Services",
    status: "active", registrationNumber: "2019/123456/07", address: "12 Fenwick Street, Cape Town",
    financialYearStartMonth: 3, baseCurrencyCode: "ZAR", createdAt: "2025-02-10T09:00:00Z",
    tradingName: "", vatNumber: "", telephone: "", email: "", website: "", postalAddress: "",
    city: "", province: "", postalCode: "", country: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(companyRepo.updateCompany).mockReset();
  vi.mocked(companyRepo.getCompany).mockReset();
});

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

describe("updateCompany — Phase 20D profile fields", () => {
  it("persists the new profile fields, trimmed, scoped to the exact companyId", async () => {
    vi.mocked(companyRepo.updateCompany).mockResolvedValue(company({ tradingName: "Acme" }));

    await updateCompany("company-a", { tradingName: "  Acme  ", vatNumber: " 4123456789 ", telephone: " 021 555 0123 " });

    expect(companyRepo.updateCompany).toHaveBeenCalledWith(
      "company-a",
      expect.objectContaining({ trading_name: "Acme", vat_number: "4123456789", telephone: "021 555 0123" }),
    );
  });

  it("never targets a different company than the one passed in (tenant isolation)", async () => {
    vi.mocked(companyRepo.updateCompany).mockResolvedValue(company());

    await updateCompany("company-a", { tradingName: "Acme" });

    expect(companyRepo.updateCompany).toHaveBeenCalledWith("company-a", expect.anything());
    expect(companyRepo.updateCompany).not.toHaveBeenCalledWith("company-b", expect.anything());
  });

  it("allows optional fields to be saved blank", async () => {
    vi.mocked(companyRepo.updateCompany).mockResolvedValue(company());

    await expect(updateCompany("company-a", { tradingName: "", vatNumber: "", telephone: "", email: "", website: "", postalAddress: "" })).resolves.toBeDefined();
    expect(companyRepo.updateCompany).toHaveBeenCalledWith(
      "company-a",
      expect.objectContaining({ trading_name: "", vat_number: "", telephone: "", email: "", website: "", postal_address: "" }),
    );
  });

  it("rejects an invalid email format", async () => {
    await expect(updateCompany("company-a", { email: "not-an-email" })).rejects.toBeInstanceOf(ValidationError);
    expect(companyRepo.updateCompany).not.toHaveBeenCalled();
  });

  it("accepts a valid email format", async () => {
    vi.mocked(companyRepo.updateCompany).mockResolvedValue(company({ email: "accounts@fenwickrowe.co.za" }));
    await expect(updateCompany("company-a", { email: "accounts@fenwickrowe.co.za" })).resolves.toBeDefined();
  });

  it("rejects an invalid website format", async () => {
    await expect(updateCompany("company-a", { website: "not a url with spaces and no dot" })).rejects.toBeInstanceOf(ValidationError);
    expect(companyRepo.updateCompany).not.toHaveBeenCalled();
  });

  it("accepts a website with or without an explicit protocol", async () => {
    vi.mocked(companyRepo.updateCompany).mockResolvedValue(company({ website: "www.fenwickrowe.co.za" }));
    await expect(updateCompany("company-a", { website: "www.fenwickrowe.co.za" })).resolves.toBeDefined();
    await expect(updateCompany("company-a", { website: "https://www.fenwickrowe.co.za" })).resolves.toBeDefined();
  });

  it("treats VAT number, registration number, and telephone as plain strings — never coerced to numbers", async () => {
    vi.mocked(companyRepo.updateCompany).mockResolvedValue(company({ vatNumber: "4001234567" }));
    await updateCompany("company-a", { vatNumber: "4001234567", registrationNumber: "2019/123456/07", telephone: "011 000 0000" });
    const [, fields] = vi.mocked(companyRepo.updateCompany).mock.calls[0]!;
    expect(typeof fields.vat_number).toBe("string");
    expect(typeof fields.registration_number).toBe("string");
    expect(typeof fields.telephone).toBe("string");
  });

  it("leaves existing fields untouched when only a new profile field is sent", async () => {
    vi.mocked(companyRepo.updateCompany).mockResolvedValue(company());
    await updateCompany("company-a", { tradingName: "Acme" });
    const [, fields] = vi.mocked(companyRepo.updateCompany).mock.calls[0]!;
    expect(fields.name).toBeUndefined();
    expect(fields.registration_number).toBeUndefined();
    expect(fields.address).toBeUndefined();
  });
});
