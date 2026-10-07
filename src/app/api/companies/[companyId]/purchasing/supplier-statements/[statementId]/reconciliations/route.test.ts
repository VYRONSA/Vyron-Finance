/**
 * @vitest-environment node
 *
 * SD-3D — reconciliation routes: permission before anything, refusals as 409,
 * and decisions without any actor from the body.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requirePermission: vi.fn(),
  service: {
    runStatementReconciliation: vi.fn(),
    listStatementReconciliations: vi.fn(),
    getStatementReconciliation: vi.fn(),
    verifyStatementReconciliation: vi.fn(),
    recordStatementResolution: vi.fn(),
  },
}));

vi.mock("@/server/auth/require-session", () => ({ requireSession: () => m.requireSession() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: (...a: unknown[]) => m.requirePermission(...a) }));
vi.mock("@/server/services/supplier-statement-reconciliation-service", () => ({
  ...m.service,
  ReconciliationError: class ReconciliationError extends Error {},
  NotFoundError: class NotFoundError extends Error {},
}));

const params = { params: Promise.resolve({ companyId: "co_1", statementId: "7" }) };

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ ok: true });
  m.requirePermission.mockResolvedValue({ ok: true });
});

describe("POST reconciliations (run)", () => {
  it("needs Purchasing:Edit, checked before anything else", async () => {
    m.requirePermission.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const { POST } = await import("./route");
    expect((await POST(new Request("http://t/x", { method: "POST" }), params)).status).toBe(403);
    expect(m.requirePermission).toHaveBeenCalledWith("co_1", "Purchasing:Edit");
    expect(m.service.runStatementReconciliation).not.toHaveBeenCalled();
  });
  it("runs and returns 201", async () => {
    m.service.runStatementReconciliation.mockResolvedValue({ id: 5 });
    const { POST } = await import("./route");
    expect((await POST(new Request("http://t/x", { method: "POST" }), params)).status).toBe(201);
  });
  it("a refusal (not ready, unconfirmed, currency, database guard) is 409", async () => {
    const { ReconciliationError } = await import("@/server/services/supplier-statement-reconciliation-service");
    m.service.runStatementReconciliation.mockRejectedValue(new ReconciliationError("Confirm the supplier before reconciling."));
    const { POST } = await import("./route");
    expect((await POST(new Request("http://t/x", { method: "POST" }), params)).status).toBe(409);
    m.service.runStatementReconciliation.mockRejectedValue(Object.assign(new Error("only a ready statement can be reconciled"), { code: "42501" }));
    expect((await POST(new Request("http://t/x", { method: "POST" }), params)).status).toBe(409);
  });
});

describe("GET reconciliations", () => {
  it("needs Purchasing:View", async () => {
    m.requirePermission.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const { GET } = await import("./route");
    expect((await GET(new Request("http://t/x"), params)).status).toBe(403);
    expect(m.service.listStatementReconciliations).not.toHaveBeenCalled();
  });
});

describe("GET one run", () => {
  const runParams = { params: Promise.resolve({ companyId: "co_1", statementId: "7", runId: "5" }) };
  it("returns the run, and replays it on ?verify=1", async () => {
    m.service.getStatementReconciliation.mockResolvedValue({ run: { id: 5 }, items: [] });
    m.service.verifyStatementReconciliation.mockResolvedValue({ fingerprintMatches: true, resultMatches: true });
    const { GET } = await import("./[runId]/route");
    const res = await GET(new Request("http://t/x?verify=1"), runParams);
    expect(res.status).toBe(200);
    expect((await res.json()).verification).toEqual({ fingerprintMatches: true, resultMatches: true });
  });
  it("an unknown or other company's run is 404", async () => {
    m.service.getStatementReconciliation.mockResolvedValue(null);
    const { GET } = await import("./[runId]/route");
    expect((await GET(new Request("http://t/x"), runParams)).status).toBe(404);
  });
});

describe("POST resolutions", () => {
  const post = (body: unknown) => new Request("http://t/x", { method: "POST", body: JSON.stringify(body) });
  it("needs Purchasing:Edit", async () => {
    m.requirePermission.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const { POST } = await import("../resolutions/route");
    expect((await POST(post({ action: "explained", reason: "x y z" }), params)).status).toBe(403);
    expect(m.service.recordStatementResolution).not.toHaveBeenCalled();
  });
  it("passes the decision through — never an actor from the body", async () => {
    m.service.recordStatementResolution.mockResolvedValue(12);
    const { POST } = await import("../resolutions/route");
    const res = await POST(post({ action: "manual-link", statementLineId: 40, refType: "bill", refId: 1, reason: "Supplier quotes our PO", performedBy: "forged" }), params);
    expect(res.status).toBe(201);
    const decision = m.service.recordStatementResolution.mock.calls[0][2];
    expect(decision).toEqual({ action: "manual-link", statementLineId: 40, refType: "bill", refId: 1, revokesResolutionId: null, reason: "Supplier quotes our PO" });
  });
  it("a database refusal is 409", async () => {
    m.service.recordStatementResolution.mockRejectedValue(Object.assign(new Error("the PRECISIA record does not belong to this statement's supplier"), { code: "42501" }));
    const { POST } = await import("../resolutions/route");
    expect((await POST(post({ action: "manual-link", statementLineId: 1, refType: "bill", refId: 99, reason: "x y z" }), params)).status).toBe(409);
  });
});
