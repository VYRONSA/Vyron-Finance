/**
 * Phase 5Q.6 — VAT against the rate the document itself states.
 *
 * THE GAP THIS CLOSES was found by certification run #47. An invoice
 * showing net 1 000.00, VAT 15% and VAT 165.00 with a total of 1 165.00 is
 * internally consistent — the line adds up, the total agrees, the line VAT
 * equals the header VAT — and it is still wrong, because 15% of 1 000.00 is
 * 150.00. It passed clean, because every other check compares printed
 * figures to OTHER printed figures. This is the only one that reads the
 * rate.
 *
 * The tolerance is absolute (`ROUNDING_TOLERANCE`, R0.05) and not a
 * percentage: the only thing tolerated is rounding, and rounding does not
 * scale with the invoice. Two tests below fail under the alternatives that
 * were considered and rejected.
 */
import { describe, expect, it } from "vitest";
import { expectedVatFromRate, shouldRetryExtraction, validateExtraction } from "./validation";
import type { ExtractedLine, ExtractionResult } from "./types";

function line(overrides: Partial<ExtractedLine> = {}): ExtractedLine {
  return {
    description: "Widget",
    supplierSku: null,
    quantity: 1,
    uom: null,
    packDescription: null,
    packQuantity: null,
    unitPrice: 100,
    discount: null,
    vatRatePercent: null,
    vatAmount: null,
    lineTotal: 100,
    confidence: 90,
    ...overrides,
  };
}

function result(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  const lines = overrides.lines ?? [line()];
  return {
    header: {
      documentType: "Invoice",
      supplierName: "Acme Supplies",
      supplierVatNumber: "4123456789",
      supplierRegistrationNumber: null,
      invoiceNumber: "INV-001",
      invoiceDate: "2026-06-01",
      dueDate: null,
      orderReference: null,
      currencyCode: "ZAR",
      subtotal: null,
      discountTotal: null,
      vatAmount: null,
      total: 115,
      confidence: null,
      ...overrides.header,
    },
    lines,
    invoiceNumbersSeen: overrides.invoiceNumbersSeen ?? ["INV-001"],
    missingFields: [],
    warnings: [],
    declaredLineCount: overrides.declaredLineCount ?? lines.length,
  };
}

const codes = (r: ExtractionResult) => validateExtraction(r).findings.map((f) => f.code);
const RATE_CODE = "line-vat-disagrees-with-rate";

describe("expectedVatFromRate", () => {
  it("computes VAT from the printed rate, after discount", () => {
    expect(expectedVatFromRate(line({ quantity: 10, unitPrice: 100, vatRatePercent: 15 }))).toBe(150);
    expect(expectedVatFromRate(line({ quantity: 10, unitPrice: 100, discount: 100, vatRatePercent: 15 }))).toBe(135);
    expect(expectedVatFromRate(line({ quantity: 3, unitPrice: 425.5, vatRatePercent: 15 }))).toBe(191.48);
  });

  it("returns null when there is nothing to check against", () => {
    // Inferring 15% from a page that does not state it would be
    // inventing the tax.
    expect(expectedVatFromRate(line({ vatRatePercent: null }))).toBeNull();
    expect(expectedVatFromRate(line({ quantity: null, vatRatePercent: 15 }))).toBeNull();
    expect(expectedVatFromRate(line({ unitPrice: null, vatRatePercent: 15 }))).toBeNull();
  });
});

describe("the certification corpus case", () => {
  const wrong = () =>
    result({
      lines: [line({ quantity: 10, unitPrice: 100, vatRatePercent: 15, vatAmount: 165, lineTotal: 1000 })],
      header: { subtotal: 1000, vatAmount: 165, total: 1165 } as ExtractionResult["header"],
    });

  it("FIRES: 15% of 1 000.00 is 150.00, not 165.00", () => {
    const report = validateExtraction(wrong());
    expect(report.findings.map((f) => f.code)).toContain(RATE_CODE);
    expect(report.status).toBe("Review");
  });

  it("names both figures and declares neither right", () => {
    const finding = validateExtraction(wrong()).findings.find((f) => f.code === RATE_CODE)!;
    expect(finding.severity).toBe("review");
    expect(finding.lineIndex).toBe(0);
    expect(finding.message).toContain("165.00");
    expect(finding.message).toContain("150.00");
    expect(finding.message).toContain("15%");
  });

  it("is independent of the checks that already existed", () => {
    // The document is internally consistent, so none of these fire — which
    // is exactly why it used to pass.
    const found = codes(wrong());
    expect(found).toContain(RATE_CODE);
    expect(found).not.toContain("totals-disagree");
    expect(found).not.toContain("line-vat-disagrees-with-header");
    expect(found).not.toContain("line-incoherent");
    expect(found).not.toContain("lines-incoherent");
  });

  it("is REVIEW, so it never blocks and never triggers a retry", () => {
    const report = validateExtraction(wrong());
    expect(report.status).toBe("Review");
    // Re-reading cannot change what the page prints.
    expect(shouldRetryExtraction(report, 1, 3)).toBe(false);
  });
});

