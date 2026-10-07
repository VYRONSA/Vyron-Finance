/**
 * @vitest-environment node
 *
 * SD-2 — the original-document route that the inline viewer uses.
 * SD-3B — every view and download is recorded BEFORE the file is returned,
 * and nothing is returned when it cannot be recorded.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.fn();
const requirePermission = vi.fn();
const getCapture = vi.fn();
const getDocument = vi.fn();
const readSupplierOriginalBytes = vi.fn();
const recordSupplierDocumentAccess = vi.fn();
const order: string[] = [];

vi.mock("@/server/auth/require-session", () => ({ requireSession: () => requireSession() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));
vi.mock("@/server/services/supplier-invoice-capture-service", () => ({ getCapture: (...a: unknown[]) => getCapture(...a) }));
vi.mock("@/server/repositories/document-repository", () => ({ getDocument: (...a: unknown[]) => getDocument(...a) }));
vi.mock("@/server/repositories/supplier-document-access-repository", () => ({
  readSupplierOriginalBytes: (...a: unknown[]) => readSupplierOriginalBytes(...a),
  recordSupplierDocumentAccess: (...a: unknown[]) => recordSupplierDocumentAccess(...a),
}));

const params = { params: Promise.resolve({ companyId: "co_1", captureId: "5" }) };
const req = (q = "") => new Request(`http://test/api/companies/co_1/purchasing/invoice-capture/5/original${q}`);
const bytes = (s: string) => new TextEncoder().encode(s);
const SECRET_PDF = "%PDF-1.7 confidential supplier original";

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  requireSession.mockResolvedValue({ ok: true });
  requirePermission.mockResolvedValue({ ok: true });
  getCapture.mockResolvedValue({ id: 5, document_id: 11 });
  getDocument.mockResolvedValue({ id: 11, filename: "invoice.pdf", storagePath: "co_1/Supplier/0/invoice.pdf", mimeType: "text/html" });
  readSupplierOriginalBytes.mockImplementation(async () => {
    order.push("read");
    return bytes(SECRET_PDF);
  });
  recordSupplierDocumentAccess.mockImplementation(async () => {
    order.push("audit");
    return 1;
  });
});

describe("the original-document route", () => {
  it("needs a session", async () => {
    requireSession.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const { GET } = await import("./route");
    expect((await GET(req(), params)).status).toBe(401);
    expect(getCapture).not.toHaveBeenCalled();
    expect(recordSupplierDocumentAccess).not.toHaveBeenCalled();
  });

  it("checks Purchasing:View for the company in the PATH before looking anything up", async () => {
    requirePermission.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const { GET } = await import("./route");
    expect((await GET(req(), params)).status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Purchasing:View");
    expect(getCapture).not.toHaveBeenCalled();
    expect(readSupplierOriginalBytes).not.toHaveBeenCalled();
    expect(recordSupplierDocumentAccess).not.toHaveBeenCalled();
  });

  it("the same refusal for a download", async () => {
    requirePermission.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const { GET } = await import("./route");
    expect((await GET(req("?download=1"), params)).status).toBe(403);
    expect(readSupplierOriginalBytes).not.toHaveBeenCalled();
    expect(recordSupplierDocumentAccess).not.toHaveBeenCalled();
  });

  it("an unknown capture — including another company's, which the caller's session cannot see — is 404, reads and records nothing", async () => {
    getCapture.mockResolvedValue(null);
    const { GET } = await import("./route");
    expect((await GET(req(), params)).status).toBe(404);
    expect(getCapture).toHaveBeenCalledWith("co_1", 5);
    expect(readSupplierOriginalBytes).not.toHaveBeenCalled();
    expect(recordSupplierDocumentAccess).not.toHaveBeenCalled();
  });

  it("records a VIEW, for the capture and document it looked up, BEFORE serving the PDF inline", async () => {
    const { GET } = await import("./route");
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    expect(recordSupplierDocumentAccess).toHaveBeenCalledTimes(1);
    expect(recordSupplierDocumentAccess).toHaveBeenCalledWith({
      companyId: "co_1",
      documentId: 11,
      subject: { kind: "capture", captureId: 5 },
      action: "view",
    });
    expect(order).toEqual(["read", "audit"]);
    expect(readSupplierOriginalBytes).toHaveBeenCalledWith("co_1/Supplier/0/invoice.pdf");
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline; filename="invoice.pdf"/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
    expect(await res.text()).toBe(SECRET_PDF);
  });

  it("records a DOWNLOAD for ?download=1, then serves the same original as an attachment (any type)", async () => {
    readSupplierOriginalBytes.mockResolvedValue(bytes("not a pdf"));
    const { GET } = await import("./route");
    const res = await GET(req("?download=1"), params);
    expect(res.status).toBe(200);
    expect(recordSupplierDocumentAccess).toHaveBeenCalledWith(expect.objectContaining({ action: "download" }));
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("FAILS CLOSED: when the view cannot be recorded, no byte of the original is returned", async () => {
    recordSupplierDocumentAccess.mockRejectedValue(Object.assign(new Error("db down"), { code: "08006" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(req(), params);
    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.text();
    expect(body).not.toContain("PDF");
    expect(body).not.toContain("confidential");
    expect(body).toMatch(/was not shown because this access could not be recorded/);
    expect(body).not.toContain("db down");
    error.mockRestore();
  });

  it("FAILS CLOSED for a download too", async () => {
    recordSupplierDocumentAccess.mockRejectedValue(new Error("refused"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(req("?download=1"), params);
    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(await res.text()).not.toContain("confidential");
    error.mockRestore();
  });

  it("a refusal by the database (e.g. permission revoked between the check and the record) is also fail-closed", async () => {
    recordSupplierDocumentAccess.mockRejectedValue(Object.assign(new Error("Purchasing:View is required"), { code: "42501" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(req(), params);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("confidential");
    error.mockRestore();
  });

  it("refuses to show a file that is not a PDF, JPEG or PNG — even one stored as text/html — and records nothing, since nothing was shown", async () => {
    readSupplierOriginalBytes.mockResolvedValue(bytes("<html><script>alert(1)</script></html>"));
    const { GET } = await import("./route");
    const res = await GET(req(), params);
    expect(res.status).toBe(415);
    expect(res.headers.get("Content-Type")).not.toMatch(/html/);
    expect(recordSupplierDocumentAccess).not.toHaveBeenCalled();
  });

  it("images get a locked-down policy", async () => {
    readSupplierOriginalBytes.mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]));
    const { GET } = await import("./route");
    const res = await GET(req(), params);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("a storage failure serves nothing and records nothing", async () => {
    readSupplierOriginalBytes.mockRejectedValue(new Error("storage unavailable"));
    const { GET } = await import("./route");
    await expect(GET(req(), params)).rejects.toThrow("storage unavailable");
    expect(recordSupplierDocumentAccess).not.toHaveBeenCalled();
  });

  it("never passes an actor: the route has none to give, the database takes it from the session", async () => {
    const { GET } = await import("./route");
    await GET(new Request("http://test/api/companies/co_1/purchasing/invoice-capture/5/original?actor=someone-else&user=x"), params);
    const arg = recordSupplierDocumentAccess.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(arg).sort()).toEqual(["action", "companyId", "documentId", "subject"]);
  });
});
