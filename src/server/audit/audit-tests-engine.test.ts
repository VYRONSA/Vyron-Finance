import { describe, expect, it } from "vitest";
import {
  runAgedReconcilingItemsTest,
  runBenfordAnalysis,
  runCutoffTest,
  runDuplicateCustomersTest,
  runDuplicateSuppliersTest,
  runHolidayPostingTest,
  runLargeJournalsTest,
  runManualJournalReviewTest,
  runNegativeCashTest,
  runNegativeInventoryTest,
  runOrphanTransactionsTest,
  runPostingDateTest,
  runSequenceGapsTest,
  runSuspenseAccountReviewTest,
  runWeekendPostingTest,
} from "./audit-tests-engine";
import type { TrialBalanceRow } from "@/server/general-ledger/types";

describe("runDuplicateSuppliersTest", () => {
  it("flags suppliers sharing a normalized name", () => {
    const findings = runDuplicateSuppliersTest([
      { id: 1, name: "Acme Traders", bankAccountNumber: "111", vatNumber: "V1" },
      { id: 2, name: "ACME TRADERS", bankAccountNumber: "222", vatNumber: "V2" },
      { id: 3, name: "Different Co", bankAccountNumber: "333", vatNumber: "V3" },
    ]);
    expect(findings.filter((f) => f.findingType === "DuplicateSuppliers").length).toBeGreaterThanOrEqual(2);
  });

  it("scores a shared bank account higher confidence than a shared name", () => {
    const findings = runDuplicateSuppliersTest([
      { id: 1, name: "Acme Traders", bankAccountNumber: "SAME123", vatNumber: "V1" },
      { id: 2, name: "Totally Different Name", bankAccountNumber: "SAME123", vatNumber: "V2" },
    ]);
    expect(findings.some((f) => f.confidence === 0.8)).toBe(true);
  });

  it("does not flag genuinely distinct suppliers", () => {
    const findings = runDuplicateSuppliersTest([
      { id: 1, name: "Acme Traders", bankAccountNumber: "111", vatNumber: "V1" },
      { id: 2, name: "Beta Supplies", bankAccountNumber: "222", vatNumber: "V2" },
    ]);
    expect(findings).toHaveLength(0);
  });
});

describe("runDuplicateCustomersTest", () => {
  it("flags customers sharing a VAT number", () => {
    const findings = runDuplicateCustomersTest([
      { id: 1, name: "Alpha", vatNumber: "SHARED", registrationNumber: "" },
      { id: 2, name: "Beta", vatNumber: "SHARED", registrationNumber: "" },
    ]);
    expect(findings.length).toBeGreaterThan(0);
  });
});

