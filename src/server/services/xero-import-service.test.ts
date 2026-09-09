import { describe, expect, it } from "vitest";
import { mapXeroTaxTypeToVatCode, XERO_ACCOUNT_MAPPINGS } from "./xero-import-service";

describe("mapXeroTaxTypeToVatCode", () => {
  it("maps every real 'Standard Rate ...' TaxType seen in the source data to VYRON's seeded 'Standard Rated' code", () => {
    expect(mapXeroTaxTypeToVatCode("Standard Rate Sales")).toBe("Standard Rated");
    expect(mapXeroTaxTypeToVatCode("Standard Rate Purchases")).toBe("Standard Rated");
    expect(mapXeroTaxTypeToVatCode("Standard Rate Purchases - Capital Goods")).toBe("Standard Rated");
  });

  it("maps 'No VAT' to VYRON's seeded 'No VAT' code", () => {
    expect(mapXeroTaxTypeToVatCode("No VAT")).toBe("No VAT");
  });

  it("falls back to 'No VAT' for an unrecognised TaxType rather than throwing or inventing a rate", () => {
    expect(mapXeroTaxTypeToVatCode("Change in Use Purchases")).toBe("No VAT");
  });
});

describe("XERO_ACCOUNT_MAPPINGS", () => {
  it("has no duplicate account codes", () => {
    const codes = XERO_ACCOUNT_MAPPINGS.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("covers every distinct AccountCode actually present in the real source data (610,800,1000,1005,1010,1500,1505,1750,1805,1815,1820,1825,1830,2060,3030,3160,3190,3210,3230,3240,3250,3260,3320,3400,3420,3430,3450,3460,5020,6170,6545)", () => {
    const required = ["610", "800", "1000", "1005", "1010", "1500", "1505", "1750", "1805", "1815", "1820", "1825", "1830", "2060", "3030", "3160", "3190", "3210", "3230", "3240", "3250", "3260", "3320", "3400", "3420", "3430", "3450", "3460", "5020", "6170", "6545"];
    const codes = new Set(XERO_ACCOUNT_MAPPINGS.map((m) => m.code));
    for (const code of required) expect(codes.has(code)).toBe(true);
  });

  it("every income-type account has Credit as its normal balance, and every expense/cost-of-sales/asset account has Debit", () => {
    for (const mapping of XERO_ACCOUNT_MAPPINGS) {
      if (mapping.accountType === "Income") expect(mapping.normalBalance).toBe("Credit");
      if (mapping.accountType === "Liability") expect(mapping.normalBalance).toBe("Credit");
      if (mapping.accountType === "Expense" || mapping.accountType === "Cost of Sales" || mapping.accountType === "Asset") expect(mapping.normalBalance).toBe("Debit");
    }
  });
});
