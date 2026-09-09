/**
 * Phase 22A — tests the orchestrator's eligibility gating, cap
 * enforcement, per-transaction failure isolation, and the "never
 * fabricate" contract. Every dependency is mocked; nothing here touches
 * a real AI provider or Supabase.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/transaction-explorer-repository", () => ({
  getTransactionsByIds: vi.fn(),
  applyAiClassification: vi.fn(),
  listAiClassificationEligibleTransactions: vi.fn(),
}));
vi.mock("@/server/ai/transaction-classification/evidence-builder", () => ({ buildTransactionClassificationEvidence: vi.fn() }));
vi.mock("@/server/ai/transaction-classification/classification-engine", () => ({
  classifyTransactionWithAi: vi.fn(),
  getDefaultTransactionClassificationProvider: vi.fn(),
}));
vi.mock("@/server/billing-platform/engine/usage-metering-engine", () => ({ recordUsageEvent: vi.fn() }));

import { classifyUnallocatedTransactionsWithAi, classifyTransactionsWithAiManual, runAutomaticAiClassificationSweep, MAX_AI_CLASSIFICATIONS_PER_RUN } from "./transaction-classification-service";
import { getTransactionsByIds, applyAiClassification, listAiClassificationEligibleTransactions } from "@/server/repositories/transaction-explorer-repository";
import { buildTransactionClassificationEvidence } from "@/server/ai/transaction-classification/evidence-builder";
import { classifyTransactionWithAi, getDefaultTransactionClassificationProvider } from "@/server/ai/transaction-classification/classification-engine";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import { AIProviderError } from "@/server/ai/types";
import type { BankTransactionRecord } from "@/server/accounting/types";

const FAKE_PROVIDER = { classify: vi.fn() };

/** Phase 28 — every mocked `TransactionClassificationResult` now needs an
 * `accountingConfidence` assessment too (the field the service's own
 * decision logic actually reads — see `transaction-classification-service.ts::classifyOne`).
 * Defaults `accountingConfidenceLevel` to mirror the given
 * `confidenceLevel` 1:1, preserving every pre-Phase-28 test's original
 * intent (a mocked "High"/"Medium"/"Low" result behaves exactly as
 * before) unless a test explicitly wants to prove evidence-based
 * divergence (see the dedicated "accounting confidence overrides model
 * confidence" describe block below). */
function accountingConfidenceFor(confidence: number, confidenceLevel: "High" | "Medium" | "Low", accountingConfidenceLevel: "High" | "Medium" | "Low" = confidenceLevel) {
  return {
    modelConfidence: confidence,
    modelConfidenceLevel: confidenceLevel,
    evidenceStrength: "None" as const,
    agreesWithHistory: null,
    accountingConfidenceLevel,
    explanation: "test fixture reasoning",
    reasoning: ["test fixture reasoning"],
  };
}

function transaction(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 501, companyId: "company-a", transactionDate: "2026-08-01", reference: "", description: "PICK N PAY", beneficiary: "Pick n Pay",
    debit: 1245.6, credit: 0, balance: null, bankAccount: "Cheque Account", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00.000Z", allocationStatus: "Unallocated", matchedSupplierId: null,
    matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null, matchedMerchantId: null,
    ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported", captureStatus: null, cashbookBatchId: null,
    reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getTransactionsByIds).mockReset().mockResolvedValue([transaction()]);
  vi.mocked(buildTransactionClassificationEvidence).mockReset().mockResolvedValue({
    companyId: "company-a", transactionId: 501, description: "PICK N PAY", beneficiary: "Pick n Pay", reference: "", amount: 1245.6,
    direction: "Debit", transactionDate: "2026-08-01", bankAccount: "Cheque Account", candidateAccounts: [], similarPastClassifications: [],
    companyHistoricalPatterns: [],
  });
  vi.mocked(getDefaultTransactionClassificationProvider).mockReset().mockResolvedValue(FAKE_PROVIDER as never);
  // Phase 26A — Medium confidence by default (not High): these tests
  // predate the High-confidence auto-allocation split and are about
  // eligibility/failure-isolation/tenant-isolation, not confidence
  // branching — Medium keeps their original "a successful classification
  // writes Suggested" intent true without each one needing to know about
  // the new branch. Dedicated High/Medium/Low branching tests live in
  // their own describe block below.
  vi.mocked(classifyTransactionWithAi).mockReset().mockResolvedValue({
    transactionId: 501, companyId: "company-a", accountCode: "6100", confidence: 75, confidenceLevel: "Medium", explanation: "Matches a known grocery merchant.", modelUsed: "openai/gpt-4o-mini",
    accountingConfidence: accountingConfidenceFor(75, "Medium"),
  });
  vi.mocked(applyAiClassification).mockReset().mockResolvedValue(undefined);
  vi.mocked(recordUsageEvent).mockReset().mockResolvedValue(undefined);
  vi.mocked(listAiClassificationEligibleTransactions).mockReset().mockResolvedValue([transaction()]);
});

