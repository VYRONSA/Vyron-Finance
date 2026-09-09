/**
 * Phase 20D — tenant-isolation and permission-enforcement tests for the
 * Company profile GET/PATCH route, mirroring the pattern already
 * established by bank-connections/route.test.ts and branding/route.test.ts.
 * Every dependency is mocked; this never touches a real Supabase project.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/company-service", () => ({ getCompany: vi.fn(), updateCompany: vi.fn(), ValidationError: class ValidationError extends Error {} }));

import { GET, PATCH } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getCompany, updateCompany, ValidationError } from "@/server/services/company-service";
import type { Company } from "@/server/company-management/types";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

function patchRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/companies/x", { method: "PATCH", body: JSON.stringify(body) });
}

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "company-a", organisationId: "org_1", name: "Fenwick & Rowe Ltd", industry: "Professional Services",
    status: "active", registrationNumber: "2019/123456/07", address: "12 Fenwick Street, Cape Town",
    financialYearStartMonth: 3, baseCurrencyCode: "ZAR", createdAt: "2025-02-10T09:00:00Z",
    tradingName: "Fenwick & Rowe", vatNumber: "4123456789", telephone: "021 555 0123",
    email: "accounts@fenwickrowe.co.za", website: "www.fenwickrowe.co.za", postalAddress: "PO Box 1234, Cape Town",
    city: "", province: "", postalCode: "", country: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(requirePermission).mockReset();
  vi.mocked(getCompany).mockReset();
  vi.mocked(updateCompany).mockReset();
});

describe("GET /api/companies/[companyId] — tenant isolation (new profile fields)", () => {
  it("returns Company A's own expanded profile fields, scoped to Company A's id", async () => {
    vi.mocked(getCompany).mockResolvedValue(company({ id: "company-a" }));

    const response = await GET(new Request("http://localhost/api/companies/company-a"), params("company-a"));
    const body = await response.json();

    expect(getCompany).toHaveBeenCalledWith("company-a");
    expect(getCompany).not.toHaveBeenCalledWith("company-b");
    expect(body.company.tradingName).toBe("Fenwick & Rowe");
    expect(body.company.vatNumber).toBe("4123456789");
  });

  it("returns Company B's own data when given Company B's id — never Company A's", async () => {
    vi.mocked(getCompany).mockResolvedValue(company({ id: "company-b", name: "Netherfield Logistics", tradingName: "Netherfield" }));

    const response = await GET(new Request("http://localhost/api/companies/company-b"), params("company-b"));
    const body = await response.json();

    expect(body.company.name).toBe("Netherfield Logistics");
    expect(body.company.tradingName).toBe("Netherfield");
  });
});

describe("PATCH /api/companies/[companyId] — Settings:Edit protects writes on the new profile fields", () => {
  it("blocks a user without Settings:Edit from updating any company field, including the new profile fields", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) });

    const response = await PATCH(patchRequest({ tradingName: "New Trading Name" }), params("company-b"));

    expect(response.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("company-b", "Settings:Edit");
    expect(updateCompany).not.toHaveBeenCalled();
  });

  it("scopes the update to the exact company in the URL, never a different one", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: true });
    vi.mocked(updateCompany).mockResolvedValue(company({ id: "company-a", tradingName: "New Trading Name" }));

    await PATCH(patchRequest({ tradingName: "New Trading Name" }), params("company-a"));

    expect(updateCompany).toHaveBeenCalledWith("company-a", expect.objectContaining({ tradingName: "New Trading Name" }));
    expect(updateCompany).not.toHaveBeenCalledWith("company-b", expect.anything());
  });

  it("maps a ValidationError (e.g. an invalid email/website) to a 400", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: true });
    vi.mocked(updateCompany).mockRejectedValue(new ValidationError("Email is not a valid email address."));

    const response = await PATCH(patchRequest({ email: "not-an-email" }), params("company-a"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/email/i);
  });

  it("persists a full set of new profile fields in one request", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: true });
    const updated = company({ telephone: "011 000 0000", email: "info@acme.co.za", website: "acme.co.za", postalAddress: "PO Box 1" });
    vi.mocked(updateCompany).mockResolvedValue(updated);

    const response = await PATCH(
      patchRequest({ telephone: "011 000 0000", email: "info@acme.co.za", website: "acme.co.za", postalAddress: "PO Box 1" }),
      params("company-a"),
    );
    const body = await response.json();

    expect(body.company.telephone).toBe("011 000 0000");
    expect(body.company.email).toBe("info@acme.co.za");
    expect(body.company.postalAddress).toBe("PO Box 1");
  });
});

describe("regression — existing gates", () => {
  it("returns 401 when there is no session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await GET(new Request("http://localhost/api/companies/co_1"), params("co_1"));
    expect(response.status).toBe(401);
  });

  it("still returns 404 when the company doesn't exist", async () => {
    vi.mocked(getCompany).mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/companies/missing"), params("missing"));
    expect(response.status).toBe(404);
  });
});
