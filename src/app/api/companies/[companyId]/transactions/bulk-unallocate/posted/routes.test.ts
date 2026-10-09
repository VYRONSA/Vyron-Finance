/**
 * Bulk Unpost routes (migration 0120): Banking:Edit AND
 * GeneralLedger:Reverse at the route (the database checks both again), and
 * every refusal mapped to an honest status.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/bank-unallocation-service", () => ({
  previewUnposting: vi.fn(),
  executeUnposting: vi.fn(),
  ValidationError: class ValidationError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
  DuplicateRunError: class DuplicateRunError extends Error {},
}));

import { POST as previewPOST } from "./preview/route";
import { POST as executePOST } from "./execute/route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { DuplicateRunError, executeUnposting, ForbiddenError, previewUnposting, ValidationError } from "@/server/services/bank-unallocation-service";

const params = (companyId = "co_1") => ({ params: Promise.resolve({ companyId }) });
const request = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const forbidden = () => ({ ok: false as const, response: NextResponse.json({ error: "no" }, { status: 403 }) });

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(previewUnposting).mockReset();
  vi.mocked(executeUnposting).mockReset();
});

describe("posted preview route", () => {
  it("requires Banking:Edit and GeneralLedger:Reverse in the company named in the URL", async () => {
    vi.mocked(previewUnposting).mockResolvedValue({ candidates: [] } as never);
    const res = await previewPOST(request({ dateFrom: "2026-03-01", dateTo: "2026-03-31" }), params("co_9"));
    expect(res.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("co_9", "Banking:Edit");
    expect(requirePermission).toHaveBeenCalledWith("co_9", "GeneralLedger:Reverse");
  });

  it("Banking:Edit without GeneralLedger:Reverse is refused and nothing is read", async () => {
    vi.mocked(requirePermission).mockImplementation(async (_co, key) => (key === "GeneralLedger:Reverse" ? forbidden() : { ok: true }));
    const res = await previewPOST(request({}), params());
    expect(res.status).toBe(403);
    expect(previewUnposting).not.toHaveBeenCalled();
  });

  it("a signed-out caller is refused", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 401 }) } as never);
    expect((await previewPOST(request({}), params())).status).toBe(401);
    expect(requirePermission).not.toHaveBeenCalled();
  });

  it("maps an invalid range to 400", async () => {
    vi.mocked(previewUnposting).mockRejectedValue(new ValidationError("From Date cannot be later than To Date."));
    expect((await previewPOST(request({}), params())).status).toBe(400);
  });
});

describe("posted execute route", () => {
  it("requires both permissions and passes the body to the service unchanged", async () => {
    const result = { runId: 1, requested: 1, unposted: 1, skipped: 0, failed: 0, reversedJournals: 1, postingBatchId: 3, items: [] };
    vi.mocked(executeUnposting).mockResolvedValue(result);
    const body = { requestKey: "k", items: [{ id: 1, journalId: 4 }] };
    const res = await executePOST(request(body), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result });
    expect(requirePermission).toHaveBeenCalledWith("co_1", "GeneralLedger:Reverse");
    expect(executeUnposting).toHaveBeenCalledWith("co_1", body);
  });

  it("without GeneralLedger:Reverse nothing is written", async () => {
    vi.mocked(requirePermission).mockImplementation(async (_co, key) => (key === "GeneralLedger:Reverse" ? forbidden() : { ok: true }));
    expect((await executePOST(request({ items: [{ id: 1 }] }), params())).status).toBe(403);
    expect(executeUnposting).not.toHaveBeenCalled();
  });

  it("maps the database's refusals: permission 403, repeated preview 409; unexpected errors are not swallowed", async () => {
    vi.mocked(executeUnposting).mockRejectedValueOnce(new ForbiddenError("no"));
    expect((await executePOST(request({}), params())).status).toBe(403);
    vi.mocked(executeUnposting).mockRejectedValueOnce(new DuplicateRunError("already executed"));
    expect((await executePOST(request({}), params())).status).toBe(409);
    vi.mocked(executeUnposting).mockRejectedValueOnce(new Error("db down"));
    await expect(executePOST(request({}), params())).rejects.toThrow("db down");
  });
});
