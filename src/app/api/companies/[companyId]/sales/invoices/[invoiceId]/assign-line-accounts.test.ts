/**
 * PATCH action "assign-line-accounts" — the supported repair for Draft
 * invoices imported without an account. Requires Sales:Edit (the same
 * permission as the other Draft actions); the service does the rest.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn(), requireApproval: vi.fn() }));
vi.mock("@/server/services/sales-invoice-service", () => ({
  getSalesInvoice: vi.fn(),
  approveAndPostInvoice: vi.fn(),
  assignMissingLineAccounts: vi.fn(),
  submitInvoice: vi.fn(),
  cancelInvoice: vi.fn(),
  retryPostInvoice: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {},
}));

import { PATCH } from "./route";
import { getPerformedByLabel, requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { approveAndPostInvoice, assignMissingLineAccounts, cancelInvoice, submitInvoice, ValidationError } from "@/server/services/sales-invoice-service";

const params = { params: Promise.resolve({ companyId: "co_1", invoiceId: "501" }) };
const req = (body: unknown) => new Request("http://localhost/api/companies/co_1/sales/invoices/501", { method: "PATCH", body: JSON.stringify(body) });
const DENIED = NextResponse.json({ error: 'Your role ("Viewer") does not have the "Sales:Edit" permission.' }, { status: 403 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockResolvedValue({ ok: true });
  vi.mocked(getPerformedByLabel).mockResolvedValue("owner@example.test");
  vi.mocked(assignMissingLineAccounts).mockResolvedValue({ id: 501, status: "Draft" } as never);
});

describe("PATCH /sales/invoices/[id] — assign-line-accounts", () => {
  it("checks Sales:Edit and passes the account and the signed-in user to the service", async () => {
    const response = await PATCH(req({ action: "assign-line-accounts", glAccount: "1000" }), params);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Sales:Edit");
    expect(assignMissingLineAccounts).toHaveBeenCalledWith("co_1", 501, "1000", "owner@example.test");
  });

  it("refuses a user without Sales:Edit and changes nothing", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: DENIED });
    const response = await PATCH(req({ action: "assign-line-accounts", glAccount: "1000" }), params);
    expect(response.status).toBe(403);
    expect(assignMissingLineAccounts).not.toHaveBeenCalled();
  });

  it("never submits, approves, posts or cancels", async () => {
    await PATCH(req({ action: "assign-line-accounts", glAccount: "1000" }), params);
    expect(submitInvoice).not.toHaveBeenCalled();
    expect(approveAndPostInvoice).not.toHaveBeenCalled();
    expect(cancelInvoice).not.toHaveBeenCalled();
  });

  it("returns the service's refusal as a 400", async () => {
    vi.mocked(assignMissingLineAccounts).mockRejectedValue(new ValidationError("SI-1 is Posted; accounts can only be assigned on a Draft."));
    const response = await PATCH(req({ action: "assign-line-accounts", glAccount: "1000" }), params);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "SI-1 is Posted; accounts can only be assigned on a Draft." });
  });
});
