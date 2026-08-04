import { describe, expect, it } from "vitest";
import {
  buildExceptionReportPaper,
  buildLeadSchedule,
  buildReconciliationPaper,
  buildSamplingListPaper,
  buildSupportingSchedule,
  buildVarianceReportPaper,
} from "./working-paper-engine";
import type { TrialBalanceRow } from "@/server/general-ledger/types";
import type { AuditFinding } from "./types";

function row(overrides: Partial<TrialBalanceRow>): TrialBalanceRow {
  return { accountId: 1, accountCode: "1000", description: "Bank", accountType: "Asset", normalBalance: "Debit", totalDebit: 0, totalCredit: 0, debitBalance: 0, creditBalance: 0, ...overrides };
}

describe("buildLeadSchedule", () => {
  it("groups rows by account type with real subtotals", () => {
    const rows = [row({ accountId: 1, accountType: "Asset", debitBalance: 1000 }), row({ accountId: 2, accountType: "Asset", accountCode: "1100", debitBalance: 500 }), row({ accountId: 3, accountType: "Liability", accountCode: "2000", creditBalance: 300 })];
    const paper = buildLeadSchedule(rows, "2026-05-31");
    const content = paper.content as { sections: { accountType: string; subtotalDebit: number }[] };
    const assetSection = content.sections.find((s) => s.accountType === "Asset")!;
    expect(assetSection.subtotalDebit).toBe(1500);
  });
});

describe("buildSupportingSchedule", () => {
  it("totals debits and credits from the transaction list", () => {
    const paper = buildSupportingSchedule("1000", "Bank", [
      { id: 1, postingDate: "2026-05-01", reference: "R1", description: "", debit: 100, credit: 0, journalNumber: "JR1" },
      { id: 2, postingDate: "2026-05-02", reference: "R2", description: "", debit: 0, credit: 40, journalNumber: "JR2" },
    ]);
    expect(paper.content.totalDebit).toBe(100);
    expect(paper.content.totalCredit).toBe(40);
    expect(paper.content.transactionCount).toBe(2);
  });
});

describe("buildReconciliationPaper", () => {
  it("buckets transactions by allocation status", () => {
    const paper = buildReconciliationPaper(
      [
        { allocationStatus: "Matched", debit: 100, credit: 0 },
        { allocationStatus: "Unallocated", debit: 50, credit: 0 },
        { allocationStatus: "Unallocated", debit: 25, credit: 0 },
      ],
      "2026-05-31",
    );
    const content = paper.content as { byStatus: Record<string, { count: number; amount: number }> };
    expect(content.byStatus.Matched.count).toBe(1);
    expect(content.byStatus.Unallocated.count).toBe(2);
    expect(content.byStatus.Unallocated.amount).toBe(75);
  });
});

describe("buildVarianceReportPaper", () => {
  it("computes variance and variance percent", () => {
    const paper = buildVarianceReportPaper([{ accountCode: "4000", description: "Sales", expected: 100000, actual: 120000 }], "FY2026");
    const content = paper.content as { rows: { variance: number; variancePercent: number }[] };
    expect(content.rows[0].variance).toBe(20000);
    expect(content.rows[0].variancePercent).toBe(20);
  });
});

describe("buildExceptionReportPaper", () => {
  it("only includes Open findings", () => {
    const findings: AuditFinding[] = [
      { id: 1, companyId: "co_1", engagementId: null, findingType: "WeekendPosting", category: "Test", severity: "Low", confidence: 0.9, reason: "r", evidence: "e", suggestedProcedure: "s", relatedType: null, relatedId: null, status: "Open", reviewedBy: null, reviewedAt: null, reviewNote: null, createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, companyId: "co_1", engagementId: null, findingType: "WeekendPosting", category: "Test", severity: "Low", confidence: 0.9, reason: "r", evidence: "e", suggestedProcedure: "s", relatedType: null, relatedId: null, status: "Dismissed", reviewedBy: "Auditor", reviewedAt: "2026-01-02T00:00:00Z", reviewNote: null, createdAt: "2026-01-01T00:00:00Z" },
    ];
    const paper = buildExceptionReportPaper(findings);
    expect(paper.content.totalOpen).toBe(1);
  });
});

describe("buildSamplingListPaper", () => {
  it("returns a deterministic systematic sample of the requested size", () => {
    const population = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, label: `Txn ${i + 1}`, amount: 100 }));
    const paper1 = buildSamplingListPaper(population, 10);
    const paper2 = buildSamplingListPaper(population, 10);
    expect(paper1.content.sample).toEqual(paper2.content.sample);
    expect((paper1.content.sample as unknown[]).length).toBeLessThanOrEqual(10);
  });

  it("handles an empty population", () => {
    const paper = buildSamplingListPaper([], 10);
    expect(paper.content.sampleSize).toBe(0);
  });
});
