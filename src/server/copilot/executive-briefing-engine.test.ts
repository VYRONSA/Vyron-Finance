import { describe, expect, it } from "vitest";
import { buildExecutiveBriefing, type ExecutiveBriefingInputs } from "./executive-briefing-engine";

function inputs(overrides: Partial<ExecutiveBriefingInputs> = {}): ExecutiveBriefingInputs {
  return {
    financialHealthScore: 90,
    businessRiskScore: 10,
    auditReadinessScore: 90,
    complianceScorePercent: 95,
    assetHealthScore: 90,
    cashPosition: 100000,
    cashTrendImproving: true,
    signals: [],
    ...overrides,
  };
}

describe("buildExecutiveBriefing", () => {
  it("bands a healthy company as Strong across the board with no recommended actions", () => {
    const briefing = buildExecutiveBriefing(inputs());
    expect(briefing.financialHealth.label).toBe("Strong");
    expect(briefing.recommendedActions).toHaveLength(0);
  });

  it("bands Business Risk inversely — a low risk score is Strong, a high one is Critical", () => {
    const healthy = buildExecutiveBriefing(inputs({ businessRiskScore: 5 }));
    const risky = buildExecutiveBriefing(inputs({ businessRiskScore: 90 }));
    expect(healthy.businessRisk.label).toBe("Strong");
    expect(risky.businessRisk.label).toBe("Critical");
  });

  it("recommends real, score-specific actions when a score is weak", () => {
    const briefing = buildExecutiveBriefing(inputs({ financialHealthScore: 35 }));
    expect(briefing.recommendedActions.some((a) => a.includes("Financial Health Score"))).toBe(true);
  });

  it("flags a declining cash trend as a recommended action", () => {
    const briefing = buildExecutiveBriefing(inputs({ cashTrendImproving: false }));
    expect(briefing.recommendedActions.some((a) => a.includes("declining"))).toBe(true);
    expect(briefing.cashPosition.trend).toBe("Declining");
  });

  it("separates alerts from opportunities and ranks both by confidence", () => {
    const briefing = buildExecutiveBriefing(
      inputs({
        signals: [
          { label: "Low priority alert", confidence: 0.3, source: "VAT" },
          { label: "High priority alert", confidence: 0.9, source: "Audit" },
          { label: "Margin improving", confidence: 0.8, source: "Financial", isOpportunity: true },
        ],
      }),
    );
    expect(briefing.majorAlerts[0]).toContain("High priority alert");
    expect(briefing.opportunities[0]).toContain("Margin improving");
    expect(briefing.majorAlerts.some((a) => a.includes("Margin improving"))).toBe(false);
  });
});
