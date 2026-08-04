import { describe, expect, it } from "vitest";
import {
  buildVatIntelligence,
  detectDuplicateVatClaims,
  detectIncorrectVatCode,
  detectMissingVat,
  detectMissingVatNumber,
  detectSuspiciousVatValues,
  detectUnusualVatTrend,
  detectVendorAndCustomerAnomalies,
  isHighRisk,
} from "./vat-intelligence";
import type { VatDocument } from "./vat-intelligence";

function doc(overrides: Partial<VatDocument> & { id: number }): VatDocument {
  return {
    documentType: "Supplier Bill", partyId: 1, partyName: "Acme Supplies", partyVatNumber: "4123456789",
    date: "2026-06-01", vatTreatmentCode: "Standard Rated", vatType: "Standard", grossAmount: 1150, vatAmount: 150,
    ...overrides,
  };
}

describe("detectMissingVat", () => {
  it("flags a non-zero document with no treatment assigned", () => {
    const signals = detectMissingVat([doc({ id: 1, vatTreatmentCode: "", vatType: null })]);
    expect(signals.get(1)?.kind).toBe("missing-vat");
  });

  it("does not flag a document with a treatment assigned", () => {
    const signals = detectMissingVat([doc({ id: 1 })]);
    expect(signals.size).toBe(0);
  });

  it("does not flag a zero-value document", () => {
    const signals = detectMissingVat([doc({ id: 1, grossAmount: 0, vatAmount: 0, vatTreatmentCode: "", vatType: null })]);
    expect(signals.size).toBe(0);
  });
});

describe("detectMissingVatNumber", () => {
  it("flags a VAT-bearing document with no party VAT number on file", () => {
    const signals = detectMissingVatNumber([doc({ id: 1, partyVatNumber: null, vatAmount: 150 })]);
    expect(signals.get(1)?.kind).toBe("missing-vat");
  });

  it("does not flag when a VAT number is on file", () => {
    const signals = detectMissingVatNumber([doc({ id: 1, partyVatNumber: "4123456789", vatAmount: 150 })]);
    expect(signals.size).toBe(0);
  });

  it("does not flag a document with no VAT amount", () => {
    const signals = detectMissingVatNumber([doc({ id: 1, partyVatNumber: null, vatAmount: 0 })]);
    expect(signals.size).toBe(0);
  });
});

describe("detectIncorrectVatCode", () => {
  it("flags a Zero Rated document carrying a non-zero VAT amount", () => {
    const signals = detectIncorrectVatCode([doc({ id: 1, vatType: "ZeroRated", vatTreatmentCode: "Zero Rated", vatAmount: 150 })]);
    expect(signals.get(1)?.kind).toBe("incorrect-vat-code");
  });

  it("does not flag a consistent Standard-rated document", () => {
    const signals = detectIncorrectVatCode([doc({ id: 1 })]);
    expect(signals.size).toBe(0);
  });
});

describe("detectDuplicateVatClaims", () => {
  it("flags two same-party, same-amount documents within the window", () => {
    const signals = detectDuplicateVatClaims([
      doc({ id: 1, date: "2026-06-01" }),
      doc({ id: 2, date: "2026-06-03" }),
    ]);
    expect(signals.get(1)?.kind).toBe("duplicate-vat-claim");
    expect(signals.get(2)?.kind).toBe("duplicate-vat-claim");
  });

  it("does not flag documents from different parties", () => {
    const signals = detectDuplicateVatClaims([
      doc({ id: 1, partyId: 1, date: "2026-06-01" }),
      doc({ id: 2, partyId: 2, date: "2026-06-01" }),
    ]);
    expect(signals.size).toBe(0);
  });

  it("does not flag documents outside the window", () => {
    const signals = detectDuplicateVatClaims([
      doc({ id: 1, date: "2026-06-01" }),
      doc({ id: 2, date: "2026-07-01" }),
    ]);
    expect(signals.size).toBe(0);
  });
});

