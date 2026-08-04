import { describe, expect, it } from "vitest";
import { MOCK_COPILOT_ANSWERS, MOCK_COPILOT_BRIEFING, MOCK_COPILOT_NARRATIVES, MOCK_COPILOT_SCENARIOS } from "./copilot-data";

describe("copilot-data mock answers", () => {
  it("derives a real profit-decrease answer with evidence, not an empty stub", () => {
    const answer = MOCK_COPILOT_ANSWERS.find((a) => a.questionId === "profit-decrease")!;
    expect(answer.confidence).toBeGreaterThan(0);
    expect(answer.evidence.length).toBeGreaterThan(0);
  });

  it("covers every answer with a non-empty executive summary", () => {
    for (const answer of MOCK_COPILOT_ANSWERS) {
      expect(answer.executiveSummary.length).toBeGreaterThan(0);
    }
  });
});

describe("copilot-data mock narratives", () => {
  it("gives every narrative real facts derived from the underlying statements", () => {
    for (const narrative of MOCK_COPILOT_NARRATIVES) {
      const content = narrative.content as { facts?: unknown[] };
      expect(Array.isArray(content.facts)).toBe(true);
      expect((content.facts ?? []).length).toBeGreaterThan(0);
    }
  });

  it("gives every narrative a unique id", () => {
    const ids = MOCK_COPILOT_NARRATIVES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("copilot-data mock scenarios", () => {
  it("derives a real financial impact summary for each scenario", () => {
    for (const scenario of MOCK_COPILOT_SCENARIOS) {
      const results = scenario.results as { financialImpactSummary?: string };
      expect(results.financialImpactSummary?.length).toBeGreaterThan(0);
    }
  });
});

describe("copilot-data mock executive briefing", () => {
  it("bands every score and includes at least one alert or opportunity", () => {
    const content = MOCK_COPILOT_BRIEFING.content as { financialHealth: { label: string }; majorAlerts: string[]; opportunities: string[] };
    expect(content.financialHealth.label).toBeTruthy();
    expect(content.majorAlerts.length + content.opportunities.length).toBeGreaterThan(0);
  });
});
