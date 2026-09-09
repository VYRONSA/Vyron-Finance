import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/merge-service", () => ({
  getSupplierMergePreview: vi.fn(),
  ValidationError: class ValidationError extends Error {},
  NotFoundError: class NotFoundError extends Error {},
}));

import { GET } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getSupplierMergePreview, ValidationError, NotFoundError } from "@/server/services/merge-service";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getSupplierMergePreview).mockReset();
});

describe("GET .../suppliers/merge-preview (Phase 33A)", () => {
  it("requires a session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const response = await GET(new Request("http://localhost/x?a=1&b=2"), params("co_1"));
    expect(response.status).toBe(401);
  });

  it("requires Matching:Edit permission", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const response = await GET(new Request("http://localhost/x?a=1&b=2"), params("co_1"));
    expect(response.status).toBe(403);
  });

  it("rejects non-numeric ids with a 400 rather than passing garbage through", async () => {
    const response = await GET(new Request("http://localhost/x?a=abc&b=2"), params("co_1"));
    expect(response.status).toBe(400);
    expect(getSupplierMergePreview).not.toHaveBeenCalled();
  });

  it("calls getSupplierMergePreview with the ids parsed from the query string and returns the preview", async () => {
    const preview = {
      supplierA: { id: 1, name: "Acme", supplierCode: "SUP-1", status: "Active" as const, vatNumber: "", taxNumber: "", paymentTermsDays: 30, linkedRecordCount: 5 },
      supplierB: { id: 2, name: "Acme (dup)", supplierCode: "", status: "Active" as const, vatNumber: "", taxNumber: "", paymentTermsDays: 0, linkedRecordCount: 0 },
    };
    vi.mocked(getSupplierMergePreview).mockResolvedValue(preview);

    const response = await GET(new Request("http://localhost/x?a=1&b=2"), params("co_1"));
    const body = await response.json();

    expect(getSupplierMergePreview).toHaveBeenCalledWith("co_1", 1, 2);
    expect(response.status).toBe(200);
    expect(body).toEqual(preview);
  });

  it("maps a ValidationError to 400", async () => {
    vi.mocked(getSupplierMergePreview).mockRejectedValue(new ValidationError("Cannot compare a supplier with itself."));
    const response = await GET(new Request("http://localhost/x?a=1&b=1"), params("co_1"));
    expect(response.status).toBe(400);
  });

  it("maps a NotFoundError to 404", async () => {
    vi.mocked(getSupplierMergePreview).mockRejectedValue(new NotFoundError("No supplier with id 999."));
    const response = await GET(new Request("http://localhost/x?a=1&b=999"), params("co_1"));
    expect(response.status).toBe(404);
  });
});
