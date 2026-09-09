import { describe, expect, it } from "vitest";
import { bandConfidence, evaluateConfidence, sumConfidence } from "./confidence-engine";
import type { MatchRule } from "./confidence-engine";

describe("sumConfidence", () => {
  it("sums only the rules that fired", () => {
    const rules: MatchRule[] = [
      { id: "a", label: "A", points: 55, matched: true },
      { id: "b", label: "B", points: 30, matched: false },
      { id: "c", label: "C", points: 13, matched: true },
    ];
    const result = sumConfidence(rules);
    expect(result.score).toBe(68);
    expect(result.matchedRules.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("returns zero for an empty rule list", () => {
    expect(sumConfidence([]).score).toBe(0);
  });
});

describe("bandConfidence", () => {
  it("is Unmatched at exactly zero regardless of threshold", () => {
    expect(bandConfidence(0, 65)).toBe("Unmatched");
    expect(bandConfidence(0, 0)).toBe("Unmatched");
  });

  it("bands Suggested below threshold, Matched at or above it", () => {
    expect(bandConfidence(64, 65)).toBe("Suggested");
    expect(bandConfidence(65, 65)).toBe("Matched");
    expect(bandConfidence(100, 65)).toBe("Matched");
  });

  it("honours a caller-supplied threshold different from 65", () => {
    expect(bandConfidence(50, 40)).toBe("Matched");
    expect(bandConfidence(30, 40)).toBe("Suggested");
  });
});

describe("evaluateConfidence", () => {
  it("combines sum and band in one call", () => {
    const rules: MatchRule[] = [{ id: "a", label: "A", points: 70, matched: true }];
    const result = evaluateConfidence(rules, 65);
    expect(result.score).toBe(70);
    expect(result.band).toBe("Matched");
  });
});