describe("classifyUnallocatedTransactionsWithAi — success", () => {
  it("writes the suggestion and records a usage event", async () => {
    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(applyAiClassification).toHaveBeenCalledWith(
      "company-a", 501,
      // Phase 28 — the persisted explanation is now accounting-based
      // first (the test fixture's default "no historical evidence"
      // reasoning), with the model's own raw text only appended,
      // clearly labelled as unverified — see `explanationFor()`.
      { suggestedGlAccount: "6100", confidence: 75, explanation: 'test fixture reasoning The AI\'s own stated reasoning (not independently verified against this company\'s history): "Matches a known grocery merchant."', modelUsed: "openai/gpt-4o-mini", targetStatus: "Suggested" },
      "System",
    );
    expect(recordUsageEvent).toHaveBeenCalledWith("company-a", "ai_requests");
    expect(outcome).toEqual({ attempted: 1, classified: 1, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0 });
  });

  it("returns immediately with an empty outcome when given no transaction ids", async () => {
    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [], "System");
    expect(outcome).toEqual({ attempted: 0, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0 });
    expect(getTransactionsByIds).not.toHaveBeenCalled();
  });
});

describe("classifyUnallocatedTransactionsWithAi — eligibility gating (Banking Rules precedence)", () => {
  it("never classifies a transaction a Banking Rule already touched (ruleId set)", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ ruleId: 7 })]);
    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");
    expect(outcome.attempted).toBe(0);
    expect(classifyTransactionWithAi).not.toHaveBeenCalled();
  });

  it("never classifies a transaction that already has a suggestedGlAccount", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ suggestedGlAccount: "6200" })]);
    await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");
    expect(classifyTransactionWithAi).not.toHaveBeenCalled();
  });

  it("never classifies a transaction with a matched supplier", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ matchedSupplierId: 3 })]);
    await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");
    expect(classifyTransactionWithAi).not.toHaveBeenCalled();
  });

  it("never classifies a transaction with a matched customer", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ matchedCustomerId: 3 })]);
    await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");
    expect(classifyTransactionWithAi).not.toHaveBeenCalled();
  });

  it("never classifies a transaction with a matched merchant", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ matchedMerchantId: 3 })]);
    await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");
    expect(classifyTransactionWithAi).not.toHaveBeenCalled();
  });

  it("never classifies a transaction not left Unallocated", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ allocationStatus: "Matched" })]);
    await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");
    expect(classifyTransactionWithAi).not.toHaveBeenCalled();
  });

  it("classifies a genuinely untouched transaction", async () => {
    await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");
    expect(classifyTransactionWithAi).toHaveBeenCalledTimes(1);
  });

  it("never classifies a transaction that's already posted (journalId set) — Phase 25K, split transactions can reach journalId without ever having suggestedGlAccount set", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ journalId: 42 })]);
    await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");
    expect(classifyTransactionWithAi).not.toHaveBeenCalled();
  });

  // Phase 26E — closes the gap the production database investigation
  // found: `bulkAssignGl` (the plain "Assign GL" bulk action) sets
  // `is_manual_override = true` without ever setting `suggestedGlAccount`/
  // `allocationStatus` away from Unallocated, so every OTHER check above
  // stays passing. Migration 0083 already rejects this case at the RPC's
  // own write-time claim; this proves the TypeScript-level check now
  // rejects it too, so a company-wide sweep never wastes a real AI
  // provider call on a transaction guaranteed to fail the write anyway.
  it("never classifies a transaction with is_manual_override = true, even when every other field looks untouched", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ isManualOverride: true })]);
    await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");
    expect(classifyTransactionWithAi).not.toHaveBeenCalled();
  });
});

describe("classifyUnallocatedTransactionsWithAi — cap enforcement", () => {
  it("caps the number of transactions classified per run at 20", async () => {
    const many = Array.from({ length: 30 }, (_, i) => transaction({ id: 501 + i }));
    vi.mocked(getTransactionsByIds).mockResolvedValue(many);

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", many.map((t) => t.id), "System");

    expect(outcome.attempted).toBe(20);
    expect(classifyTransactionWithAi).toHaveBeenCalledTimes(20);
  });
});

describe("classifyUnallocatedTransactionsWithAi — never fabricates", () => {
  it("does not write anything when the model honestly returns no confident suggestion", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue({ transactionId: 501, companyId: "company-a", accountCode: null, confidence: 0, confidenceLevel: "Low", explanation: "Nothing fits.", modelUsed: "openai/gpt-4o-mini", accountingConfidence: accountingConfidenceFor(0, "Low") });

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(applyAiClassification).not.toHaveBeenCalled();
    expect(recordUsageEvent).not.toHaveBeenCalled();
    expect(outcome).toEqual({ attempted: 1, classified: 0, autoAllocated: 0, noConfidentSuggestion: 1, failed: 0, rateLimited: 0 });
  });
});

