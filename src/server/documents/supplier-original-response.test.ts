/**
 * @vitest-environment node
 *
 * SD-3B — the shared audited viewer, as the supplier-statement viewer
 * (SD-3C) will use it. The capture route's own tests cover the capture path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readSupplierOriginalBytes = vi.fn();
const recordSupplierDocumentAccess = vi.fn();
vi.mock("@/server/repositories/supplier-document-access-repository", () => ({
  readSupplierOriginalBytes: (...a: unknown[]) => readSupplierOriginalBytes(...a),
  recordSupplierDocumentAccess: (...a: unknown[]) => recordSupplierDocumentAccess(...a),
}));

import { AUDIT_UNAVAILABLE_MESSAGE, serveSupplierOriginal } from "./supplier-original-response";

const document = { id: 21, filename: "statement.pdf", storagePath: "co_1/Supplier/0/statement.pdf" };
const request = (q = "") => new Request(`http://test/original${q}`);

beforeEach(() => {
  vi.clearAllMocks();
  readSupplierOriginalBytes.mockResolvedValue(new TextEncoder().encode("%PDF-1.4 statement"));
  recordSupplierDocumentAccess.mockResolvedValue(7);
});

describe("serveSupplierOriginal — statement foundation", () => {
  it("records a statement view with the statement as the subject, then serves it", async () => {
    const res = await serveSupplierOriginal({ request: request(), companyId: "co_1", document, subject: { kind: "statement", statementId: 3 } });
    expect(recordSupplierDocumentAccess).toHaveBeenCalledWith({
      companyId: "co_1",
      documentId: 21,
      subject: { kind: "statement", statementId: 3 },
      action: "view",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("until 0114 the database refuses statement records, so a statement original is NOT served", async () => {
    recordSupplierDocumentAccess.mockRejectedValue(Object.assign(new Error("supplier statement originals are not available yet"), { code: "42501" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await serveSupplierOriginal({ request: request("?download=1"), companyId: "co_1", document, subject: { kind: "statement", statementId: 3 } });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(AUDIT_UNAVAILABLE_MESSAGE);
    expect(error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: "42501" }));
    error.mockRestore();
  });

  it("logs ids and the error code only — never the file or the database's message", async () => {
    recordSupplierDocumentAccess.mockRejectedValue(Object.assign(new Error("document 21 is not the original of capture 9"), { code: "42501" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await serveSupplierOriginal({ request: request(), companyId: "co_1", document, subject: { kind: "capture", captureId: 9 } });
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain("is not the original");
    expect(logged).not.toContain("%PDF");
    error.mockRestore();
  });
});
