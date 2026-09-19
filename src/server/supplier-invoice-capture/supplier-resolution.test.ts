import { describe, expect, it } from "vitest";
import {
  exactNameKey,
  FUZZY_PROPOSAL_THRESHOLD,
  nameSimilarity,
  normalisedIdentifier,
  normalisedNameKey,
  resolveSupplier,
} from "./supplier-resolution";
import type { Supplier } from "@/server/accounting/types";

function supplier(overrides: Partial<Supplier> & Pick<Supplier, "id" | "name">): Supplier {
  return {
    companyId: "co_1",
    alternativeNames: [],
    defaultGlAccount: null,
    defaultVatCode: null,
    status: "Active",
    supplierCode: "",
    supplierCategory: "",
    supplierType: "Company",
    bankName: "",
    bankAccountNumber: "",
    bankBranchCode: "",
    vatNumber: "",
    taxNumber: "",
    registrationNumber: "",
    riskRating: "Low",
    paymentTermsDays: 30,
    spendingLimit: 0,
    ...overrides,
  } as Supplier;
}

const ACME = supplier({ id: 1, name: "Acme Foods (Pty) Ltd", vatNumber: "4123456789", registrationNumber: "2016/112233/07", supplierCode: "ACME" });
const BETA = supplier({ id: 2, name: "Beta Trading CC", vatNumber: "4987654321" });
const POOL = [ACME, BETA];

describe("normalisation", () => {
  it("folds case and whitespace for an exact-name comparison", () => {
    expect(exactNameKey("  Acme   Foods ")).toBe("acme foods");
  });

  it("strips legal suffixes, punctuation and a leading article", () => {
    expect(normalisedNameKey("The Acme Foods (Pty) Ltd.")).toBe("acme foods");
    expect(normalisedNameKey("Acme Foods")).toBe("acme foods");
    expect(normalisedNameKey("ACME FOODS CC")).toBe("acme foods");
  });

  it("does not reduce a name to nothing when it IS a legal suffix", () => {
    expect(normalisedNameKey("Holdings")).toBe("holdings");
  });

  it("compares identifiers on their characters alone", () => {
    expect(normalisedIdentifier("4123/456/789")).toBe(normalisedIdentifier("4123456789"));
    expect(normalisedIdentifier(null)).toBe("");
  });

  it("scores similarity over the normalised names", () => {
    expect(nameSimilarity("Acme Foods (Pty) Ltd", "Acme Foods")).toBe(1);
    expect(nameSimilarity("Acme Foods", "Beta Trading")).toBeLessThan(0.5);
  });
});

describe("resolveSupplier — deterministic tiers", () => {
  it("1. resolves on the VAT number, the strongest identifier", () => {
    const r = resolveSupplier({ supplierName: "Totally Different Name", vatNumber: "4123456789", registrationNumber: null }, POOL);
    expect(r).toMatchObject({ outcome: "resolved", supplierId: 1, tier: "vat" });
  });

  it("2. resolves on the registration number when no VAT number is printed", () => {
    const r = resolveSupplier({ supplierName: null, vatNumber: null, registrationNumber: "2016/112233/07" }, POOL);
    expect(r).toMatchObject({ outcome: "resolved", supplierId: 1, tier: "registration" });
  });

  it("3. resolves on the supplier code", () => {
    const r = resolveSupplier({ supplierName: "ACME", vatNumber: null, registrationNumber: null }, POOL);
    expect(r).toMatchObject({ outcome: "resolved", supplierId: 1, tier: "supplier-code" });
  });

  it("4. resolves on an exact name", () => {
    const r = resolveSupplier({ supplierName: "acme foods (pty) ltd", vatNumber: null, registrationNumber: null }, POOL);
    expect(r).toMatchObject({ outcome: "resolved", supplierId: 1, tier: "exact-name" });
  });

  it("5. resolves on a normalised name, so a legal suffix is not an obstacle", () => {
    const r = resolveSupplier({ supplierName: "Acme Foods", vatNumber: null, registrationNumber: null }, POOL);
    expect(r).toMatchObject({ outcome: "resolved", supplierId: 1, tier: "normalised-name" });
  });

  it("matches an alternative name — the alias array COST's schema could never accumulate", () => {
    const withAlias = supplier({ id: 3, name: "Gauteng Produce", alternativeNames: ["GP Fresh", "Gauteng Produce Wholesale"] });
    const r = resolveSupplier({ supplierName: "GP Fresh", vatNumber: null, registrationNumber: null }, [withAlias]);
    expect(r).toMatchObject({ outcome: "resolved", supplierId: 3, tier: "exact-name" });
  });

  it("6. resolves on a previously confirmed mapping", () => {
    const r = resolveSupplier({ supplierName: "Unrecognisable", vatNumber: null, registrationNumber: null, learnedSupplierId: 2 }, POOL);
    expect(r).toMatchObject({ outcome: "resolved", supplierId: 2, tier: "learned" });
  });

  it("prefers the stronger identifier when two tiers disagree", () => {
    // VAT says Beta; the name says Acme. The tax identity wins.
    const r = resolveSupplier({ supplierName: "Acme Foods", vatNumber: "4987654321", registrationNumber: null }, POOL);
    expect(r).toMatchObject({ outcome: "resolved", supplierId: 2, tier: "vat" });
  });

  it("ignores inactive suppliers when an active one exists", () => {
    const inactive = supplier({ id: 9, name: "Acme Foods", status: "Inactive" });
    const r = resolveSupplier({ supplierName: "Acme Foods", vatNumber: null, registrationNumber: null }, [inactive, ACME]);
    expect(r).toMatchObject({ outcome: "resolved", supplierId: 1 });
  });
});