describe("detectSuspiciousVatValues", () => {
  it("flags a VAT amount that doesn't reconcile with the treatment's effective rate", () => {
    const signals = detectSuspiciousVatValues([doc({ id: 1, vatAmount: 100 })], new Map([["Standard Rated", 15]]));
    expect(signals.get(1)?.kind).toBe("suspicious-vat-value");
  });

  it("does not flag a correctly reconciled amount", () => {
    const signals = detectSuspiciousVatValues([doc({ id: 1, grossAmount: 1150, vatAmount: 150 })], new Map([["Standard Rated", 15]]));
    expect(signals.size).toBe(0);
  });

  it("skips a document whose treatment has no known effective rate", () => {
    const signals = detectSuspiciousVatValues([doc({ id: 1, vatTreatmentCode: "Unknown" })], new Map());
    expect(signals.size).toBe(0);
  });
});

describe("detectVendorAndCustomerAnomalies", () => {
  it("requires at least 3 prior documents before flagging", () => {
    const signals = detectVendorAndCustomerAnomalies([
      doc({ id: 1, date: "2026-01-01", vatAmount: 100 }),
      doc({ id: 2, date: "2026-02-01", vatAmount: 500 }),
    ]);
    expect(signals.size).toBe(0);
  });

  it("flags a VAT amount well above the party's historical average", () => {
    const signals = detectVendorAndCustomerAnomalies([
      doc({ id: 1, date: "2026-01-01", vatAmount: 100 }),
      doc({ id: 2, date: "2026-02-01", vatAmount: 100 }),
      doc({ id: 3, date: "2026-03-01", vatAmount: 100 }),
      doc({ id: 4, date: "2026-04-01", vatAmount: 500 }),
    ]);
    expect(signals.get(4)?.kind).toBe("vendor-anomaly");
  });

  it("classifies a customer-invoice anomaly distinctly from a vendor one", () => {
    const signals = detectVendorAndCustomerAnomalies([
      doc({ id: 1, documentType: "Customer Invoice", date: "2026-01-01", vatAmount: 100 }),
      doc({ id: 2, documentType: "Customer Invoice", date: "2026-02-01", vatAmount: 100 }),
      doc({ id: 3, documentType: "Customer Invoice", date: "2026-03-01", vatAmount: 100 }),
      doc({ id: 4, documentType: "Customer Invoice", date: "2026-04-01", vatAmount: 500 }),
    ]);
    expect(signals.get(4)?.kind).toBe("customer-anomaly");
  });
});

describe("detectUnusualVatTrend", () => {
  it("flags a large period-over-period increase", () => {
    const signal = detectUnusualVatTrend(15000, 10000, 40);
    expect(signal?.kind).toBe("unusual-trend");
  });

  it("returns null under the threshold", () => {
    expect(detectUnusualVatTrend(10500, 10000, 40)).toBeNull();
  });

  it("returns null when there is no prior period to compare against", () => {
    expect(detectUnusualVatTrend(10000, 0, 40)).toBeNull();
  });
});

describe("buildVatIntelligence", () => {
  it("merges every detector's signals per document", () => {
    const result = buildVatIntelligence([doc({ id: 1, vatTreatmentCode: "", vatType: null })], new Map());
    expect(result.get(1)?.some((s) => s.kind === "missing-vat")).toBe(true);
  });
});

describe("isHighRisk", () => {
  it("is true with 2 or more signals regardless of confidence", () => {
    expect(isHighRisk([
      { kind: "missing-vat", message: "", reasoning: "", confidence: 50, suggestedCorrection: "" },
      { kind: "suspicious-vat-value", message: "", reasoning: "", confidence: 50, suggestedCorrection: "" },
    ])).toBe(true);
  });

  it("is true with a single high-confidence signal", () => {
    expect(isHighRisk([{ kind: "missing-vat", message: "", reasoning: "", confidence: 95, suggestedCorrection: "" }])).toBe(true);
  });

  it("is false with a single low-confidence signal", () => {
    expect(isHighRisk([{ kind: "unusual-trend", message: "", reasoning: "", confidence: 65, suggestedCorrection: "" }])).toBe(false);
  });
});
