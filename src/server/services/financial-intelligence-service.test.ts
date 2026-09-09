import { describe, expect, it } from "vitest";
import {
  aggregateMovementsByAccount,
  findLargestMovements,
  findMissingPostings,
  findPossibleDuplicateJournals,
  findUnusualGrowth,
  shiftPeriodBack,
} from "./financial-intelligence-service";
import type { GlTransactionWithContext } from "@/server/general-ledger/types";
import type { Journal } from "@/server/accounting/types";

function txn(overrides: Partial<GlTransactionWithContext> = {}): GlTransactionWithContext {
  return {
    id: 1,
    companyId: "co_1",
    journalId: 1,
    journalLineId: 1,
    accountId: 1,
    postingDate: "2026-07-15",
    reference: "REF-1",
    description: "Test posting",
    debit: 100,
    credit: 0,
    financialYearLabel: "FY2027",
    financialPeriod: 5,
    postedAt: "2026-07-15T09:00:00Z",
    postedBy: "System",
    accountCode: "1000",
    accountDescription: "Bank",
    journalNumber: "JR000001",
    sourceType: "manual",
    ...overrides,
  };
}

describe("findLargestMovements", () => {
  it("returns the top N postings by absolute amount, descending", () => {
    const transactions = [
      txn({ id: 1, debit: 100, credit: 0 }),
      txn({ id: 2, debit: 0, credit: 5000 }),
      txn({ id: 3, debit: 900, credit: 0 }),
    ];
    const result = findLargestMovements(transactions, 2);
    expect(result.map((r) => r.transactionId)).toEqual([2, 3]);
    expect(result[0].amount).toBe(5000);
  });

  it("returns fewer than topN when there aren't enough transactions", () => {
    expect(findLargestMovements([txn()], 10)).toHaveLength(1);
  });
});

describe("findPossibleDuplicateJournals", () => {
  it("flags the same account/date/side/amount posted by two different journals", () => {
    const transactions = [
      txn({ id: 1, journalId: 10, accountId: 5, accountCode: "2000", postingDate: "2026-07-01", debit: 0, credit: 1500 }),
      txn({ id: 2, journalId: 11, accountId: 5, accountCode: "2000", postingDate: "2026-07-01", debit: 0, credit: 1500 }),
    ];
    const result = findPossibleDuplicateJournals(transactions);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ accountId: 5, side: "Credit", amount: 1500 });
    expect(result[0].occurrences).toHaveLength(2);
  });

  it("does not flag two lines from the SAME journal at the same account/date/amount (a legitimate contra pair)", () => {
    const transactions = [
      txn({ id: 1, journalId: 10, accountId: 5, debit: 0, credit: 500, postingDate: "2026-07-01" }),
      txn({ id: 2, journalId: 10, accountId: 5, debit: 0, credit: 500, postingDate: "2026-07-01" }),
    ];
    expect(findPossibleDuplicateJournals(transactions)).toEqual([]);
  });

  it("does not flag different amounts, different accounts, or different dates", () => {
    const transactions = [
      txn({ id: 1, journalId: 10, accountId: 5, debit: 0, credit: 500, postingDate: "2026-07-01" }),
      txn({ id: 2, journalId: 11, accountId: 5, debit: 0, credit: 600, postingDate: "2026-07-01" }),
      txn({ id: 3, journalId: 12, accountId: 6, debit: 0, credit: 500, postingDate: "2026-07-01" }),
      txn({ id: 4, journalId: 13, accountId: 5, debit: 0, credit: 500, postingDate: "2026-07-02" }),
    ];
    expect(findPossibleDuplicateJournals(transactions)).toEqual([]);
  });
});

function journal(overrides: Partial<Journal> = {}): Pick<Journal, "id" | "journalNumber" | "status" | "createdAt"> {
  return { id: 1, journalNumber: "JR000001", status: "Approved", createdAt: "2026-07-01T00:00:00Z", ...overrides };
}

