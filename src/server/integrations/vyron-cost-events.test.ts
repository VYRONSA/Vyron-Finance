import { describe, expect, it } from "vitest";
import { postingEventTypeForVyronCostEvent, type VyronCostEventType } from "./vyron-cost-events";

const ALL_EVENT_TYPES: VyronCostEventType[] = [
  "vyron_cost.inventory_movement.v1",
  "vyron_cost.inventory_valuation.v1",
  "vyron_cost.cost_of_sale.v1",
  "vyron_cost.stock_adjustment.v1",
  "vyron_cost.manufacturing_journal.v1",
  "vyron_cost.purchase_receipt.v1",
  "vyron_cost.finished_goods_valuation.v1",
  "vyron_cost.raw_material_consumption.v1",
  "vyron_cost.standard_cost_update.v1",
  "vyron_cost.actual_cost_variance.v1",
];

describe("postingEventTypeForVyronCostEvent", () => {
  it("maps every VyronCostEventType to a distinct, non-empty posting_rules.event_type", () => {
    const mapped = ALL_EVENT_TYPES.map(postingEventTypeForVyronCostEvent);
    for (const value of mapped) expect(value.length).toBeGreaterThan(0);
    expect(new Set(mapped).size).toBe(ALL_EVENT_TYPES.length);
  });

  it("prefixes every mapped event_type with VYRON COST, so it can never collide with a company's own posting rule", () => {
    for (const eventType of ALL_EVENT_TYPES) {
      expect(postingEventTypeForVyronCostEvent(eventType)).toMatch(/^VYRON COST /);
    }
  });
});
