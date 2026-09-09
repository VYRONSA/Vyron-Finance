import { describe, expect, it } from "vitest";
import { findRelatedAuditFindings, findRelatedWorkingPapers } from "./audit-trail-link-engine";
import type { AuditFinding, AuditWorkingPaper } from "@/server/audit/types";

function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    id: 1, companyId: "co_1", engagementId: null, findingType: "DuplicateJournals", category: "Test",
    severity: "Medium", confidence: 0.8, reason: "r", evidence: "e", suggestedProcedure: "p",
    relatedType: null, relatedId: null, status: "Open", reviewedBy: null, reviewedAt: null, reviewNote: null,
    createdAt: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function workingPaper(overrides: Partial<AuditWorkingPaper> = {}): AuditWorkingPaper {
  return {
    id: 1, companyId: "co_1", engagementId: null, paperType: "SupportingSchedule", title: "Supporting Schedule — 1000 Bank",
    content: {}, generatedAt: "2026-05-01T00:00:00Z", generatedBy: "System",
    ...overrides,
  };
}

describe("findRelatedAuditFindings", () => {
  it("matches a finding tagged against this account", () => {
    const findings = [finding({ id: 1, relatedType: "chart_of_account", relatedId: 42 }), finding({ id: 2, relatedType: "journal", relatedId: 99 })];
    expect(findRelatedAuditFindings(findings, { accountId: 42 }).map((f) => f.id)).toEqual([1]);
  });

  it("matches a finding tagged against this journal", () => {
    const findings = [finding({ id: 1, relatedType: "journal", relatedId: 7 })];
    expect(findRelatedAuditFindings(findings, { journalId: 7 }).map((f) => f.id)).toEqual([1]);
  });

  it("returns nothing for a finding with no relatedType/relatedId", () => {
    const findings = [finding({ id: 1, relatedType: null, relatedId: null })];
    expect(findRelatedAuditFindings(findings, { accountId: 1 })).toHaveLength(0);
  });
});

describe("findRelatedWorkingPapers", () => {
  it("matches a Supporting Schedule by its own accountCode header", () => {
    const papers = [workingPaper({ id: 1, content: { accountCode: "1000" } }), workingPaper({ id: 2, content: { accountCode: "2000" } })];
    expect(findRelatedWorkingPapers(papers, "1000").map((p) => p.id)).toEqual([1]);
  });

  it("matches a Lead Schedule by a line-item account code inside its sections", () => {
    const papers = [workingPaper({ id: 1, paperType: "LeadSchedule", content: { sections: [{ lines: [{ accountCode: "1000" }, { accountCode: "2000" }] }] } })];
    expect(findRelatedWorkingPapers(papers, "2000")).toHaveLength(1);
    expect(findRelatedWorkingPapers(papers, "9999")).toHaveLength(0);
  });

  it("returns nothing when accountCode is empty", () => {
    expect(findRelatedWorkingPapers([workingPaper()], "")).toHaveLength(0);
  });
});
