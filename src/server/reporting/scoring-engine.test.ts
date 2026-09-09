import { describe, expect, it } from "vitest";
import { computeAuditReadinessScore, computeBusinessRiskScore, computeFinancialHealthScore } from "./scoring-engine";

describe("computeFinancialHealthScore", () => {
  it("scores 100 for a perfectly healthy company", () => {
    const score = computeFinancialHealthScore({ isBalanceSheetBalanced: true, assetToLiabilityRatio: 2, netProfitMarginPercent: 0.2, cashTrendImproving: true });
    expect(score).toBe(100);
  });

  it("heavily penalizes an unbalanced Balance Sheet — a data-integrity failure, not just weak health", () => {
    const healthy = computeFinancialHealthScore({ isBalanceSheetBalanced: true, assetToLiabilityRatio: 2, netProfitMarginPercent: 0.2, cashTrendImproving: true });
    const broken = computeFinancialHealthScore({ isBalanceSheetBalanced: false, assetToLiabilityRatio: 2, netProfitMarginPercent: 0.2, cashTrendImproving: true });
    expect(healthy - broken).toBe(40);
  });

  it("treats a null margin (zero revenue) the same as a loss", () => {
    const nullMargin = computeFinancialHealthScore({ isBalanceSheetBalanced: true, assetToLiabilityRatio: 2, netProfitMarginPercent: null, cashTrendImproving: true });
    const lossMargin = computeFinancialHealthScore({ isBalanceSheetBalanced: true, assetToLiabilityRatio: 2, netProfitMarginPercent: -0.1, cashTrendImproving: true });
    expect(nullMargin).toBe(lossMargin);
  });

  it("never goes below 0 even with every penalty stacked", () => {
    const score = computeFinancialHealthScore({ isBalanceSheetBalanced: false, assetToLiabilityRatio: 0.2, netProfitMarginPercent: -0.5, cashTrendImproving: false });
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe("computeBusinessRiskScore", () => {
  it("is 0 with no risk signals at all", () => {
    expect(computeBusinessRiskScore({ openBankingExceptionCount: 0, openVatExceptionCount: 0, highRiskVatTransactionCount: 0, overdueDebtorsCount: 0, supplierConcentrationRiskCount: 0, duplicateTransactionSuspectCount: 0 })).toBe(0);
  });

  it("weights VAT exceptions and duplicates more heavily than routine banking exceptions", () => {
    const oneVat = computeBusinessRiskScore({ openBankingExceptionCount: 0, openVatExceptionCount: 1, highRiskVatTransactionCount: 0, overdueDebtorsCount: 0, supplierConcentrationRiskCount: 0, duplicateTransactionSuspectCount: 0 });
    const oneBanking = computeBusinessRiskScore({ openBankingExceptionCount: 1, openVatExceptionCount: 0, highRiskVatTransactionCount: 0, overdueDebtorsCount: 0, supplierConcentrationRiskCount: 0, duplicateTransactionSuspectCount: 0 });
    expect(oneVat).toBeGreaterThan(oneBanking);
  });

  it("caps at 100 even with an extreme number of risk signals", () => {
    expect(computeBusinessRiskScore({ openBankingExceptionCount: 100, openVatExceptionCount: 100, highRiskVatTransactionCount: 100, overdueDebtorsCount: 100, supplierConcentrationRiskCount: 100, duplicateTransactionSuspectCount: 100 })).toBe(100);
  });
});

describe("computeAuditReadinessScore", () => {
  it("is 100 with nothing outstanding", () => {
    expect(computeAuditReadinessScore({ stalePostingCount: 0, staleDraftCount: 0, openBankingExceptionCount: 0, openVatExceptionCount: 0, failedAutomationTaskCount: 0 })).toBe(100);
  });

  it("deducts more for a stale unposted Approved journal than a stale Draft", () => {
    const posting = computeAuditReadinessScore({ stalePostingCount: 1, staleDraftCount: 0, openBankingExceptionCount: 0, openVatExceptionCount: 0, failedAutomationTaskCount: 0 });
    const draft = computeAuditReadinessScore({ stalePostingCount: 0, staleDraftCount: 1, openBankingExceptionCount: 0, openVatExceptionCount: 0, failedAutomationTaskCount: 0 });
    expect(posting).toBeLessThan(draft);
  });
});
