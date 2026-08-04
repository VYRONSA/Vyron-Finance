import { describe, expect, it } from "vitest";
import { buildReportingPackageContents, determinePackageSections } from "./reporting-package-engine";
import type { IncomeStatement } from "./income-statement-engine";
import type { BalanceSheet } from "./balance-sheet-engine";
import type { CashFlowStatement } from "./cash-flow-engine";
import type { StatementOfChangesInEquity } from "./equity-engine";
import type { DisclosureNoteResult } from "@/server/disclosures/disclosure-engine";

const INCOME_STATEMENT: IncomeStatement = {
  periodStart: "2026-05-01", periodEnd: "2026-05-31",
  revenue: { label: "Revenue", lines: [], total: 100000 }, costOfSales: { label: "Cost of Sales", lines: [], total: 40000 },
  grossProfit: 60000, operatingExpenses: { label: "Operating Expenses", lines: [], total: 20000 }, operatingProfit: 40000,
  otherIncome: { label: "Other Income", lines: [], total: 0 }, otherExpense: { label: "Other Expense", lines: [], total: 0 }, netProfit: 40000,
};
const BALANCE_SHEET: BalanceSheet = {
  asOfDate: "2026-05-31", assets: { label: "Assets", lines: [], total: 200000 }, liabilities: { label: "Liabilities", lines: [], total: 50000 },
  equity: { label: "Equity", lines: [], total: 150000 }, totalAssets: 200000, totalLiabilitiesAndEquity: 200000, isBalanced: true,
};
const CASH_FLOW: CashFlowStatement = {
  periodStart: "2026-05-01", periodEnd: "2026-05-31", operatingActivities: { label: "Operating Activities", lines: [], total: 40000 },
  investingActivities: { label: "Investing Activities", lines: [], total: 0 }, financingActivities: { label: "Financing Activities", lines: [], total: 0 },
  netChangeInCash: 40000, actualCashMovement: 40000, reconciliationVariance: 0, openingCash: 60000, closingCash: 100000,
};
const EQUITY_STATEMENT: StatementOfChangesInEquity = { periodStart: "2026-05-01", periodEnd: "2026-05-31", rows: [], totalOpeningBalance: 110000, totalMovements: 40000, totalClosingBalance: 150000 };
const NOTES: DisclosureNoteResult[] = [
  { noteType: "FixedAssetNotes", title: "Property, Plant and Equipment", content: { facts: [], placeholders: [] }, requiresUserInput: false },
  { noteType: "RelatedPartyTransactions", title: "Related Party Transactions", content: { facts: [], placeholders: ["x"] }, requiresUserInput: true },
];
const TB_SUMMARY = { totalDebit: 250000, totalCredit: 250000, accountCount: 12 };
const AUDIT_SUMMARY = { auditReadinessScore: 84, openFindingsCount: 3 };

describe("determinePackageSections", () => {
  it("keeps a Management Pack lean — no equity statement, no full disclosures, no audit summary", () => {
    const sections = determinePackageSections("ManagementPack");
    expect(sections).toEqual({ includeEquityStatement: false, includeAllDisclosures: false, includeTrialBalanceSummary: false, includeAuditSummary: false });
  });

  it("only the Auditor Pack includes the audit summary", () => {
    expect(determinePackageSections("AccountantPack").includeAuditSummary).toBe(false);
    expect(determinePackageSections("AuditorPack").includeAuditSummary).toBe(true);
  });
});

describe("buildReportingPackageContents", () => {
  it("a Management Pack omits the equity statement, audit summary, and pure-placeholder notes", () => {
    const pack = buildReportingPackageContents("ManagementPack", "2026-05-01", "2026-05-31", "FY2026", INCOME_STATEMENT, BALANCE_SHEET, CASH_FLOW, EQUITY_STATEMENT, NOTES, null, TB_SUMMARY, AUDIT_SUMMARY);
    expect(pack.statementOfChangesInEquity).toBeNull();
    expect(pack.auditSummary).toBeNull();
    expect(pack.disclosureNotes.some((n) => n.noteType === "RelatedPartyTransactions")).toBe(false);
    expect(pack.disclosureNotes.some((n) => n.noteType === "FixedAssetNotes")).toBe(true);
  });

  it("an Auditor Pack includes everything, including the pure-placeholder notes and audit summary", () => {
    const pack = buildReportingPackageContents("AuditorPack", "2026-05-01", "2026-05-31", "FY2026", INCOME_STATEMENT, BALANCE_SHEET, CASH_FLOW, EQUITY_STATEMENT, NOTES, null, TB_SUMMARY, AUDIT_SUMMARY);
    expect(pack.statementOfChangesInEquity).not.toBeNull();
    expect(pack.auditSummary).toEqual(AUDIT_SUMMARY);
    expect(pack.disclosureNotes).toHaveLength(2);
    expect(pack.trialBalanceSummary).toEqual(TB_SUMMARY);
  });

  it("never recomputes the statements it was handed — the income statement passed through is the same object", () => {
    const pack = buildReportingPackageContents("BoardPack", "2026-05-01", "2026-05-31", "FY2026", INCOME_STATEMENT, BALANCE_SHEET, CASH_FLOW, EQUITY_STATEMENT, NOTES, null, TB_SUMMARY, AUDIT_SUMMARY);
    expect(pack.incomeStatement).toBe(INCOME_STATEMENT);
    expect(pack.balanceSheet).toBe(BALANCE_SHEET);
  });
});
