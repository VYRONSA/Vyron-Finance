import { describe, expect, it } from "vitest";
import { buildCashFlowStatement } from "./cash-flow-engine";
import type { AccountType, ChartOfAccount, NormalBalance, TrialBalanceRow } from "@/server/general-ledger/types";

function account(id: number, accountCode: string, accountType: AccountType, normalBalance: NormalBalance): ChartOfAccount {
  return {
    id, companyId: "co_1", accountCode, description: accountCode, accountType, category: "", normalBalance,
    parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "",
    branchId: null, departmentId: null, costCentreId: null, projectId: null,
    isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00Z",
  };
}

function row(accountId: number, accountType: AccountType, normalBalance: NormalBalance, totalDebit: number, totalCredit: number): TrialBalanceRow {
  const net = Math.round((totalDebit - totalCredit) * 100) / 100;
  return { accountId, accountCode: "", description: "", accountType, normalBalance, totalDebit, totalCredit, debitBalance: net >= 0 ? net : 0, creditBalance: net < 0 ? -net : 0 };
}

// Bank(1)/Debtors(2) Asset, Creditors(3) Liability, RetainedIncome(4) Equity,
// Sales(5) Income, Purchases(6) Cost of Sales — a small, self-consistent
// (fully balanced) period: DR Debtors 8000/CR Sales 8000 (credit sale),
// DR Purchases 5000/CR Creditors 5000 (credit purchase), DR RetainedIncome
// 2000/CR Bank 2000 (an owner drawing paid out of the bank).
const ACCOUNTS: ChartOfAccount[] = [
  account(1, "1000", "Asset", "Debit"),
  account(2, "1100", "Asset", "Debit"),
  account(3, "2000", "Liability", "Credit"),
  account(4, "3000", "Equity", "Credit"),
  account(5, "4000", "Income", "Credit"),
  account(6, "5000", "Cost of Sales", "Debit"),
];

const START_ROWS: TrialBalanceRow[] = [
  row(1, "Asset", "Debit", 50000, 0),
  row(2, "Asset", "Debit", 0, 0),
  row(3, "Liability", "Credit", 0, 0),
  row(4, "Equity", "Credit", 0, 30000),
  row(5, "Income", "Credit", 0, 0),
  row(6, "Cost of Sales", "Debit", 0, 0),
];

const END_ROWS: TrialBalanceRow[] = [
  row(1, "Asset", "Debit", 50000, 2000),
  row(2, "Asset", "Debit", 8000, 0),
  row(3, "Liability", "Credit", 0, 5000),
  row(4, "Equity", "Credit", 2000, 30000),
  row(5, "Income", "Credit", 0, 8000),
  row(6, "Cost of Sales", "Debit", 5000, 0),
];

const NET_PROFIT = 3000; // 8000 Sales - 5000 Purchases

describe("buildCashFlowStatement", () => {
  it("reconciles the indirect method exactly against the direct cash movement (double-entry guarantee)", () => {
    const statement = buildCashFlowStatement(ACCOUNTS, START_ROWS, END_ROWS, "2026-01-01", "2026-01-31", NET_PROFIT, [1]);

    expect(statement.operatingActivities.total).toBe(0); // 3000 Net Profit - 8000 Debtors increase + 5000 Creditors increase
    expect(statement.financingActivities.total).toBe(-2000); // the drawing
    expect(statement.investingActivities.total).toBe(0);
    expect(statement.netChangeInCash).toBe(-2000);
    expect(statement.actualCashMovement).toBe(-2000);
    expect(statement.reconciliationVariance).toBe(0);
  });

  it("computes opening and closing cash from the same two snapshots", () => {
    const statement = buildCashFlowStatement(ACCOUNTS, START_ROWS, END_ROWS, "2026-01-01", "2026-01-31", NET_PROFIT, [1]);
    expect(statement.openingCash).toBe(50000);
    expect(statement.closingCash).toBe(48000);
  });

  it("excludes P&L accounts (Income/Cost of Sales) from the Operating line list — captured only via Net Profit", () => {
    const statement = buildCashFlowStatement(ACCOUNTS, START_ROWS, END_ROWS, "2026-01-01", "2026-01-31", NET_PROFIT, [1]);
    expect(statement.operatingActivities.lines.some((l) => l.accountId === 5 || l.accountId === 6)).toBe(false);
  });

  it("flags a genuine reconciliation variance rather than masking it", () => {
    const statement = buildCashFlowStatement(ACCOUNTS, START_ROWS, END_ROWS, "2026-01-01", "2026-01-31", 999999, [1]);
    expect(statement.reconciliationVariance).not.toBe(0);
  });
});
