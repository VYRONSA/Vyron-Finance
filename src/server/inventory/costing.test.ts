import { describe, expect, it } from "vitest";
import { computeWeightedAverageCost, consumeFifoLayers, currentFifoCost } from "./costing";
import type { CostLayer } from "./costing";

function layer(overrides: Partial<CostLayer> & Pick<CostLayer, "id">): CostLayer {
  return { quantityRemaining: 10, unitCost: 5, receivedDate: "2026-01-01", ...overrides };
}

describe("consumeFifoLayers", () => {
  it("consumes a single layer fully covering the request", () => {
    const result = consumeFifoLayers([layer({ id: 1, quantityRemaining: 10, unitCost: 5 })], 4);
    expect(result.consumedCost).toBe(20);
    expect(result.layerUpdates).toEqual([{ id: 1, quantityRemaining: 6 }]);
    expect(result.shortfall).toBe(0);
  });

  it("consumes the oldest layer first, then spills into the next", () => {
    const result = consumeFifoLayers(
      [
        layer({ id: 2, quantityRemaining: 5, unitCost: 8, receivedDate: "2026-02-01" }),
        layer({ id: 1, quantityRemaining: 5, unitCost: 5, receivedDate: "2026-01-01" }),
      ],
      8,
    );
    // 5 units @ 5 (oldest) + 3 units @ 8 (next) = 25 + 24 = 49
    expect(result.consumedCost).toBe(49);
    expect(result.layerUpdates).toEqual([
      { id: 1, quantityRemaining: 0 },
      { id: 2, quantityRemaining: 2 },
    ]);
    expect(result.shortfall).toBe(0);
  });

  it("reports a shortfall when requesting more than is available across all layers", () => {
    const result = consumeFifoLayers([layer({ id: 1, quantityRemaining: 3, unitCost: 5 })], 10);
    expect(result.consumedCost).toBe(15);
    expect(result.shortfall).toBe(7);
  });

  it("skips layers that are already exhausted", () => {
    const result = consumeFifoLayers(
      [
        layer({ id: 1, quantityRemaining: 0, unitCost: 5, receivedDate: "2026-01-01" }),
        layer({ id: 2, quantityRemaining: 5, unitCost: 7, receivedDate: "2026-02-01" }),
      ],
      3,
    );
    expect(result.layerUpdates).toEqual([{ id: 2, quantityRemaining: 2 }]);
    expect(result.consumedCost).toBe(21);
  });

  it("returns zero cost and zero shortfall for a zero-quantity request", () => {
    const result = consumeFifoLayers([layer({ id: 1 })], 0);
    expect(result.consumedCost).toBe(0);
    expect(result.layerUpdates).toEqual([]);
    expect(result.shortfall).toBe(0);
  });
});

describe("computeWeightedAverageCost", () => {
  it("blends existing and incoming stock proportionally", () => {
    // 10 @ 5 existing, receive 10 @ 7 -> (50 + 70) / 20 = 6
    expect(computeWeightedAverageCost(10, 5, 10, 7)).toBe(6);
  });

  it("returns the incoming cost outright when there was no existing stock", () => {
    expect(computeWeightedAverageCost(0, 0, 5, 12)).toBe(12);
  });

  it("returns 0 when there is no stock at all after the movement", () => {
    expect(computeWeightedAverageCost(0, 0, 0, 0)).toBe(0);
  });
});

describe("currentFifoCost", () => {
  it("returns the oldest remaining layer's unit cost", () => {
    const cost = currentFifoCost([
      { quantityRemaining: 5, unitCost: 9, receivedDate: "2026-02-01" },
      { quantityRemaining: 5, unitCost: 5, receivedDate: "2026-01-01" },
    ]);
    expect(cost).toBe(5);
  });

  it("ignores exhausted layers", () => {
    const cost = currentFifoCost([
      { quantityRemaining: 0, unitCost: 5, receivedDate: "2026-01-01" },
      { quantityRemaining: 3, unitCost: 9, receivedDate: "2026-02-01" },
    ]);
    expect(cost).toBe(9);
  });

  it("returns null when there is no stock to derive a cost from", () => {
    expect(currentFifoCost([])).toBeNull();
    expect(currentFifoCost([{ quantityRemaining: 0, unitCost: 5, receivedDate: "2026-01-01" }])).toBeNull();
  });
});
