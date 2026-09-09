/**
 * Phase 21B — mandatory tenant-isolation and lifecycle tests for the
 * Bank Statement Email identity service. Every dependency is mocked;
 * this never touches a real Supabase project.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/server/repositories/company-bank-statement-email-repository", () => ({
  getCompanyBankStatementEmail: vi.fn(),
  insertCompanyBankStatementEmail: vi.fn(),
}));
vi.mock("@/server/services/company-service", () => ({ getCompany: vi.fn() }));

import { getCompanyBankStatementEmail, ensureCompanyBankStatementEmail, NotFoundError } from "./company-bank-statement-email-service";
import * as repo from "@/server/repositories/company-bank-statement-email-repository";
import { getCompany } from "@/server/services/company-service";
import type { CompanyBankStatementEmailRecord } from "@/server/company-bank-statement-email/types";
import type { Company } from "@/server/company-management/types";

function record(overrides: Partial<CompanyBankStatementEmailRecord> = {}): CompanyBankStatementEmailRecord {
  return {
    id: 1,
    companyId: "company-a",
    stableIdentifier: "acme-ltd-a7k3",
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lastReceivedAt: null,
    lastSuccessfulImportAt: null,
    lastFailureAt: null,
    ...overrides,
  };
}

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "company-a", organisationId: "org_1", name: "Acme Ltd", industry: "Retail",
    status: "active", registrationNumber: "", address: "", financialYearStartMonth: 3,
    baseCurrencyCode: "ZAR", createdAt: "2025-01-01T00:00:00.000Z",
    tradingName: "", vatNumber: "", telephone: "", email: "", website: "", postalAddress: "",
    city: "", province: "", postalCode: "", country: "",
    ...overrides,
  };
}

function uniqueViolation(constraintName: string) {
  return { code: "23505", message: `duplicate key value violates unique constraint "${constraintName}"` };
}

const ORIGINAL_DOMAIN = process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN;

beforeEach(() => {
  vi.mocked(repo.getCompanyBankStatementEmail).mockReset();
  vi.mocked(repo.insertCompanyBankStatementEmail).mockReset();
  vi.mocked(getCompany).mockReset();
  process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
});

afterEach(() => {
  if (ORIGINAL_DOMAIN === undefined) delete process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN;
  else process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = ORIGINAL_DOMAIN;
});

describe("getCompanyBankStatementEmail", () => {
  it("returns null when the company has no identity yet (never creates one)", async () => {
    vi.mocked(repo.getCompanyBankStatementEmail).mockResolvedValue(null);
    const result = await getCompanyBankStatementEmail("company-a");
    expect(result).toBeNull();
    expect(repo.insertCompanyBankStatementEmail).not.toHaveBeenCalled();
  });

  it("returns the existing identity with a constructed email address", async () => {
    vi.mocked(repo.getCompanyBankStatementEmail).mockResolvedValue(record());
    const result = await getCompanyBankStatementEmail("company-a");
    expect(result?.emailAddress).toBe("acme-ltd-a7k3.bank@imports.vyronfinance.co.za");
  });

  it("only ever reads the exact companyId passed in (tenant isolation)", async () => {
    vi.mocked(repo.getCompanyBankStatementEmail).mockResolvedValue(record());
    await getCompanyBankStatementEmail("company-a");
    expect(repo.getCompanyBankStatementEmail).toHaveBeenCalledWith("company-a");
    expect(repo.getCompanyBankStatementEmail).not.toHaveBeenCalledWith("company-b");
  });
});

describe("ensureCompanyBankStatementEmail — creation lifecycle", () => {
  it("returns the existing identity without creating a new one when it already exists", async () => {
    vi.mocked(repo.getCompanyBankStatementEmail).mockResolvedValue(record());
    const result = await ensureCompanyBankStatementEmail("company-a");
    expect(result.stableIdentifier).toBe("acme-ltd-a7k3");
    expect(repo.insertCompanyBankStatementEmail).not.toHaveBeenCalled();
    expect(getCompany).not.toHaveBeenCalled();
  });

  it("creates a new identity from the company's current name on first call", async () => {
    vi.mocked(repo.getCompanyBankStatementEmail).mockResolvedValue(null);
    vi.mocked(getCompany).mockResolvedValue(company({ name: "Northwood Management Investments" }));
    vi.mocked(repo.insertCompanyBankStatementEmail).mockImplementation(async (companyId, stableIdentifier) =>
      record({ companyId, stableIdentifier }),
    );

    const result = await ensureCompanyBankStatementEmail("company-a");

    expect(result.stableIdentifier).toMatch(/^northwood-management-investments-[a-z0-9]{4}$/);
    expect(repo.insertCompanyBankStatementEmail).toHaveBeenCalledTimes(1);
  });

  it("is idempotent under a simulated concurrent call — a company_id race re-fetches the winner instead of erroring", async () => {
    vi.mocked(repo.getCompanyBankStatementEmail)
      .mockResolvedValueOnce(null) // this request's own initial check
      .mockResolvedValueOnce(record({ stableIdentifier: "acme-ltd-winner" })); // re-fetch after losing the race
    vi.mocked(getCompany).mockResolvedValue(company());
    vi.mocked(repo.insertCompanyBankStatementEmail).mockRejectedValue(uniqueViolation("company_bank_statement_email_company_id_key"));

    const result = await ensureCompanyBankStatementEmail("company-a");

    expect(result.stableIdentifier).toBe("acme-ltd-winner");
  });

  it("regenerates a fresh candidate on a stable_identifier collision rather than failing", async () => {
    vi.mocked(repo.getCompanyBankStatementEmail).mockResolvedValue(null);
    vi.mocked(getCompany).mockResolvedValue(company());
    vi.mocked(repo.insertCompanyBankStatementEmail)
      .mockRejectedValueOnce(uniqueViolation("company_bank_statement_email_stable_identifier_key"))
      .mockImplementationOnce(async (companyId, stableIdentifier) => record({ companyId, stableIdentifier }));

    const result = await ensureCompanyBankStatementEmail("company-a");

    expect(repo.insertCompanyBankStatementEmail).toHaveBeenCalledTimes(2);
    expect(result.stableIdentifier).toBeTruthy();
  });

  it("throws after repeated stable_identifier collisions rather than looping forever", async () => {
    vi.mocked(repo.getCompanyBankStatementEmail).mockResolvedValue(null);
    vi.mocked(getCompany).mockResolvedValue(company());
    vi.mocked(repo.insertCompanyBankStatementEmail).mockRejectedValue(uniqueViolation("company_bank_statement_email_stable_identifier_key"));

    await expect(ensureCompanyBankStatementEmail("company-a")).rejects.toThrow(/unique bank statement email identifier/i);
  });

  it("propagates an unrelated database error rather than swallowing it", async () => {
    vi.mocked(repo.getCompanyBankStatementEmail).mockResolvedValue(null);
    vi.mocked(getCompany).mockResolvedValue(company());
    vi.mocked(repo.insertCompanyBankStatementEmail).mockRejectedValue(new Error("connection reset"));

    await expect(ensureCompanyBankStatementEmail("company-a")).rejects.toThrow("connection reset");
  });

  it("throws NotFoundError rather than fabricating an identity for a company that doesn't exist", async () => {
    vi.mocked(repo.getCompanyBankStatementEmail).mockResolvedValue(null);
    vi.mocked(getCompany).mockResolvedValue(null);

    await expect(ensureCompanyBankStatementEmail("missing-company")).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.insertCompanyBankStatementEmail).not.toHaveBeenCalled();
  });

  it("never targets a different company than the one passed in (tenant isolation)", async () => {
    vi.mocked(repo.getCompanyBankStatementEmail).mockResolvedValue(null);
    vi.mocked(getCompany).mockResolvedValue(company({ id: "company-a" }));
    vi.mocked(repo.insertCompanyBankStatementEmail).mockImplementation(async (companyId, stableIdentifier) => record({ companyId, stableIdentifier }));

    await ensureCompanyBankStatementEmail("company-a");

    expect(getCompany).toHaveBeenCalledWith("company-a");
    expect(getCompany).not.toHaveBeenCalledWith("company-b");
    expect(repo.insertCompanyBankStatementEmail).toHaveBeenCalledWith("company-a", expect.any(String));
    expect(repo.insertCompanyBankStatementEmail).not.toHaveBeenCalledWith("company-b", expect.any(String));
  });

  it("a company rename does not change an already-stored identifier — the identity is only ever generated once", async () => {
    vi.mocked(repo.getCompanyBankStatementEmail).mockResolvedValue(record({ stableIdentifier: "old-name-a7k3" }));
    vi.mocked(getCompany).mockResolvedValue(company({ name: "Brand New Name Ltd" }));

    const result = await ensureCompanyBankStatementEmail("company-a");

    expect(result.stableIdentifier).toBe("old-name-a7k3");
    expect(getCompany).not.toHaveBeenCalled(); // never even consulted once an identity already exists
    expect(repo.insertCompanyBankStatementEmail).not.toHaveBeenCalled();
  });
});