describe("correct invoices stay silent", () => {
  it.each([
    [10, 100, 15, 150],
    [1, 900, 15, 135],
    [20, 96.5, 15, 289.5],
    [1, 4300, 15, 645],
    [500, 1.15, 15, 86.25],
  ])("qty %s x %s at %s%% = VAT %s", (qty, price, rate, vat) => {
    const r = result({ lines: [line({ quantity: qty, unitPrice: price, vatRatePercent: rate, vatAmount: vat, lineTotal: qty * price })] });
    expect(codes(r)).not.toContain(RATE_CODE);
  });

  it("tolerates legitimate cent rounding — 15% of 1 276.50 is 191.475", () => {
    for (const printed of [191.48, 191.47]) {
      const r = result({ lines: [line({ quantity: 3, unitPrice: 425.5, vatRatePercent: 15, vatAmount: printed, lineTotal: 1276.5 })] });
      expect(`${printed}:${codes(r).includes(RATE_CODE)}`).toBe(`${printed}:false`);
    }
  });

  it("charges VAT AFTER discount", () => {
    // 10 x 100 less 100 = 900 net; 15% is 135, not 150. Taxing the
    // pre-discount amount is the defect Phase 5J fixed in Finance's own
    // invoicing, and it must not reappear here.
    const correct = result({ lines: [line({ quantity: 10, unitPrice: 100, discount: 100, vatRatePercent: 15, vatAmount: 135, lineTotal: 900 })] });
    expect(codes(correct)).not.toContain(RATE_CODE);

    const taxedPreDiscount = result({ lines: [line({ quantity: 10, unitPrice: 100, discount: 100, vatRatePercent: 15, vatAmount: 150, lineTotal: 900 })] });
    expect(codes(taxedPreDiscount)).toContain(RATE_CODE);
  });

  it("handles several rates on one document, line by line", () => {
    const mixed = result({
      lines: [
        line({ quantity: 10, unitPrice: 100, vatRatePercent: 15, vatAmount: 150, lineTotal: 1000 }),
        line({ quantity: 60, unitPrice: 5, vatRatePercent: 0, vatAmount: 0, lineTotal: 300 }),
      ],
      header: { subtotal: 1300, vatAmount: 150, total: 1450 } as ExtractionResult["header"],
    });
    expect(codes(mixed)).not.toContain(RATE_CODE);
  });

  it("zero-rated lines are silent", () => {
    const zeroRated = result({
      lines: Array.from({ length: 6 }, (_, i) =>
        line({ quantity: 1, unitPrice: 50 + i * 10, vatRatePercent: 0, vatAmount: 0, lineTotal: 50 + i * 10 }),
      ),
      header: { subtotal: 450, vatAmount: 0, total: 450 } as ExtractionResult["header"],
    });
    expect(codes(zeroRated)).not.toContain(RATE_CODE);
  });

  it("a zero rate with non-zero VAT is NOT silent", () => {
    const r = result({ lines: [line({ quantity: 1, unitPrice: 500, vatRatePercent: 0, vatAmount: 75, lineTotal: 500 })] });
    expect(codes(r)).toContain(RATE_CODE);
  });

  it("skips the line when either the rate or the VAT is absent", () => {
    const noRate = result({ lines: [line({ quantity: 1, unitPrice: 750, vatRatePercent: null, vatAmount: null, lineTotal: 750 })] });
    expect(codes(noRate)).not.toContain(RATE_CODE);

    const rateButNoVat = result({ lines: [line({ quantity: 1, unitPrice: 750, vatRatePercent: 15, vatAmount: null, lineTotal: 750 })] });
    expect(codes(rateButNoVat)).not.toContain(RATE_CODE);

    const vatButNoRate = result({ lines: [line({ quantity: 1, unitPrice: 750, vatRatePercent: null, vatAmount: 112.5, lineTotal: 750 })] });
    expect(codes(vatButNoRate)).not.toContain(RATE_CODE);
  });
});

