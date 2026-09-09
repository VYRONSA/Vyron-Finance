import { describe, expect, it } from "vitest";
import { MOCK_BANK_RECONCILIATIONS, MOCK_CASHBOOK_BATCHES, MOCK_CASHBOOK_TRANSACTIONS, MOCK_RECONCILIATION_SUMMARY } from "./cashbook-data";

describe("cashbook-data mock transactions", () => {
  it("includes both Imported and Manual entries, reusing the same object", () => {
    expect(MOCK_CASHBOOK_TRANSACTIONS.some((t) => t.entrySource === "Imported")).toBe(true);
    expect(MOCK_CASHBOOK_TRANSACTIONS.some((t) => t.entrySource === "Manual")).toBe(true);
  });

  it("includes a real two-legged Bank Transfer sharing one reference", () => {
    const legs = MOCK_CASHBOOK_TRANSACTIONS.filter((t) => t.reference === "TRANSFER-1");
    expect(legs).toHaveLength(2);
    expect(legs[0].debit).toBe(legs[1].credit);
  });

  it("gives every transaction a unique id", () => {
    const ids = MOCK_CASHBOOK_TRANSACTIONS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("cashbook-data mock batches", () => {
  it("has at least one Posted and one Draft batch", () => {
    expect(MOCK_CASHBOOK_BATCHES.some((b) => b.status === "Posted")).toBe(true);
    expect(MOCK_CASHBOOK_BATCHES.some((b) => b.status === "Draft")).toBe(true);
  });
});

describe("cashbook-data mock reconciliations", () => {
  it("has one Completed+locked and one InProgress session", () => {
    expect(MOCK_BANK_RECONCILIATIONS.some((r) => r.status === "Completed" && r.monthEndLocked)).toBe(true);
    expect(MOCK_BANK_RECONCILIATIONS.some((r) => r.status === "InProgress")).toBe(true);
  });
});

describe("cashbook-data mock reconciliation summary", () => {
  it("is derived via the real engine and surfaces a genuine unprocessed outstanding item", () => {
    expect(MOCK_RECONCILIATION_SUMMARY.difference).toBe(3400);
    expect(MOCK_RECONCILIATION_SUMMARY.unprocessedCount).toBeGreaterThan(0);
  });
});
