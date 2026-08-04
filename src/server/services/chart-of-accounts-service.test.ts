import { describe, expect, it } from "vitest";
import {
  ValidationError,
  buildAccountTree,
  buildChartOfAccountsCsv,
  parseChartOfAccountsCsv,
  validateChartOfAccountInput,
  wouldCreateCycle,
} from "./chart-of-accounts-service";
import type { ChartOfAccount } from "@/server/general-ledger/types";

function account(overrides: Partial<ChartOfAccount> = {}): ChartOfAccount {
  return {
    id: 1,
    companyId: "co_1",
    accountCode: "1000",
    description: "Bank",
    accountType: "Asset",
    category: "Current Asset",
    normalBalance: "Debit",
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
    ...overrides,
  };
}

describe("validateChartOfAccountInput", () => {
  it("accepts a well-formed account", () => {
    expect(() =>
      validateChartOfAccountInput({ accountCode: "1000", description: "Bank", accountType: "Asset", normalBalance: "Debit" }),
    ).not.toThrow();
  });

  it("rejects a blank account code", () => {
    expect(() => validateChartOfAccountInput({ accountCode: "  ", description: "Bank", accountType: "Asset", normalBalance: "Debit" })).toThrow(
      ValidationError,
    );
  });

  it("rejects an account code with disallowed characters", () => {
    expect(() =>
      validateChartOfAccountInput({ accountCode: "1000 / A", description: "Bank", accountType: "Asset", normalBalance: "Debit" }),
    ).toThrow(ValidationError);
  });

  it("rejects a blank description", () => {
    expect(() => validateChartOfAccountInput({ accountCode: "1000", description: " ", accountType: "Asset", normalBalance: "Debit" })).toThrow(
      ValidationError,
    );
  });

  it("rejects an invalid account type", () => {
    expect(() =>
      validateChartOfAccountInput({
        accountCode: "1000",
        description: "Bank",
        // @ts-expect-error — deliberately invalid for the test
        accountType: "Not A Type",
        normalBalance: "Debit",
      }),
    ).toThrow(ValidationError);
  });

  it("rejects an invalid normal balance", () => {
    expect(() =>
      validateChartOfAccountInput({
        accountCode: "1000",
        description: "Bank",
        accountType: "Asset",
        // @ts-expect-error — deliberately invalid for the test
        normalBalance: "Sideways",
      }),
    ).toThrow(ValidationError);
  });
});

describe("wouldCreateCycle", () => {
  const accounts = [
    account({ id: 1, accountCode: "1000", parentAccountId: null }),
    account({ id: 2, accountCode: "1100", parentAccountId: 1 }),
    account({ id: 3, accountCode: "1110", parentAccountId: 2 }),
  ];

  it("is false for a legitimate new parent", () => {
    expect(wouldCreateCycle(accounts, 3, 1)).toBe(false);
  });

  it("is true for self-parenting", () => {
    expect(wouldCreateCycle(accounts, 1, 1)).toBe(true);
  });

  it("is true when the candidate parent is a descendant", () => {
    // Account 1 -> parent 3 would close the loop 1 -> 2 -> 3 -> 1.
    expect(wouldCreateCycle(accounts, 1, 3)).toBe(true);
  });
});

describe("buildAccountTree", () => {
  it("nests children under their parent, sorted by account code", () => {
    const accounts = [
      account({ id: 1, accountCode: "1000", description: "Assets", parentAccountId: null }),
      account({ id: 3, accountCode: "1200", description: "Inventory", parentAccountId: 1 }),
      account({ id: 2, accountCode: "1100", description: "Debtors", parentAccountId: 1 }),
    ];

    const tree = buildAccountTree(accounts);

    expect(tree).toHaveLength(1);
    expect(tree[0].accountCode).toBe("1000");
    expect(tree[0].children.map((c) => c.accountCode)).toEqual(["1100", "1200"]);
  });

  it("falls back an orphaned parent reference to the root level", () => {
    const accounts = [account({ id: 1, accountCode: "1000", parentAccountId: 999 })];
    const tree = buildAccountTree(accounts);
    expect(tree).toHaveLength(1);
    expect(tree[0].accountCode).toBe("1000");
  });

  it("defensively breaks a cyclic parent chain rather than infinite-looping", () => {
    const accounts = [
      account({ id: 1, accountCode: "1000", parentAccountId: 2 }),
      account({ id: 2, accountCode: "1100", parentAccountId: 1 }),
    ];
    const tree = buildAccountTree(accounts);
    // Both nodes can't nest inside each other — at least one lands at the root.
    expect(tree.length).toBeGreaterThanOrEqual(1);
  });
});

describe("buildChartOfAccountsCsv / parseChartOfAccountsCsv", () => {
  it("round-trips account code, description, and parent linkage through code", () => {
    const accounts = [
      account({ id: 1, accountCode: "1000", description: "Bank", parentAccountId: null }),
      account({ id: 2, accountCode: "1100", description: "Debtors", parentAccountId: 1, isControlAccount: true }),
    ];

    const csv = buildChartOfAccountsCsv(accounts);
    const { rows, errors } = parseChartOfAccountsCsv(csv);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ accountCode: "1100", description: "Debtors", parentAccountCode: "1000", isControlAccount: true });
  });

  it("collects an error per invalid row without throwing", () => {
    const csv = [
      "Account Code,Description,Account Type,Normal Balance",
      ",Missing Code,Asset,Debit",
      "2000,Bad Type,Not A Type,Debit",
      "3000,Bad Balance,Asset,Sideways",
      "4000,Valid Row,Liability,Credit",
    ].join("\n");

    const { rows, errors } = parseChartOfAccountsCsv(csv);

    expect(errors).toHaveLength(3);
    expect(rows).toHaveLength(1);
    expect(rows[0].accountCode).toBe("4000");
  });

  it("reports missing required columns instead of silently parsing garbage", () => {
    const { rows, errors } = parseChartOfAccountsCsv("Foo,Bar\n1,2");
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/missing required columns/i);
  });
});
