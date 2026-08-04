import { describe, expect, it } from "vitest";
import { buildAuditDashboardSummary } from "./audit-dashboard-summary-service";
import type { AuditFinding } from "@/server/audit/types";

function finding(overrides: Partial<AuditFinding>): AuditFinding {
  return {
    id: 1, companyId: "co_1", engagementId: null, findingType: "WeekendPosting", category: "Test", severity: "Low",
    confidence: 0.9, reason: "r", evidence: "e", suggestedProcedure: "s", relatedType: null, relatedId: null,
    status: "Open", reviewedBy: null, reviewedAt: null, reviewNote: null, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildAuditDashboardSummary", () => {
  it("counts only Open findings toward every metric", () => {
    const findings = [finding({ id: 1, severity: "High", status: "Open" }), finding({ id: 2, severity: "High", status: "Dismissed" })];
    const summary = buildAuditDashboardSummary(findings, 80, 0);
    expect(summary.materialIssuesCount).toBe(1);
    expect(summary.outstandingExceptionsCount).toBe(1);
  });

  it("counts distinct finding types for High-Risk Areas", () => {
    const findings = [finding({ id: 1, findingType: "SuspenseAccountReview", severity: "High" }), finding({ id: 2, findingType: "SuspenseAccountReview", severity: "High" }), finding({ id: 3, findingType: "NegativeCash", severity: "Critical" })];
    const summary = buildAuditDashboardSummary(findings, 80, 0);
    expect(summary.highRiskAreaCount).toBe(2);
  });

  it("maps ControlWeakness findings to internalControlExceptionsCount", () => {
    const findings = [finding({ id: 1, findingType: "ControlWeakness" })];
    const summary = buildAuditDashboardSummary(findings, 80, 0);
    expect(summary.internalControlExceptionsCount).toBe(1);
  });

  it("escalates reconciliation status as aged reconciling items grow", () => {
    const clean = buildAuditDashboardSummary([], 80, 0);
    expect(clean.reconciliationStatus).toBe("Clean");

    const attention = buildAuditDashboardSummary(Array.from({ length: 5 }, (_, i) => finding({ id: i, findingType: "AgedReconcilingItems" })), 80, 0);
    expect(attention.reconciliationStatus).toBe("Attention");

    const critical = buildAuditDashboardSummary(Array.from({ length: 15 }, (_, i) => finding({ id: i, findingType: "AgedReconcilingItems" })), 80, 0);
    expect(critical.reconciliationStatus).toBe("Critical");
  });

  it("passes through the auditReadinessScore and missingDocumentsCount unchanged", () => {
    const summary = buildAuditDashboardSummary([], 73, 4);
    expect(summary.auditReadinessScore).toBe(73);
    expect(summary.missingDocumentsCount).toBe(4);
  });
});
