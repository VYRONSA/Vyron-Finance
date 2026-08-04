import { describe, expect, it } from "vitest";
import { shouldIssueTrialWarning, TRIAL_WARNING_DAYS_BEFORE_EXPIRY } from "./lifecycle-sweep-engine";

describe("shouldIssueTrialWarning", () => {
  it("does not warn when far outside the warning window", () => {
    expect(shouldIssueTrialWarning("2026-01-20T00:00:00.000Z", "2026-01-01T00:00:00.000Z", null)).toBe(false);
  });

  it("warns exactly at the edge of the warning window", () => {
    const trialEndsAt = "2026-01-20T00:00:00.000Z";
    const nowIso = new Date(Date.parse(trialEndsAt) - TRIAL_WARNING_DAYS_BEFORE_EXPIRY * 86_400_000).toISOString();
    expect(shouldIssueTrialWarning(trialEndsAt, nowIso, null)).toBe(true);
  });

  it("warns inside the window", () => {
    expect(shouldIssueTrialWarning("2026-01-20T00:00:00.000Z", "2026-01-19T00:00:00.000Z", null)).toBe(true);
  });

  it("does not warn a second time once already sent", () => {
    expect(shouldIssueTrialWarning("2026-01-20T00:00:00.000Z", "2026-01-19T00:00:00.000Z", "2026-01-18T00:00:00.000Z")).toBe(false);
  });

  it("does not warn once the trial has already expired — that's the expiry branch's job, not the warning's", () => {
    expect(shouldIssueTrialWarning("2026-01-20T00:00:00.000Z", "2026-01-21T00:00:00.000Z", null)).toBe(false);
  });
});