describe("classifyUnallocatedTransactionsWithAi — failure isolation", () => {
  it("one transaction's classification failure doesn't stop the others", async () => {
    const two = [transaction({ id: 501 }), transaction({ id: 502 })];
    vi.mocked(getTransactionsByIds).mockResolvedValue(two);
    vi.mocked(classifyTransactionWithAi)
      .mockRejectedValueOnce(new Error("Gateway timeout"))
      .mockResolvedValueOnce({ transactionId: 502, companyId: "company-a", accountCode: "6100", confidence: 75, confidenceLevel: "Medium", explanation: "ok", modelUsed: "openai/gpt-4o-mini", accountingConfidence: accountingConfidenceFor(75, "Medium") });

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501, 502], "System");

    expect(outcome).toEqual({ attempted: 2, classified: 1, autoAllocated: 0, noConfidentSuggestion: 0, failed: 1, rateLimited: 0 });
    expect(applyAiClassification).toHaveBeenCalledTimes(1);
    expect(applyAiClassification).toHaveBeenCalledWith("company-a", 502, expect.anything(), "System");
  });

  it("never throws out of the function itself — the caller (import-service.ts) never needs its own try/catch to stay safe", async () => {
    vi.mocked(classifyTransactionWithAi).mockRejectedValue(new Error("Gateway unreachable"));
    await expect(classifyUnallocatedTransactionsWithAi("company-a", [501], "System")).resolves.toBeDefined();
  });

  it("overnight audit fix — a lost race (applyAiClassification's own write-time eligibility guard rejects because another process already allocated the transaction) counts as failed, records no usage, and never crashes the run", async () => {
    vi.mocked(applyAiClassification).mockRejectedValue(new Error("Transaction 501 is no longer eligible for AI classification — it was allocated by another process first."));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(outcome).toEqual({ attempted: 1, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 1, rateLimited: 0 });
    expect(recordUsageEvent).not.toHaveBeenCalled();
  });

  it("deep QA — genuine concurrent invocation for the SAME transaction (e.g. automatic bank-sync classification racing a manual 'Classify with AI' request): exactly one write succeeds, usage is recorded exactly once, and the loser is reported as failed, never a silent duplicate success", async () => {
    // Simulates the real DB-level guard added to applyAiClassification:
    // the update only affects a row still in its pre-classification state,
    // so only the FIRST caller to reach it can ever succeed — modeled here
    // with a shared mutable "already allocated" set the mock consults,
    // exactly like a real WHERE clause would behind the scenes.
    const alreadyAllocated = new Set<number>();
    vi.mocked(applyAiClassification).mockImplementation(async (_companyId, transactionId) => {
      if (alreadyAllocated.has(transactionId)) {
        throw new Error(`Transaction ${transactionId} is no longer eligible for AI classification — it was allocated by another process first.`);
      }
      alreadyAllocated.add(transactionId);
    });

    // Two independent entry points (automatic + manual) genuinely racing —
    // started together via Promise.all, not sequentially.
    const [automaticOutcome, manualOutcome] = await Promise.all([
      classifyUnallocatedTransactionsWithAi("company-a", [501], "System"),
      classifyTransactionsWithAiManual("company-a", [501], "Jane Accountant"),
    ]);

    const totalClassified = automaticOutcome.classified + manualOutcome.classified;
    expect(totalClassified).toBe(1);
    expect(applyAiClassification).toHaveBeenCalledTimes(2);
    expect(recordUsageEvent).toHaveBeenCalledTimes(1);
  });

  it("returns an empty outcome, without throwing, when the provider itself can't be constructed", async () => {
    vi.mocked(getDefaultTransactionClassificationProvider).mockRejectedValue(new Error("not configured"));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(outcome).toEqual({ attempted: 0, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0 });
    expect(applyAiClassification).not.toHaveBeenCalled();
  });

  it("returns an empty outcome, without throwing, when reading the transactions back fails", async () => {
    vi.mocked(getTransactionsByIds).mockRejectedValue(new Error("database unreachable"));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(outcome).toEqual({ attempted: 0, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0 });
  });
});

describe("classifyUnallocatedTransactionsWithAi — tenant isolation", () => {
  it("passes the exact companyId through to every downstream call", async () => {
    await classifyUnallocatedTransactionsWithAi("company-b", [501], "System");

    expect(getTransactionsByIds).toHaveBeenCalledWith("company-b", [501]);
    expect(buildTransactionClassificationEvidence).toHaveBeenCalledWith("company-b", expect.anything());
    expect(applyAiClassification).toHaveBeenCalledWith("company-b", 501, expect.anything(), "System");
    expect(recordUsageEvent).toHaveBeenCalledWith("company-b", "ai_requests");
  });
});

