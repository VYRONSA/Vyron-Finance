/**
 * Phase 22B — the "classify-with-ai" bulk-route case: feature gating,
 * usage-limit gating (exhausted / partially available), and the honest
 * success/partial-failure response shape. Every other existing case in
 * this route is untouched and already covered by manual/live testing
 * elsewhere in this codebase's history — this file focuses only on the
 * NEW behavior, mirroring the mocking pattern already established by
 * `companies/[companyId]/route.test.ts`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/transaction-explorer-service", () => ({
  allocateRow: vi.fn(),
  applyBulkReview: vi.fn(),
  applyNewRuleCompanyWide: vi.fn(),
  previewApplyRuleCompanyWide: vi.fn(),
  applyRule: vi.fn(),
  applyRulesToRemainingBatchTransactions: vi.fn(),
  assignCustomer: vi.fn(),
  assignGl: vi.fn(),
  assignMerchant: vi.fn(),
  assignSupplier: vi.fn(),
  assignVat: vi.fn(),
  deleteImport: vi.fn(),
  deleteTransactions: vi.fn(),
  generateJournal: vi.fn(),
  ValidationError: class ValidationError extends Error {},
}));
vi.mock("@/server/repositories/transaction-explorer-repository", () => ({ getTransactionsByIds: vi.fn() }));
vi.mock("@/server/services/transaction-classification-service", () => ({
  classifyTransactionsWithAiManual: vi.fn(),
  MAX_AI_CLASSIFICATIONS_PER_RUN: 20,
}));
vi.mock("@/server/billing-platform/engine/feature-flag-engine", () => ({ hasFeature: vi.fn() }));
vi.mock("@/server/billing-platform/engine/licensing-engine", () => ({ checkUsageLimit: vi.fn() }));

import { POST } from "./route";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getTransactionsByIds } from "@/server/repositories/transaction-explorer-repository";
import { classifyTransactionsWithAiManual } from "@/server/services/transaction-classification-service";
import { hasFeature } from "@/server/billing-platform/engine/feature-flag-engine";
import { checkUsageLimit } from "@/server/billing-platform/engine/licensing-engine";
import { allocateRow, applyNewRuleCompanyWide, previewApplyRuleCompanyWide, deleteTransactions } from "@/server/services/transaction-explorer-service";
import type { BankTransactionRecord } from "@/server/accounting/types";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

function classifyRequest(companyId: string, transactionIds: number[]): Request {
  return new Request(`http://localhost/api/companies/${companyId}/transactions/bulk`, { method: "POST", body: JSON.stringify({ action: "classify-with-ai", transactionIds }) });
}

function allocateRowRequest(companyId: string, transactionIds: number[], description: string | null = null): Request {
  return new Request(`http://localhost/api/companies/${companyId}/transactions/bulk`, {
    method: "POST",
    body: JSON.stringify({ action: "allocate-row", transactionIds, type: "G", accountCode: "6100", vatCode: null, allocationNotes: "", description }),
  });
}

function eligibleTransaction(id: number): BankTransactionRecord {
  return {
    id, companyId: "company-a", transactionDate: "2026-08-01", reference: "", description: "PICK N PAY", beneficiary: "Pick n Pay",
    debit: 100, credit: 0, balance: null, bankAccount: "Cheque Account", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00.000Z", allocationStatus: "Unallocated", matchedSupplierId: null,
    matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null, matchedMerchantId: null,
    ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported", captureStatus: null, cashbookBatchId: null,
    reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false, overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
  };
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("Jane Accountant");
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getTransactionsByIds).mockReset().mockResolvedValue([eligibleTransaction(501)]);
  vi.mocked(hasFeature).mockReset().mockResolvedValue(true);
  vi.mocked(checkUsageLimit).mockReset().mockResolvedValue({ allowed: true, limit: 100, used: 0 });
  vi.mocked(classifyTransactionsWithAiManual).mockReset().mockResolvedValue({ requested: 1, classified: 1, autoAllocated: 0, rateLimited: 0, skipped: [] });
});

describe("POST /transactions/bulk — classify-with-ai — feature gating", () => {
  it("returns 403 with an honest message when the plan doesn't include AI classification", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const response = await POST(classifyRequest("company-a", [501]), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("AI classification is not included in your current plan.");
    expect(classifyTransactionsWithAiManual).not.toHaveBeenCalled();
  });

  it("checks hasFeature with the reused ai_copilot feature key", async () => {
    await POST(classifyRequest("company-a", [501]), params("company-a"));
    expect(hasFeature).toHaveBeenCalledWith("company-a", "ai_copilot");
  });
});

describe("POST /transactions/bulk — classify-with-ai — usage limits", () => {
  it("returns 403 with an honest message when usage is fully exhausted", async () => {
    vi.mocked(checkUsageLimit).mockResolvedValue({ allowed: false, limit: 50, used: 50, reason: "This would use 51 of your plan's limit of 50." });

    const response = await POST(classifyRequest("company-a", [501]), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("This would use 51 of your plan's limit of 50.");
    expect(classifyTransactionsWithAiManual).not.toHaveBeenCalled();
  });

  it("classifies a partial amount when only some usage allowance remains", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([eligibleTransaction(501), eligibleTransaction(502), eligibleTransaction(503)]);
    vi.mocked(checkUsageLimit).mockResolvedValue({ allowed: false, limit: 50, used: 48, reason: "This would use 51 of your plan's limit of 50." });

    await POST(classifyRequest("company-a", [501, 502, 503]), params("company-a"));

    expect(classifyTransactionsWithAiManual).toHaveBeenCalledWith("company-a", [501, 502, 503], "Jane Accountant", 2);
  });

  it("does not call checkUsageLimit at all when nothing in the selection is eligible", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([{ ...eligibleTransaction(501), ruleId: 9 }]);

    await POST(classifyRequest("company-a", [501]), params("company-a"));

    expect(checkUsageLimit).not.toHaveBeenCalled();
    expect(classifyTransactionsWithAiManual).toHaveBeenCalledWith("company-a", [501], "Jane Accountant", 20);
  });

  it("caps the checked quantity at MAX_AI_CLASSIFICATIONS_PER_RUN even with a larger eligible selection", async () => {
    const many = Array.from({ length: 30 }, (_, i) => eligibleTransaction(501 + i));
    vi.mocked(getTransactionsByIds).mockResolvedValue(many);

    await POST(classifyRequest("company-a", many.map((t) => t.id)), params("company-a"));

    expect(checkUsageLimit).toHaveBeenCalledWith("company-a", "max_ai_requests_monthly", 20);
  });
});

describe("POST /transactions/bulk — classify-with-ai — success", () => {
  it("returns the outcome from the service on success", async () => {
    vi.mocked(classifyTransactionsWithAiManual).mockResolvedValue({ requested: 1, classified: 1, autoAllocated: 0, rateLimited: 0, skipped: [] });

    const response = await POST(classifyRequest("company-a", [501]), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcome).toEqual({ requested: 1, classified: 1, autoAllocated: 0, rateLimited: 0, skipped: [] });
  });

  it("passes performedBy through from getPerformedByLabel", async () => {
    await POST(classifyRequest("company-a", [501]), params("company-a"));
    expect(classifyTransactionsWithAiManual).toHaveBeenCalledWith("company-a", [501], "Jane Accountant", 20);
  });
});

describe("POST /transactions/bulk — classify-with-ai — tenant isolation", () => {
  it("only ever checks and classifies against the requested company's own id", async () => {
    await POST(classifyRequest("company-b", [501]), params("company-b"));

    expect(hasFeature).toHaveBeenCalledWith("company-b", "ai_copilot");
    expect(getTransactionsByIds).toHaveBeenCalledWith("company-b", [501]);
    expect(checkUsageLimit).toHaveBeenCalledWith("company-b", "max_ai_requests_monthly", expect.any(Number));
    expect(classifyTransactionsWithAiManual).toHaveBeenCalledWith("company-b", [501], "Jane Accountant", 20);
  });
});

describe("POST /transactions/bulk — classify-with-ai — permission enforcement (existing Banking:Edit, unchanged)", () => {
  it("still requires Banking:Edit — the same permission every other bulk action already requires", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);

    const response = await POST(classifyRequest("company-a", [501]), params("company-a"));

    expect(response.status).toBe(403);
    expect(hasFeature).not.toHaveBeenCalled();
    expect(requirePermission).toHaveBeenCalledWith("company-a", "Banking:Edit");
  });
});

// Phase 31 — "Save Selected"/bulk-save requirement: a posted transaction
// must be a visible, honest failure — never a silent `{ ok: true }` that
// actually wrote nothing. This is the route-level half of the fix (the
// repository/service halves are covered in their own test files); this
// is the layer that decides HTTP status, so it's the one that proves the
// individual Save button (which reads `res.ok`) will actually see this
// as a failure.
describe("POST /transactions/bulk — allocate-row — posted-transaction reporting (Phase 31)", () => {
  it("a single-row commit whose one transaction is posted returns 409 with an honest error, not a bare ok:true", async () => {
    vi.mocked(allocateRow).mockResolvedValue({ updatedIds: [], blockedIds: [501] });

    const response = await POST(allocateRowRequest("company-a", [501]), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/posted/i);
    expect(body.blockedIds).toEqual([501]);
  });

  it("a full success (nothing blocked) still returns ok:true, now carrying updatedIds/blockedIds", async () => {
    vi.mocked(allocateRow).mockResolvedValue({ updatedIds: [501], blockedIds: [] });

    const response = await POST(allocateRowRequest("company-a", [501]), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, updatedIds: [501], blockedIds: [] });
  });

  it("a partial block across a multi-id request is still a real success for the ids that DID update — the whole batch is never failed for one blocked row", async () => {
    vi.mocked(allocateRow).mockResolvedValue({ updatedIds: [501, 503], blockedIds: [502] });

    const response = await POST(allocateRowRequest("company-a", [501, 502, 503]), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.updatedIds).toEqual([501, 503]);
    expect(body.blockedIds).toEqual([502]);
  });

  // Phase 31A — item 7: the SAME guard/route logic applies whether or
  // not the request includes a description change — no special-casing
  // that would let a description slip through on a posted transaction.
  it("a posted transaction's description change is blocked exactly like any other field — same 409, same guard", async () => {
    vi.mocked(allocateRow).mockResolvedValue({ updatedIds: [], blockedIds: [501] });

    const response = await POST(allocateRowRequest("company-a", [501], "Ren Remuneration"), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/posted/i);
  });

  it("passes the request body's description through to the service unchanged", async () => {
    vi.mocked(allocateRow).mockResolvedValue({ updatedIds: [501], blockedIds: [] });

    await POST(allocateRowRequest("company-a", [501], "Ren Remuneration"), params("company-a"));

    expect(allocateRow).toHaveBeenCalledWith("company-a", [501], expect.objectContaining({ description: "Ren Remuneration" }), "Jane Accountant");
  });
});

// Phase 39, Part 1 — the company-wide retroactive-apply route case.
describe("POST /transactions/bulk — apply-rule-company-wide (Phase 39)", () => {
  beforeEach(() => {
    vi.mocked(applyNewRuleCompanyWide).mockReset();
  });

  function ruleCompanyWideRequest(companyId: string, ruleId: unknown, excludeTransactionId: number | null = null): Request {
    return new Request(`http://localhost/api/companies/${companyId}/transactions/bulk`, {
      method: "POST",
      body: JSON.stringify({ action: "apply-rule-company-wide", ruleId, excludeTransactionId }),
    });
  }

  it("rejects a missing/non-numeric ruleId with 400, never reaching the service", async () => {
    const response = await POST(ruleCompanyWideRequest("company-a", undefined), params("company-a"));
    expect(response.status).toBe(400);
    expect(applyNewRuleCompanyWide).not.toHaveBeenCalled();
  });

  it("returns the summary from the service on success", async () => {
    vi.mocked(applyNewRuleCompanyWide).mockResolvedValue({ matchedCount: 7, allocatedCount: 6, alreadyAllocatedCount: 1, rejectedCount: 0, allocatedTransactionIds: [1, 2, 3, 4, 5, 6] });

    const response = await POST(ruleCompanyWideRequest("company-a", 900, 501), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toEqual({ matchedCount: 7, allocatedCount: 6, alreadyAllocatedCount: 1, rejectedCount: 0, allocatedTransactionIds: [1, 2, 3, 4, 5, 6] });
    expect(applyNewRuleCompanyWide).toHaveBeenCalledWith("company-a", 900, 501, "Jane Accountant");
  });
});

// Phase 51 — the new read-only "how many would this affect?" route case,
// called BEFORE the UI ever offers "apply-rule-company-wide" above. The
// defining property under test: this case must NEVER call the actual
// apply/write function, regardless of the request shape.
describe("POST /transactions/bulk — preview-apply-rule-company-wide (Phase 51)", () => {
  beforeEach(() => {
    vi.mocked(previewApplyRuleCompanyWide).mockReset();
    vi.mocked(applyNewRuleCompanyWide).mockReset();
  });

  function previewRequest(companyId: string, ruleId: unknown, excludeTransactionId: number | null = null): Request {
    return new Request(`http://localhost/api/companies/${companyId}/transactions/bulk`, {
      method: "POST",
      body: JSON.stringify({ action: "preview-apply-rule-company-wide", ruleId, excludeTransactionId }),
    });
  }

  it("rejects a missing/non-numeric ruleId with 400, never reaching the service", async () => {
    const response = await POST(previewRequest("company-a", undefined), params("company-a"));
    expect(response.status).toBe(400);
    expect(previewApplyRuleCompanyWide).not.toHaveBeenCalled();
  });

  it("returns the preview count from the service, and never calls the real apply/write function", async () => {
    vi.mocked(previewApplyRuleCompanyWide).mockResolvedValue({ matchedCount: 12, eligibleCount: 12, alreadyAllocatedCount: 0 });

    const response = await POST(previewRequest("company-a", 900, 501), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preview).toEqual({ matchedCount: 12, eligibleCount: 12, alreadyAllocatedCount: 0 });
    expect(previewApplyRuleCompanyWide).toHaveBeenCalledWith("company-a", 900, 501);
    // The whole point of this route case existing separately from
    // "apply-rule-company-wide": it never writes, no matter the count.
    expect(applyNewRuleCompanyWide).not.toHaveBeenCalled();
  });
});

// Phase 39, Part 2 — Delete Transaction route case.
describe("POST /transactions/bulk — delete (Phase 39)", () => {
  beforeEach(() => {
    vi.mocked(deleteTransactions).mockReset();
  });

  function deleteRequest(companyId: string, transactionIds: number[]): Request {
    return new Request(`http://localhost/api/companies/${companyId}/transactions/bulk`, {
      method: "POST",
      body: JSON.stringify({ action: "delete", transactionIds }),
    });
  }

  it("a fully blocked (all posted) delete returns 409 with an honest error, never a bare ok:true", async () => {
    vi.mocked(deleteTransactions).mockResolvedValue({ deletedIds: [], blockedIds: [501] });

    const response = await POST(deleteRequest("company-a", [501]), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/posted/i);
    expect(body.blockedIds).toEqual([501]);
  });

  it("a full success returns ok:true with the exact deleted count", async () => {
    vi.mocked(deleteTransactions).mockResolvedValue({ deletedIds: [501, 502], blockedIds: [] });

    const response = await POST(deleteRequest("company-a", [501, 502]), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, deletedIds: [501, 502], blockedIds: [] });
  });

  it("a mixed posted/unposted selection still succeeds (200) for the unposted ones, reporting the posted ones as blocked", async () => {
    vi.mocked(deleteTransactions).mockResolvedValue({ deletedIds: [501], blockedIds: [502] });

    const response = await POST(deleteRequest("company-a", [501, 502]), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, deletedIds: [501], blockedIds: [502] });
  });

  it("still requires Banking:Edit, same as every other bulk action", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);

    const response = await POST(deleteRequest("company-a", [501]), params("company-a"));

    expect(response.status).toBe(403);
    expect(deleteTransactions).not.toHaveBeenCalled();
  });
});
