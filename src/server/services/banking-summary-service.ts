/**
 * Dashboard aggregates for Banking Automation & Rule Intelligence.
 *
 * Launch Blocker fix (post-RC2 Product Review Board directive): this
 * function used to take the company's ENTIRE bank transaction array and
 * `.filter()`/`.length` its way to a ratio — the exact pattern RC2's own
 * load testing proved doesn't scale (Dashboard response time regressed
 * from 3.2s to 5.6-8.3s at just 20,000 transactions, with no upper
 * bound, since every caller pulled full history through a
 * 1,000-row-per-request-capped export path). It now takes a
 * `BankingAutomationAggregate` — 8 numbers computed server-side by
 * `fn_banking_automation_summary()` (migration
 * 0039_banking_automation_aggregate.sql) in one query, never loading
 * transaction rows into application memory at all for this purpose.
 * Verified against 300,000 synthetic rows (15x RC2's own test size) —
 * see MIGRATION_ROADMAP.md's Launch Blocker section for the exact
 * before/after evidence.
 */

import type { BankingException, BankingRuleApplication } from "@/server/banking-rules/types";
import type { BankingAutomationAggregate } from "@/server/repositories/transaction-explorer-repository";

export type BankingAutomationSummary = {
  todaysImportCount: number;
  automationRatePercent: number;
  transactionsAutomaticallyProcessed: number;
  exceptionsAwaitingReview: number;
  rulesAppliedToday: number;
  unknownMerchantCount: number;
  duplicateDetectionCount: number;
};

export function buildBankingAutomationSummary(
  aggregate: BankingAutomationAggregate,
  importBatchCreatedDates: string[],
  exceptions: BankingException[],
  ruleApplications: BankingRuleApplication[],
  todayIso: string,
): BankingAutomationSummary {
  const openExceptions = exceptions.filter((e) => e.status === "Open");

  return {
    todaysImportCount: importBatchCreatedDates.filter((d) => d.slice(0, 10) === todayIso).length,
    automationRatePercent: aggregate.totalTransactions === 0 ? 0 : Math.round((aggregate.automated / aggregate.totalTransactions) * 1000) / 10,
    transactionsAutomaticallyProcessed: aggregate.automated,
    exceptionsAwaitingReview: openExceptions.length,
    rulesAppliedToday: ruleApplications.filter((a) => a.appliedAt.slice(0, 10) === todayIso).length,
    unknownMerchantCount: openExceptions.filter((e) => e.exceptionType === "UnknownMerchant").length,
    duplicateDetectionCount: openExceptions.filter((e) => e.exceptionType === "PossibleDuplicate").length,
  };
}
