import { describe, expect, it } from "vitest";
import { buildAuditDashboardSummary } from "./audit-dashboard-engine";
import type { AutomationAuditLogEntry } from "@/server/automation/types";
import type { PermissionAuditEntry } from "@/server/permissions/types";

function autoEntry(overrides: Partial<AutomationAuditLogEntry>): AutomationAuditLogEntry {
  return {
    id: 1, companyId: "co_1", performedBy: "System", actionType: "Test", ruleId: null, reason: "", changes: {},
    journalIds: [], documentType: null, documentId: null, durationMs: null, isReversible: true, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function permEntry(overrides: Partial<PermissionAuditEntry>): PermissionAuditEntry {
  return { id: 1, companyId: "co_1", itemType: "Role", itemId: "1", fieldName: "x", oldValue: null, newValue: null, reason: "", performedBy: "System", performedAt: "2026-01-01T00:00:00Z", ...overrides };
}

describe("buildAuditDashboardSummary", () => {
  it("surfaces only non-reversible entries as critical", () => {
    const summary = buildAuditDashboardSummary(
      [autoEntry({ isReversible: true }), autoEntry({ isReversible: false })],
      [],
      0,
      0,
      0,
    );
    expect(summary.totalAutomationEntries).toBe(2);
    expect(summary.recentCriticalEntries).toHaveLength(1);
  });

  it("passes through counts unchanged", () => {
    const summary = buildAuditDashboardSummary([], [permEntry({}), permEntry({})], 3, 4, 5);
    expect(summary.permissionChangeCount).toBe(2);
    expect(summary.journalReversalCount).toBe(3);
    expect(summary.manualMatchingOverrideCount).toBe(4);
    expect(summary.workflowOverrideCount).toBe(5);
  });

  it("caps recent lists at 10", () => {
    const entries = Array.from({ length: 15 }, (_, i) => autoEntry({ id: i, isReversible: false }));
    expect(buildAuditDashboardSummary(entries, [], 0, 0, 0).recentCriticalEntries).toHaveLength(10);
  });
});
