/**
 * PATCH action "allocate-credit-note" — applies credit from a Posted credit
 * note (the route's invoiceId) to a Posted invoice of the same customer.
 * Changes two posted documents' balances, so it needs Sales:Edit AND
 * Sales:Approve; the database function checks both again. Also: a lost
 * approval race answers 409, not 500.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn(), requireApproval: vi.fn() }));
vi.mock("@/server/services/sales-invoice-service", () => ({
  getSalesInvoice: vi.fn(),
  approveAndPostInvoice: vi.fn(),
  assignMissingLineAccounts: vi.fn(),
  assignMissingPostedLineAccounts: vi.fn(),
  allocateCreditNote: vi.fn(),
  submitInvoice: vi.fn(),
  cancelInvoice: vi.fn(),
  retryPostInvoice: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {},
  ConflictError: class ConflictError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

import { PATCH } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { requireApproval, requirePermission } from "@/server/services/permission-service";
import {
  allocateCreditNote,
  approveAndPostInvoice,
  cancelInvoice,
  ConflictError,
  ForbiddenError,
  getSalesInvoice,
  NotFoundError,
  submitInvoice,
  ValidationError,
} from "@/server/services/sales-invoice-service";

const KEY = "6c1f2a8e-5d3b-4f7a-9e21-0b6a4c8d2f10";
const params = { params: Promise.resolve({ companyId: "co_1", invoiceId: "495" }) };
const req = (body: unknown) => new Request("http://localhost/api/companies/co_1/sales/invoices/495", { method: "PATCH", body: JSON.stringify(body) });
const allocate = (overrides: Record<string, unknown> = {}) => PATCH(req({ action: "allocate-credit-note", invoiceId: 514, amount: 343.39, requestKey: KEY, ...overrides }), params);
const denied = (permission: string) => NextResponse.json({ error: `Your role ("Viewer") does not have the "${permission}" permission.` }, { status: 403 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockResolvedValue({ ok: true });
  vi.mocked(requireApproval).mockResolvedValue({ ok: true } as never);
  vi.mocked(allocateCreditNote).mockResolvedValue({ allocationId: 1, replayed: false, amount: 343.39, invoiceNumber: "INV-3576", invoiceOutstanding: 1254.19 } as never);
});

describe("PATCH /sales/invoices/[id] — allocate-credit-note", () => {
  it("checks Sales:Edit and Sales:Approve, then applies the credit note (the route id) to the chosen invoice", async () => {
    const response = await allocate();
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Sales:Edit");
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Sales:Approve");
    expect(allocateCreditNote).toHaveBeenCalledWith("co_1", 495, 514, 343.39, KEY);
    expect((await response.json()).allocation).toMatchObject({ amount: 343.39, invoiceNumber: "INV-3576" });
  });

  it.each(["Sales:Edit", "Sales:Approve"])("refuses a user without %s and allocates nothing", async (missing) => {
    vi.mocked(requirePermission).mockImplementation(async (_co, permission) => (permission === missing ? { ok: false, response: denied(missing) } : { ok: true }));
    const response = await allocate();
    expect(response.status).toBe(403);
    expect(allocateCreditNote).not.toHaveBeenCalled();
  });

  it.each([
    [new ValidationError("CN-3406 has only 10.00 of credit left to apply."), 400],
    [new NotFoundError("the credit note or the invoice does not exist in this company."), 404],
    [new ConflictError("this request key was already used for a different allocation."), 409],
    [new ForbiddenError("Sales:Edit and Sales:Approve are required."), 403],
  ])("answers %s with %i and its message", async (error, status) => {
    vi.mocked(allocateCreditNote).mockRejectedValue(error);
    const response = await allocate();
    expect(response.status).toBe(status);
    expect((await response.json()).error).toBe(error.message);
  });

  it("never submits, approves, posts or cancels anything", async () => {
    await allocate();
    expect(submitInvoice).not.toHaveBeenCalled();
    expect(approveAndPostInvoice).not.toHaveBeenCalled();
    expect(cancelInvoice).not.toHaveBeenCalled();
  });
});

describe("PATCH /sales/invoices/[id] — approve, when another request got there first", () => {
  it("answers 409 with the reason instead of failing", async () => {
    vi.mocked(getSalesInvoice).mockResolvedValue({ id: 495, documentType: "Invoice", total: 3510.72 } as never);
    vi.mocked(approveAndPostInvoice).mockRejectedValue(new ConflictError("INV-3611 is already being approved by another request. Refresh to see it."));
    const response = await PATCH(req({ action: "approve" }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/already being approved/);
  });
});
