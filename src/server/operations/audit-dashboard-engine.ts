/**
 * Pure aggregation across the platform's two REAL audit-log tables
 * (`automation_audit_log`, `permission_audit_log` — confirmed the only
 * two `_audit_log`-shaped tables that exist anywhere in this codebase)
 * plus two adjacent real history tables (`matching_overrides`,
 * reversed `ae_journals` rows) — every metric here "drills into the
 * existing Audit Trail," per the directive, rather than a parallel one.
 */

import type { AutomationAuditLogEntry } from "@/server/automation/types";
import type { PermissionAuditEntry } from "@/server/permissions/types";

export type AuditDashboardSummary = {
  totalAutomationEntries: number;
  recentCriticalEntries: AutomationAuditLogEntry[];
  permissionChangeCount: number;
  recentPermissionChanges: PermissionAuditEntry[];
  journalReversalCount: number;
  manualMatchingOverrideCount: number;
  workflowOverrideCount: number;
};

/** Non-reversible automation entries (`isReversible: false`) are
 * surfaced first as the "critical" subset — an irreversible automated
 * action is inherently higher-signal than a reversible one. */
export function buildAuditDashboardSummary(
  automationEntries: AutomationAuditLogEntry[],
  permissionEntries: PermissionAuditEntry[],
  journalReversalCount: number,
  manualMatchingOverrideCount: number,
  workflowOverrideCount: number,
): AuditDashboardSummary {
  return {
    totalAutomationEntries: automationEntries.length,
    recentCriticalEntries: automationEntries.filter((e) => !e.isReversible).slice(0, 10),
    permissionChangeCount: permissionEntries.length,
    recentPermissionChanges: permissionEntries.slice(0, 10),
    journalReversalCount,
    manualMatchingOverrideCount,
    workflowOverrideCount,
  };
}
