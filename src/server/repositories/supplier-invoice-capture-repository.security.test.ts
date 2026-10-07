/**
 * @vitest-environment node
 *
 * Phase SD-0 — which database client each capture write uses.
 *
 * Migration 0111 refuses system results from a signed-in client and takes
 * the event actor from the session. These tests pin the application half:
 * reviewer actions go through the caller's session (so RLS and the guard
 * trigger see the real user), system processing goes through the service
 * role, and a reviewer event never carries an actor the caller chose.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { client: "session" | "system"; op: string; target: string; args?: unknown };
const calls: Call[] = [];

function fakeClient(client: Call["client"]) {
  const builder = (target: string) => {
    const chain: Record<string, unknown> = {};
    const record = (op: string) => (args?: unknown) => {
      calls.push({ client, op, target, args });
      return chain;
    };
    for (const op of ["select", "insert", "update", "delete", "eq", "order", "limit"]) chain[op] = record(op);
    chain.single = async () => ({ data: { id: 1 }, error: null });
    chain.maybeSingle = async () => ({ data: { id: 1 }, error: null });
    chain.returns = async () => ({ data: [], error: null });
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
    return chain;
  };
  return {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: unknown) => {
      calls.push({ client, op: "rpc", target: fn, args });
      return { data: { decision: "allow" }, error: null };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient("session") }));
vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: () => true,
  createAdminClient: () => fakeClient("system"),
}));

beforeEach(() => {
  calls.length = 0;
});

describe("reviewer actions use the caller's session", () => {
  it("records a reviewer event through the session RPC with no actor parameter", async () => {
    const repo = await import("./supplier-invoice-capture-repository");
    await repo.recordCaptureEvent("co_1", 5, "FieldCorrected", { fields: ["invoiceNumber"] });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ client: "session", op: "rpc", target: "fn_supplier_invoice_capture_record_event" });
    const args = calls[0].args as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["p_capture_id", "p_company_id", "p_detail", "p_event_type"]);
    expect(JSON.stringify(args)).not.toMatch(/performed_by|actor/i);
  });

  it("never inserts into the events table directly", async () => {
    const repo = await import("./supplier-invoice-capture-repository");
    await repo.recordCaptureEvent("co_1", 5, "Cancelled", {});
    await repo.recordSystemCaptureEvent("co_1", 5, "ExtractionStarted", {}, "Scheduler");
    expect(calls.some((c) => c.target === "supplier_invoice_capture_events" && c.op === "insert")).toBe(false);
  });

  it("applies reviewer field changes and line corrections under the session", async () => {
    const repo = await import("./supplier-invoice-capture-repository");
    await repo.updateCaptureAsReviewer("co_1", 5, { invoice_number: "INV-1" });
    await repo.updateCaptureLine("co_1", 5, 1, { gl_account_confirmed: "5000" });
    expect(calls.filter((c) => c.op === "update").every((c) => c.client === "session")).toBe(true);
  });
});

describe("system processing uses the service role", () => {
  it("routes extraction results, claims, line replacement and system events to the service role", async () => {
    const repo = await import("./supplier-invoice-capture-repository");
    await repo.updateCaptureAsSystem("co_1", 5, { validation_status: "Pass" });
    await repo.claimCaptureForExtraction("co_1", 5);
    await repo.replaceCaptureLines("co_1", 5, []);
    await repo.recordSystemCaptureEvent("co_1", 5, "ValidationEvaluated", {}, "Scheduler");

    const writes = calls.filter((c) => ["update", "delete", "insert", "rpc"].includes(c.op));
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((c) => c.client === "system")).toBe(true);
    expect(calls.find((c) => c.op === "rpc")).toMatchObject({
      target: "fn_supplier_invoice_capture_record_system_event",
      args: expect.objectContaining({ p_performed_by: "Scheduler" }),
    });
  });

  it("opens the AI gate and records attempts with the service role, never the session", async () => {
    const repo = await import("./supplier-invoice-capture-repository");
    await repo.openExtractionGate("co_1", 5);
    await repo.recordExtractionAttempt({
      companyId: "co_1", captureId: 5, taskRunId: null, attemptNumber: 1, outcome: "provider_error",
      providerRequestMade: false, model: null, errorCategory: null, httpStatus: null, providerMessage: null,
      usage: null, durationMs: null, performedBy: "Scheduler", circuitSignal: "none", probe: false,
    });
    const rpcs = calls.filter((c) => c.op === "rpc");
    expect(rpcs.map((c) => c.target)).toEqual(["fn_ai_extraction_gate", "fn_ai_extraction_record_attempt"]);
    expect(rpcs.every((c) => c.client === "system")).toBe(true);
  });

  it("refuses system processing when the service role is not configured", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      isSupabaseAdminConfigured: () => false,
      createAdminClient: () => {
        throw new Error("must not be called");
      },
    }));
    const repo = await import("./supplier-invoice-capture-repository");
    await expect(repo.openExtractionGate("co_1", 5)).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    await expect(repo.recordSystemCaptureEvent("co_1", 5, "Requeued", {}, "Scheduler")).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    vi.doUnmock("@/lib/supabase/admin");
  });
});
