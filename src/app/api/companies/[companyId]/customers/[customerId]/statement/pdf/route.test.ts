/**
 * Phase 24A — mirrors the invoice PDF route's own tests (see that file's
 * docstring) for the Customer Statement PDF download route.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/customer-service", () => ({ getCustomer: vi.fn() }));
vi.mock("@/server/pdf/pdf-generation-service", () => ({
  generateStatementPdf: vi.fn(),
  PdfGenerationError: class PdfGenerationError extends Error {},
}));

import { GET } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getCustomer } from "@/server/services/customer-service";
import { generateStatementPdf, PdfGenerationError } from "@/server/pdf/pdf-generation-service";
import type { Customer } from "@/server/customer-management/types";

function params(companyId: string, customerId: string) {
  return { params: Promise.resolve({ companyId, customerId }) };
}

function req(companyId: string, customerId: string): Request {
  return new Request(`http://localhost/api/companies/${companyId}/customers/${customerId}/statement/pdf`);
}

function customer(overrides: Partial<Customer> = {}): Customer {
  return { id: 42, companyId: "company-a", name: "Northwood Management", vatNumber: "", registrationNumber: "", createdAt: "2026-01-01T00:00:00Z", ...overrides } as Customer;
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getCustomer).mockReset().mockResolvedValue(customer());
  vi.mocked(generateStatementPdf).mockReset().mockResolvedValue(Buffer.from("%PDF-fake"));
});

describe("GET statement pdf — permission enforcement", () => {
  it("requires Sales:View", async () => {
    await GET(req("company-a", "42"), params("company-a", "42"));
    expect(requirePermission).toHaveBeenCalledWith("company-a", "Sales:View");
  });

  it("returns the permission-denied response and never generates a PDF when unauthorised", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const response = await GET(req("company-a", "42"), params("company-a", "42"));
    expect(response.status).toBe(403);
    expect(generateStatementPdf).not.toHaveBeenCalled();
  });
});

describe("GET statement pdf — tenant isolation and not-found", () => {
  it("only ever looks up the customer against the requested company's own id", async () => {
    await GET(req("company-b", "42"), params("company-b", "42"));
    expect(getCustomer).toHaveBeenCalledWith("company-b", 42);
  });

  it("returns 404 for a customer id that doesn't resolve in this company", async () => {
    vi.mocked(getCustomer).mockResolvedValue(null);
    const response = await GET(req("company-a", "999"), params("company-a", "999"));
    expect(response.status).toBe(404);
    expect(generateStatementPdf).not.toHaveBeenCalled();
  });
});

describe("GET statement pdf — success", () => {
  it("returns application/pdf with a predictable filename built from the real customer name", async () => {
    const response = await GET(req("company-a", "42"), params("company-a", "42"));
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain('filename="STATEMENT-Northwood-Management-');
  });
});

describe("GET statement pdf — honest failure handling", () => {
  it("returns 502 with the honest error message on generation failure", async () => {
    vi.mocked(generateStatementPdf).mockRejectedValue(new PdfGenerationError("PDF generation failed. Please try again."));
    const response = await GET(req("company-a", "42"), params("company-a", "42"));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.error).toBe("PDF generation failed. Please try again.");
  });
});
