/**
 * /sales/invoices/posted-line-accounts — GET preflight (Sales:View) and
 * POST bulk repair (Sales:Edit AND Sales:Approve, invoice ids only).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/posted-line-account-repair-service", () => ({
  bulkAssignMissingPostedLineAccounts: vi.fn(),
  listRepairScopes: vi.fn(),
  previewPostedLineAccountRepair: vi.fn(),
}));
vi.mock("@/server/services/sales-invoice-service", () => ({
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {},
}));

import { GET, POST } from "./route";
import { getPerformedByLabel, requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { bulkAssignMissingPostedLineAccounts, listRepairScopes, previewPostedLineAccountRepair } from "@/server/services/posted-line-account-repair-service";
import { ValidationError } from "@/server/services/sales-invoice-service";

const params = { params: Promise.resolve({ companyId: "co_1" }) };
const url = "http://localhost/api/companies/co_1/sales/invoices/posted-line-accounts";
const post = (body: unknown) => new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const denied = (permission: string) => NextResponse.json({ error: `Your role ("Clerk") does not have the "${permission}" permission.` }, { status: 403 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockResolvedValue({ ok: true });
  vi.mocked(getPerformedByLabel).mockResolvedValue("owner@example.test");
  vi.mocked(bulkAssignMissingPostedLineAccounts).mockResolvedValue({ results: [], summary: {} } as never);
  vi.mocked(previewPostedLineAccountRepair).mockResolvedValue({ ready: true } as never);
  vi.mocked(listRepairScopes).mockReturnValue([]);
});

describe("POST — bulk repair", () => {
  it("needs Sales:Edit and Sales:Approve, and passes this company, the ids and the signed-in user", async () => {
    const response = await POST(post({ invoiceIds: [1, 2] }), params);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Sales:Edit");
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Sales:Approve");
    expect(bulkAssignMissingPostedLineAccounts).toHaveBeenCalledWith("co_1", [1, 2], "owner@example.test");
  });

  it.each(["Sales:Edit", "Sales:Approve"])("refuses a user without %s and changes nothing", async (missing) => {
    vi.mocked(requirePermission).mockImplementation(async (_co, p) => (p === missing ? { ok: false, response: denied(missing) } : { ok: true }));
    const response = await POST(post({ invoiceIds: [1] }), params);
    expect(response.status).toBe(403);
    expect(bulkAssignMissingPostedLineAccounts).not.toHaveBeenCalled();
  });

  it("refuses a signed-out request", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Sign in" }, { status: 401 }) } as never);
    expect((await POST(post({ invoiceIds: [1] }), params)).status).toBe(401);
    expect(bulkAssignMissingPostedLineAccounts).not.toHaveBeenCalled();
  });

  it.each([
    [{ invoiceIds: [1], glAccount: "4000" }, /not "glAccount"/],
    [{ invoiceIds: [1], account: "1000" }, /not "account"/],
    [[1, 2], /Send \{ "invoiceIds"/],
    ["not json", /must be JSON/],
  ])("refuses the body %j — the account can never be chosen", async (body, message) => {
    const response = await POST(post(body), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(message);
    expect(bulkAssignMissingPostedLineAccounts).not.toHaveBeenCalled();
  });

  it("returns the service's refusal (e.g. too many ids, account 1000 unusable) as a 400", async () => {
    vi.mocked(bulkAssignMissingPostedLineAccounts).mockRejectedValue(new ValidationError("At most 50 invoices can be repaired at once; 51 were sent."));
    const response = await POST(post({ invoiceIds: [1] }), params);
    expect(response.status).toBe(400);
  });
});

describe("GET — read-only preflight", () => {
  it("needs Sales:View only and lists this company's scopes", async () => {
    const response = await GET(new Request(url), params);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Sales:View");
    expect(listRepairScopes).toHaveBeenCalledWith("co_1");
    expect(bulkAssignMissingPostedLineAccounts).not.toHaveBeenCalled();
  });

  it("previews a scope", async () => {
    await GET(new Request(`${url}?scope=handcrafted-batch-1b`), params);
    expect(previewPostedLineAccountRepair).toHaveBeenCalledWith("co_1", { scopeId: "handcrafted-batch-1b" });
  });

  it("previews ids, passing anything that is not a whole number as invalid", async () => {
    await GET(new Request(`${url}?ids=1,2,x`), params);
    expect(previewPostedLineAccountRepair).toHaveBeenCalledWith("co_1", { invoiceIds: [1, 2, NaN] });
  });

  it("refuses a user without Sales:View", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: denied("Sales:View") });
    expect((await GET(new Request(url), params)).status).toBe(403);
    expect(listRepairScopes).not.toHaveBeenCalled();
  });
});
