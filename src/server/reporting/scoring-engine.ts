/**
 * Pure scoring functions for the Executive Command Centre — Financial
 * Health, Business Risk, Audit Readiness. Every score is a disclosed,
 * transparent formula over REAL inputs the caller supplies (see
 * `executive-intelligence-service.ts` for where those inputs come from);
 * none of this is a black-box model, and every deduction traces to a
 * named, visible cause — same discipline as VAT's own
 * `computeComplianceScore`, which the Compliance Score below reuses
 * directly rather than reimplementing ("Do not create another AI
 * engine... Expand it").
 */

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export type FinancialHealthInputs = {
  /** Balance Sheet's own `isBalanced` — a real accounting-integrity
   * check, not a health metric per se, but a false value means every
   * other figure here is untrustworthy, so it dominates the score. */
  isBalanceSheetBalanced: boolean;
  /** totalAssets / totalLiabilities — a simple solvency ratio (no
   * current/non-current split exists yet in this Chart of Accounts). */
  assetToLiabilityRatio: number;
  /** netProfit / revenue for the period, e.g. 0.15 = 15% margin. Null
   * when revenue is zero (no meaningful margin to compute). */
  netProfitMarginPercent: number | null;
  /** True when the Cashflow Forecast's fitted trend slope is >= 0. */
  cashTrendImproving: boolean;
};

/** 100 = excellent. Deducts real, visible amounts: 40 points if the
 * Balance Sheet itself doesn't balance (a data-integrity failure, not a
 * business-health one — dominates deliberately), up to 25 for weak
 * solvency, up to 25 for a negative/thin margin, 10 for a declining
 * cash trend. */
export function computeFinancialHealthScore(inputs: FinancialHealthInputs): number {
  let score = 100;
  if (!inputs.isBalanceSheetBalanced) score -= 40;

  if (inputs.assetToLiabilityRatio < 1) score -= 25;
  else if (inputs.assetToLiabilityRatio < 1.5) score -= 12;

  if (inputs.netProfitMarginPercent === null || inputs.netProfitMarginPercent < 0) score -= 25;
  else if (inputs.netProfitMarginPercent < 0.05) score -= 12;

  if (!inputs.cashTrendImproving) score -= 10;

  return clampScore(score);
}

export type BusinessRiskInputs = {
  openBankingExceptionCount: number;
  openVatExceptionCount: number;
  highRiskVatTransactionCount: number;
  overdueDebtorsCount: number; // debtors aged past 90 days
  supplierConcentrationRiskCount: number; // suppliers over a concentration threshold
  duplicateTransactionSuspectCount: number;
};

/** 0 = no detected risk, 100 = severe. Every point traces to a specific
 * count the caller measured from real data — 3 points per open Banking
 * Exception, 4 per open VAT Exception (higher weight — compliance
 * exposure), 5 per high-risk VAT transaction, 2 per overdue debtor, 6
 * per concentrated supplier, 5 per suspected duplicate. */
export function computeBusinessRiskScore(inputs: BusinessRiskInputs): number {
  const raw =
    inputs.openBankingExceptionCount * 3 +
    inputs.openVatExceptionCount * 4 +
    inputs.highRiskVatTransactionCount * 5 +
    inputs.overdueDebtorsCount * 2 +
    inputs.supplierConcentrationRiskCount * 6 +
    inputs.duplicateTransactionSuspectCount * 5;
  return clampScore(raw);
}

export type AuditReadinessInputs = {
  /** Approved journals still unposted past the Financial Intelligence
   * module's own staleness threshold — `findMissingPostings`. */
  stalePostingCount: number;
  /** Draft journals stale beyond the same threshold. */
  staleDraftCount: number;
  openBankingExceptionCount: number;
  openVatExceptionCount: number;
  /** Automation tasks whose retries were exhausted (a real failure the
   * automation Audit Trail already records). */
  failedAutomationTaskCount: number;
};

/** 100 = fully audit-ready. Every unposted/stale item and open exception
 * is something an auditor would flag, so each one costs real points. */
export function computeAuditReadinessScore(inputs: AuditReadinessInputs): number {
  const deduction =
    inputs.stalePostingCount * 4 +
    inputs.staleDraftCount * 2 +
    inputs.openBankingExceptionCount * 2 +
    inputs.openVatExceptionCount * 3 +
    inputs.failedAutomationTaskCount * 3;
  return clampScore(100 - deduction);
}
