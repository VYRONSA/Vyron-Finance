import { describe, expect, it } from "vitest";
import { MOCK_DISCLOSURE_NOTES, MOCK_REPORTING_PACKAGES, MOCK_REPORTING_READINESS, MOCK_STATEMENT_OF_CHANGES_IN_EQUITY } from "./financial-statements-data";
import { MOCK_BALANCE_SHEET } from "./financial-reporting-data";

describe("financial-statements-data mock Statement of Changes in Equity", () => {
  it("ties its totalClosingBalance to the Balance Sheet's own Equity total", () => {
    expect(MOCK_STATEMENT_OF_CHANGES_IN_EQUITY.totalClosingBalance).toBe(MOCK_BALANCE_SHEET.equity.total);
  });
});

describe("financial-statements-data mock disclosure notes", () => {
  it("generates all 11 note types with a unique id each", () => {
    expect(MOCK_DISCLOSURE_NOTES).toHaveLength(11);
    const ids = MOCK_DISCLOSURE_NOTES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("derives real facts for the data-driven notes and honest placeholders for Related Party/Commitments/Events After Reporting Date", () => {
    const fixedAssetNote = MOCK_DISCLOSURE_NOTES.find((n) => n.noteType === "FixedAssetNotes")!;
    expect((fixedAssetNote.generatedContent as { facts: string[] }).facts.length).toBeGreaterThan(0);

    const relatedParty = MOCK_DISCLOSURE_NOTES.find((n) => n.noteType === "RelatedPartyTransactions")!;
    expect(relatedParty.requiresUserInput).toBe(true);
    expect((relatedParty.generatedContent as { facts: string[] }).facts).toHaveLength(0);
  });
});

describe("financial-statements-data mock reporting packages", () => {
  it("a Management Pack omits the audit summary; an Auditor Pack includes it", () => {
    const management = MOCK_REPORTING_PACKAGES.find((p) => p.packageType === "ManagementPack")!;
    const auditor = MOCK_REPORTING_PACKAGES.find((p) => p.packageType === "AuditorPack")!;
    expect((management.contents as { auditSummary: unknown }).auditSummary).toBeNull();
    expect((auditor.contents as { auditSummary: unknown }).auditSummary).not.toBeNull();
  });
});

describe("financial-statements-data mock reporting readiness", () => {
  it("derives a real score and status, tied to the real Balance Sheet balance state", () => {
    expect(MOCK_REPORTING_READINESS.isBalanceSheetBalanced).toBe(MOCK_BALANCE_SHEET.isBalanced);
    expect(MOCK_REPORTING_READINESS.score).toBeGreaterThanOrEqual(0);
    expect(MOCK_REPORTING_READINESS.score).toBeLessThanOrEqual(100);
  });
});
