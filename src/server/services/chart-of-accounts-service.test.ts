import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/chart-of-accounts-repository", () => ({
  createChartOfAccount: vi.fn(),
  listChartOfAccounts: vi.fn(),
  getChartOfAccount: vi.fn(),
  updateChartOfAccount: vi.fn(),
}));

import {
  ValidationError,
  buildAccountTree,
  buildChartOfAccountsCsv,
  CHART_OF_ACCOUNTS_IMPORT_TEMPLATE_HEADERS,
  parseChartOfAccountsCsv,
  validateChartOfAccountInput,
  wouldCreateCycle,
  createChartOfAccount,
  importChartOfAccountsCsv,
} from "./chart-of-accounts-service";
import {
  createChartOfAccount as repoCreateChartOfAccount,
  listChartOfAccounts as repoListChartOfAccounts,
  updateChartOfAccount as repoUpdateChartOfAccount,
} from "@/server/repositories/chart-of-accounts-repository";
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

  // Phase 30 — proves the sort is genuinely NUMERIC, not lexicographic
  // (`account_code` is a TEXT column). A differently-sized code is the
  // one case where the two disagree — "500" is lexicographically before
  // "1000" (wrong) but numerically after it (right).
  it("sorts numerically, not lexicographically — a shorter code is not automatically 'first'", () => {
    const accounts = [
      account({ id: 1, accountCode: "1000", parentAccountId: null }),
      account({ id: 2, accountCode: "500", parentAccountId: null }),
      account({ id: 3, accountCode: "2000", parentAccountId: null }),
    ];
    const tree = buildAccountTree(accounts);
    expect(tree.map((n) => n.accountCode)).toEqual(["500", "1000", "2000"]);
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

  // Phase 32 — points the user at the template instead of leaving them to guess.
  it("the missing-columns error points the user at the Chart of Accounts Import Template", () => {
    const { errors } = parseChartOfAccountsCsv("Foo,Bar\n1,2");
    expect(errors[0]).toContain("Download the Chart of Accounts Import Template");
  });
});

// Phase 32 — "the template must be generated from the ACTUAL importer
// contract... do not invent columns."
describe("CHART_OF_ACCOUNTS_IMPORT_TEMPLATE_HEADERS (Phase 32)", () => {
  it("is accepted end-to-end by the parser with no missing-columns rejection", () => {
    const csv = [CHART_OF_ACCOUNTS_IMPORT_TEMPLATE_HEADERS.join(","), "5000,Rent Expense,Expense,Debit,Overheads,,,,,No,"].join("\n");
    const { rows, errors } = parseChartOfAccountsCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountCode: "5000", description: "Rent Expense", accountType: "Expense", normalBalance: "Debit", category: "Overheads" });
  });
});

// -----------------------------------------------------------------------
// Phase 26G, Part L — "+ Add General Ledger Account" reuses this exact
// service function (via the existing POST /general-ledger/chart-of-accounts
// route), so its validation and duplicate-code handling are what protect
// that new inline workflow. Added here: the account-code uniqueness
// mapping this ticket's own testing requirements call for, previously
// untested (a raw Postgres 23505 would have surfaced as an opaque 500).
// -----------------------------------------------------------------------
describe("createChartOfAccount", () => {
  beforeEach(() => {
    vi.mocked(repoCreateChartOfAccount).mockReset();
  });

  it("validates before ever reaching the repository", async () => {
    await expect(createChartOfAccount("co_1", { accountCode: "", description: "Bank", accountType: "Asset", normalBalance: "Debit" })).rejects.toThrow(ValidationError);
    expect(repoCreateChartOfAccount).not.toHaveBeenCalled();
  });

  it("trims accountCode/description before writing", async () => {
    vi.mocked(repoCreateChartOfAccount).mockResolvedValue(account({ accountCode: "6950", description: "Marketing" }));
    await createChartOfAccount("co_1", { accountCode: "  6950  ", description: "  Marketing  ", accountType: "Expense", normalBalance: "Debit" });
    expect(repoCreateChartOfAccount).toHaveBeenCalledWith("co_1", expect.objectContaining({ accountCode: "6950", description: "Marketing" }));
  });

  it("maps a duplicate account_code (unique constraint violation) to a friendly ValidationError, never a raw 500", async () => {
    vi.mocked(repoCreateChartOfAccount).mockRejectedValue({ code: "23505", message: 'duplicate key value violates unique constraint "chart_of_accounts_company_id_account_code_key"' });

    await expect(createChartOfAccount("co_1", { accountCode: "1000", description: "Bank", accountType: "Asset", normalBalance: "Debit" })).rejects.toThrow(ValidationError);
    await expect(createChartOfAccount("co_1", { accountCode: "1000", description: "Bank", accountType: "Asset", normalBalance: "Debit" })).rejects.toThrow(/already exists/i);
  });

  it("does not swallow an unrelated database error as a duplicate", async () => {
    vi.mocked(repoCreateChartOfAccount).mockRejectedValue(new Error("connection reset"));
    await expect(createChartOfAccount("co_1", { accountCode: "1000", description: "Bank", accountType: "Asset", normalBalance: "Debit" })).rejects.toThrow("connection reset");
  });

  it("returns the real created account on success", async () => {
    const created = account({ id: 99, accountCode: "6950", description: "Marketing" });
    vi.mocked(repoCreateChartOfAccount).mockResolvedValue(created);
    await expect(createChartOfAccount("co_1", { accountCode: "6950", description: "Marketing", accountType: "Expense", normalBalance: "Debit" })).resolves.toEqual(created);
  });
});

