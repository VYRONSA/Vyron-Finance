/**
 * @vitest-environment node
 *
 * SD-3B — the generic signed-URL download route does not hand out supplier
 * originals (their every view and download must be recorded).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const requireSession = vi.fn();
const requirePermission = vi.fn();
const getDocumentOr404 = vi.fn();
const getDownloadUrl = vi.fn();
const isAuditedSupplierOriginal = vi.fn();

vi.mock("@/server/auth/require-session", () => ({ requireSession: () => requireSession() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));
vi.mock("@/server/services/document-lookup", () => ({ getDocumentOr404: (...a: unknown[]) => getDocumentOr404(...a) }));
vi.mock("@/server/services/document-service", () => ({
  getDownloadUrl: (...a: unknown[]) => getDownloadUrl(...a),
  NotFoundError: class NotFoundError extends Error {},
}));
vi.mock("@/server/repositories/supplier-document-access-repository", () => ({
  isAuditedSupplierOriginal: (...a: unknown[]) => isAuditedSupplierOriginal(...a),
}));

const params = { params: Promise.resolve({ companyId: "co_1", documentId: "11" }) };
const req = () => new Request("http://test/api/companies/co_1/documents/11/download");

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ ok: true });
  requirePermission.mockResolvedValue({ ok: true });
  getDocumentOr404.mockResolvedValue({ id: 11, entityType: "Supplier" });
  getDownloadUrl.mockResolvedValue("https://storage.test/signed");
  isAuditedSupplierOriginal.mockResolvedValue(false);
});

describe("the generic document download route", () => {
  it("still issues a signed URL for an ordinary document", async () => {
    const { GET } = await import("./route");
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://storage.test/signed" });
  });

  it("refuses a supplier original and issues no URL — it is opened from Supplier Documents, where access is recorded", async () => {
    isAuditedSupplierOriginal.mockResolvedValue(true);
    const { GET } = await import("./route");
    const res = await GET(req(), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Supplier Documents/);
    expect(getDownloadUrl).not.toHaveBeenCalled();
    expect(isAuditedSupplierOriginal).toHaveBeenCalledWith(11);
  });

  it("checks the permission before revealing whether a document is a supplier original", async () => {
    requirePermission.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) });
    const { GET } = await import("./route");
    expect((await GET(req(), params)).status).toBe(403);
    expect(isAuditedSupplierOriginal).not.toHaveBeenCalled();
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });
});