describe("the tolerance is absolute, and that choice is load-bearing", () => {
  it("allows a divergence AT the tolerance and fires just beyond it", () => {
    const at = result({
      lines: [line({ quantity: 1, unitPrice: 1000, vatRatePercent: 15, vatAmount: 150.05, lineTotal: 1000 })],
      header: { subtotal: 1000, vatAmount: 150.05, total: 1150.05 } as ExtractionResult["header"],
    });
    expect(codes(at)).not.toContain(RATE_CODE);

    const beyond = result({
      lines: [line({ quantity: 1, unitPrice: 1000, vatRatePercent: 15, vatAmount: 150.06, lineTotal: 1000 })],
      header: { subtotal: 1000, vatAmount: 150.06, total: 1150.06 } as ExtractionResult["header"],
    });
    expect(codes(beyond)).toContain(RATE_CODE);
  });

  it("catches a small error on a small line — a R1 absolute tolerance would miss this", () => {
    // Net 10.00, VAT should be 1.50, printed 2.40: a 60% error worth 90c.
    const r = result({ lines: [line({ quantity: 1, unitPrice: 10, vatRatePercent: 15, vatAmount: 2.4, lineTotal: 10 })] });
    expect(codes(r)).toContain(RATE_CODE);
  });

  it("catches a large error on a large line — a 2% relative tolerance would miss this", () => {
    // Net 100 000, VAT should be 15 000, printed 15 250. A 2% tolerance
    // would have allowed R300 of error here; the blind spot would grow
    // with the invoice, which is backwards for materiality.
    const r = result({ lines: [line({ quantity: 1, unitPrice: 100000, vatRatePercent: 15, vatAmount: 15250, lineTotal: 100000 })] });
    expect(codes(r)).toContain(RATE_CODE);
  });
});

describe("reporting shape", () => {
  it("names the offending line when only one of several is wrong", () => {
    const r = result({
      lines: [
        line({ quantity: 1, unitPrice: 100, vatRatePercent: 15, vatAmount: 15, lineTotal: 100 }),
        line({ quantity: 1, unitPrice: 200, vatRatePercent: 15, vatAmount: 44, lineTotal: 200 }),
        line({ quantity: 1, unitPrice: 300, vatRatePercent: 15, vatAmount: 45, lineTotal: 300 }),
      ],
    });
    const found = validateExtraction(r).findings.filter((f) => f.code === RATE_CODE);
    expect(found).toHaveLength(1);
    expect(found[0].lineIndex).toBe(1);
  });

  it("reports ONE summary finding when most rated lines disagree", () => {
    // Most rows disagreeing is a column-mapping problem, not arithmetic.
    // Five separate findings would say it worse than one.
    const r = result({
      lines: Array.from({ length: 5 }, (_, i) =>
        line({ quantity: 1, unitPrice: 100 * (i + 1), vatRatePercent: 15, vatAmount: 99, lineTotal: 100 * (i + 1) }),
      ),
    });
    const found = validateExtraction(r).findings.filter((f) => f.code === RATE_CODE);
    expect(found).toHaveLength(1);
    expect(found[0].lineIndex).toBeUndefined();
    expect(found[0].message).toMatch(/of 5 lines/);
  });
});

describe("the supplier VAT number stays OPTIONAL — unchanged by this phase", () => {
  it("a missing supplier VAT number is not a finding", () => {
    const r = result({
      header: { supplierVatNumber: null, subtotal: 1000, vatAmount: 150, total: 1150 } as ExtractionResult["header"],
      lines: [line({ quantity: 1, unitPrice: 1000, vatRatePercent: 15, vatAmount: 150, lineTotal: 1000 })],
    });
    expect(codes(r)).not.toContain("missing-required-field");
    expect(validateExtraction(r).status).toBe("Pass");
  });
});