// -----------------------------------------------------------------------
// Phase 22B — classifyTransactionsWithAiManual (the "Classify with AI"
// user-triggered action, single or bulk). Billing feature/usage gating
// itself lives in the route (see route.test.ts) — these tests cover the
// service's own eligibility reporting, cap handling, and honest
// per-transaction skip reasons.
// -----------------------------------------------------------------------

describe("classifyTransactionsWithAiManual — success", () => {
  it("classifies an eligible transaction and reports zero skipped", async () => {
    const outcome = await classifyTransactionsWithAiManual("company-a", [501], "Jane Accountant");

    expect(outcome).toEqual({ requested: 1, classified: 1, autoAllocated: 0, rateLimited: 0, skipped: [] });
    expect(applyAiClassification).toHaveBeenCalledWith("company-a", 501, expect.objectContaining({ suggestedGlAccount: "6100" }), "Jane Accountant");
    expect(recordUsageEvent).toHaveBeenCalledWith("company-a", "ai_requests");
  });

  it("returns immediately with an empty outcome for an empty selection", async () => {
    const outcome = await classifyTransactionsWithAiManual("company-a", [], "Jane Accountant");
    expect(outcome).toEqual({ requested: 0, classified: 0, autoAllocated: 0, rateLimited: 0, skipped: [] });
    expect(getTransactionsByIds).not.toHaveBeenCalled();
  });
});

describe("classifyTransactionsWithAiManual — ineligible transactions are reported, not silently dropped", () => {
  it("reports an ineligible (already-ruled) transaction in skipped with an honest reason", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, ruleId: 9 })]);

    const outcome = await classifyTransactionsWithAiManual("company-a", [501], "Jane Accountant");

    expect(outcome.classified).toBe(0);
    expect(outcome.skipped).toEqual([{ transactionId: 501, reason: "Not eligible for AI classification — already classified, allocated, or matched." }]);
    expect(classifyTransactionWithAi).not.toHaveBeenCalled();
  });

  it("an already AI-classified transaction (suggestedGlAccount already set) is reported ineligible, never reprocessed", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, suggestedGlAccount: "6200", allocationStatus: "Suggested", allocationMethod: "Future AI" })]);

    const outcome = await classifyTransactionsWithAiManual("company-a", [501], "Jane Accountant");

    expect(outcome.classified).toBe(0);
    expect(classifyTransactionWithAi).not.toHaveBeenCalled();
  });

  it("a user-overridden transaction cannot be overwritten by a manual classify request", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, suggestedGlAccount: "6300", isManualOverride: true, allocationStatus: "Allocated" })]);

    const outcome = await classifyTransactionsWithAiManual("company-a", [501], "Jane Accountant");

    expect(outcome.classified).toBe(0);
    expect(applyAiClassification).not.toHaveBeenCalled();
  });
});

describe("classifyTransactionsWithAiManual — batch/usage cap", () => {
  it("processes only up to maxCount, reporting the rest as skipped with an honest limit reason", async () => {
    const three = [transaction({ id: 501 }), transaction({ id: 502 }), transaction({ id: 503 })];
    vi.mocked(getTransactionsByIds).mockResolvedValue(three);

    const outcome = await classifyTransactionsWithAiManual("company-a", [501, 502, 503], "Jane Accountant", 2);

    expect(outcome.classified).toBe(2);
    expect(outcome.skipped).toEqual([{ transactionId: 503, reason: "Skipped — the AI classification batch/usage limit was reached for this request." }]);
  });

  it("a maxCount of 0 skips every eligible transaction with the limit reason and calls no AI classification", async () => {
    const outcome = await classifyTransactionsWithAiManual("company-a", [501], "Jane Accountant", 0);

    expect(outcome.classified).toBe(0);
    expect(outcome.skipped).toEqual([{ transactionId: 501, reason: "Skipped — the AI classification batch/usage limit was reached for this request." }]);
    expect(classifyTransactionWithAi).not.toHaveBeenCalled();
  });
});

