import { describe, expect, it } from "vitest";
import {
  buildBankingIntelligence,
  detectCashFlowImpact,
  detectDuplicatePayments,
  detectNewMerchants,
  detectSuspiciousPatterns,
  detectUnusualSpending,
} from "./banking-intelligence";
import type { IntelligenceTransaction } from "./banking-intelligence";

function t(overrides: Partial<IntelligenceTransaction> & { id: number }): IntelligenceTransaction {
  return { transactionDate: "2026-06-01", beneficiary: "Acme Supplies", debit: 1000, credit: 0, ...overrides };
}

describe("detectDuplicatePayments", () => {
  it("flags two same-beneficiary, same-amount payments within the window", () => {
    const signals = detectDuplicatePayments([
      t({ id: 1, transactionDate: "2026-06-01", debit: 500 }),
      t({ id: 2, transactionDate: "2026-06-02", debit: 500 }),
    ]);
    expect(signals.get(1)?.kind).toBe("duplicate-payment");
    expect(signals.get(2)?.kind).toBe("duplicate-payment");
  });

  it("does not flag payments outside the window", () => {
    const signals = detectDuplicatePayments(
      [t({ id: 1, transactionDate: "2026-06-01", debit: 500 }), t({ id: 2, transactionDate: "2026-06-10", debit: 500 })],
      3,
    );
    expect(signals.size).toBe(0);
  });

  it("does not flag different beneficiaries or amounts", () => {
    const signals = detectDuplicatePayments([
      t({ id: 1, transactionDate: "2026-06-01", debit: 500, beneficiary: "Acme" }),
      t({ id: 2, transactionDate: "2026-06-01", debit: 500, beneficiary: "Other" }),
      t({ id: 3, transactionDate: "2026-06-01", debit: 700, beneficiary: "Acme" }),
    ]);
    expect(signals.size).toBe(0);
  });

  it("ignores zero-amount rows", () => {
    const signals = detectDuplicatePayments([t({ id: 1, debit: 0, credit: 0 }), t({ id: 2, debit: 0, credit: 0 })]);
    expect(signals.size).toBe(0);
  });
});

describe("detectNewMerchants", () => {
  it("flags only the first chronological occurrence of a beneficiary", () => {
    const signals = detectNewMerchants([
      t({ id: 1, transactionDate: "2026-06-01", beneficiary: "Acme" }),
      t({ id: 2, transactionDate: "2026-06-05", beneficiary: "Acme" }),
    ]);
    expect(signals.has(1)).toBe(true);
    expect(signals.has(2)).toBe(false);
  });

  it("flags each distinct new beneficiary once", () => {
    const signals = detectNewMerchants([t({ id: 1, beneficiary: "Acme" }), t({ id: 2, beneficiary: "Other Co" })]);
    expect(signals.size).toBe(2);
  });
});

describe("detectUnusualSpending", () => {
  it("requires at least 3 prior payments before flagging", () => {
    const signals = detectUnusualSpending([
      t({ id: 1, transactionDate: "2026-01-01", debit: 100 }),
      t({ id: 2, transactionDate: "2026-02-01", debit: 100 }),
      t({ id: 3, transactionDate: "2026-03-01", debit: 5000 }),
    ]);
    expect(signals.size).toBe(0);
  });

  it("flags a payment at least 2x the historical average once enough history exists", () => {
    const signals = detectUnusualSpending([
      t({ id: 1, transactionDate: "2026-01-01", debit: 100 }),
      t({ id: 2, transactionDate: "2026-02-01", debit: 100 }),
      t({ id: 3, transactionDate: "2026-03-01", debit: 100 }),
      t({ id: 4, transactionDate: "2026-04-01", debit: 500 }),
    ]);
    expect(signals.get(4)?.kind).toBe("unusual-spending");
  });

  it("does not flag amounts under 2x the average", () => {
    const signals = detectUnusualSpending([
      t({ id: 1, transactionDate: "2026-01-01", debit: 100 }),
      t({ id: 2, transactionDate: "2026-02-01", debit: 100 }),
      t({ id: 3, transactionDate: "2026-03-01", debit: 100 }),
      t({ id: 4, transactionDate: "2026-04-01", debit: 150 }),
    ]);
    expect(signals.has(4)).toBe(false);
  });
});

describe("detectCashFlowImpact", () => {
  it("flags a debit dominating the trailing window", () => {
    const signals = detectCashFlowImpact([
      t({ id: 1, transactionDate: "2026-06-01", debit: 100 }),
      t({ id: 2, transactionDate: "2026-06-02", debit: 100 }),
      t({ id: 3, transactionDate: "2026-06-03", debit: 8000 }),
    ]);
    expect(signals.get(3)?.kind).toBe("cash-flow-impact");
  });

  it("does not flag when outflow is evenly distributed across enough payments", () => {
    const signals = detectCashFlowImpact([
      t({ id: 1, transactionDate: "2026-06-01", debit: 100 }),
      t({ id: 2, transactionDate: "2026-06-02", debit: 100 }),
      t({ id: 3, transactionDate: "2026-06-03", debit: 100 }),
      t({ id: 4, transactionDate: "2026-06-04", debit: 100 }),
      t({ id: 5, transactionDate: "2026-06-05", debit: 100 }),
      t({ id: 6, transactionDate: "2026-06-06", debit: 100 }),
    ]);
    expect(signals.size).toBe(0);
  });
});

describe("detectSuspiciousPatterns", () => {
  it("flags a new merchant with a large payment", () => {
    const newMerchants = detectNewMerchants([t({ id: 1, beneficiary: "Acme", debit: 100_000 })]);
    const signals = detectSuspiciousPatterns([t({ id: 1, beneficiary: "Acme", debit: 100_000 })], newMerchants, 50_000);
    expect(signals.get(1)?.kind).toBe("suspicious-pattern");
    expect(signals.get(1)?.confidence).toBeLessThan(100);
  });

  it("does not flag a new merchant with a small payment", () => {
    const newMerchants = detectNewMerchants([t({ id: 1, beneficiary: "Acme", debit: 100 })]);
    const signals = detectSuspiciousPatterns([t({ id: 1, beneficiary: "Acme", debit: 100 })], newMerchants, 50_000);
    expect(signals.size).toBe(0);
  });
});

describe("buildBankingIntelligence", () => {
  it("merges every detector's signals per transaction", () => {
    const result = buildBankingIntelligence([t({ id: 1, transactionDate: "2026-06-01", beneficiary: "Acme", debit: 100 })]);
    expect(result.get(1)?.some((s) => s.kind === "new-merchant")).toBe(true);
  });

  it("returns no entry for a transaction with zero signals", () => {
    const result = buildBankingIntelligence([
      t({ id: 1, transactionDate: "2026-01-01", beneficiary: "Acme", debit: 100 }),
      t({ id: 2, transactionDate: "2026-01-06", beneficiary: "Acme", debit: 100 }),
      t({ id: 3, transactionDate: "2026-01-11", beneficiary: "Acme", debit: 100 }),
      t({ id: 4, transactionDate: "2026-01-16", beneficiary: "Acme", debit: 100 }),
      t({ id: 5, transactionDate: "2026-01-21", beneficiary: "Acme", debit: 100 }),
      t({ id: 6, transactionDate: "2026-01-26", beneficiary: "Acme", debit: 100 }),
    ]);
    expect(result.has(6)).toBe(false);
  });
});
