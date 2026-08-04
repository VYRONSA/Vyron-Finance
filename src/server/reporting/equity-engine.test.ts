import { describe, expect, it } from "vitest";
import { buildStatementOfChangesInEquity } from "./equity-engine";
import { buildBalanceSheet } from "./balance-sheet-engine";
import type { AccountType, ChartOfAccount, NormalBalance, TrialBalanceRow } from "@/server/general-ledger/types";

function account(id: number, accountCode: string, accountType: AccountType, normalBalance: NormalBalance): ChartOfAccount {
  return {
    id, companyId: "co_1", accountCode, description: accountCode, accountType, category: "", normalBalance,
    parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "",
    branchId: null, departmentId: null, costCentreId: null, projectId: null,
    isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00Z",
  };
}

function row(accountId: number, accountType: AccountType, normalBalance: NormalBalance, debitBalance: number, creditBalance: number): TrialBalanceRow {
  return { accountId, accountCode: "", description: "", accountType, normalBalance, totalDebit: debitBalance, totalCredit: creditBalance, debitBalance, creditBalance };
}

const ACCOUNTS: ChartOfAccount[] = [
  account(1, "1000", "Asset", "Debit"),
  account(3, "2000", "Liability", "Credit"),
  account(4, "3000", "Equity", "Credit"), // Retained Income
  account(5, "3200", "Equity", "Credit"), // Owner Contributions
];

describe("buildStatementOfChangesInEquity", () => {
  it("shows opening balance, real movements, and closing balance per equity account", () => {
    const opening: TrialBalanceRow[] = [row(4, "Equity", "Credit", 0, 25000), row(5, "Equity", "Credit", 0, 0)];
    const closing: TrialBalanceRow[] = [row(4, "Equity", "Credit", 0, 25000), row(5, "Equity", "Credit", 0, 10000)];

    const statement = buildStatementOfChangesInEquity(ACCOUNTS, opening, closing, "2026-01-01", "2026-01-31", 45500);

    const contributions = statement.rows.find((r) => r.accountCode === "3200")!;
    expect(contributions.openingBalance).toBe(0);
    expect(contributions.movements).toBe(10000);
    expect(contributions.closingBalance).toBe(10000);

    const retained = statement.rows.find((r) => r.accountCode === "3000")!;
    expect(retained.openingBalance).toBe(25000);
    expect(retained.movements).toBe(0);
  });

  it("adds a synthetic Profit for the Period row, never attributed to a real account", () => {
    const opening: TrialBalanceRow[] = [row(4, "Equity", "Credit", 0, 25000)];
    const closing: TrialBalanceRow[] = [row(4, "Equity", "Credit", 0, 25000)];

    const statement = buildStatementOfChangesInEquity(ACCOUNTS, opening, closing, "2026-01-01", "2026-01-31", 45500);

    const profitRow = statement.rows.find((r) => r.description === "Profit for the Period")!;
    expect(profitRow.accountId).toBe(-1);
    expect(profitRow.movements).toBe(45500);
    expect(profitRow.closingBalance).toBe(45500);
  });

  it("omits the synthetic Profit row entirely when Net Profit for the period is zero", () => {
    const opening: TrialBalanceRow[] = [row(4, "Equity", "Credit", 0, 25000)];
    const closing: TrialBalanceRow[] = [row(4, "Equity", "Credit", 0, 25000)];
    const statement = buildStatementOfChangesInEquity(ACCOUNTS, opening, closing, "2026-01-01", "2026-01-31", 0);
    expect(statement.rows.some((r) => r.description === "Profit for the Period")).toBe(false);
  });

  it("totalClosingBalance matches buildBalanceSheet's total Equity for the identical date and Net Profit — the two statements can never diverge", () => {
    const closing: TrialBalanceRow[] = [
      row(1, "Asset", "Debit", 95500, 0),
      row(3, "Liability", "Credit", 0, 15000),
      row(4, "Equity", "Credit", 0, 25000),
      row(5, "Equity", "Credit", 0, 10000),
    ];
    const opening: TrialBalanceRow[] = [row(4, "Equity", "Credit", 0, 25000), row(5, "Equity", "Credit", 0, 0)];

    const netProfit = 45500;
    const statement = buildStatementOfChangesInEquity(ACCOUNTS, opening, closing, "2026-01-01", "2026-01-31", netProfit);
    const sheet = buildBalanceSheet(ACCOUNTS, closing, "2026-01-31", netProfit);

    expect(statement.totalClosingBalance).toBe(sheet.equity.total);
  });

  it("omits an equity account with no opening balance, no closing balance, and no activity", () => {
    const opening: TrialBalanceRow[] = [row(4, "Equity", "Credit", 0, 25000), row(5, "Equity", "Credit", 0, 0)];
    const closing: TrialBalanceRow[] = [row(4, "Equity", "Credit", 0, 25000), row(5, "Equity", "Credit", 0, 0)];
    const statement = buildStatementOfChangesInEquity(ACCOUNTS, opening, closing, "2026-01-01", "2026-01-31", 0);
    expect(statement.rows.some((r) => r.accountCode === "3200")).toBe(false);
  });
});
