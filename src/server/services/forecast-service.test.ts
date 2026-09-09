import { describe, expect, it } from "vitest";
import { lastNMonthEnds } from "./forecast-service";

describe("lastNMonthEnds", () => {
  it("returns the last N complete month-ends before the reference date, oldest first", () => {
    expect(lastNMonthEnds(3, "2026-08-15")).toEqual(["2026-05-31", "2026-06-30", "2026-07-31"]);
  });

  it("rolls over a year boundary correctly", () => {
    expect(lastNMonthEnds(2, "2026-02-10")).toEqual(["2025-12-31", "2026-01-31"]);
  });
});
