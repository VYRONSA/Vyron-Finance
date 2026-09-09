/**
 * Phase 25F — rename/delete for a single Find & Recode saved filter
 * preset. Both mutations require the same "Banking:Edit" permission
 * Find & Recode's own preview/commit routes already require, and are
 * scoped to the authenticated user's own id — never a browser-supplied
 * one — so a tampered preset id in the URL still can't reach another
 * user's or another company's row (the service/repository layer's own
 * `.eq("user_id", userId).eq("company_id", companyId)` scoping, backed
 * by RLS, is what actually enforces this; these tests confirm the route
 * always passes the server-derived identity, never a client-supplied one).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getCurrentUserId: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/find-and-recode-preset-service", () => ({
  renamePreset: vi.fn(),
  deletePreset: vi.fn(),
  ValidationError: class ValidationError extends Error {},
}));

import { PATCH, DELETE } from "./route";
import { requireSession, getCurrentUserId } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { renamePreset, deletePreset, ValidationError } from "@/server/services/find-and-recode-preset-service";

function params(companyId: string, presetId: string) {
  return { params: Promise.resolve({ companyId, presetId }) };
}

function patchRequest(companyId: string, presetId: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/companies/${companyId}/find-and-recode-presets/${presetId}`, { method: "PATCH", body: JSON.stringify(body) });
}

const SAMPLE_FILTERS = {
  search: null, dateFrom: null, dateTo: null, minAmount: null, maxAmount: null, statuses: null,
  bankAccountId: null, importBatch: null, duplicateOnly: false, unknownSupplierOnly: false,
  sortBy: "transactionDate", sortDirection: "desc", description: null, reference: null, glAccount: null,
  supplierId: null, customerId: null, allocationMethods: null, hasRule: null, manualOverrideOnly: false, needsReviewOnly: false,
} as never;

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getCurrentUserId).mockReset().mockResolvedValue("user-1");
  vi.mocked(renamePreset).mockReset().mockResolvedValue({ id: 1, companyId: "company-a", userId: "user-1", name: "Renamed", filters: SAMPLE_FILTERS, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" });
  vi.mocked(deletePreset).mockReset().mockResolvedValue(undefined);
});

describe("PATCH find-and-recode-presets/[presetId] — permission and identity", () => {
  it("requires Banking:Edit before renaming anything", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const response = await PATCH(patchRequest("company-a", "1", { name: "New Name" }), params("company-a", "1"));
    expect(response.status).toBe(403);
    expect(renamePreset).not.toHaveBeenCalled();
  });

  it("renames using the server-derived company id, user id, and numeric preset id — never trusting the request body for identity", async () => {
    await PATCH(patchRequest("company-a", "1", { name: "New Name" }), params("company-a", "1"));
    expect(renamePreset).toHaveBeenCalledWith("company-a", "user-1", 1, "New Name");
  });

  it("a tampered/foreign preset id resolves through the service's own scoping, not the route — the route always passes the authenticated user's id regardless of what id is in the URL", async () => {
    await PATCH(patchRequest("company-a", "999999", { name: "New Name" }), params("company-a", "999999"));
    expect(renamePreset).toHaveBeenCalledWith("company-a", "user-1", 999999, "New Name");
  });

  it("returns a clean 400 on a duplicate name", async () => {
    vi.mocked(renamePreset).mockRejectedValue(new ValidationError('A preset named "Taken" already exists.'));
    const response = await PATCH(patchRequest("company-a", "1", { name: "Taken" }), params("company-a", "1"));
    expect(response.status).toBe(400);
  });

  it("returns 400 when the preset does not exist under this user/company", async () => {
    vi.mocked(renamePreset).mockRejectedValue(new ValidationError("Preset not found."));
    const response = await PATCH(patchRequest("company-a", "404", { name: "X" }), params("company-a", "404"));
    expect(response.status).toBe(400);
  });
});

describe("DELETE find-and-recode-presets/[presetId] — permission and identity", () => {
  it("requires Banking:Edit before deleting anything", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const response = await DELETE(new Request("http://localhost"), params("company-a", "1"));
    expect(response.status).toBe(403);
    expect(deletePreset).not.toHaveBeenCalled();
  });

  it("deletes using the server-derived company id and user id", async () => {
    await DELETE(new Request("http://localhost"), params("company-a", "1"));
    expect(deletePreset).toHaveBeenCalledWith("company-a", "user-1", 1);
  });

  it("returns ok:true on success", async () => {
    const response = await DELETE(new Request("http://localhost"), params("company-a", "1"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
