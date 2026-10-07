/**
 * @vitest-environment node
 *
 * SD-3C — statement originals go through the SD-3B audited viewer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requirePermission: vi.fn(),
  getStatement: vi.fn(),
  getDocument: vi.fn(),
  serveSupplierOriginal: vi.fn(),
}));

vi.mock("@/server/auth/require-session", () => ({ requireSession: () => m.requireSession() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: (...a: unknown[]) => m.requirePermission(...a) }));
vi.mock("@/server/repositories/supplier-statement-repository", () => ({ getStatement: (...a: unknown[]) => m.getStatement(...a) }));
vi.mock("@/server/repositories/document-repository", () => ({ getDocument: (...a: unknown[]) => m.getDocument(...a) }));
vi.mock("@/server/documents/supplier-original-response", () => ({ serveSupplierOriginal: (...a: unknown[]) => m.serveSupplierOriginal(...a) }));

const params = { params: Promise.resolve({ companyId: "co_1", statementId: "7" }) };
const req = new Request("http://test/api/companies/co_1/purchasing/supplier-statements/7/original?download=1");

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ ok: true });
  m.requirePermission.mockResolvedValue({ ok: true });
  m.getStatement.mockResolvedValue({ id: 7, document_id: 70 });
  m.getDocument.mockResolvedValue({ id: 70, filename: "statement.pdf", storagePath: "co_1/Supplier/0/statement.pdf" });
  m.serveSupplierOriginal.mockResolvedValue(new Response("ok"));
});

describe("the statement original route", () => {
  it("checks Purchasing:View before looking anything up", async () => {
    m.requirePermission.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const { GET } = await import("./route");
    expect((await GET(req, params)).status).toBe(403);
    expect(m.getStatement).not.toHaveBeenCalled();
    expect(m.serveSupplierOriginal).not.toHaveBeenCalled();
  });

  it("an unknown (or other company's) statement is 404 and serves nothing", async () => {
    m.getStatement.mockResolvedValue(null);
    const { GET } = await import("./route");
    expect((await GET(req, params)).status).toBe(404);
    expect(m.serveSupplierOriginal).not.toHaveBeenCalled();
  });

  it("serves through the shared audited viewer, with the STATEMENT as the audited subject", async () => {
    const { GET } = await import("./route");
    await GET(req, params);
    expect(m.serveSupplierOriginal).toHaveBeenCalledWith({
      request: req,
      companyId: "co_1",
      document: { id: 70, filename: "statement.pdf", storagePath: "co_1/Supplier/0/statement.pdf" },
      subject: { kind: "statement", statementId: 7 },
    });
  });
});
