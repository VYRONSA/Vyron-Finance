import { describe, expect, it } from "vitest";
import { describeBillingEventForNotification } from "./subscribers";
import { BILLING_EVENT_TYPES } from "../types";

describe("describeBillingEventForNotification", () => {
  it("returns real, non-empty content for every declared billing event type", () => {
    for (const eventType of BILLING_EVENT_TYPES) {
      const content = describeBillingEventForNotification(eventType, {});
      expect(content).not.toBeNull();
      expect(content!.title.length).toBeGreaterThan(0);
      expect(content!.message.length).toBeGreaterThan(0);
      expect(["info", "warning", "critical"]).toContain(content!.severity);
    }
  });

  it("escalates SubscriptionChanged to critical only when moving into suspended/past_due", () => {
    expect(describeBillingEventForNotification("SubscriptionChanged", { fromStatus: "active", toStatus: "suspended" })?.severity).toBe("critical");
    expect(describeBillingEventForNotification("SubscriptionChanged", { fromStatus: "trial", toStatus: "active" })?.severity).toBe("info");
  });
});
