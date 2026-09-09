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

  // Phase 30B — GL 9999 "Suspense" corrected from account_type 'Equity'
  // to 'Asset' (migration 0088). Before the fix, ANY future Suspense
  // movement would have landed in Financing Activities (this function's
  // own `else if (account.accountType === "Equity")` branch) —
  // incorrectly implying it was an owner/financing transaction. After
  // the fix, an Asset-typed Suspense movement correctly lands in
  // Operating Activities instead (the same branch every ordinary
  // Asset/Liability working-capital change already uses).
  it("Phase 30B — an Asset-typed Suspense account (post-fix) with real movement lands in Operating Activities, never Financing", () => {
    const suspenseAccount = account(9, "9999", "Asset", "Debit");
    const accountsWithSuspense = [...ACCOUNTS, suspenseAccount];
    const start = [...START_ROWS, row(9, "Asset", "Debit", 0, 0)];
    const end = [...END_ROWS, row(9, "Asset", "Debit", 1500, 0)]; // Suspense picked up a real balance

    const statement = buildCashFlowStatement(accountsWithSuspense, start, end, "2026-01-01", "2026-01-31", NET_PROFIT, [1]);

    expect(statement.operatingActivities.lines.some((l) => l.accountCode === "9999")).toBe(true);
    expect(statement.financingActivities.lines.some((l) => l.accountCode === "9999")).toBe(false);
  });

  it("Phase 30B — regression guard: if Suspense were still typed Equity (the OLD, incorrect state), it WOULD incorrectly land in Financing Activities", () => {
    const suspenseStillEquity = account(9, "9999", "Equity", "Debit"); // the pre-fix state, deliberately
    const accountsWithSuspense = [...ACCOUNTS, suspenseStillEquity];
    const start = [...START_ROWS, row(9, "Equity", "Debit", 0, 0)];
    const end = [...END_ROWS, row(9, "Equity", "Debit", 1500, 0)];

    const statement = buildCashFlowStatement(accountsWithSuspense, start, end, "2026-01-01", "2026-01-31", NET_PROFIT, [1]);

    expect(statement.financingActivities.lines.some((l) => l.accountCode === "9999")).toBe(true); // confirms this WOULD have been the bug
  });

  // Phase 30C, Task 2 — the requested chain, sorted ascending numerically,
  // in Operating Activities (all Asset-typed, real movement each).
  it("sorts a full requested chain of codes ascending numerically in Operating Activities, never lexicographically", () => {
    const codes = ["1000", "1200", "5000", "6100", "6940", "7040", "9999"];
    const extraAccounts = codes.map((code, i) => account(300 + i, code, "Asset", "Debit"));
    const accountsWithExtras = [...ACCOUNTS, ...extraAccounts];
    const start = [...START_ROWS, ...extraAccounts.map((a) => row(a.id, "Asset", "Debit", 0, 0))];
    const end = [...END_ROWS, ...extraAccounts.map((a) => row(a.id, "Asset", "Debit", 100, 0))]; // each picks up a real balance

    const statement = buildCashFlowStatement(accountsWithExtras, start, end, "2026-01-01", "2026-01-31", NET_PROFIT, [1]);

    const extraCodesInOrder = statement.operatingActivities.lines.map((l) => l.accountCode).filter((c) => codes.includes(c));
    expect(extraCodesInOrder).toEqual(codes); // already in ascending numeric order
  });

  it("lexicographic ordering cannot reappear in Operating Activities — a differently-sized code lands in its correct numeric position", () => {
    const mixed = [account(310, "1200", "Asset", "Debit"), account(311, "500", "Asset", "Debit"), account(312, "1000", "Asset", "Debit")];
    const accountsWithMixed = [...ACCOUNTS, ...mixed];
    const start = [...START_ROWS, ...mixed.map((a) => row(a.id, "Asset", "Debit", 0, 0))];
    const end = [...END_ROWS, ...mixed.map((a) => row(a.id, "Asset", "Debit", 100, 0))];

    const statement = buildCashFlowStatement(accountsWithMixed, start, end, "2026-01-01", "2026-01-31", NET_PROFIT, [1]);

    const mixedCodesInOrder = statement.operatingActivities.lines.map((l) => l.accountCode).filter((c) => ["1200", "500", "1000"].includes(c));
    // Numeric truth: 500 < 1000 < 1200. A lexicographic sort would have
    // produced ["1000", "1200", "500"] instead — genuinely wrong.
    expect(mixedCodesInOrder).toEqual(["500", "1000", "1200"]);
  });
});
