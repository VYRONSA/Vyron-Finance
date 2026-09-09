/**
 * Phase 41, Part 2 — the route-level half of duplicate-rule prevention:
 * proves a `DuplicateRuleError` from the service becomes a 409 with the
 * existing rule attached, never a bare 500 or a silent 201.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/banking-rule-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/banking-rule-service")>();
  return { ...actual, createBankingRule: vi.fn(), listBankingRules: vi.fn() };
});

import { POST } from "./route";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createBankingRule, DuplicateRuleError, ValidationError } from "@/server/services/banking-rule-service";
import type { BankingRule } from "@/server/banking-rules/types";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

function createRequest(companyId: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/companies/${companyId}/banking-rules`, { method: "POST", body: JSON.stringify(body) });
}

function existingRule(): BankingRule {
  return {
    id: 9,
    companyId: "company-a",
    domain: "Banking",
    ruleType: "Supplier",
    name: "Auto: Fish → Supplier",
    description: "",
    priority: 100,
    isActive: true,
    version: 1,
    createdAt: "2026-08-20T07:13:51Z",
    updatedAt: "2026-08-20T07:13:51Z",
    createdBy: "tester",
    updatedBy: "tester",
    conditions: [{ id: 9, field: "description", operator: "contains", value: "Fish", value2: null }],
    actions: [{ id: 15, actionType: "set_supplier", targetId: 636, targetText: null }],
  };
}

const ruleBody = { domain: "Banking", ruleType: "Supplier", name: "Auto: Fish → Supplier", conditions: [{ field: "description", operator: "contains", value: "Fish" }], actions: [{ actionType: "set_supplier", targetId: 636 }] };

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("Jane Accountant");
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(createBankingRule).mockReset();
});

describe("POST /banking-rules — duplicate rejection (Phase 41)", () => {
  it("returns 409 with the existing rule attached when the service throws DuplicateRuleError", async () => {
    vi.mocked(createBankingRule).mockRejectedValue(new DuplicateRuleError(existingRule()));

    const response = await POST(createRequest("company-a", ruleBody), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/already exists/i);
    expect(body.duplicateRule).toMatchObject({ id: 9, name: "Auto: Fish → Supplier" });
  });

  it("still returns 400 for an ordinary ValidationError, unaffected by the new duplicate handling", async () => {
    vi.mocked(createBankingRule).mockRejectedValue(new ValidationError("Rule name is required."));

    const response = await POST(createRequest("company-a", ruleBody), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Rule name is required.");
    expect(body.duplicateRule).toBeUndefined();
  });

  it("returns 201 with the created rule on success, unchanged", async () => {
    vi.mocked(createBankingRule).mockResolvedValue(existingRule());

    const response = await POST(createRequest("company-a", ruleBody), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.rule.id).toBe(9);
  });

  it("still requires Banking:Create permission", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);

    const response = await POST(createRequest("company-a", ruleBody), params("company-a"));

    expect(response.status).toBe(403);
    expect(createBankingRule).not.toHaveBeenCalled();
  });
});
