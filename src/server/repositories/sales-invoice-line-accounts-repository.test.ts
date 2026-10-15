/**
 * `setMissingLineAccounts` / `clearLineAccounts` — the only writes the
 * line-account repairs make. Proves the update touches `gl_account` alone,
 * only on `sales_invoice_lines`, and only on lines of the named invoice
 * whose account is still empty (or, for the undo, still the one written).
 * The Supabase client is mocked; this never touches a real project.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { table: string; op: string; args: unknown[] }[] = [];
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const op of ["update", "insert", "upsert", "delete", "eq", "in", "is", "select"]) {
    b[op] = (...args: unknown[]) => {
      calls.push({ table, op, args });
      return b;
    };
  }
  b.then = (resolve: (v: unknown) => void) => resolve({ data: [{ id: 1 }, { id: 2 }], error: null });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => builder(table), rpc: vi.fn() }) }));
vi.mock("@/server/auth/require-session", () => ({ getPerformedByLabel: vi.fn() }));

import { clearLineAccounts, setMissingLineAccounts } from "./sales-invoice-repository";

beforeEach(() => {
  calls.length = 0;
});

describe("line-account repository writes", () => {
  it("setMissingLineAccounts writes only gl_account, only to the named invoice's lines that have none", async () => {
    expect(await setMissingLineAccounts(501, [1, 2], "1000")).toEqual([1, 2]);
    expect(new Set(calls.map((c) => c.table))).toEqual(new Set(["sales_invoice_lines"]));
    const writes = calls.filter((c) => ["update", "insert", "upsert", "delete"].includes(c.op));
    expect(writes).toEqual([{ table: "sales_invoice_lines", op: "update", args: [{ gl_account: "1000" }] }]);
    expect(calls).toContainEqual({ table: "sales_invoice_lines", op: "eq", args: ["invoice_id", 501] });
    expect(calls).toContainEqual({ table: "sales_invoice_lines", op: "in", args: ["id", [1, 2]] });
    expect(calls).toContainEqual({ table: "sales_invoice_lines", op: "is", args: ["gl_account", null] });
  });

  it("clearLineAccounts empties only the lines still on the account it wrote", async () => {
    await clearLineAccounts(501, [1, 2], "1000");
    const writes = calls.filter((c) => ["update", "insert", "upsert", "delete"].includes(c.op));
    expect(writes).toEqual([{ table: "sales_invoice_lines", op: "update", args: [{ gl_account: null }] }]);
    expect(calls).toContainEqual({ table: "sales_invoice_lines", op: "eq", args: ["gl_account", "1000"] });
    expect(calls).toContainEqual({ table: "sales_invoice_lines", op: "eq", args: ["invoice_id", 501] });
  });

  it("writes nothing when there are no lines", async () => {
    expect(await setMissingLineAccounts(501, [], "1000")).toEqual([]);
    await clearLineAccounts(501, [], "1000");
    expect(calls).toEqual([]);
  });
});
