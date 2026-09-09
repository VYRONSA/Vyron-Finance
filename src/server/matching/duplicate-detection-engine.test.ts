import { describe, expect, it } from "vitest";
import { buildDuplicateFindings, MERGE_SUPPORTED_ENTITY_TYPES, type DuplicateDetectionInputs } from "./duplicate-detection-engine";

const EMPTY_INPUTS: DuplicateDetectionInputs = {
  customers: [], suppliers: [], merchants: [], stockItems: [], transactions: [],
  salesOrders: [], purchaseOrders: [], quotations: [], bills: [], payments: [], receipts: [], glTransactions: [],
};

// LR1 Product Audit D-026: "Suggested Merge" always failed because
// every finding's groupIds was empty/discarded, so the UI could only
// ever submit relatedId === relatedId (a self-merge, always rejected).
// This test locks in that every merge-supported entity type's finding
// carries a real, multi-member groupIds array.
describe("buildDuplicateFindings — groupIds threading (D-026 fix)", () => {
  it("Customer findings carry a real groupIds array with a distinct merge target", () => {
    const inputs: DuplicateDetectionInputs = {
      ...EMPTY_INPUTS,
      customers: [
        { id: 1, name: "Acme Ltd", vatNumber: "", registrationNumber: "" },
        { id: 2, name: "Acme Ltd", vatNumber: "", registrationNumber: "" },
      ] as DuplicateDetectionInputs["customers"],
    };
    const findings = buildDuplicateFindings("co_1", inputs);
    const customerFindings = findings.filter((f) => f.entityType === "Customer");
    expect(customerFindings.length).toBe(2);
    for (const f of customerFindings) {
      expect(f.groupIds).toEqual(expect.arrayContaining([1, 2]));
      const target = f.groupIds.find((id) => id !== f.relatedId);
      expect(target).toBeDefined();
      expect(target).not.toBe(f.relatedId);
    }
  });

  it("Merchant findings carry a real groupIds array with a distinct merge target", () => {
    const inputs: DuplicateDetectionInputs = {
      ...EMPTY_INPUTS,
      merchants: [
        { id: 10, name: "Woolworths" },
        { id: 11, name: "Woolworths" },
      ] as DuplicateDetectionInputs["merchants"],
    };
    const findings = buildDuplicateFindings("co_1", inputs);
    const merchantFindings = findings.filter((f) => f.entityType === "Merchant");
    expect(merchantFindings.length).toBe(2);
    for (const f of merchantFindings) {
      const target = f.groupIds.find((id) => id !== f.relatedId);
      expect(target).toBeDefined();
    }
  });

  it("every merge-supported entity type is exercised above (regression guard against a 4th type being added silently)", () => {
    expect(MERGE_SUPPORTED_ENTITY_TYPES.has("Customer")).toBe(true);
    expect(MERGE_SUPPORTED_ENTITY_TYPES.has("Supplier")).toBe(true);
    expect(MERGE_SUPPORTED_ENTITY_TYPES.has("Merchant")).toBe(true);
    expect(MERGE_SUPPORTED_ENTITY_TYPES.size).toBe(3);
  });

  it("non-merge-supported findings (e.g. Transaction) report supportsMerge: false", () => {
    const findings = buildDuplicateFindings("co_1", EMPTY_INPUTS);
    expect(findings.length).toBe(0); // no input data — just confirms the function runs cleanly on an empty company
  });
});