describe("resolveSupplier — ambiguity is never resolved silently", () => {
  it("refuses to choose when two suppliers share a VAT number (duplicate master data)", () => {
    const twin = supplier({ id: 10, name: "Acme Foods Limited", vatNumber: "4123456789" });
    const r = resolveSupplier({ supplierName: "Acme", vatNumber: "4123456789", registrationNumber: null }, [ACME, twin]);
    expect(r.outcome).toBe("ambiguous");
    if (r.outcome !== "ambiguous") return;
    expect(r.candidates).toHaveLength(2);
    expect(r.reason).toMatch(/2 suppliers share this VAT number/);
    // This is COST's exact bug: its `.maybeSingle()` turned this into a
    // silent null with an unread error.
  });

  it("refuses to choose when two suppliers share a name", () => {
    const twin = supplier({ id: 11, name: "Acme Foods (Pty) Ltd" });
    const r = resolveSupplier({ supplierName: "Acme Foods (Pty) Ltd", vatNumber: null, registrationNumber: null }, [ACME, twin]);
    expect(r.outcome).toBe("ambiguous");
  });

  it("7. a similar name is a PROPOSAL, never a resolution", () => {
    const r = resolveSupplier({ supplierName: "Acme Food (Pty) Ltd", vatNumber: null, registrationNumber: null }, POOL);
    expect(r.outcome).toBe("ambiguous");
    if (r.outcome !== "ambiguous") return;
    expect(r.candidates[0].supplierId).toBe(1);
    expect(r.candidates[0].similarity).toBeGreaterThanOrEqual(FUZZY_PROPOSAL_THRESHOLD);
    expect(r.candidates[0].reason).toMatch(/nothing on the document confirms it/i);
  });

  it("there is no input that makes a similarity score return `resolved`", () => {
    // A near-identical name, nothing else. However high the score, the
    // outcome cannot be "resolved" — it is structurally unreachable.
    for (const name of ["Acme Foods (Pty) Ltdd", "Acme  Foods  (Pty) Ltd ", "ACME FOODS PTY LTD."]) {
      const r = resolveSupplier({ supplierName: name, vatNumber: null, registrationNumber: null }, POOL);
      if (r.outcome === "resolved") {
        // Only a deterministic tier may resolve; assert it was not fuzzy.
        expect(["vat", "registration", "supplier-code", "exact-name", "normalised-name", "learned"]).toContain(r.tier);
      }
    }
  });

  it("returns unmatched when nothing is close enough, rather than proposing noise", () => {
    const r = resolveSupplier({ supplierName: "Zzz Unrelated Logistics", vatNumber: null, registrationNumber: null }, POOL);
    expect(r).toMatchObject({ outcome: "unmatched", candidates: [] });
  });

  it("returns unmatched for a document with no supplier signal at all", () => {
    expect(resolveSupplier({ supplierName: null, vatNumber: null, registrationNumber: null }, POOL).outcome).toBe("unmatched");
  });

  it("never creates a supplier — that is the reviewer's explicit act", () => {
    const r = resolveSupplier({ supplierName: "Brand New Supplier", vatNumber: null, registrationNumber: null }, POOL);
    expect(r.outcome).toBe("unmatched");
    expect(Object.keys(r)).not.toContain("createdSupplierId");
  });
});
