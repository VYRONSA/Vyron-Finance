/**
 * Phase 5C — "Apply Rule" and "apply to the rest of the statement" run the
 * real Rule Engine pipeline, which can POST an accounting journal.
 *
 * The separation under test: `Banking:Edit` still gates the action (it is a
 * genuine classification operation), and `Banking:Post` decides whether the
 * pass may post. A caller with Edit alone keeps every classification and the
 * transactions a rule would have POSTED are left untouched — never
 * downgraded to a claim, which would take them out of automatic posting for
 * good (see `ProcessTransactionOptions.mayPost`).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn(), hasPermission: vi.fn() }));
vi.mock("@/server/services/transaction-explorer-service", () => ({
  applyRule: vi.fn(),
  applyRulesToRemainingBatchTransactions: vi.fn(),
  applyNewRuleCompanyWide: vi.fn(),
  previewApplyRuleCompanyWide: vi.fn(),
  allocateRow: vi.fn(),
  applyBulkReview: vi.fn(),
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
vi.mock("@/server/ai/transaction-classification/types", () => ({ isEligibleForAiClassification: vi.fn() }));
vi.mock("@/server/services/transaction-classification-service", () => ({ classifyTransactionsWithAiManual: vi.fn(), MAX_AI_CLASSIFICATIONS_PER_RUN: 50 }));
vi.mock("@/server/billing-platform/engine/feature-flag-engine", () => ({ hasFeature: vi.fn() }));
vi.mock("@/server/billing-platform/engine/licensing-engine", () => ({ checkUsageLimit: vi.fn() }));

import { POST } from "./route";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { hasPermission, requirePermission } from "@/server/services/permission-service";
import { applyRule, applyRulesToRemainingBatchTransactions } from "@/server/services/transaction-explorer-service";

const params = { params: Promise.resolve({ companyId: "co_1" }) };
const request = (body: unknown) =>
  new Request("http://localhost/api/companies/co_1/transactions/bulk", { method: "POST", body: JSON.stringify(body) });

/** One posted, one refused for want of Banking:Post. */
const MIXED = [
  { transactionId: 1, matchedRuleIds: [153], autoPosted: true, journalId: 900, exceptionsRaised: [], outcome: "posted" as const },
  { transactionId: 2, matchedRuleIds: [153], autoPosted: false, journalId: null, exceptionsRaised: [], outcome: "not-permitted" as const },
];

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("user@example.test");
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(hasPermission).mockReset().mockResolvedValue(true);
  vi.mocked(applyRule).mockReset().mockResolvedValue([]);
  vi.mocked(applyRulesToRemainingBatchTransactions).mockReset().mockResolvedValue([]);
});

describe("POST /transactions/bulk apply-rule — posting-permission separation", () => {
  it("the route still gates on Banking:Edit, and asks separately about Banking:Post", async () => {
    const response = await POST(request({ action: "apply-rule", transactionIds: [1, 2] }), params);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Banking:Edit");
    expect(hasPermission).toHaveBeenCalledWith("co_1", "Banking:Post");
  });

  it("with Banking:Post the pass MAY post", async () => {
    vi.mocked(hasPermission).mockResolvedValue(true);
    await POST(request({ action: "apply-rule", transactionIds: [1, 2] }), params);
    expect(applyRule).toHaveBeenCalledWith("co_1", [1, 2], "user@example.test", true);
  });

  it("without Banking:Post the pass MAY NOT post", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    await POST(request({ action: "apply-rule", transactionIds: [1, 2] }), params);
    expect(applyRule).toHaveBeenCalledWith("co_1", [1, 2], "user@example.test", false);
  });

  it("a caller without Banking:Edit is refused outright, and no rule pass runs at all", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) });
    const response = await POST(request({ action: "apply-rule", transactionIds: [1] }), params);
    expect(response.status).toBe(403);
    expect(applyRule).not.toHaveBeenCalled();
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it("the response reports how many transactions were left unposted for want of the permission", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    vi.mocked(applyRule).mockResolvedValue(MIXED as never);
    const response = await POST(request({ action: "apply-rule", transactionIds: [1, 2] }), params);
    expect(await response.json()).toMatchObject({ notPermitted: 1 });
  });

  it("apply-rule-to-batch separates the two permissions the same way", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    await POST(request({ action: "apply-rule-to-batch", importBatch: "B1", excludeTransactionId: 9, newRuleId: 7 }), params);
    expect(applyRulesToRemainingBatchTransactions).toHaveBeenCalledWith("co_1", "B1", 9, "user@example.test", 7, false);

    vi.mocked(hasPermission).mockResolvedValue(true);
    await POST(request({ action: "apply-rule-to-batch", importBatch: "B1", excludeTransactionId: 9, newRuleId: 7 }), params);
    expect(applyRulesToRemainingBatchTransactions).toHaveBeenLastCalledWith("co_1", "B1", 9, "user@example.test", 7, true);
  });

  it("the company it was asked about is the only company it asks about", async () => {
    const otherParams = { params: Promise.resolve({ companyId: "co_2" }) };
    await POST(request({ action: "apply-rule", transactionIds: [1] }), otherParams);
    expect(requirePermission).toHaveBeenCalledWith("co_2", "Banking:Edit");
    expect(hasPermission).toHaveBeenCalledWith("co_2", "Banking:Post");
    expect(applyRule).toHaveBeenCalledWith("co_2", [1], "user@example.test", true);
  });

  it("an unauthenticated request is refused before any permission check", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as never);
    const response = await POST(request({ action: "apply-rule", transactionIds: [1] }), params);
    expect(response.status).toBe(401);
    expect(requirePermission).not.toHaveBeenCalled();
    expect(hasPermission).not.toHaveBeenCalled();
    expect(applyRule).not.toHaveBeenCalled();
  });
});
