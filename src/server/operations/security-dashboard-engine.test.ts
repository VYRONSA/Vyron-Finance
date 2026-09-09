import { describe, expect, it } from "vitest";
import { buildSecurityDashboardSummary } from "./security-dashboard-engine";
import type { SystemEvent } from "./types";

function event(overrides: Partial<SystemEvent>): SystemEvent {
  return { id: 1, companyId: "co_1", eventType: "PermissionDenied", severity: "warning", actor: "user@x.com", detail: "", metadata: {}, createdAt: "2026-01-01T00:00:00Z", ...overrides };
}

describe("buildSecurityDashboardSummary", () => {
  it("counts real PermissionDenied events as tracked", () => {
    const summary = buildSecurityDashboardSummary([event({}), event({})]);
    expect(summary.permissionDenials).toEqual({ count: 2, tracked: true });
  });

  it("marks untracked event types as tracked:false regardless of count", () => {
    const summary = buildSecurityDashboardSummary([]);
    expect(summary.failedLogins).toEqual({ count: 0, tracked: false });
    expect(summary.lockedAccounts.tracked).toBe(false);
    expect(summary.expiredSessions.tracked).toBe(false);
    expect(summary.apiAuthFailures.tracked).toBe(false);
  });

  it("never fabricates suspicious-activity counts", () => {
    const summary = buildSecurityDashboardSummary([event({ eventType: "PermissionDenied" })]);
    expect(summary.suspiciousActivity).toEqual({ count: 0, tracked: false });
  });

  it("caps recent events at 20", () => {
    const events = Array.from({ length: 30 }, (_, i) => event({ id: i }));
    expect(buildSecurityDashboardSummary(events).recentEvents).toHaveLength(20);
  });
});