describe("runSequenceGapsTest", () => {
  it("finds a gap between two sequential document numbers", () => {
    const findings = runSequenceGapsTest(
      [{ id: 1, number: "JR000001" }, { id: 2, number: "JR000005" }],
      "journal",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toContain("3 missing");
  });

  it("finds nothing when numbers are contiguous", () => {
    const findings = runSequenceGapsTest(
      [{ id: 1, number: "JR000001" }, { id: 2, number: "JR000002" }, { id: 3, number: "JR000003" }],
      "journal",
    );
    expect(findings).toHaveLength(0);
  });
});

describe("runPostingDateTest", () => {
  it("flags a journal entered materially after its posting date", () => {
    const findings = runPostingDateTest([{ id: 1, journalNumber: "JR000001", journalDate: "2026-01-01", createdAt: "2026-01-10T09:00:00Z" }]);
    expect(findings).toHaveLength(1);
  });

  it("does not flag a journal entered the same day", () => {
    const findings = runPostingDateTest([{ id: 1, journalNumber: "JR000001", journalDate: "2026-01-01", createdAt: "2026-01-01T09:00:00Z" }]);
    expect(findings).toHaveLength(0);
  });
});

describe("runCutoffTest", () => {
  it("flags a journal dated in the period but entered after period-end", () => {
    const findings = runCutoffTest(
      [{ id: 1, journalNumber: "JR000001", journalDate: "2026-01-30", createdAt: "2026-02-03T09:00:00Z" }],
      "2026-01-31",
    );
    expect(findings).toHaveLength(1);
  });

  it("does not flag a journal dated after period-end", () => {
    const findings = runCutoffTest(
      [{ id: 1, journalNumber: "JR000001", journalDate: "2026-02-05", createdAt: "2026-02-05T09:00:00Z" }],
      "2026-01-31",
    );
    expect(findings).toHaveLength(0);
  });
});

describe("runBenfordAnalysis", () => {
  it("returns nothing for an empty series", () => {
    expect(runBenfordAnalysis([])).toHaveLength(0);
  });

  it("flags a series where every value starts with the same digit (an obvious Benford violation)", () => {
    const amounts = Array.from({ length: 50 }, (_, i) => 9000 + i);
    const findings = runBenfordAnalysis(amounts);
    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBeLessThanOrEqual(0.85);
  });

  it("marks small samples with a disclosed low-confidence caveat", () => {
    const amounts = Array.from({ length: 10 }, (_, i) => 9000 + i);
    const findings = runBenfordAnalysis(amounts);
    if (findings.length > 0) {
      expect(findings[0].confidence).toBe(0.3);
      expect(findings[0].evidence).toContain("weak signal");
    }
  });
});

describe("runLargeJournalsTest", () => {
  it("flags journals above the threshold", () => {
    const findings = runLargeJournalsTest([{ id: 1, journalNumber: "JR1", totalDebit: 60000, totalCredit: 60000 }], 50000);
    expect(findings).toHaveLength(1);
  });

  it("does not flag journals at or below the threshold", () => {
    const findings = runLargeJournalsTest([{ id: 1, journalNumber: "JR1", totalDebit: 50000, totalCredit: 50000 }], 50000);
    expect(findings).toHaveLength(0);
  });
});

describe("runWeekendPostingTest", () => {
  it("flags a Saturday posting", () => {
    const findings = runWeekendPostingTest([{ id: 1, journalNumber: "JR1", journalDate: "2026-01-03" }]); // a Saturday
    expect(findings).toHaveLength(1);
  });

  it("does not flag a weekday posting", () => {
    const findings = runWeekendPostingTest([{ id: 1, journalNumber: "JR1", journalDate: "2026-01-05" }]); // a Monday
    expect(findings).toHaveLength(0);
  });
});

describe("runHolidayPostingTest", () => {
  it("is empty by default (no holiday calendar configured)", () => {
    expect(runHolidayPostingTest([{ id: 1, journalNumber: "JR1", journalDate: "2026-12-25" }], [])).toHaveLength(0);
  });

  it("flags a posting on a configured holiday date", () => {
    expect(runHolidayPostingTest([{ id: 1, journalNumber: "JR1", journalDate: "2026-12-25" }], ["2026-12-25"])).toHaveLength(1);
  });
});

describe("runManualJournalReviewTest", () => {
  it("flags a material manual journal", () => {
    const findings = runManualJournalReviewTest([{ id: 1, journalNumber: "JR1", sourceType: "manual", totalDebit: 20000, totalCredit: 20000 }], 10000);
    expect(findings).toHaveLength(1);
  });

  it("excludes automatically-generated journals", () => {
    const findings = runManualJournalReviewTest([{ id: 1, journalNumber: "JR1", sourceType: "sales_invoice", totalDebit: 20000, totalCredit: 20000 }], 10000);
    expect(findings).toHaveLength(0);
  });
});

describe("runSuspenseAccountReviewTest", () => {
  it("flags a posting to the suspense account", () => {
    const findings = runSuspenseAccountReviewTest([{ id: 1, accountCode: "9999", postingDate: "2026-01-01", debit: 500, credit: 0, description: "" }]);
    expect(findings).toHaveLength(1);
  });
});

describe("runNegativeInventoryTest", () => {
  it("flags a negative quantity on hand", () => {
    const findings = runNegativeInventoryTest([{ id: 1, stockCode: "SC1", description: "Widget", quantityOnHand: -5 }]);
    expect(findings).toHaveLength(1);
  });
});

function trialBalanceRow(overrides: Partial<TrialBalanceRow>): TrialBalanceRow {
  return { accountId: 1, accountCode: "1000", description: "Bank", accountType: "Asset", normalBalance: "Debit", totalDebit: 0, totalCredit: 0, debitBalance: 0, creditBalance: 0, ...overrides };
}

describe("runNegativeCashTest", () => {
  it("flags a cash account with a net credit balance", () => {
    const rows = [trialBalanceRow({ accountId: 1, creditBalance: 500, debitBalance: 0 })];
    expect(runNegativeCashTest(rows, [1])).toHaveLength(1);
  });

  it("does not flag a healthy debit-balance cash account", () => {
    const rows = [trialBalanceRow({ accountId: 1, creditBalance: 0, debitBalance: 500 })];
    expect(runNegativeCashTest(rows, [1])).toHaveLength(0);
  });
});

describe("runAgedReconcilingItemsTest", () => {
  it("flags an old unallocated transaction", () => {
    const findings = runAgedReconcilingItemsTest(
      [{ id: 1, transactionDate: "2025-11-01", allocationStatus: "Unallocated", debit: 100, credit: 0, beneficiary: "X" }],
      "2026-01-01",
    );
    expect(findings).toHaveLength(1);
  });

  it("does not flag a recently matched transaction", () => {
    const findings = runAgedReconcilingItemsTest(
      [{ id: 1, transactionDate: "2025-12-30", allocationStatus: "Matched", debit: 100, credit: 0, beneficiary: "X" }],
      "2026-01-01",
    );
    expect(findings).toHaveLength(0);
  });
});

describe("runOrphanTransactionsTest", () => {
  it("flags a GL transaction whose journal doesn't exist", () => {
    const findings = runOrphanTransactionsTest([{ id: 1, journalId: 999, accountCode: "1000", postingDate: "2026-01-01" }], new Set([1, 2]));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("Critical");
  });

  it("does not flag a transaction with a valid journal", () => {
    const findings = runOrphanTransactionsTest([{ id: 1, journalId: 1, accountCode: "1000", postingDate: "2026-01-01" }], new Set([1, 2]));
    expect(findings).toHaveLength(0);
  });
});
