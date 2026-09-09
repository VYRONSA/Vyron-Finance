/**
 * Shared Matching Platform dashboard math — the single place Matching
 * Accuracy/Auto Match %/Manual Queue/Duplicate Risk/Rule Success Rate/AI
 * Confidence/Unresolved Exceptions are computed, so the Matching
 * Workspace's own Dashboard tab and the Executive Dashboard can never
 * quietly restate the same numbers differently. Mirrors every other
 * module's `buildXDashboardSummary` — pure, unit tested, no duplicated
 * calculation of what `banking-summary-service.ts`/`matching-queue-service.ts`
 * already own.
 *
 * Launch Blocker fix (post-RC2 Product Review Board directive): took a
 * full `BankTransactionRecord[]` and reduced it in JavaScript — the
 * same unbounded-history pattern fixed in `banking-summary-service.ts`
 * (see that file's own comment for the full evidence). Now takes the
 * same server-side `BankingAutomationAggregate`.
 */

import type { BankingAutomationAggregate } from "@/server/repositories/transaction-explorer-repository";
import type { MatchingQueueItem } from "./matching-queue-service";

export type MatchingSummary = {
  matchingAccuracyPercent: number;
  autoMatchPercent: number;
  manualQueueCount: number;
  duplicateRiskCount: number;
  ruleSuccessRatePercent: number;
  aiConfidencePercent: number;
  unresolvedExceptionsCount: number;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

const DUPLICATE_QUEUE_TYPES = new Set(["DuplicatePayment", "DuplicateCustomer", "DuplicateSupplier"]);

/** Pure. `automationRatePercent`/`exceptionsAwaitingReview` are passed in
 * from `banking-summary-service.ts::buildBankingAutomationSummary` —
 * reused, not recomputed. */
export function buildMatchingSummary(
  aggregate: BankingAutomationAggregate,
  queue: MatchingQueueItem[],
  automationRatePercent: number,
  exceptionsAwaitingReview: number,
): MatchingSummary {
  const matchingAccuracyPercent = aggregate.imported > 0 ? round1((aggregate.importedMatched / aggregate.imported) * 100) : 0;
  const ruleSuccessRatePercent = aggregate.importedRuleApplied > 0 ? round1((aggregate.importedRuleSucceeded / aggregate.importedRuleApplied) * 100) : 0;
  const aiConfidencePercent = aggregate.importedWithConfidence > 0 ? round1(aggregate.importedConfidenceSum / aggregate.importedWithConfidence) : 0;

  const duplicateRiskCount = queue.filter((item) => DUPLICATE_QUEUE_TYPES.has(item.itemType)).length;

  return {
    matchingAccuracyPercent,
    autoMatchPercent: round1(automationRatePercent),
    manualQueueCount: queue.length,
    duplicateRiskCount,
    ruleSuccessRatePercent,
    aiConfidencePercent,
    unresolvedExceptionsCount: exceptionsAwaitingReview,
  };
}
