import { describe, expect, it } from "vitest";
import { buildVat201Summary } from "./vat-201-engine";
import type { VatDocument } from "./vat-intelligence";

function doc(overrides: Partial<VatDocument> & { id: number }): VatDocument {
  return {
    documentType: "Customer Invoice",
    partyId: 1,
    partyName: "Test Party",
    partyVatNumber: null,
    date: "2026-06-15",
    vatTreatmentCode: "STD",
    vatType: "Standard",
    grossAmount: 1150,
    vatAmount: 150,
    ...overrides,
  };
}

describe("buildVat201Summary", () => {
  it("splits documents into Output/Input by document type", () => {
    const summary = buildVat201Summary(
      [doc({ id: 1, documentType: "Customer Invoice" }), doc({ id: 2, documentType: "Supplier Bill", vatType: "Standard" })],
      "2026-06-01",
      "2026-06-30",
    );
    expect(summary.outputs).toHaveLength(1);
    expect(summary.inputs).toHaveLength(1);
    expect(summary.totalOutputVat).toBe(150);
    expect(summary.totalInputVat).toBe(150);
    expect(summary.netVat).toBe(0);
  });

  it("groups by vatType within a direction", () => {
    const summary = buildVat201Summary(
      [
        doc({ id: 1, vatType: "Standard", grossAmount: 1150, vatAmount: 150 }),
        doc({ id: 2, vatType: "ZeroRated", grossAmount: 1000, vatAmount: 0 }),
        doc({ id: 3, vatType: "Standard", grossAmount: 2300, vatAmount: 300 }),
      ],
      "2026-06-01",
      "2026-06-30",
    );
    const standard = summary.outputs.find((c) => c.category === "Standard");
    const zeroRated = summary.outputs.find((c) => c.category === "ZeroRated");
    expect(standard).toEqual({ category: "Standard", documentCount: 2, netValue: 3000, vatValue: 450 });
    expect(zeroRated).toEqual({ category: "ZeroRated", documentCount: 1, netValue: 1000, vatValue: 0 });
  });

  it("signs a Customer/Supplier Credit Note as a reversal, not a positive addition", () => {
    const summary = buildVat201Summary(
      [
        doc({ id: 1, documentType: "Customer Invoice", grossAmount: 1150, vatAmount: 150 }),
        doc({ id: 2, documentType: "Customer Credit Note", grossAmount: 230, vatAmount: 30 }),
      ],
      "2026-06-01",
      "2026-06-30",
    );
    expect(summary.totalOutputVat).toBe(120);
    expect(summary.totalOutputValue).toBe(800);
  });

  it("buckets a document with no VAT treatment assigned as Unclassified rather than dropping it", () => {
    const summary = buildVat201Summary([doc({ id: 1, vatType: null, grossAmount: 1150, vatAmount: 150 })], "2026-06-01", "2026-06-30");
    expect(summary.outputs).toEqual([{ category: "Unclassified", documentCount: 1, netValue: 1000, vatValue: 150 }]);
    expect(summary.totalOutputVat).toBe(150);
  });

  it("ignores document types that are neither an Output nor an Input (e.g. an unrelated VAT-adjacent record)", () => {
    const summary = buildVat201Summary([doc({ id: 1, documentType: "VatAdjustment" })], "2026-06-01", "2026-06-30");
    expect(summary.outputs).toHaveLength(0);
    expect(summary.inputs).toHaveLength(0);
  });
});