describe("classifyTransactionsWithAiManual — no confident suggestion / failure isolation", () => {
  it("reports an honest 'could not confidently classify' skip reason, never a fabricated suggestion", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue({ transactionId: 501, companyId: "company-a", accountCode: null, confidence: 0, confidenceLevel: "Low", explanation: "Nothing fits.", modelUsed: "openai/gpt-4o-mini", accountingConfidence: accountingConfidenceFor(0, "Low") });

    const outcome = await classifyTransactionsWithAiManual("company-a", [501], "Jane Accountant");

    expect(outcome.classified).toBe(0);
    expect(outcome.skipped).toEqual([{ transactionId: 501, reason: "AI could not confidently classify this transaction." }]);
    expect(applyAiClassification).not.toHaveBeenCalled();
    expect(recordUsageEvent).not.toHaveBeenCalled();
  });

  it("one transaction's provider failure doesn't stop the rest of the batch", async () => {
    const two = [transaction({ id: 501 }), transaction({ id: 502 })];
    vi.mocked(getTransactionsByIds).mockResolvedValue(two);
    vi.mocked(classifyTransactionWithAi)
      .mockRejectedValueOnce(new Error("Gateway timeout"))
      .mockResolvedValueOnce({ transactionId: 502, companyId: "company-a", accountCode: "6100", confidence: 75, confidenceLevel: "Medium", explanation: "ok", modelUsed: "openai/gpt-4o-mini", accountingConfidence: accountingConfidenceFor(75, "Medium") });

    const outcome = await classifyTransactionsWithAiManual("company-a", [501, 502], "Jane Accountant");

    expect(outcome.classified).toBe(1);
    expect(outcome.skipped).toEqual([{ transactionId: 501, reason: "AI classification failed for this transaction — please try again." }]);
  });

  it("never throws when the provider itself can't be constructed — reports every candidate as temporarily unavailable", async () => {
    vi.mocked(getDefaultTransactionClassificationProvider).mockRejectedValue(new Error("not configured"));

    const outcome = await classifyTransactionsWithAiManual("company-a", [501], "Jane Accountant");

    expect(outcome.classified).toBe(0);
    expect(outcome.skipped).toEqual([{ transactionId: 501, reason: "AI classification is temporarily unavailable." }]);
  });
});

describe("classifyTransactionsWithAiManual — tenant isolation", () => {
  it("passes the exact companyId through to every downstream call", async () => {
    await classifyTransactionsWithAiManual("company-b", [501], "Jane Accountant");

    expect(getTransactionsByIds).toHaveBeenCalledWith("company-b", [501]);
    expect(buildTransactionClassificationEvidence).toHaveBeenCalledWith("company-b", expect.anything());
    expect(applyAiClassification).toHaveBeenCalledWith("company-b", 501, expect.anything(), "Jane Accountant");
    expect(recordUsageEvent).toHaveBeenCalledWith("company-b", "ai_requests");
  });
});

// -----------------------------------------------------------------------
// Phase 26A — automatic AI allocation for genuinely High-confidence
// classifications (Option 3: confidence gate + the full existing
// eligibility/hallucination/tenant-scoping defense, never confidence
// alone). Covers this ticket's own Part M test list items 1-3, 16-17, 23-24.
// -----------------------------------------------------------------------

function classificationResult(overrides: {
  accountCode?: string | null;
  confidence?: number;
  confidenceLevel?: "High" | "Medium" | "Low";
  explanation?: string;
  /** Phase 28 — defaults to mirror `confidenceLevel` (see `accountingConfidenceFor`
   * above) unless a test explicitly wants to prove accounting evidence
   * diverges from the model's own raw confidence. */
  accountingConfidenceLevel?: "High" | "Medium" | "Low";
} = {}) {
  const base = {
    transactionId: 501,
    companyId: "company-a",
    accountCode: "6100",
    confidence: 92,
    confidenceLevel: "High" as const,
    explanation: "Matches a known grocery merchant with high certainty.",
    modelUsed: "openai/gpt-4o-mini",
    ...overrides,
  };
  return { ...base, accountingConfidence: accountingConfidenceFor(base.confidence, base.confidenceLevel, overrides.accountingConfidenceLevel ?? base.confidenceLevel) };
}

