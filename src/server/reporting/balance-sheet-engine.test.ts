import { describe, expect, it } from "vitest";
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
  account(2, "1100", "Asset", "Debit"),
  account(3, "2000", "Liability", "Credit"),
  account(4, "3000", "Equity", "Credit"),
];

describe("buildBalanceSheet", () => {
  it("balances when Current Year Earnings folds unclosed Net Profit into Equity", () => {
    const rows: TrialBalanceRow[] = [
      row(1, "Asset", "Debit", 65500, 0), // Bank
      row(2, "Asset", "Debit", 20000, 0), // Debtors
      row(3, "Liability", "Credit", 0, 15000), // Creditors
      row(4, "Equity", "Credit", 0, 25000), // Retained Income (opening)
    ];

    const sheet = buildBalanceSheet(ACCOUNTS, rows, "2026-01-31", 45500);

    expect(sheet.totalAssets).toBe(85500);
    expect(sheet.equity.total).toBe(70500); // 25000 opening + 45500 current year earnings
    expect(sheet.totalLiabilitiesAndEquity).toBe(85500);
    expect(sheet.isBalanced).toBe(true);
    expect(sheet.equity.lines.some((l) => l.description === "Current Year Earnings" && l.amount === 45500)).toBe(true);
  });

  it("reports isBalanced: false when the figures genuinely don't reconcile — a real ledger-integrity signal", () => {
    const rows: TrialBalanceRow[] = [
      row(1, "Asset", "Debit", 65500, 0),
      row(2, "Asset", "Debit", 20000, 0),
      row(3, "Liability", "Credit", 0, 15000),
      row(4, "Equity", "Credit", 0, 25000),
    ];

    const sheet = buildBalanceSheet(ACCOUNTS, rows, "2026-01-31", 1000); // wrong earnings figure on purpose
    expect(sheet.isBalanced).toBe(false);
  });

  it("omits zero-balance accounts rather than fabricating a zero line", () => {
    const rows: TrialBalanceRow[] = [
      row(1, "Asset", "Debit", 65500, 0),
      row(2, "Asset", "Debit", 0, 0), // Debtors, zero balance this period
      row(3, "Liability", "Credit", 0, 15000),
      row(4, "Equity", "Credit", 0, 25000),
    ];
    const sheet = buildBalanceSheet(ACCOUNTS, rows, "2026-01-31", 0);
    expect(sheet.assets.lines.some((l) => l.accountId === 2)).toBe(false);
  });

  it("skips the synthetic Current Year Earnings line entirely when it's zero", () => {
    const rows: TrialBalanceRow[] = [row(1, "Asset", "Debit", 25000, 0), row(3, "Liability", "Credit", 0, 15000), row(4, "Equity", "Credit", 0, 10000)];
    const sheet = buildBalanceSheet(ACCOUNTS, rows, "2026-01-31", 0);
    expect(sheet.equity.lines.some((l) => l.description === "Current Year Earnings")).toBe(false);
  });
});
