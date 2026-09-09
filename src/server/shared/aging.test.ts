import { describe, expect, it } from "vitest";
import { computeAgingBuckets } from "./aging";

describe("computeAgingBuckets", () => {
  it("buckets a not-yet-due item as Current", () => {
    const result = computeAgingBuckets([{ outstanding: 500, dueDate: "2026-07-30" }], "2026-07-15");
    expect(result).toEqual({ current: 500, days30: 0, days60: 0, days90: 0, days120Plus: 0 });
  });

  it("buckets by days overdue at the 30/60/90/120 boundaries", () => {
    const items = [
      { outstanding: 100, dueDate: "2026-07-01" }, // 15 days overdue -> 30-bucket
      { outstanding: 200, dueDate: "2026-06-01" }, // 45 days overdue -> 60-bucket
      { outstanding: 300, dueDate: "2026-05-01" }, // 76 days overdue -> 90-bucket
      { outstanding: 400, dueDate: "2026-01-01" }, // way over 120 -> 120+-bucket
    ];
    const result = computeAgingBuckets(items, "2026-07-16");
    expect(result).toEqual({ current: 0, days30: 100, days60: 200, days90: 300, days120Plus: 400 });
  });

  it("ignores items that are already fully settled (outstanding <= 0)", () => {
    const result = computeAgingBuckets([{ outstanding: 0, dueDate: "2026-01-01" }], "2026-07-16");
    expect(result).toEqual({ current: 0, days30: 0, days60: 0, days90: 0, days120Plus: 0 });
  });

  it("treats an item with no due date as Current rather than dropping it", () => {
    const result = computeAgingBuckets([{ outstanding: 250, dueDate: null }], "2026-07-16");
    expect(result.current).toBe(250);
  });
});
