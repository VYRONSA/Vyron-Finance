/**
 * PATCH action "assign-posted-line-accounts" — the metadata-only repair for
 * Posted invoices without line accounts. A posted document, so it needs
 * both Sales:Edit and Sales:Approve; the service does the rest.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn(), requireApproval: vi.fn() }));
vi.mock("@/server/services/sales-invoice-service", () => ({
  getSalesInvoice: vi.fn(),
  approveAndPostInvoice: vi.fn(),
  assignMissingLineAccounts: vi.fn(),
  assignMissingPostedLineAccounts: vi.fn(),
  submitInvoice: vi.fn(),
  cancelInvoice: vi.fn(),
  retryPostInvoice: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {},
  ConflictError: class ConflictError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
  allocateCreditNote: vi.fn(),
}));

import { PATCH } from "./route";
import { getPerformedByLabel, requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import {
  approveAndPostInvoice,
  assignMissingLineAccounts,
  assignMissingPostedLineAccounts,
  cancelInvoice,
  retryPostInvoice,
  submitInvoice,
  ValidationError,
} from "@/server/services/sales-invoice-service";

const params = { params: Promise.resolve({ companyId: "co_1", invoiceId: "501" }) };
const req = (body: unknown) => new Request("http://localhost/api/companies/co_1/sales/invoices/501", { method: "PATCH", body: JSON.stringify(body) });
const denied = (permission: string) => NextResponse.json({ error: `Your role ("Clerk") does not have the "${permission}" permission.` }, { status: 403 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockResolvedValue({ ok: true });
  vi.mocked(getPerformedByLabel).mockResolvedValue("owner@example.test");
  vi.mocked(assignMissingPostedLineAccounts).mockResolvedValue({ id: 501, status: "Posted" } as never);
});

describe("PATCH /sales/invoices/[id] — assign-posted-line-accounts", () => {
  it("checks Sales:Edit and Sales:Approve and passes the account and the signed-in user to the service", async () => {
    const response = await PATCH(req({ action: "assign-posted-line-accounts", glAccount: "1000" }), params);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Sales:Edit");
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Sales:Approve");
    expect(assignMissingPostedLineAccounts).toHaveBeenCalledWith("co_1", 501, "1000", "owner@example.test");
    expect(assignMissingLineAccounts).not.toHaveBeenCalled();
  });

  it.each(["Sales:Edit", "Sales:Approve"])("refuses a user without %s and changes nothing", async (missing) => {
    vi.mocked(requirePermission).mockImplementation(async (_co, permission) => (permission === missing ? { ok: false, response: denied(missing) } : { ok: true }));
    const response = await PATCH(req({ action: "assign-posted-line-accounts", glAccount: "1000" }), params);
    expect(response.status).toBe(403);
    expect(assignMissingPostedLineAccounts).not.toHaveBeenCalled();
  });

  it("never submits, approves, posts, re-posts or cancels", async () => {
    await PATCH(req({ action: "assign-posted-line-accounts", glAccount: "1000" }), params);
    expect(submitInvoice).not.toHaveBeenCalled();
    expect(approveAndPostInvoice).not.toHaveBeenCalled();
    expect(retryPostInvoice).not.toHaveBeenCalled();
    expect(cancelInvoice).not.toHaveBeenCalled();
  });

  it("returns the service's refusal as a 400", async () => {
    vi.mocked(assignMissingPostedLineAccounts).mockRejectedValue(new ValidationError("Only account 1000 can be assigned to a Posted invoice's lines."));
    const response = await PATCH(req({ action: "assign-posted-line-accounts", glAccount: "1005" }), params);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Only account 1000 can be assigned to a Posted invoice's lines." });
  });
});
