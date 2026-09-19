/**
 * Phase 5N — the certification call ceiling, from the application side.
 *
 * The ceiling's atomicity is a database property and is proved there
 * (`supabase/tests/certification_call_ceiling.test.sql`, and the real
 * 40-connection race in `.concurrency.sh`). What is proved HERE is the
 * part a database test cannot reach: that this wrapper never invents a
 * grant, including when the database itself is unreachable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { closeCertificationRun, openCertificationRun, reserveCertificationCall } from "./certification-budget";

beforeEach(() => rpc.mockReset());

describe("reserving a certification call", () => {
  it("passes a granted reservation through with its counts", async () => {
    rpc.mockResolvedValue({
      data: { reserved: true, calls_used: 3, call_ceiling: 15, status: "Open", reason: "" },
      error: null,
    });

    expect(await reserveCertificationCall(1)).toEqual({
      reserved: true,
      callsUsed: 3,
      callCeiling: 15,
      status: "Open",
      reason: "",
    });
  });

  it("passes a refusal through, with the reason", async () => {
    rpc.mockResolvedValue({
      data: { reserved: false, calls_used: 15, call_ceiling: 15, status: "Exhausted", reason: "This certification run has reached its call ceiling." },
      error: null,
    });

    const result = await reserveCertificationCall(1);
    expect(result.reserved).toBe(false);
    expect(result.reason).toContain("ceiling");
  });
});

describe("fail-closed", () => {
  it("a database ERROR is a refusal, not an exception and not a grant", async () => {
    // The decisive case. If the ceiling cannot be consulted then there is
    // no ceiling, and a run with no ceiling must not make calls. An
    // exception here would be almost as bad as a grant: a harness with a
    // try/catch around its loop would carry on.
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });

    const result = await reserveCertificationCall(1);
    expect(result.reserved).toBe(false);
    expect(result.reason).toMatch(/no provider call was made/i);
  });

  it("a thrown client is a refusal too", async () => {
    rpc.mockImplementationOnce(() => {
      throw new Error("socket hang up");
    });
    expect((await reserveCertificationCall(1)).reserved).toBe(false);
  });

  it("an empty or malformed answer is a refusal", async () => {
    for (const data of [null, {}, { reserved: "yes" }, { reserved: 1 }]) {
      rpc.mockResolvedValue({ data, error: null });
      expect((await reserveCertificationCall(1)).reserved).toBe(false);
    }
  });

  it("only a literal true is a grant", async () => {
    // Anything truthy-but-not-true is a shape nobody designed, and an
    // undesigned shape must not spend money.
    rpc.mockResolvedValue({ data: { reserved: true, calls_used: 1, call_ceiling: 2, status: "Open", reason: "" }, error: null });
    expect((await reserveCertificationCall(1)).reserved).toBe(true);
  });

  it("never leaks the database's own error text to the caller", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "FATAL: password authentication failed for user \"postgres\"" } });
    const result = await reserveCertificationCall(1);
    expect(JSON.stringify(result)).not.toMatch(/password|postgres|FATAL/i);
  });
});

describe("opening and closing a run", () => {
  it("opens with a label and a finite ceiling", async () => {
    rpc.mockResolvedValue({ data: 42, error: null });
    expect(await openCertificationRun("co-1", "gateway certification", 15, "owner")).toBe(42);
    expect(rpc).toHaveBeenCalledWith("fn_ai_certification_open_run", {
      p_company_id: "co-1",
      p_label: "gateway certification",
      p_call_ceiling: 15,
      p_opened_by: "owner",
    });
  });

  it("surfaces a refusal to open rather than continuing without a ceiling", async () => {
    // Unlike a reservation, a failure to OPEN must be loud: there is no
    // safe default run to fall back to.
    rpc.mockResolvedValue({ data: null, error: { message: "a certification run needs a finite ceiling greater than zero" } });
    await expect(openCertificationRun("co-1", "bad", 0, "owner")).rejects.toBeTruthy();
  });

  it("closes by id", async () => {
    rpc.mockResolvedValue({ data: { closed: true }, error: null });
    await closeCertificationRun(42);
    expect(rpc).toHaveBeenCalledWith("fn_ai_certification_close_run", { p_run_id: 42 });
  });
});

describe("it is not billing", () => {
  it("nothing here touches the customer metering path", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/server/supplier-invoice-capture/certification-budget.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // `fn_record_usage_event` is the customer-facing usage path. A
    // certification ceiling is operational safety and must never appear on
    // an invoice.
    expect(code).not.toMatch(/record_usage_event|usage_event|billing|invoice_line/i);
  });

  it("does not raise, and cannot raise, the operational daily budget", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/server/supplier-invoice-capture/certification-budget.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/scope_budgets|daily_request_cap|budget_overrides/);
  });
});