// Phase 32A — a non-blank Parent Account code that doesn't resolve to a
// real account (typo, or absent from both the file and the company) was
// previously silently dropped: the child account was still created, just
// with no parent link and no error. It must now be reported.
describe("importChartOfAccountsCsv — Parent Account resolution (Phase 32A)", () => {
  beforeEach(() => {
    vi.mocked(repoListChartOfAccounts).mockReset().mockResolvedValue([]);
    vi.mocked(repoCreateChartOfAccount)
      .mockReset()
      .mockImplementation(async (_companyId, input) => account({ id: input.accountCode === "1000" ? 1 : 2, accountCode: input.accountCode, description: input.description }));
    vi.mocked(repoUpdateChartOfAccount).mockReset().mockResolvedValue(account());
  });

  it("reports an error and skips the link when Parent Account doesn't resolve to any known code", async () => {
    const csv = [
      CHART_OF_ACCOUNTS_IMPORT_TEMPLATE_HEADERS.join(","),
      "1100,Debtors,Asset,Debit,,9999,,,,No,",
    ].join("\n");

    const { created, errors } = await importChartOfAccountsCsv("co_1", csv);

    expect(created).toHaveLength(1); // the account itself was still created
    expect(errors).toEqual(['Account Code "1100": Parent Account "9999" was not found — parent link skipped.']);
    expect(repoUpdateChartOfAccount).not.toHaveBeenCalled();
  });

  it("reports an error and skips the link when Parent Account is the account's own code", async () => {
    const csv = [
      CHART_OF_ACCOUNTS_IMPORT_TEMPLATE_HEADERS.join(","),
      "1100,Debtors,Asset,Debit,,1100,,,,No,",
    ].join("\n");

    const { created, errors } = await importChartOfAccountsCsv("co_1", csv);

    expect(created).toHaveLength(1);
    expect(errors).toEqual(['Account Code "1100": Parent Account cannot be the account\'s own code — parent link skipped.']);
    expect(repoUpdateChartOfAccount).not.toHaveBeenCalled();
  });

  it("still links a Parent Account that resolves to a real code in the same file", async () => {
    vi.mocked(repoCreateChartOfAccount).mockImplementation(async (_companyId, input) =>
      account({ id: input.accountCode === "1000" ? 1 : 2, accountCode: input.accountCode, description: input.description }),
    );
    const csv = [
      CHART_OF_ACCOUNTS_IMPORT_TEMPLATE_HEADERS.join(","),
      "1000,Assets,Asset,Debit,,,,,,No,",
      "1100,Debtors,Asset,Debit,,1000,,,,No,",
    ].join("\n");

    const { created, errors } = await importChartOfAccountsCsv("co_1", csv);

    expect(errors).toEqual([]);
    expect(created).toHaveLength(2);
    expect(repoUpdateChartOfAccount).toHaveBeenCalledWith("co_1", 2, { parent_account_id: 1 });
  });
});