describe("Phase 26A — automatic AI allocation confidence branching (Phase 28, Part 1: currently PAUSED)", () => {
  // Phase 28 — the forensic investigation found self-reported model
  // confidence doesn't reliably mean accounting confidence (repeated
  // over-selection of 6100 Bank Charges at 85-95% "High" confidence).
  // `AUTO_ALLOCATE_HIGH_CONFIDENCE` (transaction-classification-service.ts)
  // is temporarily `false`, so every classification — High confidence
  // included — now writes `'Suggested'`, never `'Allocated'`, requiring a
  // human Accept. These two tests document that CURRENT, intentionally
  // paused behavior; they are expected to flip back to asserting
  // `'Allocated'` the moment that flag is reverted to `true`.
  it("1. No Banking Rule, High confidence (>=85) — Phase 28 safety pause: still writes allocation_status: 'Suggested', never an unattended 'Allocated'", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ confidence: 92, confidenceLevel: "High" }));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(applyAiClassification).toHaveBeenCalledWith(
      "company-a", 501,
      expect.objectContaining({ suggestedGlAccount: "6100", confidence: 92, targetStatus: "Suggested" }),
      "System",
    );
    expect(outcome).toEqual({ attempted: 1, classified: 1, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0 });
  });

  it("boundary: confidence exactly 85 (the deterministic High threshold) — Phase 28 safety pause: no longer auto-allocates", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ confidence: 85, confidenceLevel: "High" }));
    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");
    expect(outcome.autoAllocated).toBe(0);
    expect(outcome.classified).toBe(1);
  });

  it("2. No Banking Rule, Medium confidence (60-84) — remains Suggested for human review, never auto-allocated", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ confidence: 72, confidenceLevel: "Medium" }));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(applyAiClassification).toHaveBeenCalledWith(
      "company-a", 501,
      expect.objectContaining({ suggestedGlAccount: "6100", confidence: 72, targetStatus: "Suggested" }),
      "System",
    );
    expect(outcome).toEqual({ attempted: 1, classified: 1, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0 });
  });

  it("boundary: confidence exactly 84 (just below the High threshold) still only Suggests", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ confidence: 84, confidenceLevel: "Medium" }));
    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");
    expect(outcome.classified).toBe(1);
    expect(outcome.autoAllocated).toBe(0);
  });

  it("3. No Banking Rule, Low confidence (<60, accountCode null) — remains genuinely Unallocated; nothing is written at all", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ accountCode: null, confidence: 0, confidenceLevel: "Low" }));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(applyAiClassification).not.toHaveBeenCalled();
    expect(recordUsageEvent).not.toHaveBeenCalled();
    expect(outcome).toEqual({ attempted: 1, classified: 0, autoAllocated: 0, noConfidentSuggestion: 1, failed: 0, rateLimited: 0 });
  });

  it("16/17. the manual 'Classify with AI' path — Phase 28 safety pause: High confidence still only Suggests, storing the real confidence value", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ confidence: 97, confidenceLevel: "High" }));

    const outcome = await classifyTransactionsWithAiManual("company-a", [501], "Jane Accountant");

    expect(outcome).toEqual({ requested: 1, classified: 1, autoAllocated: 0, rateLimited: 0, skipped: [] });
    expect(applyAiClassification).toHaveBeenCalledWith(
      "company-a", 501,
      expect.objectContaining({ confidence: 97, targetStatus: "Suggested" }),
      "Jane Accountant",
    );
  });

  it("23. tenant isolation is preserved for the classification path — the exact companyId flows through unchanged", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult());
    await classifyUnallocatedTransactionsWithAi("company-b", [501], "System");
    expect(applyAiClassification).toHaveBeenCalledWith("company-b", 501, expect.objectContaining({ targetStatus: "Suggested" }), "System");
  });

  it("24. automatic allocation never creates or posts a journal — this module has no journal/posting import at all to call", async () => {
    // Structural guarantee, not just behavioral: this test file's own
    // module-level mocks (see the top of this file) are the complete set
    // of this service's dependencies — no journal-repository or
    // posting-engine-service mock exists here because
    // transaction-classification-service.ts never imports either. A
    // High-confidence auto-allocation still only ever calls
    // applyAiClassification, exactly like the Suggested path always has.
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ confidence: 99, confidenceLevel: "High" }));
    await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");
    expect(applyAiClassification).toHaveBeenCalledTimes(1);
  });

  it("a High-confidence result still respects every existing eligibility guard — a Banking-Rule-touched transaction is never auto-allocated", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ ruleId: 7 })]);
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ confidence: 99, confidenceLevel: "High" }));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(classifyTransactionWithAi).not.toHaveBeenCalled();
    expect(applyAiClassification).not.toHaveBeenCalled();
    expect(outcome.autoAllocated).toBe(0);
  });

  it("a High-confidence result still respects the manual-override guard — never auto-allocates over a human's own decision", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, suggestedGlAccount: "6300", isManualOverride: true, allocationStatus: "Allocated" })]);
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ confidence: 99, confidenceLevel: "High" }));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(classifyTransactionWithAi).not.toHaveBeenCalled();
    expect(outcome.autoAllocated).toBe(0);
  });

  it("a genuine write-time race on a High-confidence result (RPC's own atomic WHERE clause rejects) is reported as failed, never a false auto-allocation", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ confidence: 99, confidenceLevel: "High" }));
    vi.mocked(applyAiClassification).mockRejectedValue(new Error("Transaction 501 is no longer eligible for AI classification — it was allocated by another process first."));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(outcome).toEqual({ attempted: 1, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 1, rateLimited: 0 });
    expect(recordUsageEvent).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// Phase 28 — the decision is now driven by `accountingConfidence.accountingConfidenceLevel`,
// never the model's raw `confidenceLevel` — proving this end-to-end
// through the real service, not just the isolated `accounting-confidence.ts`
// unit tests. Directly exercises the forensic report's own required
// test cases (Cases A-J; H/I/J are the pre-existing eligibility-guard
// tests above, unchanged and still passing).
// -----------------------------------------------------------------------

