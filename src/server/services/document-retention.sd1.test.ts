/**
 * @vitest-environment node
 *
 * SD-1 (A) — a captured supplier invoice's original document is accounting
 * evidence. The database refuses to delete it (0112); these tests pin the
 * application half: the refusal is reported clearly, the stored FILE is
 * never removed before the record, and retention purging skips evidence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { op: string; args?: unknown };
const calls: Call[] = [];
let deleteResult: { data: { id: number }[] | null; error: unknown } = { data: [{ id: 5 }], error: null };
let evidence = false;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.delete = () => {
        calls.push({ op: "db.delete" });
        return chain;
      };
      chain.eq = () => chain;
      chain.select = async () => deleteResult;
      return chain;
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          calls.push({ op: "storage.remove", args: paths });
          return { error: null };
        },
      }),
    },
    rpc: async (fn: string, args: unknown) => {
      calls.push({ op: `rpc:${fn}`, args });
      return { data: evidence, error: null };
    },
  }),
}));

beforeEach(() => {
  calls.length = 0;
  deleteResult = { data: [{ id: 5 }], error: null };
  evidence = false;
});

describe("the repository deletes the record before the file", () => {
  it("removes the stored file only after the row is gone", async () => {
    const repo = await import("@/server/repositories/document-repository");
    await repo.deleteDocument("co_1", 5, "co_1/Supplier/0/invoice.pdf");
    expect(calls.map((c) => c.op)).toEqual(["db.delete", "storage.remove"]);
  });

  it("keeps the file when the database refuses the deletion", async () => {
    deleteResult = { data: null, error: { code: "42501", message: "retained as accounting evidence" } };
    const repo = await import("@/server/repositories/document-repository");
    await expect(repo.deleteDocument("co_1", 5, "co_1/Supplier/0/invoice.pdf")).rejects.toMatchObject({ code: "42501" });
    expect(calls.some((c) => c.op === "storage.remove")).toBe(false);
  });

  it("keeps the file when no row was deleted (e.g. not visible to the caller)", async () => {
    deleteResult = { data: [], error: null };
    const repo = await import("@/server/repositories/document-repository");
    await expect(repo.deleteDocument("co_1", 5, "co_1/Supplier/0/invoice.pdf")).rejects.toThrow(/kept/);
    expect(calls.some((c) => c.op === "storage.remove")).toBe(false);
  });
});

describe("the service refuses to delete capture evidence, clearly", () => {
  it("raises RetainedDocumentError and touches nothing", async () => {
    vi.doMock("@/server/repositories/document-repository", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      getDocument: async () => ({ id: 5, storagePath: "co_1/Supplier/0/invoice.pdf" }),
    }));
    evidence = true;
    const service = await import("./document-service");
    await expect(service.deleteDocument("co_1", 5)).rejects.toBeInstanceOf(service.RetainedDocumentError);
    // SD-3C — the check now covers supplier statement originals too (0114).
    expect(calls.map((c) => c.op)).toEqual(["rpc:fn_document_is_audited_original"]);
    vi.doUnmock("@/server/repositories/document-repository");
  });
});
