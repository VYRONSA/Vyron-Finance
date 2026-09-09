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

  // Phase 30B — GL 9999 "Suspense" is corrected from account_type
  // 'Equity' to 'Asset' (migration 0088). This proves WHY: before the
  // fix, ANY future Suspense balance would have been swept into this
  // exact Statement of Changes in Equity (this function filters purely
  // on `accountType === "Equity"`, with no name-based exclusion for
  // "Suspense" the way the AI candidate list has). After the fix, an
  // Asset-typed Suspense account is correctly excluded here — a
  // Suspense/clearing balance is never an equity movement.
  it("Phase 30B — an Asset-typed Suspense account (post-fix) never appears in the Statement of Changes in Equity, even with real activity", () => {
    const suspenseAccount = account(9, "9999", "Asset", "Debit");
    const accountsWithSuspense = [...ACCOUNTS, suspenseAccount];
    const opening: TrialBalanceRow[] = [row(4, "Equity", "Credit", 0, 25000), row(9, "Asset", "Debit", 0, 0)];
    const closing: TrialBalanceRow[] = [row(4, "Equity", "Credit", 0, 25000), row(9, "Asset", "Debit", 5000, 0)]; // Suspense picked up a real balance

    const statement = buildStatementOfChangesInEquity(accountsWithSuspense, opening, closing, "2026-01-01", "2026-01-31", 0);

    expect(statement.rows.some((r) => r.accountCode === "9999")).toBe(false);
  });

  it("Phase 30B — regression guard: if Suspense were still typed Equity (the OLD, incorrect state), it WOULD incorrectly appear here — proving the fix is the thing preventing this, not an accident", () => {
    const suspenseStillEquity = account(9, "9999", "Equity", "Debit"); // the pre-fix state, deliberately
    const accountsWithSuspense = [...ACCOUNTS, suspenseStillEquity];
    const opening: TrialBalanceRow[] = [row(4, "Equity", "Credit", 0, 25000), row(9, "Equity", "Debit", 0, 0)];
    const closing: TrialBalanceRow[] = [row(4, "Equity", "Credit", 0, 25000), row(9, "Equity", "Debit", 5000, 0)];

    const statement = buildStatementOfChangesInEquity(accountsWithSuspense, opening, closing, "2026-01-01", "2026-01-31", 0);

    expect(statement.rows.some((r) => r.accountCode === "9999")).toBe(true); // confirms this WOULD have been the bug
  });

  // Phase 30C, Task 2 — the requested chain, sorted ascending numerically.
  it("sorts a full requested chain of codes ascending numerically, never lexicographically", () => {
    const codes = ["1000", "1200", "5000", "6100", "6940", "7040", "9999"];
    const equityAccounts = codes.map((code, i) => account(200 + i, code, "Equity", "Credit"));
    const opening: TrialBalanceRow[] = equityAccounts.map((a) => row(a.id, "Equity", "Credit", 0, 0));
    const closing: TrialBalanceRow[] = equityAccounts.map((a) => row(a.id, "Equity", "Credit", 0, 100)); // give each a real balance so none are omitted

    const statement = buildStatementOfChangesInEquity(equityAccounts, opening, closing, "2026-01-01", "2026-01-31", 0);

    expect(statement.rows.map((r) => r.accountCode)).toEqual(codes); // already in ascending numeric order
  });

  it("lexicographic ordering cannot reappear — a differently-sized code lands in its correct numeric position", () => {
    const mixed = [account(210, "1200", "Equity", "Credit"), account(211, "500", "Equity", "Credit"), account(212, "1000", "Equity", "Credit")];
    const opening: TrialBalanceRow[] = mixed.map((a) => row(a.id, "Equity", "Credit", 0, 0));
    const closing: TrialBalanceRow[] = mixed.map((a) => row(a.id, "Equity", "Credit", 0, 100));

    const statement = buildStatementOfChangesInEquity(mixed, opening, closing, "2026-01-01", "2026-01-31", 0);

    // Numeric truth: 500 < 1000 < 1200. A lexicographic sort would have
    // produced ["1000", "1200", "500"] instead ('5' > '1' as a first
    // character) — genuinely wrong.
    expect(statement.rows.map((r) => r.accountCode)).toEqual(["500", "1000", "1200"]);
  });
});