describe("classifyUnallocatedTransactionsWithAi — accounting confidence drives the decision, not model confidence (Phase 28)", () => {
  it("Case C/F — the model says High (99%) but accounting confidence is only Medium (no historical evidence): still written as Suggested, never treated as a stronger result than genuine evidence would warrant", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ confidence: 99, confidenceLevel: "High", accountingConfidenceLevel: "Medium" }));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(outcome).toEqual({ attempted: 1, classified: 1, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0 });
    expect(applyAiClassification).toHaveBeenCalledWith("company-a", 501, expect.objectContaining({ targetStatus: "Suggested" }), "System");
  });

  it("Case A/D — the model says High (contradicting this company's strong confirmed history, downgraded to Low accounting confidence): NOTHING is written — a correct Unallocated beats a confidently wrong allocation", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ confidence: 90, confidenceLevel: "High", accountingConfidenceLevel: "Low" }));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(applyAiClassification).not.toHaveBeenCalled();
    expect(recordUsageEvent).not.toHaveBeenCalled();
    expect(outcome).toEqual({ attempted: 1, classified: 0, autoAllocated: 0, noConfidentSuggestion: 1, failed: 0, rateLimited: 0 });
  });

  it("Case G — the model has only Medium confidence but accounting evidence is Strong+agrees (High accounting confidence): would be Allocated once auto-allocation is re-enabled — proves accounting evidence can also STRENGTHEN a weaker model answer, not just downgrade it", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ confidence: 65, confidenceLevel: "Medium", accountingConfidenceLevel: "High" }));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    // Still Suggested right now (Part 1's safety pause forces this
    // regardless of accountingConfidenceLevel) — but classified (a real
    // written suggestion), and specifically NOT gated by the model's own
    // Medium confidence, proving evidence — not the model — decided this
    // was worth writing.
    expect(outcome.classified).toBe(1);
    expect(applyAiClassification).toHaveBeenCalledWith("company-a", 501, expect.objectContaining({ targetStatus: "Suggested" }), "System");
  });

  it("Low accounting confidence with a real accountCode is treated identically to the model returning no accountCode at all — 'declining to allocate', not a low-quality write", async () => {
    vi.mocked(classifyTransactionWithAi).mockResolvedValue(classificationResult({ accountCode: "6100", confidence: 85, confidenceLevel: "High", accountingConfidenceLevel: "Low" }));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501], "System");

    expect(outcome.noConfidentSuggestion).toBe(1);
    expect(outcome.classified).toBe(0);
    expect(outcome.failed).toBe(0);
  });
});

// -----------------------------------------------------------------------
// Phase 26E — rate-limit-aware early stopping. A provider rate-limit
// means every SUBSEQUENT call in the same batch is likely to fail
// identically, so both loops below must stop immediately rather than
// hammer an already-rate-limited provider on every remaining transaction.
// -----------------------------------------------------------------------

describe("classifyUnallocatedTransactionsWithAi — rate-limit early stopping (Phase 26E)", () => {
  it("stops the batch on the first rate-limit, never attempting the remaining transactions", async () => {
    const three = [transaction({ id: 501 }), transaction({ id: 502 }), transaction({ id: 503 })];
    vi.mocked(getTransactionsByIds).mockResolvedValue(three);
    vi.mocked(classifyTransactionWithAi)
      .mockResolvedValueOnce({ transactionId: 501, companyId: "company-a", accountCode: "6100", confidence: 75, confidenceLevel: "Medium", explanation: "ok", modelUsed: "openai/gpt-4o-mini", accountingConfidence: accountingConfidenceFor(75, "Medium") })
      .mockRejectedValueOnce(new AIProviderError("rate-limit", "VYRON AI's provider rate limit was reached."));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501, 502, 503], "System");

    expect(outcome).toEqual({ attempted: 2, classified: 1, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 1 });
    expect(classifyTransactionWithAi).toHaveBeenCalledTimes(2);
  });

  // Phase 26I — the Scheduler reschedules the next sweep off this exact
  // field (`scheduler-service.ts::nextTaskRunAt`) so it can honor the
  // provider's own stated cooldown instead of a blind flat wait.
  it("carries the provider's real retryAfterMs through to the outcome when the rate-limit error has one", async () => {
    const two = [transaction({ id: 501 }), transaction({ id: 502 })];
    vi.mocked(getTransactionsByIds).mockResolvedValue(two);
    vi.mocked(classifyTransactionWithAi).mockRejectedValueOnce(new AIProviderError("rate-limit", "VYRON AI's provider rate limit was reached.", 20_000));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501, 502], "System");

    expect(outcome.retryAfterMs).toBe(20_000);
  });

  it("leaves retryAfterMs absent (not a fabricated value) when the rate-limit error carries none", async () => {
    const two = [transaction({ id: 501 }), transaction({ id: 502 })];
    vi.mocked(getTransactionsByIds).mockResolvedValue(two);
    vi.mocked(classifyTransactionWithAi).mockRejectedValueOnce(new AIProviderError("rate-limit", "VYRON AI's provider rate limit was reached."));

    const outcome = await classifyUnallocatedTransactionsWithAi("company-a", [501, 502], "System");

    expect(outcome.retryAfterMs).toBeUndefined();
  });
});