describe("findMissingPostings", () => {
  it("flags an Approved journal older than the stale threshold", () => {
    const result = findMissingPostings([journal({ id: 1, createdAt: "2026-07-01T00:00:00Z" })], [], "2026-07-10", 7, 14);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ journalId: 1, ageDays: 9 });
  });

  it("does not flag an Approved journal still within the threshold", () => {
    const result = findMissingPostings([journal({ id: 1, createdAt: "2026-07-08T00:00:00Z" })], [], "2026-07-10", 7, 14);
    expect(result).toEqual([]);
  });

  it("flags a stale Draft journal separately from Approved ones", () => {
    const result = findMissingPostings([], [journal({ id: 2, status: "Draft", createdAt: "2026-06-01T00:00:00Z" })], "2026-07-10", 7, 14);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("Draft");
  });

  it("sorts oldest (largest ageDays) first", () => {
    const result = findMissingPostings(
      [journal({ id: 1, createdAt: "2026-07-01T00:00:00Z" }), journal({ id: 2, createdAt: "2026-06-01T00:00:00Z" })],
      [],
      "2026-07-10",
      7,
      14,
    );
    expect(result.map((r) => r.journalId)).toEqual([2, 1]);
  });
});

describe("aggregateMovementsByAccount", () => {
  it("nets debit minus credit per account across multiple postings", () => {
    const transactions = [
      txn({ accountId: 1, accountCode: "1000", debit: 500, credit: 0 }),
      txn({ accountId: 1, accountCode: "1000", debit: 0, credit: 200 }),
      txn({ accountId: 2, accountCode: "4000", debit: 0, credit: 1000 }),
    ];
    const result = aggregateMovementsByAccount(transactions);
    expect(result.get(1)?.movement).toBe(300);
    expect(result.get(2)?.movement).toBe(-1000);
  });
});

describe("findUnusualGrowth", () => {
  it("flags an account whose movement changed beyond the threshold", () => {
    const current = new Map([[1, { accountCode: "6000", accountDescription: "Marketing", movement: 1500 }]]);
    const previous = new Map([[1, { accountCode: "6000", accountDescription: "Marketing", movement: 1000 }]]);
    const result = findUnusualGrowth(current, previous, 50);
    expect(result).toHaveLength(1);
    expect(result[0].changePercent).toBe(50);
  });

  it("does not flag an account whose change is within the threshold", () => {
    const current = new Map([[1, { accountCode: "6000", accountDescription: "Marketing", movement: 1100 }]]);
    const previous = new Map([[1, { accountCode: "6000", accountDescription: "Marketing", movement: 1000 }]]);
    expect(findUnusualGrowth(current, previous, 50)).toEqual([]);
  });

  it("flags new activity with no prior baseline, using null (not Infinity/NaN) for changePercent", () => {
    const current = new Map([[1, { accountCode: "6000", accountDescription: "Marketing", movement: 500 }]]);
    const previous = new Map<number, { accountCode: string; accountDescription: string; movement: number }>();
    const result = findUnusualGrowth(current, previous, 50);
    expect(result).toHaveLength(1);
    expect(result[0].changePercent).toBeNull();
  });

  it("does not flag an account with no movement in either period", () => {
    const current = new Map([[1, { accountCode: "6000", accountDescription: "Marketing", movement: 0 }]]);
    const previous = new Map<number, { accountCode: string; accountDescription: string; movement: number }>();
    expect(findUnusualGrowth(current, previous, 50)).toEqual([]);
  });
});

describe("shiftPeriodBack", () => {
  it("returns the immediately preceding period of equal length", () => {
    expect(shiftPeriodBack("2026-07-01", "2026-07-30")).toEqual({ dateFrom: "2026-06-01", dateTo: "2026-06-30" });
  });

  it("handles a single-day period", () => {
    expect(shiftPeriodBack("2026-07-15", "2026-07-15")).toEqual({ dateFrom: "2026-07-14", dateTo: "2026-07-14" });
  });
});
