/**
 * Phase 24A — permission enforcement, tenant scoping, filename headers,
 * and honest error propagation for the Invoice PDF download route.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/sales-invoice-service", () => ({ getSalesInvoice: vi.fn() }));
vi.mock("@/server/pdf/pdf-generation-service", () => ({
  generateInvoicePdf: vi.fn(),
  PdfGenerationError: class PdfGenerationError extends Error {},
}));

import { GET } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getSalesInvoice } from "@/server/services/sales-invoice-service";
import { generateInvoicePdf, PdfGenerationError } from "@/server/pdf/pdf-generation-service";
import type { SalesInvoice } from "@/server/sales/types";

function params(companyId: string, invoiceId: string) {
  return { params: Promise.resolve({ companyId, invoiceId }) };
}

function req(companyId: string, invoiceId: string): Request {
  return new Request(`http://localhost/api/companies/${companyId}/sales/invoices/${invoiceId}/pdf`);
}

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 501, companyId: "company-a", documentType: "Invoice", invoiceNumber: "INV000125", customerId: 1, invoiceDate: "2026-08-01",
    dueDate: null, reference: "", status: "Posted", subtotal: 100, vatAmount: 15, total: 115, outstanding: 0, notes: "",
    lines: [], journalId: null, createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  } as SalesInvoice;
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getSalesInvoice).mockReset().mockResolvedValue(invoice());
  vi.mocked(generateInvoicePdf).mockReset().mockResolvedValue(Buffer.from("%PDF-fake"));
});

describe("GET invoice pdf — permission enforcement", () => {
  it("requires Sales:View — the same permission the existing invoice-viewing route implies", async () => {
    await GET(req("company-a", "501"), params("company-a", "501"));
    expect(requirePermission).toHaveBeenCalledWith("company-a", "Sales:View");
  });

  it("returns the permission-denied response and never generates a PDF when unauthorised", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const response = await GET(req("company-a", "501"), params("company-a", "501"));
    expect(response.status).toBe(403);
    expect(generateInvoicePdf).not.toHaveBeenCalled();
  });

  it("requires a real session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const response = await GET(req("company-a", "501"), params("company-a", "501"));
    expect(response.status).toBe(401);
    expect(generateInvoicePdf).not.toHaveBeenCalled();
  });
});

describe("GET invoice pdf — tenant isolation and not-found", () => {
  it("only ever looks up the invoice against the requested company's own id", async () => {
    await GET(req("company-b", "501"), params("company-b", "501"));
    expect(getSalesInvoice).toHaveBeenCalledWith("company-b", 501);
  });

  it("returns 404 for an invoice id that doesn't resolve in this company (e.g. belongs to another company)", async () => {
    vi.mocked(getSalesInvoice).mockResolvedValue(null);
    const response = await GET(req("company-a", "999"), params("company-a", "999"));
    expect(response.status).toBe(404);
    expect(generateInvoicePdf).not.toHaveBeenCalled();
  });
});

describe("GET invoice pdf — success", () => {
  it("returns application/pdf with the real invoice number as the filename", async () => {
    const response = await GET(req("company-a", "501"), params("company-a", "501"));
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="INV000125.pdf"');
  });

  it("returns the real generated PDF bytes", async () => {
    const response = await GET(req("company-a", "501"), params("company-a", "501"));
    const buf = Buffer.from(await response.arrayBuffer());
    expect(buf.toString()).toBe("%PDF-fake");
  });
});

describe("GET invoice pdf — honest failure handling", () => {
  it("returns 502 with the honest error message, never a stack trace, on generation failure", async () => {
    vi.mocked(generateInvoicePdf).mockRejectedValue(new PdfGenerationError("PDF generation failed. Please try again."));
    const response = await GET(req("company-a", "501"), params("company-a", "501"));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.error).toBe("PDF generation failed. Please try again.");
  });

  it("never leaks a secret in the error response", async () => {
    vi.mocked(generateInvoicePdf).mockRejectedValue(new PdfGenerationError("PDF generation failed. Please try again."));
    const response = await GET(req("company-a", "501"), params("company-a", "501"));
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/service[_-]?role|api[_-]?key|secret|cookie/i);
  });
});
