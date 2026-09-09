import { describe, expect, it } from "vitest";
import { dayBefore, identifyCashAccountIds } from "./financial-statements-service";
import type { ChartOfAccount } from "@/server/general-ledger/types";

function account(id: number, description: string, accountType: ChartOfAccount["accountType"]): ChartOfAccount {
  return {
    id, companyId: "co_1", accountCode: String(id), description, accountType, category: "", normalBalance: "Debit",
    parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "",
    branchId: null, departmentId: null, costCentreId: null, projectId: null,
    isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("dayBefore", () => {
  it("returns the previous calendar day", () => {
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  });

  it("handles a year boundary", () => {
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
  });
});

describe("identifyCashAccountIds", () => {
  it("matches Asset accounts named Bank or Cash, case-insensitively", () => {
    const accounts = [account(1, "Bank", "Asset"), account(2, "Petty Cash", "Asset"), account(3, "Debtors", "Asset"), account(4, "Bank Overdraft", "Liability")];
    expect(identifyCashAccountIds(accounts)).toEqual([1, 2]);
  });
});
