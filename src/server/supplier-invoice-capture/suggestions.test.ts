import { describe, expect, it } from "vitest";
import { describeSource, normaliseDescription, normaliseSku, suggestGlAccount, suggestVatCode, vatCodeForPrintedRate } from "./gl-vat-suggestion";
import type { SuggestionInputs } from "./gl-vat-suggestion";
import { derivedUnitCostIsOutOfScope, parsePackDescription } from "./pack-size";

const TREATMENTS = [
  { code: "Standard Rated", rate: 15 },
  { code: "Zero Rated", rate: 0 },
  { code: "Exempt", rate: 0 },
  { code: "No VAT", rate: 0 },
  { code: "Import VAT", rate: 15 },
];

function inputs(overrides: Partial<SuggestionInputs> = {}): SuggestionInputs {
  return {
    supplierDefaultGlAccount: null,
    supplierDefaultVatCode: null,
    learnedGlAccount: null,
    learnedVatCode: null,
    historicalGlAccount: null,
    historicalVatCode: null,
    aiGlAccount: null,
    aiVatCode: null,
    printedVatRatePercent: null,
    vatTreatments: TREATMENTS,
    ...overrides,
  };
}

describe("GL suggestion — the priority ladder", () => {
  it("a configured supplier default outranks everything", () => {
    const r = suggestGlAccount(inputs({
      supplierDefaultGlAccount: "5100",
      learnedGlAccount: "5200",
      historicalGlAccount: "5300",
      aiGlAccount: "5400",
    }));
    expect(r).toEqual({ value: "5100", source: "supplier-default" });
  });

  it("AI can NEVER override a configured supplier default", () => {
    // The decisive rule: a person configured the default on purpose; a
    // model's guess is not evidence against it.
    const r = suggestGlAccount(inputs({ supplierDefaultGlAccount: "5100", aiGlAccount: "9999" }));
    expect(r.value).toBe("5100");
    expect(r.source).not.toBe("ai");
  });

  it("falls to a confirmed mapping, then a historical bill, then AI", () => {
    expect(suggestGlAccount(inputs({ learnedGlAccount: "5200", historicalGlAccount: "5300", aiGlAccount: "5400" })))
      .toEqual({ value: "5200", source: "learned-mapping" });
    expect(suggestGlAccount(inputs({ historicalGlAccount: "5300", aiGlAccount: "5400" })))
      .toEqual({ value: "5300", source: "historical-bill" });
    expect(suggestGlAccount(inputs({ aiGlAccount: "5400" })))
      .toEqual({ value: "5400", source: "ai" });
  });

  it("suggests nothing rather than guessing", () => {
    expect(suggestGlAccount(inputs())).toEqual({ value: null, source: "none" });
  });

  it("treats blank and whitespace as absent, so an empty default does not mask a real suggestion", () => {
    expect(suggestGlAccount(inputs({ supplierDefaultGlAccount: "   ", aiGlAccount: "5400" })))
      .toEqual({ value: "5400", source: "ai" });
  });
});

describe("VAT suggestion", () => {
  it("follows the same ladder, with the printed rate above AI", () => {
    expect(suggestVatCode(inputs({ supplierDefaultVatCode: "Zero Rated", printedVatRatePercent: 15 })).source).toBe("supplier-default");
    // A rate that maps to exactly ONE code is usable evidence. (With the
    // full seeded list, 15% is shared by Standard Rated and Import VAT, so
    // it deliberately resolves to nothing — asserted below.)
    expect(suggestVatCode(inputs({ printedVatRatePercent: 15, aiVatCode: "Exempt", vatTreatments: [{ code: "Standard Rated", rate: 15 }] })))
      .toEqual({ value: "Standard Rated", source: "printed-rate" });
    // And when the rate is ambiguous, the ladder falls through rather than
    // picking one of the two 15% codes.
    expect(suggestVatCode(inputs({ printedVatRatePercent: 15, aiVatCode: "Exempt" })))
      .toEqual({ value: "Exempt", source: "ai" });
  });

  it("resolves a printed rate only when exactly one treatment has it", () => {
    // 15% is shared by Standard Rated AND Import VAT — picking one would be
    // a guess dressed as evidence.
    expect(vatCodeForPrintedRate(15, TREATMENTS)).toBeNull();
    expect(vatCodeForPrintedRate(15, [{ code: "Standard Rated", rate: 15 }])).toBe("Standard Rated");
  });

  it("does not round a 14% document onto the nearest configured rate", () => {
    expect(vatCodeForPrintedRate(14, TREATMENTS)).toBeNull();
  });

  it("ignores an unreadable rate", () => {
    expect(vatCodeForPrintedRate(null, TREATMENTS)).toBeNull();
    expect(vatCodeForPrintedRate(Number.NaN, TREATMENTS)).toBeNull();
  });

  it("names its source in words a reviewer can act on", () => {
    expect(describeSource("supplier-default")).toMatch(/supplier's default/);
    expect(describeSource("ai")).toMatch(/check it/i);
    expect(describeSource("none")).toMatch(/choose one/i);
  });
});

describe("learning keys", () => {
  it("normalises a description stably", () => {
    expect(normaliseDescription("  KAROO LAMB 280GR (1 box) ")).toBe("karoo lamb 280gr 1 box");
    expect(normaliseDescription("Karoo-Lamb 280gr, 1 box")).toBe("karoo lamb 280gr 1 box");
  });

  it("normalises a SKU to its characters", () => {
    expect(normaliseSku("AB-166/2")).toBe("ab1662");
    expect(normaliseSku(null)).toBe("");
  });
});

describe("pack/UOM — captured, never acted upon", () => {
  it("reads an unambiguous pack expression as printed", () => {
    expect(parsePackDescription("12 x 1L Coca Cola")).toEqual({ packDescription: "12 x 1L", packQuantity: 12, unitSize: "1L" });
    expect(parsePackDescription("24x330ML Soda")).toMatchObject({ packQuantity: 24, unitSize: "330ML" });
    expect(parsePackDescription("6 × 750ml")).toMatchObject({ packQuantity: 6 });
  });

  it("refuses ambiguous or prose forms rather than guessing", () => {
    expect(parsePackDescription("1L x 12")).toMatchObject({ packQuantity: null });
    expect(parsePackDescription("box of 12")).toMatchObject({ packQuantity: null });
    expect(parsePackDescription("12")).toMatchObject({ packQuantity: null });
    expect(parsePackDescription("Consulting services")).toMatchObject({ packDescription: null });
    expect(parsePackDescription(null)).toMatchObject({ packDescription: null });
  });

  it("rejects a pack of one, which carries no information", () => {
    expect(parsePackDescription("1 x 5L")).toMatchObject({ packQuantity: null });
  });

  it("keeps the unit size as TEXT — converting it needs a UOM table this system does not have", () => {
    expect(parsePackDescription("12 x 1L").unitSize).toBe("1L");
    expect(typeof parsePackDescription("12 x 1L").unitSize).toBe("string");
  });

  it("offers no way to derive a unit cost — the COST bug is not expressible here", () => {
    // COST wrote the CASE price into a column called `true_unit_cost`.
    // There is deliberately no function here that divides a price by a
    // pack quantity; reaching for one finds the reason instead.
    expect(() => derivedUnitCostIsOutOfScope()).toThrow(/does not derive a unit cost/i);
  });
});
