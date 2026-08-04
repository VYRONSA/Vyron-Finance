import { describe, expect, it } from "vitest";
import { buildIncomeStatement, computePeriodMovements } from "./income-statement-engine";
import type { AccountType, ChartOfAccount, NormalBalance, TrialBalanceRow } from "@/server/general-ledger/types";

function account(id: number, accountCode: string, description: string, accountType: AccountType, normalBalance: NormalBalance): ChartOfAccount {
  return {
    id,
    companyId: "co_1",
    accountCode,
    description,
    accountType,
    category: "",
    normalBalance,
    parentAccountId: null,
    reportingGroup: "",
    financialStatementGroup: "",
    taxTreatment: "",
    branchId: null,
    departmentId: null,
    costCentreId: null,
    projectId: null,
    isControlAccount: false,
    isActive: true,
    notes: "",
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function row(accountId: number, accountCode: string, accountType: AccountType, normalBalance: NormalBalance, totalDebit: number, totalCredit: number): TrialBalanceRow {
  const net = Math.round((totalDebit - totalCredit) * 100) / 100;
  return {
    accountId,
    accountCode,
    description: "",
    accountType,
    normalBalance,
    totalDebit,
    totalCredit,
    debitBalance: net >= 0 ? net : 0,
    creditBalance: net < 0 ? -net : 0,
  };
}

const ACCOUNTS: ChartOfAccount[] = [
  account(1, "1000", "Bank", "Asset", "Debit"),
  account(5, "4000", "Sales", "Income", "Credit"),
  account(6, "4100", "Sales Returns", "Income", "Debit"),
  account(7, "5000", "Purchases", "Cost of Sales", "Debit"),
  account(8, "6100", "Rent Expense", "Expense", "Debit"),
  account(9, "6200", "Interest Received", "Other Income", "Credit"),
];

const START_ROWS: TrialBalanceRow[] = ACCOUNTS.map((a) => row(a.id, a.accountCode, a.accountType, a.normalBalance, 0, 0));

const END_ROWS: TrialBalanceRow[] = [
  row(1, "1000", "Asset", "Debit", 100500, 15000),
  row(5, "4000", "Income", "Credit", 0, 100000),
  row(6, "4100", "Income", "Debit", 5000, 0),
  row(7, "5000", "Cost of Sales", "Debit", 40000, 0),
  row(8, "6100", "Expense", "Debit", 10000, 0),
  row(9, "6200", "Other Income", "Credit", 0, 500),
];

describe("computePeriodMovements", () => {
  it("diffs two snapshots into per-account period debit/credit movement", () => {
    const movements = computePeriodMovements(ACCOUNTS, START_ROWS, END_ROWS);
    expect(movements.get(5)).toMatchObject({ periodDebit: 0, periodCredit: 100000 });
    expect(movements.get(7)).toMatchObject({ periodDebit: 40000, periodCredit: 0 });
  });

  it("treats a missing start row as zero opening activity", () => {
    const movements = computePeriodMovements(ACCOUNTS, [], END_ROWS);
    expect(movements.get(9)).toMatchObject({ periodDebit: 0, periodCredit: 500 });
  });
});

describe("buildIncomeStatement", () => {
  it("builds Revenue -> Gross Profit -> Operating Profit -> Net Profit, netting a contra Income account against Revenue", () => {
    const statement = buildIncomeStatement(ACCOUNTS, START_ROWS, END_ROWS, "2026-01-01", "2026-01-31");

    expect(statement.revenue.total).toBe(95000); // 100000 Sales - 5000 Sales Returns
    expect(statement.costOfSales.total).toBe(40000);
    expect(statement.grossProfit).toBe(55000);
    expect(statement.operatingExpenses.total).toBe(10000);
    expect(statement.operatingProfit).toBe(45000);
    expect(statement.otherIncome.total).toBe(500);
    expect(statement.otherExpense.total).toBe(0);
    expect(statement.netProfit).toBe(45500);
  });

  it("omits accounts with zero period activity rather than fabricating a zero line", () => {
    const accountsWithIdleExpense = [...ACCOUNTS, account(99, "6300", "Idle Expense", "Expense", "Debit")];
    const idleRow = row(99, "6300", "Expense", "Debit", 0, 0);
    const statement = buildIncomeStatement(accountsWithIdleExpense, [...START_ROWS, idleRow], [...END_ROWS, idleRow], "2026-01-01", "2026-01-31");
    expect(statement.operatingExpenses.lines.some((l) => l.accountId === 99)).toBe(false);
  });

  it("excludes Balance Sheet account types (Asset/Liability/Equity) from every P&L section", () => {
    const withBank = buildIncomeStatement(ACCOUNTS, START_ROWS, END_ROWS, "2026-01-01", "2026-01-31");
    const allLines = [...withBank.revenue.lines, ...withBank.costOfSales.lines, ...withBank.operatingExpenses.lines, ...withBank.otherIncome.lines, ...withBank.otherExpense.lines];
    expect(allLines.some((l) => l.accountId === 1)).toBe(false);
  });
});
