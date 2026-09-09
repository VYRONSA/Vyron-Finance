/**
 * Phase 24B — permission enforcement, tenant scoping, and honest error
 * mapping for the Send Invoice Email route. `document-email-service.ts`'s
 * own logic is covered by its own test file — this focuses on what's
 * unique to the route.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/document-email-service", () => ({
  sendInvoiceEmail: vi.fn(),
  ValidationError: class ValidationError extends Error {},
  NotFoundError: class NotFoundError extends Error {},
}));
vi.mock("@/server/services/document-service", () => ({
  ValidationError: class DocumentValidationError extends Error {},
  UsageLimitExceededError: class UsageLimitExceededError extends Error {},
}));
vi.mock("@/server/services/communication-service", () => ({
  ValidationError: class CommunicationValidationError extends Error {},
  NotFoundError: class CommunicationNotFoundError extends Error {},
}));
vi.mock("@/server/pdf/pdf-generation-service", () => ({ PdfGenerationError: class PdfGenerationError extends Error {} }));

import { POST } from "./route";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { sendInvoiceEmail, ValidationError, NotFoundError } from "@/server/services/document-email-service";
import { PdfGenerationError } from "@/server/pdf/pdf-generation-service";

function params(companyId: string, invoiceId: string) {
  return { params: Promise.resolve({ companyId, invoiceId }) };
}

function req(companyId: string, invoiceId: string): Request {
  return new Request(`http://localhost/api/companies/${companyId}/sales/invoices/${invoiceId}/send-email`, { method: "POST" });
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("Jane Accountant");
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(sendInvoiceEmail).mockReset().mockResolvedValue({ id: 1, status: "Queued" } as never);
});

describe("POST invoice send-email — permission enforcement", () => {
  it("requires Sales:Create", async () => {
    await POST(req("company-a", "501"), params("company-a", "501"));
    expect(requirePermission).toHaveBeenCalledWith("company-a", "Sales:Create");
  });

  it("returns the permission-denied response and never sends when unauthorised", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const response = await POST(req("company-a", "501"), params("company-a", "501"));
    expect(response.status).toBe(403);
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("requires a real session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const response = await POST(req("company-a", "501"), params("company-a", "501"));
    expect(response.status).toBe(401);
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });
});

describe("POST invoice send-email — tenant isolation and success", () => {
  it("only ever sends against the requested company's own id", async () => {
    await POST(req("company-b", "501"), params("company-b", "501"));
    expect(sendInvoiceEmail).toHaveBeenCalledWith(expect.anything(), "company-b", 501, "Jane Accountant");
  });

  it("returns the real communication on success", async () => {
    vi.mocked(sendInvoiceEmail).mockResolvedValue({ id: 42, status: "Queued" } as never);
    const response = await POST(req("company-a", "501"), params("company-a", "501"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.communication).toEqual({ id: 42, status: "Queued" });
  });
});

describe("POST invoice send-email — honest error mapping", () => {
  it("returns 404 for a not-found invoice/customer", async () => {
    vi.mocked(sendInvoiceEmail).mockRejectedValue(new NotFoundError("Sales invoice not found."));
    const response = await POST(req("company-a", "999"), params("company-a", "999"));
    expect(response.status).toBe(404);
  });

  it("returns 400 with an honest message when the customer has no email", async () => {
    vi.mocked(sendInvoiceEmail).mockRejectedValue(new ValidationError("This customer has no email address on file. Add one under Customer Contacts before sending."));
    const response = await POST(req("company-a", "501"), params("company-a", "501"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("no email address on file");
  });

  it("returns 502 without a stack trace on PDF generation failure", async () => {
    vi.mocked(sendInvoiceEmail).mockRejectedValue(new PdfGenerationError("PDF generation failed. Please try again."));
    const response = await POST(req("company-a", "501"), params("company-a", "501"));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(JSON.stringify(body)).not.toMatch(/at .*\(.*:\d+:\d+\)/);
  });
});
