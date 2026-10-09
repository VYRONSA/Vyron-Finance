/**
 * Bulk Unallocate routes: Banking:Edit at the route (the database checks it
 * again), and every refusal mapped to an honest status — never a success
 * for something that did not happen.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/bank-unallocation-service", () => ({
  previewUnallocation: vi.fn(),
  executeUnallocation: vi.fn(),
  ValidationError: class ValidationError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
  DuplicateRunError: class DuplicateRunError extends Error {},
}));

import { POST as previewPOST } from "./preview/route";
import { POST as executePOST } from "./execute/route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import {
  DuplicateRunError,
  executeUnallocation,
  ForbiddenError,
  previewUnallocation,
  ValidationError,
} from "@/server/services/bank-unallocation-service";

const params = (companyId = "co_1") => ({ params: Promise.resolve({ companyId }) });
const request = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const forbidden = () => ({ ok: false as const, response: NextResponse.json({ error: "no Banking:Edit" }, { status: 403 }) });

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(previewUnallocation).mockReset();
  vi.mocked(executeUnallocation).mockReset();
});

describe("preview route", () => {
  it("requires Banking:Edit in the company named in the URL", async () => {
    vi.mocked(previewUnallocation).mockResolvedValue({ candidates: [] } as never);
    const res = await previewPOST(request({ dateFrom: "2026-03-01", dateTo: "2026-03-31" }), params("co_9"));
    expect(res.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("co_9", "Banking:Edit");
    expect(previewUnallocation).toHaveBeenCalledWith("co_9", { dateFrom: "2026-03-01", dateTo: "2026-03-31" });
  });

  it("a view-only or other-company user is refused and nothing is read", async () => {
    vi.mocked(requirePermission).mockResolvedValue(forbidden());
    const res = await previewPOST(request({}), params());
    expect(res.status).toBe(403);
    expect(previewUnallocation).not.toHaveBeenCalled();
  });

  it("a signed-out caller is refused", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 401 }) } as never);
    const res = await previewPOST(request({}), params());
    expect(res.status).toBe(401);
    expect(requirePermission).not.toHaveBeenCalled();
  });

  it("maps an invalid range to 400", async () => {
    vi.mocked(previewUnallocation).mockRejectedValue(new ValidationError("From Date cannot be later than To Date."));
    const res = await previewPOST(request({}), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "From Date cannot be later than To Date." });
  });
});

describe("execute route", () => {
  it("requires Banking:Edit and passes the body to the service unchanged", async () => {
    const result = { runId: 1, requested: 1, unallocated: 1, skipped: 0, failed: 0, items: [] };
    vi.mocked(executeUnallocation).mockResolvedValue(result);
    const body = { requestKey: "k", dateFrom: "2026-03-01", dateTo: "2026-03-31", items: [{ id: 1, glAccount: "6100" }] };
    const res = await executePOST(request(body), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result });
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Banking:Edit");
    expect(executeUnallocation).toHaveBeenCalledWith("co_1", body);
  });

  it("a view-only user cannot execute — nothing is written", async () => {
    vi.mocked(requirePermission).mockResolvedValue(forbidden());
    const res = await executePOST(request({ items: [{ id: 1 }] }), params());
    expect(res.status).toBe(403);
    expect(executeUnallocation).not.toHaveBeenCalled();
  });

  it("the database's own refusal is 403, not a success", async () => {
    vi.mocked(executeUnallocation).mockRejectedValue(new ForbiddenError("no"));
    expect((await executePOST(request({}), params())).status).toBe(403);
  });

  it("a repeated preview is 409", async () => {
    vi.mocked(executeUnallocation).mockRejectedValue(new DuplicateRunError("already executed"));
    expect((await executePOST(request({}), params())).status).toBe(409);
  });

  it("an unexpected failure is not swallowed", async () => {
    vi.mocked(executeUnallocation).mockRejectedValue(new Error("db down"));
    await expect(executePOST(request({}), params())).rejects.toThrow("db down");
  });
});
