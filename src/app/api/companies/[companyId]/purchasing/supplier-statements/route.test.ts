/**
 * @vitest-environment node
 *
 * SD-3C — statement upload: permission first, file kind from the bytes,
 * original retained, and reading deferred until AFTER the response.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requirePermission: vi.fn(),
  uploadDocument: vi.fn(),
  registerUploadedStatement: vi.fn(),
  processStatement: vi.fn(),
  listSupplierStatements: vi.fn(),
  after: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: (fn: () => unknown) => m.after(fn) }));
vi.mock("@/server/auth/require-session", () => ({ requireSession: () => m.requireSession(), getPerformedByLabel: async () => "creator@synthetic.test" }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: (...a: unknown[]) => m.requirePermission(...a) }));
vi.mock("@/server/services/document-service", () => ({
  uploadDocument: (...a: unknown[]) => m.uploadDocument(...a),
  ValidationError: class extends Error {},
  UsageLimitExceededError: class extends Error {},
}));
vi.mock("@/server/services/supplier-statement-service", () => ({
  registerUploadedStatement: (...a: unknown[]) => m.registerUploadedStatement(...a),
  processStatement: (...a: unknown[]) => m.processStatement(...a),
  listSupplierStatements: (...a: unknown[]) => m.listSupplierStatements(...a),
}));

const params = { params: Promise.resolve({ companyId: "co_1" }) };
function upload(bytes: Uint8Array<ArrayBuffer> | string, name: string, declared = "application/pdf") {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type: declared }));
  return new Request("http://test/api/companies/co_1/purchasing/supplier-statements", { method: "POST", body: form });
}
const PDF = "%PDF-1.7\nstatement";

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ ok: true });
  m.requirePermission.mockResolvedValue({ ok: true });
  m.uploadDocument.mockResolvedValue({ id: 70 });
  m.registerUploadedStatement.mockResolvedValue({ statementId: 7, status: "Queued", duplicateOfStatementId: null, message: null });
});

describe("POST supplier statements", () => {
  it("checks Purchasing:Create before reading the upload", async () => {
    m.requirePermission.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const { POST } = await import("./route");
    expect((await POST(upload(PDF, "s.pdf"), params)).status).toBe(403);
    expect(m.requirePermission).toHaveBeenCalledWith("co_1", "Purchasing:Create");
    expect(m.uploadDocument).not.toHaveBeenCalled();
  });

  it("stores a PDF as a Supplier Statement document, registers it, and defers reading to after the response", async () => {
    const { POST } = await import("./route");
    const res = await POST(upload(PDF, "statement.pdf", "text/html"), params);
    expect(res.status).toBe(201);
    expect(m.uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co_1", entityType: "Supplier", category: "Statement", mimeType: "application/pdf", contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
      null,
    );
    expect(m.registerUploadedStatement).toHaveBeenCalledWith("co_1", 70, expect.any(String), "pdf");
    // Not read inside the request:
    expect(m.processStatement).not.toHaveBeenCalled();
    expect(m.after).toHaveBeenCalledTimes(1);
    await m.after.mock.calls[0][0]();
    expect(m.processStatement).toHaveBeenCalledWith("co_1", 7, "creator@synthetic.test");
  });

  it("a duplicate is not processed at all", async () => {
    m.registerUploadedStatement.mockResolvedValue({ statementId: 8, status: "Duplicate", duplicateOfStatementId: 7, message: "dup" });
    const { POST } = await import("./route");
    expect((await POST(upload(PDF, "s.pdf"), params)).status).toBe(201);
    expect(m.after).not.toHaveBeenCalled();
  });

  it("the kind comes from the BYTES: HTML named .pdf is refused before anything is stored", async () => {
    const { POST } = await import("./route");
    const res = await POST(upload("<html><script>alert(1)</script></html>", "statement.pdf"), params);
    expect(res.status).toBe(415);
    expect(m.uploadDocument).not.toHaveBeenCalled();
  });

  it("accepts CSV as a secondary format", async () => {
    const { POST } = await import("./route");
    expect((await POST(upload("Date;Ref;Debit\n", "statement.csv", "application/octet-stream"), params)).status).toBe(201);
    expect(m.registerUploadedStatement).toHaveBeenCalledWith("co_1", 70, expect.any(String), "csv");
  });

  it("refuses files over 25 MB and empty files", async () => {
    const { POST } = await import("./route");
    expect((await POST(upload(new Uint8Array(25 * 1024 * 1024 + 1), "big.pdf"), params)).status).toBe(413);
    expect((await POST(upload("", "empty.pdf"), params)).status).toBe(400);
  });
});

describe("GET supplier statements", () => {
  it("needs Purchasing:View", async () => {
    m.requirePermission.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const { GET } = await import("./route");
    expect((await GET(new Request("http://test/x"), params)).status).toBe(403);
    expect(m.listSupplierStatements).not.toHaveBeenCalled();
  });
});
