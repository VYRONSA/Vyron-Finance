import { describe, expect, it } from "vitest";
import { isValidCopilotAnswer, toVyronAskAnswer } from "./vyron-ask-view";
import type { CopilotAnswer } from "@/server/copilot/copilot-assistant-engine";

function answer(overrides: Partial<CopilotAnswer> = {}): CopilotAnswer {
  return {
    questionId: "needs-attention",
    question: "What needs my attention?",
    executiveSummary: "2 item(s) currently need attention.",
    confidence: 0.85,
    evidence: ["Evidence A", "Evidence B"],
    calculationsUsed: "Reused financial-intelligence-engine.ts.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["VYRON Intelligence Centre"],
    suggestedActions: ["Review Banking Exceptions"],
    alternativeExplanations: [],
    ...overrides,
  };
}

describe("toVyronAskAnswer", () => {
  it("maps the real executiveSummary, evidence, and documentsConsulted straight through", () => {
    const result = toVyronAskAnswer(answer());
    expect(result.answer).toBe("2 item(s) currently need attention.");
    expect(result.evidence).toEqual(["Evidence A", "Evidence B"]);
    expect(result.sources).toEqual(["VYRON Intelligence Centre"]);
  });

  it("uses real actionLinks (with real hrefs) when present, never inventing a route", () => {
    const result = toVyronAskAnswer(answer({ actionLinks: [{ label: "Review Banking Exceptions", href: "/company/co_1/banking-exceptions" }] }));
    expect(result.recommendedActions).toEqual([{ label: "Review Banking Exceptions", href: "/company/co_1/banking-exceptions" }]);
  });

  it("falls back to suggestedActions as unlinked text when there are no actionLinks (no fake button)", () => {
    const result = toVyronAskAnswer(answer({ actionLinks: undefined, suggestedActions: ["Review cost of sales."] }));
    expect(result.recommendedActions).toEqual([{ label: "Review cost of sales.", href: null }]);
  });

  it("defaults keyPoints to an empty list when the underlying answer doesn't carry any", () => {
    const result = toVyronAskAnswer(answer({ keyPoints: undefined }));
    expect(result.keyPoints).toEqual([]);
  });

  it("passes real keyPoints through unchanged when present", () => {
    const result = toVyronAskAnswer(answer({ keyPoints: ["[Critical] A finding", "[High] Another finding"] }));
    expect(result.keyPoints).toEqual(["[Critical] A finding", "[High] Another finding"]);
  });

  it("passes answeredBy through unchanged, including undefined for a pre-Phase-15 answer", () => {
    expect(toVyronAskAnswer(answer({ answeredBy: "VyronAI" })).answeredBy).toBe("VyronAI");
    expect(toVyronAskAnswer(answer({ answeredBy: "VyronIntelligence" })).answeredBy).toBe("VyronIntelligence");
    expect(toVyronAskAnswer(answer()).answeredBy).toBeUndefined();
  });

  it("defaults evidenceReferences and uncertainties to an empty list when absent", () => {
    const result = toVyronAskAnswer(answer());
    expect(result.evidenceReferences).toEqual([]);
    expect(result.uncertainties).toEqual([]);
  });

  it("passes real evidenceReferences and uncertainties through unchanged when present", () => {
    const result = toVyronAskAnswer(
      answer({
        evidenceReferences: [{ label: "VYRON Intelligence — Cash Collection Pressure", href: "/company/co_1/intelligence" }],
        uncertainties: ["The exact cause isn't in the evidence."],
      }),
    );
    expect(result.evidenceReferences).toEqual([{ label: "VYRON Intelligence — Cash Collection Pressure", href: "/company/co_1/intelligence" }]);
    expect(result.uncertainties).toEqual(["The exact cause isn't in the evidence."]);
  });
});

describe("isValidCopilotAnswer", () => {
  it("accepts a well-formed real answer", () => {
    expect(isValidCopilotAnswer(answer())).toBe(true);
  });

  it("rejects null and non-objects (malformed provider response)", () => {
    expect(isValidCopilotAnswer(null)).toBe(false);
    expect(isValidCopilotAnswer(undefined)).toBe(false);
    expect(isValidCopilotAnswer("a string")).toBe(false);
    expect(isValidCopilotAnswer(42)).toBe(false);
  });

  it("rejects an object missing a required string field", () => {
    const malformed: Record<string, unknown> = answer();
    delete malformed.executiveSummary;
    expect(isValidCopilotAnswer(malformed)).toBe(false);
  });

  it("rejects an object whose evidence field is not an array of strings", () => {
    expect(isValidCopilotAnswer(answer({ evidence: "not an array" as unknown as string[] }))).toBe(false);
    expect(isValidCopilotAnswer(answer({ evidence: [1, 2, 3] as unknown as string[] }))).toBe(false);
  });

  it("rejects an object whose confidence field is not a number", () => {
    expect(isValidCopilotAnswer(answer({ confidence: "high" as unknown as number }))).toBe(false);
  });

  it("accepts an answer with the new optional keyPoints/actionLinks fields present", () => {
    expect(isValidCopilotAnswer(answer({ keyPoints: ["A"], actionLinks: [{ label: "Go", href: "/x" }] }))).toBe(true);
  });

  it("accepts a Phase 15 VYRON AI answer with answeredBy/evidenceReferences/uncertainties present", () => {
    expect(
      isValidCopilotAnswer(
        answer({
          answeredBy: "VyronAI",
          evidenceReferences: [{ label: "VYRON Intelligence", href: "/company/co_1/intelligence" }, { label: "Informational", href: null }],
          uncertainties: ["Not fully supported by the evidence."],
        }),
      ),
    ).toBe(true);
  });

  it("rejects an invalid answeredBy value (malformed provider response)", () => {
    expect(isValidCopilotAnswer(answer({ answeredBy: "SomeOtherLayer" as unknown as "VyronAI" }))).toBe(false);
  });

  it("rejects a malformed evidenceReferences entry — missing href — even though the field itself is optional (malformed provider response)", () => {
    expect(isValidCopilotAnswer({ ...answer(), evidenceReferences: [{ label: "no href" }] })).toBe(false);
  });

  it("rejects a malformed uncertainties field that isn't a string array", () => {
    expect(isValidCopilotAnswer({ ...answer(), uncertainties: "not an array" })).toBe(false);
  });
});
