/**
 * @vitest-environment node
 *
 * SD-3B — the access-audit writer and the server-side original reader.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const adminDownload = vi.fn();
const adminFrom = vi.fn(() => ({ download: adminDownload }));
let adminConfigured = true;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: () => adminConfigured,
  createAdminClient: () => ({ storage: { from: adminFrom } }),
}));

import {
  isAuditedSupplierOriginal,
  readSupplierOriginalBytes,
  recordSupplierDocumentAccess,
} from "./supplier-document-access-repository";

beforeEach(() => {
  vi.clearAllMocks();
  adminConfigured = true;
  rpc.mockResolvedValue({ data: 42, error: null });
});

describe("recordSupplierDocumentAccess", () => {
  it("records a capture view under the caller's session, with no actor argument", async () => {
    await expect(
      recordSupplierDocumentAccess({ companyId: "co_1", documentId: 11, subject: { kind: "capture", captureId: 5 }, action: "view" }),
    ).resolves.toBe(42);
    expect(rpc).toHaveBeenCalledWith("fn_record_supplier_document_access", {
      p_company_id: "co_1",
      p_document_id: 11,
      p_capture_id: 5,
      p_statement_id: null,
      p_action: "view",
    });
  });

  it("statement foundation: a statement subject is sent as p_statement_id (the database refuses it until 0114)", async () => {
    await recordSupplierDocumentAccess({ companyId: "co_1", documentId: 12, subject: { kind: "statement", statementId: 9 }, action: "download" });
    expect(rpc).toHaveBeenCalledWith("fn_record_supplier_document_access", {
      p_company_id: "co_1",
      p_document_id: 12,
      p_capture_id: null,
      p_statement_id: 9,
      p_action: "download",
    });
  });

  it("throws when the database refuses — the viewer then serves nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Purchasing:View is required" } });
    await expect(
      recordSupplierDocumentAccess({ companyId: "co_1", documentId: 11, subject: { kind: "capture", captureId: 5 }, action: "view" }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("throws when no record id comes back, rather than assuming it was written", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(
      recordSupplierDocumentAccess({ companyId: "co_1", documentId: 11, subject: { kind: "capture", captureId: 5 }, action: "view" }),
    ).rejects.toThrow("not written");
  });
});

describe("isAuditedSupplierOriginal", () => {
  it("asks the database", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(isAuditedSupplierOriginal(11)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("fn_document_is_audited_original", { p_document_id: 11 });
  });

  it("an error is an error, not a 'no'", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("down") });
    await expect(isAuditedSupplierOriginal(11)).rejects.toThrow("down");
  });
});

describe("readSupplierOriginalBytes", () => {
  it("reads the stored path from the documents bucket with the server's credentials", async () => {
    adminDownload.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });
    await expect(readSupplierOriginalBytes("co_1/Supplier/0/x.pdf")).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(adminFrom).toHaveBeenCalledWith("documents");
    expect(adminDownload).toHaveBeenCalledWith("co_1/Supplier/0/x.pdf");
  });

  it("refuses to run without a service-role key (nothing is served)", async () => {
    adminConfigured = false;
    await expect(readSupplierOriginalBytes("co_1/Supplier/0/x.pdf")).rejects.toThrow("SUPABASE_SERVICE_ROLE_KEY");
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("propagates a storage error", async () => {
    adminDownload.mockResolvedValue({ data: null, error: new Error("not found") });
    await expect(readSupplierOriginalBytes("co_1/Supplier/0/x.pdf")).rejects.toThrow("not found");
  });
});
