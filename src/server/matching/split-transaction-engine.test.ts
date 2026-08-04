import { describe, expect, it } from "vitest";
import { buildSplitGlLines, validateSplitLines } from "./split-transaction-engine";

describe("validateSplitLines", () => {
  it("rejects a single line — one line is not a split", () => {
    const result = validateSplitLines([{ amount: 100, description: "x", glAccount: "6100" }], 100);
    expect(result.ok).toBe(false);
  });

  it("rejects a line with no GL account", () => {
    const result = validateSplitLines(
      [
        { amount: 50, description: "a", glAccount: "6100" },
        { amount: 50, description: "b", glAccount: "" },
      ],
      100,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects lines that don't sum to the transaction amount", () => {
    const result = validateSplitLines(
      [
        { amount: 50, description: "a", glAccount: "6100" },
        { amount: 40, description: "b", glAccount: "6200" },
      ],
      100,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("90");
  });

  it("accepts lines that sum exactly (within tolerance)", () => {
    const result = validateSplitLines(
      [
        { amount: 33.33, description: "a", glAccount: "6100" },
        { amount: 33.33, description: "b", glAccount: "6200" },
        { amount: 33.34, description: "c", glAccount: "6300" },
      ],
      100,
    );
    expect(result.ok).toBe(true);
  });

  it("accepts every allocation dimension on a line, including inventoryItemId", () => {
    const result = validateSplitLines(
      [
        { amount: 50, description: "a", glAccount: "6100", vatCode: "STD", supplierId: 1, customerId: null, projectId: 2, costCentreId: 3, departmentId: 4, branchId: 5, inventoryItemId: 6 },
        { amount: 50, description: "b", glAccount: "6200" },
      ],
      100,
    );
    expect(result.ok).toBe(true);
  });
});

describe("buildSplitGlLines", () => {
  it("builds debit GL lines for a payment", () => {
    const lines = buildSplitGlLines(
      [
        { amount: 60, description: "a", glAccount: "6100" },
        { amount: 40, description: "b", glAccount: "6200" },
      ],
      true,
    );
    expect(lines).toEqual([
      { accountCode: "6100", debit: 60, credit: 0, description: "a" },
      { accountCode: "6200", debit: 40, credit: 0, description: "b" },
    ]);
  });

  it("builds credit GL lines for a receipt", () => {
    const lines = buildSplitGlLines([{ amount: 100, description: "a", glAccount: "4000" }], false);
    expect(lines).toEqual([{ accountCode: "4000", debit: 0, credit: 100, description: "a" }]);
  });
});
