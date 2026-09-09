import { describe, expect, it } from "vitest";
import { findPostedRunForPeriod } from "./depreciation-run-service";
import type { DepreciationRun } from "@/server/assets/types";

function run(overrides: Partial<DepreciationRun> = {}): DepreciationRun {
  return {
    id: 1,
    companyId: "company-1",
    runDate: "2026-03-31",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    status: "Posted",
    totalAmount: 1000,
    journalId: 99,
    createdBy: "System",
    createdAt: "2026-03-31T00:00:00.000Z",
    ...overrides,
  };
}

// Master Implementation Tracker — Epic E1, Root Cause RC-2, Finding #195.
describe("findPostedRunForPeriod", () => {
  it("finds an existing Posted run for the exact same period", () => {
    const runs = [run({ id: 1 })];
    expect(findPostedRunForPeriod(runs, "2026-03-01", "2026-03-31")).toEqual(run({ id: 1 }));
  });

  it("ignores a Draft run for the same period — only Posted blocks a re-run", () => {
    const runs = [run({ id: 1, status: "Draft", journalId: null })];
    expect(findPostedRunForPeriod(runs, "2026-03-01", "2026-03-31")).toBeNull();
  });

  it("ignores a Posted run for a different period", () => {
    const runs = [run({ id: 1, periodStart: "2026-02-01", periodEnd: "2026-02-28" })];
    expect(findPostedRunForPeriod(runs, "2026-03-01", "2026-03-31")).toBeNull();
  });

  it("returns null when there are no runs at all", () => {
    expect(findPostedRunForPeriod([], "2026-03-01", "2026-03-31")).toBeNull();
  });
});
