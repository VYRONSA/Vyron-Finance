import { describe, expect, it } from "vitest";
import { MOCK_AUDIT_FINDINGS, MOCK_AUDIT_WORKING_PAPERS } from "./audit-data";

describe("audit-data mock findings", () => {
  it("derives a real Duplicate Journals finding from the seeded re-entered bank-fee pair", () => {
    expect(MOCK_AUDIT_FINDINGS.some((f) => f.findingType === "DuplicateJournals")).toBe(true);
  });

  it("includes at least one Intelligence-category finding", () => {
    expect(MOCK_AUDIT_FINDINGS.some((f) => f.category === "Intelligence")).toBe(true);
  });

  it("gives every finding a unique id", () => {
    const ids = MOCK_AUDIT_FINDINGS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("audit-data mock working papers", () => {
  it("generates a non-empty Lead Schedule and Exception Report", () => {
    expect(MOCK_AUDIT_WORKING_PAPERS).toHaveLength(2);
    expect(MOCK_AUDIT_WORKING_PAPERS.every((p) => Object.keys(p.content).length > 0)).toBe(true);
  });
});
