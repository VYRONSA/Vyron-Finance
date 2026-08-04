import { describe, expect, it } from "vitest";
import { draftPaymentReminderMessage, draftWelcomeMessage } from "./communication-draft-engine";

describe("draftPaymentReminderMessage", () => {
  it("drafts a courtesy message when nothing is overdue", () => {
    const draft = draftPaymentReminderMessage("Meridian Traders", { current: 100, days30: 0, days60: 0, days90: 0, days120Plus: 0 }, 100);
    expect(draft).toContain("Meridian Traders");
    expect(draft).toContain("no overdue amount");
  });

  it("drafts an overdue reminder naming the oldest bucket", () => {
    const draft = draftPaymentReminderMessage("Meridian Traders", { current: 0, days30: 100, days60: 0, days90: 0, days120Plus: 200 }, 300);
    expect(draft).toContain("120+ days");
    expect(draft).toContain("300.00");
  });

  it("picks the 30 day bucket when that's the only overdue amount", () => {
    const draft = draftPaymentReminderMessage("X", { current: 0, days30: 50, days60: 0, days90: 0, days120Plus: 0 }, 50);
    expect(draft).toContain("30 days");
  });
});

describe("draftWelcomeMessage", () => {
  it("includes the recipient and company name", () => {
    const draft = draftWelcomeMessage("Meridian Traders", "VYRON FINANCE");
    expect(draft).toContain("Meridian Traders");
    expect(draft).toContain("VYRON FINANCE");
  });
});
