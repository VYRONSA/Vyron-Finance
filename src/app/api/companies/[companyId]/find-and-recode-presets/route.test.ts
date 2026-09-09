/**
 * Phase 25F — list/create for Find & Recode's saved filter presets.
 * Listing requires only a session (matches the transactions search route
 * itself, which also requires no stronger permission), while creating
 * requires the same "Banking:Edit" permission Find & Recode's own
 * preview/commit routes already require.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getCurrentUserId: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/find-and-recode-preset-service", () => ({
  listPresets: vi.fn(),
  savePreset: vi.fn(),
  ValidationError: class ValidationError extends Error {},
}));

import { GET, POST } from "./route";
import { requireSession, getCurrentUserId } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { listPresets, savePreset, ValidationError } from "@/server/services/find-and-recode-preset-service";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

function postRequest(companyId: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/companies/${companyId}/find-and-recode-presets`, { method: "POST", body: JSON.stringify(body) });
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
  vi.mocked(listPresets).mockReset().mockResolvedValue([]);
  vi.mocked(savePreset).mockReset().mockResolvedValue({ id: 1, companyId: "company-a", userId: "user-1", name: "My Filter", filters: SAMPLE_FILTERS, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
});

describe("GET find-and-recode-presets — requires only a session (no stronger permission than viewing Find & Recode)", () => {
  it("returns 401 when unauthenticated, without ever calling the service", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const response = await GET(new Request("http://localhost"), params("company-a"));
    expect(response.status).toBe(401);
    expect(listPresets).not.toHaveBeenCalled();
  });

  it("lists presets scoped to the exact company and the authenticated user (tenant + ownership isolation)", async () => {
    await GET(new Request("http://localhost"), params("company-a"));
    expect(listPresets).toHaveBeenCalledWith("company-a", "user-1");
  });

  it("never requires a permission check to view the list", async () => {
    await GET(new Request("http://localhost"), params("company-a"));
    expect(requirePermission).not.toHaveBeenCalled();
  });
});

describe("POST find-and-recode-presets — requires Banking:Edit, same as preview/commit", () => {
  it("requires Banking:Edit before saving anything", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const response = await POST(postRequest("company-a", { name: "X", filters: SAMPLE_FILTERS }), params("company-a"));
    expect(response.status).toBe(403);
    expect(savePreset).not.toHaveBeenCalled();
  });

  it("saves the preset scoped to the exact company and the authenticated user", async () => {
    await POST(postRequest("company-a", { name: "My Filter", filters: SAMPLE_FILTERS }), params("company-a"));
    expect(savePreset).toHaveBeenCalledWith("company-a", "user-1", "My Filter", SAMPLE_FILTERS);
  });

  it("returns a clean 400 with the real message on a duplicate name (ValidationError)", async () => {
    vi.mocked(savePreset).mockRejectedValue(new ValidationError('A preset named "My Filter" already exists.'));
    const response = await POST(postRequest("company-a", { name: "My Filter", filters: SAMPLE_FILTERS }), params("company-a"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("already exists");
  });

  it("returns 201 with the created preset on success", async () => {
    const response = await POST(postRequest("company-a", { name: "My Filter", filters: SAMPLE_FILTERS }), params("company-a"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.preset.name).toBe("My Filter");
  });
});
