import { describe, expect, it } from "vitest";
import { findDuplicateParties } from "./duplicate-party-engine";

describe("findDuplicateParties", () => {
  it("flags records sharing a normalized name at 0.6 confidence", () => {
    const findings = findDuplicateParties([
      { id: 1, name: "Acme Supplies", secondaryIds: [] },
      { id: 2, name: "ACME SUPPLIES", secondaryIds: [] },
      { id: 3, name: "Different Co", secondaryIds: [] },
    ]);
    const nameFindings = findings.filter((f) => f.confidence === 0.6);
    expect(nameFindings).toHaveLength(2);
    expect(nameFindings[0].groupIds.sort()).toEqual([1, 2]);
  });

  it("flags records sharing a secondary identifier at 0.8 confidence", () => {
    const findings = findDuplicateParties([
      { id: 1, name: "Acme Supplies", secondaryIds: ["VAT123"] },
      { id: 2, name: "Acme Supplies Pty Ltd", secondaryIds: ["VAT123"] },
    ]);
    const secondaryFindings = findings.filter((f) => f.confidence === 0.8);
    expect(secondaryFindings.length).toBeGreaterThan(0);
    expect(secondaryFindings[0].groupIds.sort()).toEqual([1, 2]);
  });

  it("does not flag a unique name/secondary id", () => {
    const findings = findDuplicateParties([{ id: 1, name: "Solo Corp", secondaryIds: ["VAT999"] }]);
    expect(findings).toHaveLength(0);
  });

  it("ignores blank names and blank secondary ids", () => {
    const findings = findDuplicateParties([
      { id: 1, name: "", secondaryIds: [""] },
      { id: 2, name: "", secondaryIds: [""] },
    ]);
    expect(findings).toHaveLength(0);
  });
});
