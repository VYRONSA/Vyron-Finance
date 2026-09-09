import { describe, expect, it } from "vitest";
import { findDuplicateDocuments } from "./duplicate-document-engine";

describe("findDuplicateDocuments", () => {
  it("flags same party + exact amount within the window at 0.6 confidence", () => {
    const findings = findDuplicateDocuments([
      { id: 1, partyId: 10, amount: 500, date: "2026-06-01", reference: "" },
      { id: 2, partyId: 10, amount: 500, date: "2026-06-02", reference: "" },
    ]);
    expect(findings).toHaveLength(2);
    expect(findings[0].confidence).toBe(0.6);
    expect(findings[0].groupIds.sort()).toEqual([1, 2]);
  });

  it("scores a shared reference number higher, at 0.85 confidence", () => {
    const findings = findDuplicateDocuments([
      { id: 1, partyId: 10, amount: 500, date: "2026-06-01", reference: "PO-100" },
      { id: 2, partyId: 10, amount: 500, date: "2026-06-01", reference: "PO-100" },
    ]);
    expect(findings[0].confidence).toBe(0.85);
  });

  it("never flags different parties even with identical amount and date", () => {
    const findings = findDuplicateDocuments([
      { id: 1, partyId: 10, amount: 500, date: "2026-06-01", reference: "" },
      { id: 2, partyId: 20, amount: 500, date: "2026-06-01", reference: "" },
    ]);
    expect(findings).toHaveLength(0);
  });

  it("never flags documents outside the date window", () => {
    const findings = findDuplicateDocuments(
      [
        { id: 1, partyId: 10, amount: 500, date: "2026-06-01", reference: "" },
        { id: 2, partyId: 10, amount: 500, date: "2026-06-10", reference: "" },
      ],
      3,
    );
    expect(findings).toHaveLength(0);
  });

  it("excludes documents with no party or no date", () => {
    const findings = findDuplicateDocuments([
      { id: 1, partyId: null, amount: 500, date: "2026-06-01", reference: "" },
      { id: 2, partyId: 10, amount: 500, date: null, reference: "" },
    ]);
    expect(findings).toHaveLength(0);
  });
});
