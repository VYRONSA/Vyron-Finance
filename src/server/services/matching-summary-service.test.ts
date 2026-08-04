import { describe, expect, it } from "vitest";
import { buildMatchingSummary } from "./matching-summary-service";
import type { BankingAutomationAggregate } from "@/server/repositories/transaction-explorer-repository";
import type { MatchingQueueItem } from "./matching-queue-service";

const EMPTY_AGGREGATE: BankingAutomationAggregate = {
  totalTransactions: 0, automated: 0, imported: 0, importedMatched: 0,
  importedRuleApplied: 0, importedRuleSucceeded: 0, importedWithConfidence: 0, importedConfidenceSum: 0,
};

function aggregate(overrides: Partial<BankingAutomationAggregate>): BankingAutomationAggregate {
  return { ...EMPTY_AGGREGATE, ...overrides };
}

function queueItem(itemType: MatchingQueueItem["itemType"]): MatchingQueueItem {
  return { id: `${itemType}:1`, itemType, description: "x", amount: null, date: null, confidence: null, detailHref: "#" };
}

// Launch Blocker fix (post-RC2): this function used to take a full
// BankTransactionRecord[] and filter/reduce it in JavaScript. That
// counting now happens server-side (fn_banking_automation_summary(),
// migration 0039_banking_automation_aggregate.sql) — these tests assert
// the pure arithmetic on a pre-computed aggregate is still correct, not
// that the function can re-derive counts from raw rows (that's now a
// SQL correctness concern, verified separately — see
// MIGRATION_ROADMAP.md's Launch Blocker section).
describe("buildMatchingSummary", () => {
  it("computes matching accuracy from the share of Matched imported transactions", () => {
    // 4 imported, 2 Matched (mirrors the original 4-transaction fixture)
    const summary = buildMatchingSummary(aggregate({ imported: 4, importedMatched: 2 }), [], 80, 2);
    expect(summary.matchingAccuracyPercent).toBe(50);
  });

  it("excludes manually captured Cashbook entries from matching accuracy", () => {
    // 1 Imported+Matched, 1 Manual+Unallocated — the aggregate's own
    // `imported`/`importedMatched` counts are already scoped to
    // entry_source = 'Imported' server-side, so the Manual row is
    // already excluded before this function ever sees it.
    const summary = buildMatchingSummary(aggregate({ imported: 1, importedMatched: 1 }), [], 80, 0);
    expect(summary.matchingAccuracyPercent).toBe(100);
  });

  it("computes rule success rate only across rule-applied transactions", () => {
    // 3 imported; 2 rule-applied (1 succeeded — Allocated, 1 pending —
    // Suggested); 1 not rule-applied, excluded from the rule-applied
    // denominator by the aggregate itself.
    const summary = buildMatchingSummary(aggregate({ imported: 3, importedRuleApplied: 2, importedRuleSucceeded: 1 }), [], 0, 0);
    expect(summary.ruleSuccessRatePercent).toBe(50);
  });

  it("averages AI confidence only across transactions that have a real score", () => {
    // 3 imported; 2 with a confidence score (90, 70 — sum 160), 1 without.
    const summary = buildMatchingSummary(aggregate({ imported: 3, importedWithConfidence: 2, importedConfidenceSum: 160 }), [], 0, 0);
    expect(summary.aiConfidencePercent).toBe(80);
  });

  it("counts duplicate-risk queue items but not other queue item types", () => {
    const queue = [queueItem("DuplicatePayment"), queueItem("DuplicateCustomer"), queueItem("BankTransaction"), queueItem("UnallocatedInvoice")];
    const summary = buildMatchingSummary(EMPTY_AGGREGATE, queue, 0, 0);
    expect(summary.duplicateRiskCount).toBe(2);
    expect(summary.manualQueueCount).toBe(4);
  });

  it("passes through Auto Match % and Unresolved Exceptions from the reused banking summary", () => {
    const summary = buildMatchingSummary(EMPTY_AGGREGATE, [], 87.5, 5);
    expect(summary.autoMatchPercent).toBe(87.5);
    expect(summary.unresolvedExceptionsCount).toBe(5);
  });

  it("returns zero rates rather than NaN when there is no data", () => {
    const summary = buildMatchingSummary(EMPTY_AGGREGATE, [], 0, 0);
    expect(summary.matchingAccuracyPercent).toBe(0);
    expect(summary.ruleSuccessRatePercent).toBe(0);
    expect(summary.aiConfidencePercent).toBe(0);
  });
});
