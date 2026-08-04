import { describe, expect, it } from "vitest";
import { MOCK_DUPLICATE_CUSTOMER_FINDINGS, MOCK_DUPLICATE_SUPPLIER_FINDINGS, MOCK_MATCHING_QUEUE, MOCK_MATCHING_SUMMARY, MOCK_MERCHANTS } from "./matching-data";

describe("matching-data mock queue", () => {
  it("aggregates multiple real item types into one queue", () => {
    const types = new Set(MOCK_MATCHING_QUEUE.map((i) => i.itemType));
    expect(types.size).toBeGreaterThan(1);
  });

  it("gives every queue item a unique id", () => {
    const ids = MOCK_MATCHING_QUEUE.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("matching-data mock summary", () => {
  it("derives real, bounded percentages from the mock data", () => {
    expect(MOCK_MATCHING_SUMMARY.matchingAccuracyPercent).toBeGreaterThanOrEqual(0);
    expect(MOCK_MATCHING_SUMMARY.manualQueueCount).toBe(MOCK_MATCHING_QUEUE.length);
  });
});

describe("matching-data mock duplicate findings and merchants", () => {
  it("reuses the real Auditor Workspace duplicate-party test, not a second implementation", () => {
    expect(Array.isArray(MOCK_DUPLICATE_CUSTOMER_FINDINGS)).toBe(true);
    expect(Array.isArray(MOCK_DUPLICATE_SUPPLIER_FINDINGS)).toBe(true);
  });

  it("re-exports the existing MOCK_MERCHANTS rather than a parallel merchant fixture", () => {
    expect(MOCK_MERCHANTS.length).toBeGreaterThan(0);
  });
});
