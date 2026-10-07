/**
 * @vitest-environment node
 *
 * SD-2 — the original-document route that the inline viewer uses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.fn();
const requirePermission = vi.fn();
const getCapture = vi.fn();
const getDocument = vi.fn();
const downloadDocumentFile = vi.fn();

vi.mock("@/server/auth/require-session", () => ({ requireSession: () => requireSession() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));
vi.mock("@/server/services/supplier-invoice-capture-service", () => ({ getCapture: (...a: unknown[]) => getCapture(...a) }));
vi.mock("@/server/repositories/document-repository", () => ({
  getDocument: (...a: unknown[]) => getDocument(...a),
  downloadDocumentFile: (...a: unknown[]) => downloadDocumentFile(...a),
}));

const params = { params: Promise.resolve({ companyId: "co_1", captureId: "5" }) };
const req = (q = "") => new Request(`http://test/api/companies/co_1/purchasing/invoice-capture/5/original${q}`);
const bytes = (s: string) => new TextEncoder().encode(s).buffer;

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ ok: true });
  requirePermission.mockResolvedValue({ ok: true });
  getCapture.mockResolvedValue({ id: 5, document_id: 11 });
  getDocument.mockResolvedValue({ id: 11, filename: "invoice.pdf", storagePath: "co_1/Supplier/0/invoice.pdf", mimeType: "text/html" });
  downloadDocumentFile.mockResolvedValue(bytes("%PDF-1.7 fixture"));
});

describe("the original-document route", () => {
  it("needs a session", async () => {
    requireSession.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const { GET } = await import("./route");
    expect((await GET(req(), params)).status).toBe(401);
    expect(getCapture).not.toHaveBeenCalled();
  });

  it("checks Purchasing:View for the company in the PATH before looking anything up", async () => {
    requirePermission.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const { GET } = await import("./route");
    expect((await GET(req(), params)).status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Purchasing:View");
    expect(getCapture).not.toHaveBeenCalled();
    expect(downloadDocumentFile).not.toHaveBeenCalled();
  });

  it("an unknown capture is 404 and reads no file", async () => {
    getCapture.mockResolvedValue(null);
    const { GET } = await import("./route");
    expect((await GET(req(), params)).status).toBe(404);
    expect(downloadDocumentFile).not.toHaveBeenCalled();
  });

  it("serves a PDF inline, typed from its bytes — never from the stored MIME type", async () => {
    const { GET } = await import("./route");
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline; filename="invoice.pdf"/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
  });

  it("refuses to show a file that is not a PDF, JPEG or PNG — even one stored as text/html", async () => {
    downloadDocumentFile.mockResolvedValue(bytes("<html><script>alert(1)</script></html>"));
    const { GET } = await import("./route");
    const res = await GET(req(), params);
    expect(res.status).toBe(415);
    expect(res.headers.get("Content-Type")).not.toMatch(/html/);
  });

  it("images get a locked-down policy", async () => {
    downloadDocumentFile.mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]).buffer);
    const { GET } = await import("./route");
    const res = await GET(req(), params);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("?download=1 serves the same original as an attachment (and any type, as a plain download)", async () => {
    downloadDocumentFile.mockResolvedValue(bytes("not a pdf"));
    const { GET } = await import("./route");
    const res = await GET(req("?download=1"), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
