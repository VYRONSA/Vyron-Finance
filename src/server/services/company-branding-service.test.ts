/**
 * Phase 20B — mandatory security/behaviour tests for the Company
 * Branding service. Every repository call is mocked (this never touches
 * a real Supabase project); tenant isolation is proven the same way
 * bank-sync-service.test.ts already proves it — every repository call a
 * company's own operation makes is asserted to carry ONLY that
 * company's id, and a company's operation never reads or writes using
 * another company's id. Real cross-tenant enforcement is Postgres RLS
 * (0076_company_branding.sql), verified directly against the live
 * project separately — this file proves the application layer never
 * even attempts a cross-tenant call.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/company-branding-repository", () => ({
  getCompanyBranding: vi.fn(),
  uploadLogoFile: vi.fn(),
  deleteLogoFile: vi.fn(),
  getSignedLogoUrl: vi.fn(),
  insertCompanyBranding: vi.fn(),
  updateLogoReference: vi.fn(),
  clearLogoReference: vi.fn(),
}));

import { getCompanyBrandingAssets, uploadLogo, removeLogo, ValidationError, NotFoundError } from "./company-branding-service";
import * as repo from "@/server/repositories/company-branding-repository";
import type { CompanyBrandingRecord } from "@/server/company-branding/types";

function brandingRecord(overrides: Partial<CompanyBrandingRecord> = {}): CompanyBrandingRecord {
  return {
    id: 1,
    companyId: "company-a",
    logoStoragePath: "company-a/logo/20260812100000-logo.png",
    logoFilename: "logo.png",
    logoMimeType: "image/png",
    logoSizeBytes: 2048,
    uploadedBy: "user@example.com",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function pngFile(sizeBytes = 2048): Blob {
  return { size: sizeBytes, type: "image/png" } as unknown as Blob;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCompanyBrandingAssets — empty and populated states", () => {
  it("reports the empty state for a company with no branding row at all (empty company branding behaves correctly)", async () => {
    vi.mocked(repo.getCompanyBranding).mockResolvedValue(null);

    const assets = await getCompanyBrandingAssets("company-a");

    expect(assets).toEqual({ hasLogo: false, logoUrl: null, logoFilename: null, logoMimeType: null, logoSizeBytes: null, updatedAt: null });
    expect(repo.getSignedLogoUrl).not.toHaveBeenCalled();
  });

  it("reports the empty state for a company with a row but a cleared logo reference (post-remove empty state)", async () => {
    vi.mocked(repo.getCompanyBranding).mockResolvedValue(brandingRecord({ logoStoragePath: null, logoFilename: null, logoMimeType: null, logoSizeBytes: null }));

    const assets = await getCompanyBrandingAssets("company-a");

    expect(assets.hasLogo).toBe(false);
    expect(assets.logoUrl).toBeNull();
  });

  it("returns a signed URL and metadata when a logo exists", async () => {
    vi.mocked(repo.getCompanyBranding).mockResolvedValue(brandingRecord());
    vi.mocked(repo.getSignedLogoUrl).mockResolvedValue("https://storage.example/signed-url");

    const assets = await getCompanyBrandingAssets("company-a");

    expect(assets).toEqual({
      hasLogo: true,
      logoUrl: "https://storage.example/signed-url",
      logoFilename: "logo.png",
      logoMimeType: "image/png",
      logoSizeBytes: 2048,
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(repo.getSignedLogoUrl).toHaveBeenCalledWith("company-a/logo/20260812100000-logo.png");
  });
});

describe("uploadLogo — tenant isolation", () => {
  it("Company A's upload only ever reads/writes Company A's own branding row (Company A can access Company A branding)", async () => {
    vi.mocked(repo.getCompanyBranding).mockResolvedValue(null);
    vi.mocked(repo.insertCompanyBranding).mockResolvedValue(brandingRecord({ companyId: "company-a" }));
    vi.mocked(repo.getSignedLogoUrl).mockResolvedValue("url");

    await uploadLogo({ companyId: "company-a", filename: "logo.png", mimeType: "image/png", file: pngFile(), uploadedBy: "a@example.com" });

    expect(repo.getCompanyBranding).toHaveBeenCalledWith("company-a");
    expect(repo.getCompanyBranding).not.toHaveBeenCalledWith("company-b");
    expect(repo.insertCompanyBranding).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-a" }));
    expect(repo.uploadLogoFile).toHaveBeenCalledWith(expect.stringMatching(/^company-a\/logo\//), expect.anything(), "image/png");
  });

  it("Company B's upload only ever reads/writes Company B's own branding row (Company B can access Company B branding)", async () => {
    vi.mocked(repo.getCompanyBranding).mockResolvedValue(null);
    vi.mocked(repo.insertCompanyBranding).mockResolvedValue(brandingRecord({ companyId: "company-b" }));
    vi.mocked(repo.getSignedLogoUrl).mockResolvedValue("url");

    await uploadLogo({ companyId: "company-b", filename: "logo.png", mimeType: "image/png", file: pngFile(), uploadedBy: "b@example.com" });

    expect(repo.getCompanyBranding).toHaveBeenCalledWith("company-b");
    expect(repo.getCompanyBranding).not.toHaveBeenCalledWith("company-a");
    expect(repo.insertCompanyBranding).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-b" }));
    expect(repo.uploadLogoFile).toHaveBeenCalledWith(expect.stringMatching(/^company-b\/logo\//), expect.anything(), "image/png");
  });

  it("never lets Company A's upload replace Company B's logo — a caller can only ever act on the companyId it passes in (Company A cannot replace Company B's logo)", async () => {
    // Even though Company B already has a logo, uploadLogo("company-a", ...)
    // has no way to reach it: getCompanyBranding is only ever called with
    // "company-a", so Company B's existing row/path never enters this call.
    vi.mocked(repo.getCompanyBranding).mockResolvedValue(null);
    vi.mocked(repo.insertCompanyBranding).mockResolvedValue(brandingRecord({ companyId: "company-a" }));
    vi.mocked(repo.getSignedLogoUrl).mockResolvedValue("url");

    await uploadLogo({ companyId: "company-a", filename: "logo.png", mimeType: "image/png", file: pngFile(), uploadedBy: "a@example.com" });

    for (const call of vi.mocked(repo.getCompanyBranding).mock.calls) expect(call[0]).toBe("company-a");
    for (const call of vi.mocked(repo.updateLogoReference).mock.calls) expect(call[0]).toBe("company-a");
    expect(repo.deleteLogoFile).not.toHaveBeenCalled();
  });
});

describe("uploadLogo — validation (malformed/invalid upload)", () => {
  it("rejects an unsupported MIME type before touching storage or the database", async () => {
    await expect(
      uploadLogo({ companyId: "company-a", filename: "logo.svg", mimeType: "image/svg+xml", file: pngFile(), uploadedBy: "a@example.com" }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(repo.uploadLogoFile).not.toHaveBeenCalled();
    expect(repo.insertCompanyBranding).not.toHaveBeenCalled();
  });

  it("rejects an empty file", async () => {
    await expect(
      uploadLogo({ companyId: "company-a", filename: "logo.png", mimeType: "image/png", file: pngFile(0), uploadedBy: "a@example.com" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.uploadLogoFile).not.toHaveBeenCalled();
  });

  it("rejects a blank filename", async () => {
    await expect(
      uploadLogo({ companyId: "company-a", filename: "   ", mimeType: "image/png", file: pngFile(), uploadedBy: "a@example.com" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.uploadLogoFile).not.toHaveBeenCalled();
  });
});

describe("uploadLogo — replace ordering and failure safety", () => {
  it("uploads the new file, then updates the DB reference, then ONLY THEN removes the old asset (correct ordering)", async () => {
    const existing = brandingRecord({ logoStoragePath: "company-a/logo/OLD.png" });
    vi.mocked(repo.getCompanyBranding).mockResolvedValue(existing);
    vi.mocked(repo.updateLogoReference).mockResolvedValue(brandingRecord({ logoStoragePath: "company-a/logo/NEW.png" }));
    vi.mocked(repo.getSignedLogoUrl).mockResolvedValue("url");

    const calls: string[] = [];
    vi.mocked(repo.uploadLogoFile).mockImplementation(async () => { calls.push("upload"); });
    vi.mocked(repo.updateLogoReference).mockImplementation(async () => { calls.push("update"); return brandingRecord({ logoStoragePath: "company-a/logo/NEW.png" }); });
    vi.mocked(repo.deleteLogoFile).mockImplementation(async () => { calls.push("delete-old"); });

    await uploadLogo({ companyId: "company-a", filename: "logo.png", mimeType: "image/png", file: pngFile(), uploadedBy: "a@example.com" });

    expect(calls).toEqual(["upload", "update", "delete-old"]);
    expect(repo.deleteLogoFile).toHaveBeenCalledWith("company-a/logo/OLD.png");
  });

  it("leaves an existing logo fully intact when the new upload fails (upload failure leaves an existing logo intact)", async () => {
    vi.mocked(repo.getCompanyBranding).mockResolvedValue(brandingRecord({ logoStoragePath: "company-a/logo/OLD.png" }));
    vi.mocked(repo.uploadLogoFile).mockRejectedValue(new Error("storage unavailable"));

    await expect(
      uploadLogo({ companyId: "company-a", filename: "logo.png", mimeType: "image/png", file: pngFile(), uploadedBy: "a@example.com" }),
    ).rejects.toThrow("storage unavailable");

    expect(repo.updateLogoReference).not.toHaveBeenCalled();
    expect(repo.insertCompanyBranding).not.toHaveBeenCalled();
    expect(repo.deleteLogoFile).not.toHaveBeenCalled();
  });

  it("does not destroy the previous logo when the DB update fails after the new file already uploaded (replace failure does not destroy the previous logo)", async () => {
    vi.mocked(repo.getCompanyBranding).mockResolvedValue(brandingRecord({ logoStoragePath: "company-a/logo/OLD.png" }));
    vi.mocked(repo.uploadLogoFile).mockResolvedValue(undefined);
    vi.mocked(repo.updateLogoReference).mockRejectedValue(new Error("db unreachable"));

    await expect(
      uploadLogo({ companyId: "company-a", filename: "logo.png", mimeType: "image/png", file: pngFile(), uploadedBy: "a@example.com" }),
    ).rejects.toThrow("db unreachable");

    // The old asset's storage path was never touched — the DB row still
    // points at it (only a harmless new orphan file exists in storage).
    expect(repo.deleteLogoFile).not.toHaveBeenCalled();
  });

  it("never lets a failure removing the superseded file surface as an error — the new logo is already live and correct", async () => {
    vi.mocked(repo.getCompanyBranding).mockResolvedValue(brandingRecord({ logoStoragePath: "company-a/logo/OLD.png" }));
    vi.mocked(repo.updateLogoReference).mockResolvedValue(brandingRecord({ logoStoragePath: "company-a/logo/NEW.png" }));
    vi.mocked(repo.getSignedLogoUrl).mockResolvedValue("url");
    vi.mocked(repo.deleteLogoFile).mockRejectedValue(new Error("cleanup failed"));

    const assets = await uploadLogo({ companyId: "company-a", filename: "logo.png", mimeType: "image/png", file: pngFile(), uploadedBy: "a@example.com" });

    expect(assets.hasLogo).toBe(true);
  });
});

describe("removeLogo — tenant isolation and correctness", () => {
  it("removes the stored asset, then clears the DB reference, in that order (remove works correctly)", async () => {
    vi.mocked(repo.getCompanyBranding).mockResolvedValue(brandingRecord({ companyId: "company-a", logoStoragePath: "company-a/logo/OLD.png" }));

    const calls: string[] = [];
    vi.mocked(repo.deleteLogoFile).mockImplementation(async () => { calls.push("delete-storage"); });
    vi.mocked(repo.clearLogoReference).mockImplementation(async () => { calls.push("clear-db"); });

    await removeLogo("company-a");

    expect(calls).toEqual(["delete-storage", "clear-db"]);
    expect(repo.deleteLogoFile).toHaveBeenCalledWith("company-a/logo/OLD.png");
    expect(repo.clearLogoReference).toHaveBeenCalledWith("company-a");
  });

  it("Company A's remove call never references Company B's id anywhere (Company A cannot delete Company B's logo)", async () => {
    vi.mocked(repo.getCompanyBranding).mockResolvedValue(brandingRecord({ companyId: "company-a", logoStoragePath: "company-a/logo/OLD.png" }));

    await removeLogo("company-a");

    expect(repo.getCompanyBranding).toHaveBeenCalledWith("company-a");
    expect(repo.getCompanyBranding).not.toHaveBeenCalledWith("company-b");
    expect(repo.deleteLogoFile).toHaveBeenCalledWith(expect.stringMatching(/^company-a\//));
  });

  it("throws NotFoundError rather than silently succeeding when the company has no logo to remove", async () => {
    vi.mocked(repo.getCompanyBranding).mockResolvedValue(null);

    await expect(removeLogo("company-a")).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.deleteLogoFile).not.toHaveBeenCalled();
    expect(repo.clearLogoReference).not.toHaveBeenCalled();
  });
});
