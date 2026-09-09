/**
 * Phase 21D — proves `createClient()`'s one new behavior: it returns the
 * active execution-context client when one is active (the webhook
 * path), and otherwise behaves exactly as it always has (the normal
 * session-scoped path — every existing browser/Server-Component/Route-
 * Handler caller in this codebase).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { getAllMock, createServerClientMock } = vi.hoisted(() => ({
  getAllMock: vi.fn().mockReturnValue([]),
  createServerClientMock: vi.fn().mockReturnValue({ __label: "session-scoped-client" }),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ getAll: getAllMock, set: vi.fn() }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: createServerClientMock }));

import { createClient } from "./server";
import { runWithServerExecutionContext } from "./execution-context";
import type { SupabaseClient } from "@supabase/supabase-js";

beforeEach(() => {
  createServerClientMock.mockClear();
});

describe("createClient — normal request (no execution context active)", () => {
  it("uses the existing session-scoped cookie-based client — unchanged behavior", async () => {
    const client = await createClient();
    expect(client).toEqual({ __label: "session-scoped-client" });
    expect(createServerClientMock).toHaveBeenCalledTimes(1);
  });
});

describe("createClient — inside runWithServerExecutionContext (the webhook path)", () => {
  it("returns the admin client instead of constructing a session-scoped one", async () => {
    const adminClient = { __label: "admin-client" } as unknown as SupabaseClient;

    const result = await runWithServerExecutionContext(adminClient, async () => createClient());

    expect(result).toBe(adminClient);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("every nested createClient() call inside the same context also gets the admin client", async () => {
    const adminClient = { __label: "admin-client" } as unknown as SupabaseClient;

    const [first, second] = await runWithServerExecutionContext(adminClient, async () => {
      return [await createClient(), await createClient()];
    });

    expect(first).toBe(adminClient);
    expect(second).toBe(adminClient);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("reverts to the session-scoped client once the context ends", async () => {
    const adminClient = { __label: "admin-client" } as unknown as SupabaseClient;
    await runWithServerExecutionContext(adminClient, async () => createClient());

    const afterContext = await createClient();

    expect(afterContext).toEqual({ __label: "session-scoped-client" });
  });
});
