/**
 * Phase 21B — mandatory tenant-isolation security tests, mirroring the
 * pattern already established by branding/route.test.ts. Every
 * dependency is mocked; this never touches a real Supabase project.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/company-bank-statement-email-service", () => ({
  ensureCompanyBankStatementEmail: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
}));

import { GET } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { ensureCompanyBankStatementEmail, NotFoundError } from "@/server/services/company-bank-statement-email-service";
import type { CompanyBankStatementEmail } from "@/server/company-bank-statement-email/types";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

function identity(overrides: Partial<CompanyBankStatementEmail> = {}): CompanyBankStatementEmail {
  return {
    id: 1, companyId: "company-a", stableIdentifier: "acme-ltd-a7k3", status: "active",
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    lastReceivedAt: null, lastSuccessfulImportAt: null, lastFailureAt: null,
    emailAddress: "acme-ltd-a7k3.bank@imports.vyronfinance.co.za",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(ensureCompanyBankStatementEmail).mockReset();
});

describe("GET /api/companies/[companyId]/bank-statement-email — tenant isolation", () => {
  it("scopes the ensure/read call to the exact company in the URL", async () => {
    vi.mocked(ensureCompanyBankStatementEmail).mockResolvedValue(identity({ companyId: "company-a" }));

    const response = await GET(new Request("http://localhost/api/companies/company-a/bank-statement-email"), params("company-a"));
    const body = await response.json();

    expect(ensureCompanyBankStatementEmail).toHaveBeenCalledWith("company-a");
    expect(ensureCompanyBankStatementEmail).not.toHaveBeenCalledWith("company-b");
    expect(body.bankStatementEmail.companyId).toBe("company-a");
  });

  it("returns Company B's own identity when given Company B's id — never Company A's", async () => {
    vi.mocked(ensureCompanyBankStatementEmail).mockResolvedValue(
      identity({ companyId: "company-b", stableIdentifier: "netherfield-logistics-x9q2", emailAddress: "netherfield-logistics-x9q2.bank@imports.vyronfinance.co.za" }),
    );

    const response = await GET(new Request("http://localhost/api/companies/company-b/bank-statement-email"), params("company-b"));
    const body = await response.json();

    expect(body.bankStatementEmail.stableIdentifier).toBe("netherfield-logistics-x9q2");
    expect(body.bankStatementEmail.stableIdentifier).not.toBe("acme-ltd-a7k3");
  });

  it("returns 401 when there is no session (unauthorized company access is rejected)", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });

    const response = await GET(new Request("http://localhost/api/companies/company-a/bank-statement-email"), params("company-a"));

    expect(response.status).toBe(401);
    expect(ensureCompanyBankStatementEmail).not.toHaveBeenCalled();
  });

  it("maps a NotFoundError to a 404", async () => {
    vi.mocked(ensureCompanyBankStatementEmail).mockRejectedValue(new NotFoundError("No company with id missing."));

    const response = await GET(new Request("http://localhost/api/companies/missing/bank-statement-email"), params("missing"));

    expect(response.status).toBe(404);
  });

  it("returns an honest null emailAddress rather than a fabricated one when the domain isn't configured", async () => {
    vi.mocked(ensureCompanyBankStatementEmail).mockResolvedValue(identity({ emailAddress: null }));

    const response = await GET(new Request("http://localhost/api/companies/company-a/bank-statement-email"), params("company-a"));
    const body = await response.json();

    expect(body.bankStatementEmail.emailAddress).toBeNull();
  });
});
