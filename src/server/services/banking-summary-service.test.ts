import { describe, expect, it } from "vitest";
import { buildBankingAutomationSummary } from "./banking-summary-service";
import type { BankingAutomationAggregate } from "@/server/repositories/transaction-explorer-repository";
import type { BankingException, BankingRuleApplication } from "@/server/banking-rules/types";

const EMPTY_AGGREGATE: BankingAutomationAggregate = {
  totalTransactions: 0, automated: 0, imported: 0, importedMatched: 0,
  importedRuleApplied: 0, importedRuleSucceeded: 0, importedWithConfidence: 0, importedConfidenceSum: 0,
};

function aggregate(overrides: Partial<BankingAutomationAggregate>): BankingAutomationAggregate {
  return { ...EMPTY_AGGREGATE, ...overrides };
}

function exception(overrides: Partial<BankingException>): BankingException {
  return {
    id: 1, companyId: "co_1", bankTransactionId: 1, exceptionType: "UnknownMerchant", reason: "", evidence: "",
    recommendedAction: "", status: "Open", resolvedBy: null, resolvedAt: null, resolutionNote: null, createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildBankingAutomationSummary", () => {
  // Launch Blocker fix (post-RC2): this function used to take a full
  // BankTransactionRecord[] and count `ruleId !== null && journalId !==
  // null` itself in JavaScript. That counting now happens server-side
  // (fn_banking_automation_summary(), migration
  // 0039_banking_automation_aggregate.sql) — these tests assert the
  // function correctly uses the pre-computed aggregate's numbers, not
  // that it can re-derive them from raw rows (that predicate is now
  // proven by a live EXPLAIN ANALYZE / SQL correctness check instead,
  // see MIGRATION_ROADMAP.md's Launch Blocker section).
  it("computes the automation rate from the aggregate's automated/total counts", () => {
    const summary = buildBankingAutomationSummary(aggregate({ totalTransactions: 4, automated: 1 }), [], [], [], "2026-08-01");
    expect(summary.transactionsAutomaticallyProcessed).toBe(1);
    expect(summary.automationRatePercent).toBe(25);
  });

  it("returns 0% automation rate when there are no transactions", () => {
    const summary = buildBankingAutomationSummary(EMPTY_AGGREGATE, [], [], [], "2026-08-01");
    expect(summary.automationRatePercent).toBe(0);
  });

  it("counts today's imports by date prefix", () => {
    const summary = buildBankingAutomationSummary(EMPTY_AGGREGATE, ["2026-08-01T09:00:00Z", "2026-07-31T09:00:00Z"], [], [], "2026-08-01");
    expect(summary.todaysImportCount).toBe(1);
  });

  it("counts only Open exceptions toward exceptionsAwaitingReview, unknownMerchantCount, and duplicateDetectionCount", () => {
    const exceptions: BankingException[] = [
      exception({ id: 1, exceptionType: "UnknownMerchant", status: "Open" }),
      exception({ id: 2, exceptionType: "UnknownMerchant", status: "Resolved" }),
      exception({ id: 3, exceptionType: "PossibleDuplicate", status: "Open" }),
    ];
    const summary = buildBankingAutomationSummary(EMPTY_AGGREGATE, [], exceptions, [], "2026-08-01");
    expect(summary.exceptionsAwaitingReview).toBe(2);
    expect(summary.unknownMerchantCount).toBe(1);
    expect(summary.duplicateDetectionCount).toBe(1);
  });

  it("counts rule applications only from today", () => {
    const applications: BankingRuleApplication[] = [
      { id: 1, ruleId: 1, bankTransactionId: 1, appliedAt: "2026-08-01T08:00:00Z" },
      { id: 2, ruleId: 1, bankTransactionId: 2, appliedAt: "2026-07-30T08:00:00Z" },
    ];
    const summary = buildBankingAutomationSummary(EMPTY_AGGREGATE, [], [], applications, "2026-08-01");
    expect(summary.rulesAppliedToday).toBe(1);
  });
});
