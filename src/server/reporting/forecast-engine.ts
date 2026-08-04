/**
 * The platform's ONE Forecast Engine — pure, no Supabase. Every forecast
 * type (Cashflow/Revenue/Expense/VAT/Inventory/Customer-Payment/
 * Supplier-Payment) calls this single `linearRegressionForecast`, never
 * its own math, mirroring the whole platform's "one X engine, many
 * callers" discipline (see `vat-engine.ts`, `posting-rule-service.ts`).
 *
 * Deliberately a transparent statistical method (ordinary least-squares
 * linear regression over the supplied historical series), not a
 * black-box model — every result reports its `method`, the number of
 * historical points it was fitted from, and a `confidence` derived from
 * R² (the standard "how well does this line explain the historical
 * variance" measure), so nothing overstates predictive certainty.
 */

export type ForecastPoint = { period: string; value: number };

export type ForecastResult = {
  method: "linear-regression";
  historicalPoints: number;
  /** R² of the fit against historical data, 0-1. Also used, floored, as
   * the forecast's confidence — a flat/noisy history legitimately
   * produces low confidence rather than a falsely precise number. */
  confidence: number;
  forecast: ForecastPoint[];
  assumptions: string[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Pure — ordinary least-squares fit over `series` (assumed evenly
 * spaced, oldest first), projecting `periodsAhead` further points using
 * each forecast point's own generated label via `labelForIndex`.
 * Returns a zero-confidence flat-line forecast (last known value
 * repeated) when there isn't enough history to fit a meaningful trend —
 * an honest degenerate case, not a crash or a fabricated trend. */
export function linearRegressionForecast(series: ForecastPoint[], periodsAhead: number, labelForIndex: (indexAfterLastKnown: number) => string): ForecastResult {
  const n = series.length;
  const assumptions = [
    "Ordinary least-squares linear regression over the supplied historical periods.",
    "Assumes the recent trend continues linearly — does not model seasonality, one-off events, or external factors.",
  ];

  if (n < 2) {
    const lastValue = series[0]?.value ?? 0;
    return {
      method: "linear-regression",
      historicalPoints: n,
      confidence: 0,
      forecast: Array.from({ length: periodsAhead }, (_, i) => ({ period: labelForIndex(i + 1), value: round2(lastValue) })),
      assumptions: [...assumptions, "Fewer than 2 historical points were available — forecast is a flat projection of the last known value with zero confidence."],
    };
  }

  const xs = series.map((_, i) => i);
  const ys = series.map((p) => p.value);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (xs[i] - meanX) * (ys[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * xs[i] + intercept;
    ssRes += (ys[i] - predicted) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  const rSquared = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : Math.max(0, 1 - ssRes / ssTot);

  const forecast: ForecastPoint[] = Array.from({ length: periodsAhead }, (_, i) => {
    const x = n - 1 + (i + 1);
    return { period: labelForIndex(i + 1), value: round2(slope * x + intercept) };
  });

  return { method: "linear-regression", historicalPoints: n, confidence: round2(rSquared), forecast, assumptions };
}
