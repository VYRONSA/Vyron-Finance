import { describe, expect, it } from "vitest";
import { buildReportingReadiness, computeReportingReadinessScore, determineReportingStatus } from "./reporting-readiness-engine";

describe("computeReportingReadinessScore", () => {
  it("scores 100 when everything is clean", () => {
    expect(computeReportingReadinessScore(true, 0, 100, 0)).toBe(100);
  });

  it("applies a dominant 40-point penalty when the Balance Sheet doesn't balance", () => {
    expect(computeReportingReadinessScore(false, 0, 100, 0)).toBe(60);
  });

  it("penalizes outstanding disclosures, capped at 30", () => {
    expect(computeReportingReadinessScore(true, 3, 100, 0)).toBe(85);
    expect(computeReportingReadinessScore(true, 20, 100, 0)).toBe(70); // capped at -30
  });

  it("penalizes low audit readiness and open findings", () => {
    expect(computeReportingReadinessScore(true, 0, 50, 2)).toBe(86); // -10 (audit) -4 (findings)
  });

  it("never goes below zero", () => {
    expect(computeReportingReadinessScore(false, 20, 0, 20)).toBeGreaterThanOrEqual(0);
  });
});

describe("determineReportingStatus", () => {
  it("bands the score into Draft/ReadyForReview/Ready", () => {
    expect(determineReportingStatus(95)).toBe("Ready");
    expect(determineReportingStatus(70)).toBe("ReadyForReview");
    expect(determineReportingStatus(40)).toBe("Draft");
  });
});

describe("buildReportingReadiness", () => {
  it("composes the full readiness object with a real, traceable financialStatementsGeneratedCount", () => {
    const readiness = buildReportingReadiness(true, 1, 90, 1, 4);
    expect(readiness.status).toBe("Ready");
    expect(readiness.financialStatementsGeneratedCount).toBe(4);
  });
});
