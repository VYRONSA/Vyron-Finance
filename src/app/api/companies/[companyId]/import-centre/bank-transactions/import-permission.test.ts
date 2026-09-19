/**
 * Phase 5C — importing bank transactions and POSTING them are two
 * different accounting actions and now need two different permissions.
 *
 *   Banking:Create  upload/import transactions (unchanged)
 *   Banking:Post    let the attached Banking Rules pass post them
 *
 * A user with Create alone imports every row in full; the transactions a
 * rule would have posted are left untouched and reported, so someone who
 * may post them still can. Requiring Banking:Post merely to IMPORT would
 * be wrong — that is the separation these tests pin down.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getCurrentUserEmail: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn(), hasPermission: vi.fn() }));
vi.mock("@/server/services/import-service", () => ({
  importBankStatement: vi.fn(),
  confirmPdfBankStatementImport: vi.fn(),
  ValidationError: class ValidationError extends Error {},
}));

import { POST as importCsv } from "./route";
import { POST as confirmPdf } from "./confirm/route";
import { requireSession, getCurrentUserEmail } from "@/server/auth/require-session";
import { hasPermission, requirePermission } from "@/server/services/permission-service";
import { confirmPdfBankStatementImport, importBankStatement } from "@/server/services/import-service";

const params = { params: Promise.resolve({ companyId: "co_1" }) };

/** The route only ever calls `request.formData()` and checks that "file" is
 * a `File`. Building a real multipart Request here would test undici's
 * FormData/File interop, not the permission separation, so the upload is
 * stubbed at exactly the seam the route uses. */
function csvRequest(): Request {
  const file = new File(["date,amount\n"], "statement.csv", { type: "text/csv" });
  return { formData: async () => ({ get: (key: string) => (key === "file" ? file : null) }) } as unknown as Request;
}

const confirmRequest = () =>
  new Request("http://localhost/api/companies/co_1/import-centre/bank-transactions/confirm", {
    method: "POST",
    body: JSON.stringify({ batchId: "B1", sourceFilename: "s.pdf", transactions: [{}], metadata: {} }),
  });

const CSV_OUTCOME = { batch: {}, exceptions: [], rulesAutoAllocated: 0, rulePass: { notPermitted: 3, notAttempted: 0, stopReason: null } };
const PDF_OUTCOME = { batch: {}, importedCount: 5, duplicateCount: 0, rulesAutoAllocated: 0, rulePass: { notPermitted: 2, notAttempted: 0, stopReason: null }, validation: {}, exceptions: [] };

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getCurrentUserEmail).mockReset().mockResolvedValue("importer@example.test");
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(hasPermission).mockReset().mockResolvedValue(true);
  vi.mocked(importBankStatement).mockReset().mockResolvedValue(CSV_OUTCOME as never);
  vi.mocked(confirmPdfBankStatementImport).mockReset().mockResolvedValue(PDF_OUTCOME as never);
});

describe("POST bank-transactions (CSV import) — create imports, post posts", () => {
  it("Banking:Create alone still imports: the request succeeds", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    const response = await importCsv(csvRequest(), params);
    expect(response.status).toBe(201);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Banking:Create");
    expect(importBankStatement).toHaveBeenCalledTimes(1);
  });

  it("without Banking:Post the import runs with mayPost false", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    await importCsv(csvRequest(), params);
    expect(hasPermission).toHaveBeenCalledWith("co_1", "Banking:Post");
    expect(vi.mocked(importBankStatement).mock.calls[0]![3]).toEqual({ mayPost: false });
  });

  it("with Banking:Post the import may post", async () => {
    vi.mocked(hasPermission).mockResolvedValue(true);
    await importCsv(csvRequest(), params);
    expect(vi.mocked(importBankStatement).mock.calls[0]![3]).toEqual({ mayPost: true });
  });

  it("the response surfaces what was left unposted — never silently dropped", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    const response = await importCsv(csvRequest(), params);
    expect(await response.json()).toMatchObject({ rulePass: { notPermitted: 3, notAttempted: 0, stopReason: null } });
  });

  it("without Banking:Create nothing is imported at all", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) });
    const response = await importCsv(csvRequest(), params);
    expect(response.status).toBe(403);
    expect(importBankStatement).not.toHaveBeenCalled();
  });

  it("an unauthenticated request never reaches a permission check", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as never);
    const response = await importCsv(csvRequest(), params);
    expect(response.status).toBe(401);
    expect(requirePermission).not.toHaveBeenCalled();
    expect(importBankStatement).not.toHaveBeenCalled();
  });
});

describe("POST bank-transactions/confirm (PDF import) — the same separation", () => {
  it("Banking:Create alone still confirms the import", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    const response = await confirmPdf(confirmRequest(), params);
    expect(response.status).toBe(201);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Banking:Create");
  });

  it("the posting capability is passed through, both ways", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    await confirmPdf(confirmRequest(), params);
    expect(vi.mocked(confirmPdfBankStatementImport).mock.calls[0]![3]).toEqual({ mayPost: false });

    vi.mocked(hasPermission).mockResolvedValue(true);
    await confirmPdf(confirmRequest(), params);
    expect(vi.mocked(confirmPdfBankStatementImport).mock.calls[1]![3]).toEqual({ mayPost: true });
  });

  it("the confirm response reports the unposted remainder too", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    const response = await confirmPdf(confirmRequest(), params);
    expect(await response.json()).toMatchObject({ rulePass: { notPermitted: 2 } });
  });

  it("both import routes ask about exactly the company in the path", async () => {
    const otherParams = { params: Promise.resolve({ companyId: "co_2" }) };
    await confirmPdf(confirmRequest(), otherParams);
    expect(requirePermission).toHaveBeenCalledWith("co_2", "Banking:Create");
    expect(hasPermission).toHaveBeenCalledWith("co_2", "Banking:Post");
    expect(vi.mocked(confirmPdfBankStatementImport).mock.calls[0]![0]).toBe("co_2");
  });
});
