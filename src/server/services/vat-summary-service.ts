/**
 * VAT Dashboard aggregates — pure, computed from already-fetched data,
 * same "no DB-side aggregate needed at this scale yet" approach as every
 * other summary service in this codebase.
 */

import type { VatException, VatReturn } from "@/server/vat/types";

export type VatDashboardSummary = {
  vatPayable: number;
  vatReceivable: number;
  draftReturnCount: number;
  openExceptionCount: number;
  complianceScorePercent: number;
  highRiskTransactionCount: number;
};

/** 100, minus a real penalty per open exception (more for higher-
 * severity types) and per overdue Draft return — never fabricated, every
 * point deducted traces to a specific, visible cause. */
export function computeComplianceScore(openExceptions: VatException[], draftReturnCount: number): number {
  const SEVERITY_PENALTY: Record<VatException["exceptionType"], number> = {
    MissingVatNumber: 3,
    IncorrectVatCode: 4,
    UnexpectedVatPercentage: 4,
    LargeVatAdjustment: 5,
    DuplicateVatClaim: 6,
    VatRateConflict: 5,
    CrossPeriodVat: 5,
  };
  const exceptionPenalty = openExceptions.reduce((sum, e) => sum + (SEVERITY_PENALTY[e.exceptionType] ?? 3), 0);
  const draftPenalty = draftReturnCount * 2;
  return Math.max(0, Math.round(100 - exceptionPenalty - draftPenalty));
}

/** `exceptions` may be any mix of statuses — filtered to Open internally,
 * so callers can pass either an already-Open-only list or the full set. */
export function buildVatDashboardSummary(
  latestReturn: VatReturn | null,
  vatReturns: VatReturn[],
  exceptions: VatException[],
  highRiskTransactionCount: number,
): VatDashboardSummary {
  const netPayable = latestReturn?.netPayable ?? 0;
  const draftReturnCount = vatReturns.filter((r) => r.status === "Draft").length;
  const openExceptions = exceptions.filter((e) => e.status === "Open");

  return {
    vatPayable: netPayable > 0 ? netPayable : 0,
    vatReceivable: netPayable < 0 ? Math.abs(netPayable) : 0,
    draftReturnCount,
    openExceptionCount: openExceptions.length,
    complianceScorePercent: computeComplianceScore(openExceptions, draftReturnCount),
    highRiskTransactionCount,
  };
}
