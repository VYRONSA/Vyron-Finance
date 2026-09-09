import { describe, expect, it } from "vitest";
import { postingEventTypeForVyronCoreEvent, type VyronCoreEventType } from "./vyron-core-events";

const ALL_EVENT_TYPES: VyronCoreEventType[] = [
  "vyron_core.approved_timesheet.v1",
  "vyron_core.payroll_ready_hours.v1",
  "vyron_core.labour_cost_allocation.v1",
  "vyron_core.department_costing.v1",
  "vyron_core.branch_costing.v1",
  "vyron_core.project_costing.v1",
  "vyron_core.employee_expense_claim.v1",
  "vyron_core.travel_claim.v1",
  "vyron_core.leave_provision.v1",
  "vyron_core.payroll_journal_import.v1",
];

describe("postingEventTypeForVyronCoreEvent", () => {
  it("maps every VyronCoreEventType to a distinct, non-empty posting_rules.event_type", () => {
    const mapped = ALL_EVENT_TYPES.map(postingEventTypeForVyronCoreEvent);
    for (const value of mapped) expect(value.length).toBeGreaterThan(0);
    expect(new Set(mapped).size).toBe(ALL_EVENT_TYPES.length);
  });

  it("prefixes every mapped event_type with VYRON CORE, so it can never collide with a company's own posting rule", () => {
    for (const eventType of ALL_EVENT_TYPES) {
      expect(postingEventTypeForVyronCoreEvent(eventType)).toMatch(/^VYRON CORE /);
    }
  });
});
