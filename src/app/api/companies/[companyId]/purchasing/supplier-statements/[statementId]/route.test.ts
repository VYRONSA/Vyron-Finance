/**
 * @vitest-environment node
 *
 * SD-3C — statement review actions: each action's permission is checked
 * before anything is looked up; the database's refusals surface as 409.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requirePermission: vi.fn(),
  service: {
    confirmStatementSupplier: vi.fn(),
    correctStatementHeader: vi.fn(),
    correctStatementLines: vi.fn(),
    getSupplierStatement: vi.fn(),
    markStatementReady: vi.fn(),
    processStatement: vi.fn(),
    rejectStatement: vi.fn(),
    reopenStatement: vi.fn(),
    requeueStatement: vi.fn(),
    startStatementManualEntry: vi.fn(),
    submitStatementForReview: vi.fn(),
    unconfirmStatementSupplier: vi.fn(),
  },
  after: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: (fn: () => unknown) => m.after(fn) }));
vi.mock("@/server/auth/require-session", () => ({ requireSession: () => m.requireSession(), getPerformedByLabel: async () => "editor@synthetic.test" }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: (...a: unknown[]) => m.requirePermission(...a) }));
vi.mock("@/server/services/supplier-statement-service", () => ({
  ...m.service,
  ValidationError: class ValidationError extends Error {},
  NotFoundError: class NotFoundError extends Error {},
}));
vi.mock("@/server/services/supplier-management-service", () => ({ ValidationError: class extends Error {}, NotFoundError: class extends Error {} }));

const params = { params: Promise.resolve({ companyId: "co_1", statementId: "7" }) };
const patch = (body: unknown) => new Request("http://test/x", { method: "PATCH", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ ok: true });
  m.requirePermission.mockResolvedValue({ ok: true });
  m.service.getSupplierStatement.mockResolvedValue({ statement: { id: 7 }, lines: [], events: [] });
});

describe("PATCH a supplier statement", () => {
  it.each([
    ["correct-header", "Purchasing:Edit"],
    ["correct-lines", "Purchasing:Edit"],
    ["start-manual-entry", "Purchasing:Edit"],
    ["submit-for-review", "Purchasing:Edit"],
    ["confirm-supplier", "Purchasing:Edit"],
    ["mark-ready", "Purchasing:Edit"],
    ["reopen", "Purchasing:Edit"],
    ["requeue", "Purchasing:Edit"],
    ["reject", "Purchasing:Reject"],
  ])("%s needs %s, checked before anything is looked up", async (action, permission) => {
    m.requirePermission.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const { PATCH } = await import("./route");
    expect((await PATCH(patch({ action, supplierId: 1, reason: "x" }), params)).status).toBe(403);
    expect(m.requirePermission).toHaveBeenCalledWith("co_1", permission);
    expect(m.service.getSupplierStatement).not.toHaveBeenCalled();
    for (const fn of Object.values(m.service)) expect(fn).not.toHaveBeenCalled();
  });

  it("an unknown action is refused", async () => {
    const { PATCH } = await import("./route");
    expect((await PATCH(patch({ action: "post-to-ledger" }), params)).status).toBe(400);
    expect(m.requirePermission).not.toHaveBeenCalled();
  });

  it("confirm-supplier passes the supplier and the explicit save choice — no actor from the body", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patch({ action: "confirm-supplier", supplierId: 3, saveAccountNumber: true, performedBy: "someone-else" }), params);
    expect(res.status).toBe(200);
    expect(m.service.confirmStatementSupplier).toHaveBeenCalledWith("co_1", 7, 3, { saveAccountNumber: true });
  });

  it("a database refusal (guard / RLS) is a 409, not a 500", async () => {
    m.service.markStatementReady.mockRejectedValue(Object.assign(new Error("a reviewer must confirm the supplier before the statement is ready"), { code: "42501" }));
    const { PATCH } = await import("./route");
    const res = await PATCH(patch({ action: "mark-ready" }), params);
    expect(res.status).toBe(409);
  });

  it("requeue schedules processing after the response, never inline", async () => {
    const { PATCH } = await import("./route");
    await PATCH(patch({ action: "requeue" }), params);
    expect(m.service.processStatement).not.toHaveBeenCalled();
    expect(m.after).toHaveBeenCalledTimes(1);
  });
});

describe("GET a supplier statement", () => {
  it("needs Purchasing:View; an unknown or other company's statement is 404", async () => {
    m.service.getSupplierStatement.mockResolvedValue(null);
    const { GET } = await import("./route");
    expect((await GET(new Request("http://test/x"), params)).status).toBe(404);
    expect(m.requirePermission).toHaveBeenCalledWith("co_1", "Purchasing:View");
  });
});
