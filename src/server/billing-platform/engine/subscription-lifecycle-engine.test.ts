import { describe, expect, it } from "vitest";
import { canTransition } from "./subscription-lifecycle-engine";
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "../types";

describe("canTransition", () => {
  it("allows the real recovery chain: active -> past_due -> grace_period -> suspended -> active", () => {
    expect(canTransition("active", "past_due")).toBe(true);
    expect(canTransition("past_due", "grace_period")).toBe(true);
    expect(canTransition("grace_period", "suspended")).toBe(true);
    expect(canTransition("suspended", "active")).toBe(true);
  });

  it("allows recovery to skip grace_period (payment succeeds while still past_due)", () => {
    expect(canTransition("past_due", "active")).toBe(true);
    expect(canTransition("grace_period", "active")).toBe(true);
  });

  it("allows a trial to convert to active, expire, or be cancelled", () => {
    expect(canTransition("trial", "active")).toBe(true);
    expect(canTransition("trial", "expired")).toBe(true);
    expect(canTransition("trial", "cancelled")).toBe(true);
  });

  it("forbids reversing a terminal cancellation back to any active-ish state", () => {
    expect(canTransition("cancelled", "active")).toBe(false);
    expect(canTransition("cancelled", "trial")).toBe(false);
    expect(canTransition("cancelled", "past_due")).toBe(false);
  });

  it("archived is a true terminal state — no transition out of it", () => {
    for (const to of SUBSCRIPTION_STATUSES) {
      expect(canTransition("archived", to)).toBe(false);
    }
  });

  it("cancelled can only ever move to archived", () => {
    for (const to of SUBSCRIPTION_STATUSES) {
      expect(canTransition("cancelled", to)).toBe(to === "archived");
    }
  });

  it("every declared status has a defined (possibly empty) transition list — no undefined lookup", () => {
    for (const from of SUBSCRIPTION_STATUSES) {
      for (const to of SUBSCRIPTION_STATUSES) {
        expect(() => canTransition(from as SubscriptionStatus, to as SubscriptionStatus)).not.toThrow();
      }
    }
  });
});
