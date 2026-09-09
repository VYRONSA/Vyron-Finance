import { describe, expect, it } from "vitest";
import { runWithServerExecutionContext, getServerExecutionContextClient } from "./execution-context";
import type { SupabaseClient } from "@supabase/supabase-js";

function fakeClient(label: string): SupabaseClient {
  return { __label: label } as unknown as SupabaseClient;
}

describe("getServerExecutionContextClient — outside any context", () => {
  it("returns undefined when no context is active (the state for every normal request)", () => {
    expect(getServerExecutionContextClient()).toBeUndefined();
  });
});

describe("runWithServerExecutionContext", () => {
  it("makes the given client available inside the callback", async () => {
    const client = fakeClient("admin-a");
    await runWithServerExecutionContext(client, async () => {
      expect(getServerExecutionContextClient()).toBe(client);
    });
  });

  it("makes the client available to nested async calls within the same context", async () => {
    const client = fakeClient("admin-nested");
    async function deeplyNested() {
      await Promise.resolve();
      return getServerExecutionContextClient();
    }
    const result = await runWithServerExecutionContext(client, () => deeplyNested());
    expect(result).toBe(client);
  });

  it("is not active before or after the wrapped call (never leaks outside its own scope)", async () => {
    expect(getServerExecutionContextClient()).toBeUndefined();
    await runWithServerExecutionContext(fakeClient("temporary"), async () => {
      expect(getServerExecutionContextClient()).toBeDefined();
    });
    expect(getServerExecutionContextClient()).toBeUndefined();
  });

  it("does not leak into a concurrent, unrelated async call outside the wrapped scope", async () => {
    const clientA = fakeClient("company-a-admin");

    const concurrentOutsideCheck = new Promise<SupabaseClient | undefined>((resolve) => {
      setTimeout(() => resolve(getServerExecutionContextClient()), 5);
    });

    const [, outsideResult] = await Promise.all([
      runWithServerExecutionContext(clientA, async () => {
        await new Promise((r) => setTimeout(r, 10));
      }),
      concurrentOutsideCheck,
    ]);

    expect(outsideResult).toBeUndefined();
  });

  it("two concurrent, independently-scoped contexts never see each other's client", async () => {
    const clientA = fakeClient("company-a-admin");
    const clientB = fakeClient("company-b-admin");

    const [resultA, resultB] = await Promise.all([
      runWithServerExecutionContext(clientA, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getServerExecutionContextClient();
      }),
      runWithServerExecutionContext(clientB, async () => {
        await new Promise((r) => setTimeout(r, 1));
        return getServerExecutionContextClient();
      }),
    ]);

    expect(resultA).toBe(clientA);
    expect(resultB).toBe(clientB);
  });

  it("propagates the callback's return value", async () => {
    const result = await runWithServerExecutionContext(fakeClient("x"), async () => 42);
    expect(result).toBe(42);
  });

  it("propagates the callback's thrown error rather than swallowing it", async () => {
    await expect(
      runWithServerExecutionContext(fakeClient("x"), async () => {
        throw new Error("pipeline failure");
      }),
    ).rejects.toThrow("pipeline failure");
  });
});
