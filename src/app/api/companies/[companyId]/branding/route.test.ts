/**
 * Phase 20B — mandatory tenant-isolation security tests, mirroring
 * bank-connections/route.test.ts's pattern exactly. Every dependency is
 * mocked; this never touches a real Supabase project.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/company-branding-service", async () => {
  const actual = await vi.importActual<typeof import("@/server/services/company-branding-service")>("@/server/services/company-branding-service");
  return { ...actual, getCompanyBrandingAssets: vi.fn(), uploadLogo: vi.fn(), removeLogo: vi.fn() };
});

import { GET, POST, DELETE } from "./route";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getCompanyBrandingAssets, uploadLogo, removeLogo, ValidationError, NotFoundError } from "@/server/services/company-branding-service";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

// Built directly (not round-tripped through a real multipart Request
// body) — jsdom's test environment re-parses a multipart body via
// undici's own internal Blob/File classes, which fail `instanceof Blob`
// against the jsdom-provided global `Blob` the route handler checks
// against, even though production (a real browser, no jsdom involved)
// never hits this mismatch. Calling `.formData()` directly like this
// exercises the exact same route.ts code path without that test-only
// cross-realm artifact.
function postRequest(file: Blob | null): Request {
  const formData = new FormData();
  if (file) formData.append("file", file, "logo.png");
  return { formData: async () => formData } as unknown as Request;
}

const EMPTY_ASSETS = { hasLogo: false, logoUrl: null, logoFilename: null, logoMimeType: null, logoSizeBytes: null, updatedAt: null };

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("user@example.com");
  vi.mocked(requirePermission).mockReset();
  vi.mocked(getCompanyBrandingAssets).mockReset();
  vi.mocked(uploadLogo).mockReset();
  vi.mocked(removeLogo).mockReset();
});

describe("GET /api/companies/[companyId]/branding — tenant isolation", () => {
  it("Company A's request only ever fetches Company A's branding (Company A can access Company A branding)", async () => {
    vi.mocked(getCompanyBrandingAssets).mockResolvedValue(EMPTY_ASSETS);

    await GET(new Request("http://localhost/api/companies/company-a/branding"), params("company-a"));

    expect(getCompanyBrandingAssets).toHaveBeenCalledWith("company-a");
    expect(getCompanyBrandingAssets).not.toHaveBeenCalledWith("company-b");
  });

  it("Company B's request only ever fetches Company B's branding (Company B can access Company B branding)", async () => {
    vi.mocked(getCompanyBrandingAssets).mockResolvedValue(EMPTY_ASSETS);

    await GET(new Request("http://localhost/api/companies/company-b/branding"), params("company-b"));

    expect(getCompanyBrandingAssets).toHaveBeenCalledWith("company-b");
    expect(getCompanyBrandingAssets).not.toHaveBeenCalledWith("company-a");
  });

  it("returns 401 when there is no session (regression)", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await GET(new Request("http://localhost/api/companies/co_1/branding"), params("co_1"));
    expect(response.status).toBe(401);
    expect(getCompanyBrandingAssets).not.toHaveBeenCalled();
  });
});

describe("POST /api/companies/[companyId]/branding — permission enforcement and tenant isolation", () => {
  it("blocks a user with no Settings:Edit permission from uploading a logo (a user without Settings:Edit cannot modify branding)", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) });

    const response = await POST(postRequest(new Blob(["x"], { type: "image/png" })), params("company-b"));

    expect(response.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("company-b", "Settings:Edit");
    expect(uploadLogo).not.toHaveBeenCalled();
  });

  it("scopes the upload to the exact company in the URL, never a different one", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: true });
    vi.mocked(uploadLogo).mockResolvedValue(EMPTY_ASSETS);

    await POST(postRequest(new Blob(["x"], { type: "image/png" })), params("company-a"));

    expect(uploadLogo).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-a" }));
  });

  it("rejects a request with no file", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: true });

    const response = await POST(postRequest(null), params("company-a"));

    expect(response.status).toBe(400);
    expect(uploadLogo).not.toHaveBeenCalled();
  });

  it("maps a ValidationError from the service to a 400 (malformed/invalid upload)", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: true });
    vi.mocked(uploadLogo).mockRejectedValue(new ValidationError("Unsupported image type."));

    const response = await POST(postRequest(new Blob(["x"], { type: "image/svg+xml" })), params("company-a"));

    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/companies/[companyId]/branding — permission enforcement and tenant isolation", () => {
  it("blocks a user with no Settings:Edit permission from removing a logo (a user without Settings:Edit cannot modify branding)", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) });

    const response = await DELETE(new Request("http://localhost/api/companies/company-b/branding", { method: "DELETE" }), params("company-b"));

    expect(response.status).toBe(403);
    expect(removeLogo).not.toHaveBeenCalled();
  });

  it("scopes removal to the exact company in the URL (Company A cannot delete Company B's logo)", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: true });
    vi.mocked(removeLogo).mockResolvedValue(undefined);

    await DELETE(new Request("http://localhost/api/companies/company-a/branding", { method: "DELETE" }), params("company-a"));

    expect(removeLogo).toHaveBeenCalledWith("company-a");
    expect(removeLogo).not.toHaveBeenCalledWith("company-b");
  });

  it("maps a NotFoundError from the service to a 404 (empty company branding behaves correctly)", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: true });
    vi.mocked(removeLogo).mockRejectedValue(new NotFoundError("This company has no logo to remove."));

    const response = await DELETE(new Request("http://localhost/api/companies/company-a/branding", { method: "DELETE" }), params("company-a"));

    expect(response.status).toBe(404);
  });
});
