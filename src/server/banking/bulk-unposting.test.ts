/**
 * Bulk Unpost (migration 0120) — the pure selection rules. A posting is
 * reversed a whole journal at a time, so the screen selects whole journals.
 */
import { describe, expect, it } from "vitest";
import { allocationLabel, journalGroup, toggleJournalGroup, toUnpostingItem, type UnpostingCandidate } from "./bulk-unallocation";

function candidate(id: number, journalId: number | null, overrides: Partial<UnpostingCandidate> = {}): UnpostingCandidate {
  return {
    id, transactionDate: "2026-03-10", description: `T${id}`, reference: "", amount: -10, bankAccountId: 1, bankAccountName: "Cheque",
    allocationStatus: "Allocated", allocationType: "G", glAccountCode: "6100", glAccountName: "Bank Charges",
    customerId: null, customerCode: null, customerName: null, supplierId: null, supplierCode: null, supplierName: null,
    journalId, journalNumber: journalId ? `JR${journalId}` : null, journalDate: "2026-03-10", journalSourceType: "bank_transactions_post",
    journalTransactionCount: 1, exclusionReason: null, ...overrides,
  };
}

const CANDIDATES = [
  candidate(1, 10),
  candidate(2, 10),
  candidate(3, 20),
  candidate(4, 30, { exclusionReason: "Included in a bank reconciliation." }),
  candidate(5, 30, { exclusionReason: "Posted together on journal JR30 with transaction #4 …" }),
];

describe("journalGroup", () => {
  it("is every eligible transaction on the same journal", () => {
    expect(journalGroup(CANDIDATES, 1)).toEqual([1, 2]);
    expect(journalGroup(CANDIDATES, 3)).toEqual([3]);
  });

  it("is empty for an excluded transaction — it can never be selected", () => {
    expect(journalGroup(CANDIDATES, 4)).toEqual([]);
    expect(journalGroup(CANDIDATES, 99)).toEqual([]);
  });
});

describe("toggleJournalGroup", () => {
  it("selecting one transaction selects its whole journal; clearing one clears it", () => {
    const selected = toggleJournalGroup(new Set(), CANDIDATES, 2);
    expect([...selected].sort()).toEqual([1, 2]);
    expect([...toggleJournalGroup(selected, CANDIDATES, 1)]).toEqual([]);
  });

  it("leaves other journals alone", () => {
    const selected = toggleJournalGroup(new Set([3]), CANDIDATES, 1);
    expect([...selected].sort()).toEqual([1, 2, 3]);
  });

  it("does not mutate the current selection", () => {
    const current = new Set([3]);
    toggleJournalGroup(current, CANDIDATES, 1);
    expect([...current]).toEqual([3]);
  });
});

describe("allocationLabel", () => {
  it("names the GL account, customer or supplier that will be kept", () => {
    expect(allocationLabel(candidate(1, 10))).toBe("6100 — Bank Charges");
    expect(allocationLabel(candidate(1, 10, { glAccountCode: null, customerId: 7, customerCode: "CUST-001", customerName: "Acme" }))).toBe(
      "Customer CUST-001 — Acme",
    );
    expect(allocationLabel(candidate(1, 10, { glAccountCode: null, supplierId: 8, supplierCode: null, supplierName: "Supplies Co" }))).toBe(
      "Supplier Supplies Co",
    );
  });
});

describe("toUnpostingItem", () => {
  it("sends exactly what the preview showed, so the database can refuse a stale picture", () => {
    expect(toUnpostingItem(candidate(1, 10, { glAccountCode: null, customerId: 7 }))).toEqual({
      id: 1, journalId: 10, glAccount: "", customerId: 7, supplierId: null,
    });
  });
});
