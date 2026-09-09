/**
 * Phase 24B — mirrors the invoice send-email route's own tests.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/document-email-service", () => ({
  sendStatementEmail: vi.fn(),
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
import { sendStatementEmail, ValidationError, NotFoundError } from "@/server/services/document-email-service";

function params(companyId: string, customerId: string) {
  return { params: Promise.resolve({ companyId, customerId }) };
}

function req(companyId: string, customerId: string): Request {
  return new Request(`http://localhost/api/companies/${companyId}/customers/${customerId}/statement/send-email`, { method: "POST" });
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("Jane Accountant");
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(sendStatementEmail).mockReset().mockResolvedValue({ id: 1, status: "Queued" } as never);
});

describe("POST statement send-email — permission enforcement", () => {
  it("requires Sales:Create", async () => {
    await POST(req("company-a", "42"), params("company-a", "42"));
    expect(requirePermission).toHaveBeenCalledWith("company-a", "Sales:Create");
  });

  it("returns the permission-denied response and never sends when unauthorised", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const response = await POST(req("company-a", "42"), params("company-a", "42"));
    expect(response.status).toBe(403);
    expect(sendStatementEmail).not.toHaveBeenCalled();
  });
});

describe("POST statement send-email — tenant isolation and success", () => {
  it("only ever sends against the requested company's own id", async () => {
    await POST(req("company-b", "42"), params("company-b", "42"));
    expect(sendStatementEmail).toHaveBeenCalledWith(expect.anything(), "company-b", 42, "Jane Accountant");
  });

  it("returns the real communication on success", async () => {
    vi.mocked(sendStatementEmail).mockResolvedValue({ id: 88, status: "Queued" } as never);
    const response = await POST(req("company-a", "42"), params("company-a", "42"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.communication).toEqual({ id: 88, status: "Queued" });
  });
});

describe("POST statement send-email — honest error mapping", () => {
  it("returns 404 for a not-found customer", async () => {
    vi.mocked(sendStatementEmail).mockRejectedValue(new NotFoundError("Customer not found."));
    const response = await POST(req("company-a", "999"), params("company-a", "999"));
    expect(response.status).toBe(404);
  });

  it("returns 400 when the customer has no email", async () => {
    vi.mocked(sendStatementEmail).mockRejectedValue(new ValidationError("This customer has no email address on file."));
    const response = await POST(req("company-a", "42"), params("company-a", "42"));
    expect(response.status).toBe(400);
  });
});