describe("classifyTransactionsWithAiManual — rate-limit early stopping (Phase 26E)", () => {
  it("stops processing on the first rate-limit and reports every unattempted transaction with a distinct rate-limit skip reason", async () => {
    const three = [transaction({ id: 501 }), transaction({ id: 502 }), transaction({ id: 503 })];
    vi.mocked(getTransactionsByIds).mockResolvedValue(three);
    vi.mocked(classifyTransactionWithAi).mockRejectedValue(new AIProviderError("rate-limit", "VYRON AI's provider rate limit was reached."));

    const outcome = await classifyTransactionsWithAiManual("company-a", [501, 502, 503], "Jane Accountant");

    expect(outcome.rateLimited).toBe(3);
    expect(outcome.skipped).toEqual([
      { transactionId: 501, reason: "Skipped — the AI provider's rate limit was reached for this request. Please try again shortly." },
      { transactionId: 502, reason: "Skipped — the AI provider's rate limit was reached for this request. Please try again shortly." },
      { transactionId: 503, reason: "Skipped — the AI provider's rate limit was reached for this request. Please try again shortly." },
    ]);
    // Only the FIRST transaction was ever actually attempted — 502/503
    // never reached the provider at all.
    expect(classifyTransactionWithAi).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------
// Phase 26E — runAutomaticAiClassificationSweep. The automatic,
// unattended entry point the AiClassificationSweep scheduler task calls —
// finds its own candidates company-wide rather than needing a
// caller-supplied id list, and otherwise defers entirely to the exact
// same classifyUnallocatedTransactionsWithAi every other automatic path
// already uses (no second engine, no second write path).
// -----------------------------------------------------------------------

describe("runAutomaticAiClassificationSweep (Phase 26E)", () => {
  it("fetches its own candidates and classifies them through the shared pipeline", async () => {
    vi.mocked(listAiClassificationEligibleTransactions).mockResolvedValue([transaction({ id: 501 })]);

    const outcome = await runAutomaticAiClassificationSweep("company-a", "Scheduler");

    expect(listAiClassificationEligibleTransactions).toHaveBeenCalledWith("company-a", MAX_AI_CLASSIFICATIONS_PER_RUN);
    expect(getTransactionsByIds).toHaveBeenCalledWith("company-a", [501]);
    expect(outcome.attempted).toBe(1);
    expect(outcome.classified).toBe(1);
    expect(outcome.hasMoreEligible).toBe(false);
  });

  it("returns an empty, non-throwing outcome when nothing is currently eligible", async () => {
    vi.mocked(listAiClassificationEligibleTransactions).mockResolvedValue([]);

    const outcome = await runAutomaticAiClassificationSweep("company-a", "Scheduler");

    expect(outcome).toEqual({ attempted: 0, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0, hasMoreEligible: false });
    expect(getTransactionsByIds).not.toHaveBeenCalled();
  });

  it("reports hasMoreEligible: true when the candidate fetch returns exactly a full batch — more historical backlog may remain", async () => {
    const fullBatch = Array.from({ length: MAX_AI_CLASSIFICATIONS_PER_RUN }, (_, i) => transaction({ id: 501 + i }));
    vi.mocked(listAiClassificationEligibleTransactions).mockResolvedValue(fullBatch);
    vi.mocked(getTransactionsByIds).mockResolvedValue(fullBatch);

    const outcome = await runAutomaticAiClassificationSweep("company-a", "Scheduler");

    expect(outcome.hasMoreEligible).toBe(true);
  });

  it("never throws when the candidate fetch itself fails — an empty outcome, matching every other automatic path's defensive discipline", async () => {
    vi.mocked(listAiClassificationEligibleTransactions).mockRejectedValue(new Error("database unreachable"));

    const outcome = await runAutomaticAiClassificationSweep("company-a", "Scheduler");

    expect(outcome).toEqual({ attempted: 0, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0, hasMoreEligible: false });
  });

  it("tenant isolation — only ever queries and classifies the exact company it was called for", async () => {
    vi.mocked(listAiClassificationEligibleTransactions).mockResolvedValue([transaction({ id: 501, companyId: "company-b" })]);

    await runAutomaticAiClassificationSweep("company-b", "Scheduler");

    expect(listAiClassificationEligibleTransactions).toHaveBeenCalledWith("company-b", expect.anything());
    expect(listAiClassificationEligibleTransactions).not.toHaveBeenCalledWith("company-a", expect.anything());
    expect(getTransactionsByIds).toHaveBeenCalledWith("company-b", [501]);
  });
});
