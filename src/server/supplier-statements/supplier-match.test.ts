/**
 * @vitest-environment node
 *
 * SD-3C — statement supplier PROPOSAL (confirmation is always a reviewer's).
 */
import { describe, expect, it } from "vitest";
import type { Supplier } from "@/server/accounting/types";
import { proposeStatementSupplier } from "./supplier-match";

function supplier(id: number, name: string, extra: Partial<Supplier> = {}): Supplier {
  return { id, name, vatNumber: "", registrationNumber: "", supplierCode: "", alternativeNames: [], status: "Active", ...extra } as Supplier;
}

const suppliers = [
  supplier(1, "Karoo Building Supplies (Pty) Ltd", { vatNumber: "4123456789" }),
  supplier(2, "Highveld Packaging CC"),
  supplier(3, "Overberg Builders Merchants"),
  supplier(4, "Old Supplier", { status: "Inactive" as Supplier["status"] }),
];
const accounts = new Map<number, string | null>([[1, "000123"], [2, "CUST-0042"], [3, null], [4, "000999"]]);
const none = { supplierName: null, vatNumber: null, registrationNumber: null, accountNumber: null };

describe("proposeStatementSupplier", () => {
  it("VAT number proposes (tier vat)", () => {
    expect(proposeStatementSupplier({ ...none, vatNumber: "4123456789" }, suppliers, accounts)).toMatchObject({ supplierId: 1, tier: "vat", outcome: "resolved" });
  });

  it("our account number proposes, verbatim with leading zeros (tier account-number)", () => {
    expect(proposeStatementSupplier({ ...none, accountNumber: " 000123 " }, suppliers, accounts)).toMatchObject({ supplierId: 1, tier: "account-number" });
    expect(proposeStatementSupplier({ ...none, accountNumber: "123" }, suppliers, accounts).supplierId).toBeNull();
  });

  it("an account number recorded on an inactive supplier is ignored", () => {
    expect(proposeStatementSupplier({ ...none, accountNumber: "000999" }, suppliers, accounts).supplierId).toBeNull();
  });

  it("VAT and account number pointing at different suppliers is AMBIGUOUS — a person decides", () => {
    const p = proposeStatementSupplier({ ...none, vatNumber: "4123456789", accountNumber: "CUST-0042" }, suppliers, accounts);
    expect(p).toMatchObject({ supplierId: null, outcome: "ambiguous" });
    expect(p.candidates.map((c) => c.supplierId).sort()).toEqual([1, 2]);
  });

  it("name and account number pointing at different suppliers is AMBIGUOUS", () => {
    const p = proposeStatementSupplier({ ...none, supplierName: "Overberg Builders Merchants", accountNumber: "CUST-0042" }, suppliers, accounts);
    expect(p).toMatchObject({ supplierId: null, outcome: "ambiguous" });
  });

  it("two suppliers with the same account number recorded is AMBIGUOUS", () => {
    const p = proposeStatementSupplier({ ...none, accountNumber: "000123" }, suppliers, new Map([[1, "000123"], [2, "000123"]]));
    expect(p).toMatchObject({ supplierId: null, outcome: "ambiguous" });
  });

  it("falls back to the capture's name tiers", () => {
    expect(proposeStatementSupplier({ ...none, supplierName: "Overberg Builders Merchants" }, suppliers, accounts)).toMatchObject({ supplierId: 3, tier: "exact-name" });
  });

  it("a merely similar name is never a match — candidates only", () => {
    const p = proposeStatementSupplier({ ...none, supplierName: "Overberg Builder Merchant" }, suppliers, accounts);
    expect(p.supplierId).toBeNull();
  });

  it("nothing at all proposes nothing (and never creates a supplier)", () => {
    expect(proposeStatementSupplier(none, suppliers, accounts)).toMatchObject({ supplierId: null, outcome: "unmatched" });
  });
});
