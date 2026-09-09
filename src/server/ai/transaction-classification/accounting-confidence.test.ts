/**
 * Phase 28 — regression coverage for the accounting-confidence decision
 * table, directly exercising the forensic report's own required test
 * cases (Cases A-G; H/I/J are eligibility-layer guarantees, already
 * covered by `transaction-classification-service.test.ts`'s existing
 * "still respects every existing eligibility guard" tests, unchanged by
 * this phase).
 */
import { describe, expect, it } from "vitest";
import { assessAccountingConfidence } from "./accounting-confidence";
import type { CompanyHistoricalPatternEvidence } from "./company-historical-evidence";

const PATTERN = { prefix: "FNB OB Pmt", amountBand: "5000-25000", direction: "Debit" as const };

function evidence(overrides: Partial<CompanyHistoricalPatternEvidence> = {}): CompanyHistoricalPatternEvidence {
  return { pattern: PATTERN, sampleSize: 0, accounts: [], strength: "None", dominantAccountCode: null, isAmbiguous: false, ...overrides };
}

describe("assessAccountingConfidence", () => {
  it("Case E — strong human-confirmed evidence + model agreement: High accounting confidence, explanation names the real historical count", () => {
    const strongEvidence = evidence({
      strength: "Strong",
      dominantAccountCode: "6940",
      accounts: [{ accountCode: "6940", humanConfirmedCount: 18, aiOnlyCount: 0, totalCount: 18 }],
    });
    const result = assessAccountingConfidence({ accountCode: "6940", confidence: 90 }, strongEvidence);

    expect(result.accountingConfidenceLevel).toBe("High");
    expect(result.agreesWithHistory).toBe(true);
    expect(result.explanation).toContain("confirmed 18 times");
    expect(result.explanation).toContain("6940");
    // The exact failure mode the forensic report found — this new
    // explanation never reasons from the narration string itself.
    expect(result.explanation.toLowerCase()).not.toContain("fnb");
    expect(result.explanation.toLowerCase()).not.toContain("indicates a payment to the bank");
  });

  it("Case A/D — strong human-confirmed evidence contradicted by the model: downgraded to Low, never High, evidence overrides the model", () => {
    const strongEvidence = evidence({
      strength: "Strong",
      dominantAccountCode: "6940",
      accounts: [{ accountCode: "6940", humanConfirmedCount: 5, aiOnlyCount: 0, totalCount: 5 }],
    });
    // The model wrongly says Bank Charges (6100) despite strong Salaries & Wages history — the exact production defect.
    const result = assessAccountingConfidence({ accountCode: "6100", confidence: 90 }, strongEvidence);

    expect(result.accountingConfidenceLevel).toBe("Low");
    expect(result.agreesWithHistory).toBe(false);
    expect(result.explanation).toContain("6940");
    expect(result.explanation).toContain("overrides the model");
  });

  it("Case B — a genuine small bank fee WITH strong confirmed history: High confidence, correctly", () => {
    const strongEvidence = evidence({
      strength: "Strong",
      dominantAccountCode: "6100",
      accounts: [{ accountCode: "6100", humanConfirmedCount: 4, aiOnlyCount: 0, totalCount: 4 }],
    });
    const result = assessAccountingConfidence({ accountCode: "6100", confidence: 95 }, strongEvidence);
    expect(result.accountingConfidenceLevel).toBe("High");
  });

  it("Case C/F — no historical evidence at all: model's own High confidence is NEVER enough on its own for High accounting confidence", () => {
    const noEvidence = evidence({ strength: "None" });
    const result = assessAccountingConfidence({ accountCode: "6100", confidence: 95 }, noEvidence);

    expect(result.accountingConfidenceLevel).not.toBe("High");
    expect(result.accountingConfidenceLevel).toBe("Medium");
    expect(result.explanation).toContain("No company historical pattern");
  });

  it("Case C — even Medium model confidence with no evidence is left as-is (never upgraded), only High is ever capped down", () => {
    const noEvidence = evidence({ strength: "None" });
    const result = assessAccountingConfidence({ accountCode: "6100", confidence: 70 }, noEvidence);
    expect(result.accountingConfidenceLevel).toBe("Medium");
  });

  it("Case G — ONLY prior AI (unconfirmed) allocations exist: capped at Low regardless of model confidence, never treated as human-equivalent evidence", () => {
    const weakEvidence = evidence({
      strength: "Weak",
      dominantAccountCode: null,
      accounts: [{ accountCode: "6100", humanConfirmedCount: 0, aiOnlyCount: 6, totalCount: 6 }],
    });
    const result = assessAccountingConfidence({ accountCode: "6100", confidence: 95 }, weakEvidence);

    expect(result.accountingConfidenceLevel).toBe("Low");
    expect(result.explanation).toContain("never confirmed by a human");
  });

  it("ambiguous evidence (two accounts tied) never grants High confidence, even if the model agrees with one of them", () => {
    const ambiguousEvidence = evidence({
      strength: "Moderate",
      dominantAccountCode: null,
      isAmbiguous: true,
      accounts: [
        { accountCode: "6940", humanConfirmedCount: 3, aiOnlyCount: 0, totalCount: 3 },
        { accountCode: "6800", humanConfirmedCount: 3, aiOnlyCount: 0, totalCount: 3 },
      ],
    });
    const result = assessAccountingConfidence({ accountCode: "6940", confidence: 90 }, ambiguousEvidence);
    expect(result.accountingConfidenceLevel).toBe("Low");
    expect(result.explanation).toContain("ambiguous");
  });

  it("Moderate evidence + model agreement is Medium, never High — reserved for genuinely repeated (>= threshold) confirmation", () => {
    const moderateEvidence = evidence({
      strength: "Moderate",
      dominantAccountCode: "6940",
      accounts: [{ accountCode: "6940", humanConfirmedCount: 1, aiOnlyCount: 0, totalCount: 1 }],
    });
    const result = assessAccountingConfidence({ accountCode: "6940", confidence: 85 }, moderateEvidence);
    expect(result.accountingConfidenceLevel).toBe("Medium");
  });

  it("the model returning no account (Low/no confident suggestion) always resolves to Low accounting confidence, never an evidence override", () => {
    const strongEvidence = evidence({
      strength: "Strong",
      dominantAccountCode: "6940",
      accounts: [{ accountCode: "6940", humanConfirmedCount: 10, aiOnlyCount: 0, totalCount: 10 }],
    });
    const result = assessAccountingConfidence({ accountCode: null, confidence: 0 }, strongEvidence);
    expect(result.accountingConfidenceLevel).toBe("Low");
    expect(result.agreesWithHistory).toBeNull();
  });

  it("always surfaces the model's own raw confidence/level unmodified, separate from accountingConfidenceLevel", () => {
    const strongEvidence = evidence({
      strength: "Strong",
      dominantAccountCode: "6100",
      accounts: [{ accountCode: "6100", humanConfirmedCount: 5, aiOnlyCount: 0, totalCount: 5 }],
    });
    const result = assessAccountingConfidence({ accountCode: "6940", confidence: 92 }, strongEvidence);
    expect(result.modelConfidence).toBe(92);
    expect(result.modelConfidenceLevel).toBe("High");
    // Model says High, but contradicts strong evidence — accounting confidence must differ.
    expect(result.accountingConfidenceLevel).toBe("Low");
    expect(result.modelConfidenceLevel).not.toBe(result.accountingConfidenceLevel);
  });
});
