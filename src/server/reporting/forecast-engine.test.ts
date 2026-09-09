import { describe, expect, it } from "vitest";
import { linearRegressionForecast } from "./forecast-engine";

const label = (i: number) => `+${i}`;

describe("linearRegressionForecast", () => {
  it("projects a perfect linear trend with confidence 1", () => {
    const series = [1, 2, 3, 4, 5].map((value, i) => ({ period: `p${i}`, value }));
    const result = linearRegressionForecast(series, 3, label);

    expect(result.confidence).toBe(1);
    expect(result.forecast.map((p) => p.value)).toEqual([6, 7, 8]);
    expect(result.method).toBe("linear-regression");
    expect(result.historicalPoints).toBe(5);
  });

  it("returns a flat zero-confidence projection with fewer than 2 historical points", () => {
    const result = linearRegressionForecast([{ period: "p0", value: 500 }], 2, label);
    expect(result.confidence).toBe(0);
    expect(result.forecast).toEqual([{ period: "+1", value: 500 }, { period: "+2", value: 500 }]);
  });

  it("handles zero history without crashing", () => {
    const result = linearRegressionForecast([], 2, label);
    expect(result.confidence).toBe(0);
    expect(result.forecast.every((p) => p.value === 0)).toBe(true);
  });

  it("produces a lower confidence for a noisy, non-linear series than a perfect line", () => {
    const perfect = linearRegressionForecast([1, 2, 3, 4, 5].map((v, i) => ({ period: `p${i}`, value: v })), 1, label);
    const noisy = linearRegressionForecast([1, 5, 1, 5, 1].map((v, i) => ({ period: `p${i}`, value: v })), 1, label);
    expect(noisy.confidence).toBeLessThan(perfect.confidence);
  });

  it("always discloses its method and assumptions", () => {
    const result = linearRegressionForecast([{ period: "p0", value: 1 }, { period: "p1", value: 2 }], 1, label);
    expect(result.assumptions.length).toBeGreaterThan(0);
  });
});
