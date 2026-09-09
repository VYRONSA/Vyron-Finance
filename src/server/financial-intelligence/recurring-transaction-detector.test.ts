import { describe, expect, it } from "vitest";
import { detectRecurringTransactionPatterns } from "./recurring-transaction-detector";
import type { IntelligenceTransaction } from "@/server/banking-rules/banking-intelligence";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let nextId = 1;
function txn(overrides: Partial<IntelligenceTransaction> & { transactionDate: string | null }): IntelligenceTransaction {
  return { id: nextId++, beneficiary: "Test Beneficiary", debit: 0, credit: 0, ...overrides };
}

function debitSeries(beneficiary: string, dates: string[], amounts: number | number[]): IntelligenceTransaction[] {
  return dates.map((d, i) => txn({ transactionDate: d, beneficiary, debit: Array.isArray(amounts) ? amounts[i] : amounts }));
}

function creditSeries(beneficiary: string, dates: string[], amounts: number | number[]): IntelligenceTransaction[] {
  return dates.map((d, i) => txn({ transactionDate: d, beneficiary, credit: Array.isArray(amounts) ? amounts[i] : amounts }));
}

const BASE = "2026-01-01";

describe("detectRecurringTransactionPatterns", () => {
  it("detects three genuinely recurring monthly payments (1)", () => {
    const dates = [BASE, addDays(BASE, 30), addDays(BASE, 60)];
    const patterns = detectRecurringTransactionPatterns(debitSeries("ABC Landlords", dates, 12000));
    expect(patterns).toHaveLength(1);
    expect(patterns[0].periodicity).toBe("Monthly");
    expect(patterns[0].direction).toBe("Debit");
    expect(patterns[0].occurrenceCount).toBe(3);
  });

  it("detects a weekly pattern (2)", () => {
    const dates = [BASE, addDays(BASE, 7), addDays(BASE, 14)];
    const patterns = detectRecurringTransactionPatterns(debitSeries("Weekly Cleaner", dates, 500));
    expect(patterns).toHaveLength(1);
    expect(patterns[0].periodicity).toBe("Weekly");
  });

  it("detects a fortnightly pattern (3)", () => {
    const dates = [BASE, addDays(BASE, 14), addDays(BASE, 28)];
    const patterns = detectRecurringTransactionPatterns(debitSeries("Fortnightly Payroll", dates, 9000));
    expect(patterns).toHaveLength(1);
    expect(patterns[0].periodicity).toBe("Fortnightly");
  });

  it("detects a quarterly pattern (4)", () => {
    const dates = [BASE, addDays(BASE, 90), addDays(BASE, 180)];
    const patterns = detectRecurringTransactionPatterns(debitSeries("Insurance Co", dates, 4500));
    expect(patterns).toHaveLength(1);
    expect(patterns[0].periodicity).toBe("Quarterly");
  });

  it("rejects irregular, non-periodic dates (5)", () => {
    const dates = [BASE, addDays(BASE, 30), addDays(BASE, 33)]; // gaps 30, 3 — inconsistent
    const patterns = detectRecurringTransactionPatterns(debitSeries("Irregular Vendor", dates, 1000));
    expect(patterns).toEqual([]);
  });

  it("never treats two transactions alone as recurring, even with a plausible monthly gap (6)", () => {
    const dates = [BASE, addDays(BASE, 30)];
    const patterns = detectRecurringTransactionPatterns(debitSeries("Only Twice", dates, 1000));
    expect(patterns).toEqual([]);
  });

  it("accepts small amount variation within tolerance — R1,000 / R1,020 / R1,000 (7)", () => {
    const dates = [BASE, addDays(BASE, 30), addDays(BASE, 60)];
    const patterns = detectRecurringTransactionPatterns(debitSeries("Software Sub", dates, [1000, 1020, 1000]));
    expect(patterns).toHaveLength(1);
    expect(patterns[0].occurrenceCount).toBe(3);
  });

  it("rejects grouping when amounts differ radically, even with the same beneficiary and plausible dates (8)", () => {
    const dates = [BASE, addDays(BASE, 30), addDays(BASE, 60)];
    const patterns = detectRecurringTransactionPatterns(debitSeries("Mixed Amounts Ltd", dates, [500, 500, 50000]));
    expect(patterns).toEqual([]); // largest cluster after amount-clustering has only 2 members
  });

  it("keeps debit and credit strictly separate, never merging a recurring payment with a recurring receipt to the same name (9)", () => {
    const dates = [BASE, addDays(BASE, 30), addDays(BASE, 60)];
    const transactions = [...debitSeries("Shared Name Inc", dates, 1000), ...creditSeries("Shared Name Inc", dates, 1000)];
    const patterns = detectRecurringTransactionPatterns(transactions);
    expect(patterns).toHaveLength(2);
    expect(patterns.map((p) => p.direction).sort()).toEqual(["Credit", "Debit"]);
    for (const p of patterns) expect(p.occurrenceCount).toBe(3);
  });

  it("normalizes beneficiary identity — case and surrounding whitespace differences still group together (10)", () => {
    const dates = [BASE, addDays(BASE, 30), addDays(BASE, 60)];
    const transactions = [
      txn({ transactionDate: dates[0], beneficiary: "ABC Landlords", debit: 12000 }),
      txn({ transactionDate: dates[1], beneficiary: "abc landlords", debit: 12000 }),
      txn({ transactionDate: dates[2], beneficiary: "  ABC LANDLORDS  ", debit: 12000 }),
    ];
    const patterns = detectRecurringTransactionPatterns(transactions);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].occurrenceCount).toBe(3);
  });

  it("never groups genuinely different beneficiaries together (11)", () => {
    const dates = [BASE, addDays(BASE, 30)];
    const transactions = [
      ...debitSeries("Landlord A", dates, 1000),
      ...debitSeries("Landlord B", dates, 1000),
    ];
    // 2 occurrences each — below MIN_EVIDENCE, so this also proves no
    // cross-beneficiary contamination inflated either group to 3+.
    expect(detectRecurringTransactionPatterns(transactions)).toEqual([]);
  });

  it("detects multiple independent recurring patterns for the same company (12)", () => {
    const dates = [BASE, addDays(BASE, 30), addDays(BASE, 60)];
    const transactions = [...debitSeries("Landlord", dates, 12000), ...debitSeries("Insurer", dates, 800)];
    const patterns = detectRecurringTransactionPatterns(transactions);
    expect(patterns).toHaveLength(2);
    expect(patterns.map((p) => p.beneficiary).sort()).toEqual(["Insurer", "Landlord"]);
  });

  it("is a pure function that never mutates its input (14 — no production writes possible from a pure array-in array-out function)", () => {
    const dates = [BASE, addDays(BASE, 30), addDays(BASE, 60)];
    const transactions = debitSeries("Landlord", dates, 12000);
    const snapshot = JSON.parse(JSON.stringify(transactions));
    detectRecurringTransactionPatterns(transactions);
    expect(transactions).toEqual(snapshot);
  });

  it("returns no patterns for an empty transaction history (15)", () => {
    expect(detectRecurringTransactionPatterns([])).toEqual([]);
  });

  it("returns no patterns for a single transaction (16)", () => {
    expect(detectRecurringTransactionPatterns(debitSeries("Solo", [BASE], 100))).toEqual([]);
  });

  it("finds the recurring stream within a mix of recurring and one-off transactions (17)", () => {
    const dates = [BASE, addDays(BASE, 30), addDays(BASE, 60)];
    const transactions = [
      ...debitSeries("Landlord", dates, 12000),
      txn({ transactionDate: addDays(BASE, 5), beneficiary: "One Off Vendor", debit: 350 }),
      txn({ transactionDate: addDays(BASE, 45), beneficiary: "Another One Off", debit: 75 }),
    ];
    const patterns = detectRecurringTransactionPatterns(transactions);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].beneficiary).toBe("Landlord");
  });

  it("reports the true latest date and full occurrence set regardless of input order (18)", () => {
    const dates = [BASE, addDays(BASE, 30), addDays(BASE, 60)];
    const shuffled = [
      txn({ id: 30, transactionDate: dates[2], beneficiary: "Landlord", debit: 12000 }),
      txn({ id: 10, transactionDate: dates[0], beneficiary: "Landlord", debit: 12000 }),
      txn({ id: 20, transactionDate: dates[1], beneficiary: "Landlord", debit: 12000 }),
    ];
    const [pattern] = detectRecurringTransactionPatterns(shuffled);
    expect(pattern.latestDate).toBe(dates[2]);
    expect(pattern.firstDate).toBe(dates[0]);
    expect(pattern.transactionIds.sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });

  it("reports an accurate evidence and occurrence count for a 5-occurrence pattern (19)", () => {
    const dates = [BASE, addDays(BASE, 30), addDays(BASE, 60), addDays(BASE, 90), addDays(BASE, 120)];
    const [pattern] = detectRecurringTransactionPatterns(debitSeries("Landlord", dates, 12000));
    expect(pattern.occurrenceCount).toBe(5);
    expect(pattern.transactionIds).toHaveLength(5);
    expect(pattern.typicalAmount).toBe(12000);
  });

  it("excludes transactions with no transaction date from ever forming evidence", () => {
    const dates = [BASE, addDays(BASE, 30)];
    const transactions = [...debitSeries("Landlord", dates, 12000), txn({ transactionDate: null, beneficiary: "Landlord", debit: 12000 })];
    expect(detectRecurringTransactionPatterns(transactions)).toEqual([]);
  });

  it("excludes transactions with neither a debit nor a credit amount", () => {
    const dates = [BASE, addDays(BASE, 30), addDays(BASE, 60)];
    const transactions = [...debitSeries("Landlord", dates.slice(0, 2), 12000), txn({ transactionDate: dates[2], beneficiary: "Landlord", debit: 0, credit: 0 })];
    expect(detectRecurringTransactionPatterns(transactions)).toEqual([]);
  });
});
