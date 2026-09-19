import { describe, expect, it } from "vitest";
import { computeInvoiceTotals, computeInvoiceTotalsFromCodes, resolveLineVatRatePercent } from "./invoice-totals";

/** The six treatments `seed_company_defaults()` gives every company
 * (0006/0007/0012). Phase 5J invents no VAT categories — these are the
 * ones that exist. */
const RATES = new Map<string, number>([
  ["Standard Rated", 15],
  ["Zero Rated", 0],
  ["Exempt", 0],
  ["No VAT", 0],
  ["Fuel VAT", 0],
  ["Import VAT", 15],
]);

describe("resolveLineVatRatePercent", () => {
  it("falls back to the document's header treatment when the line names no VAT code", () => {
    expect(resolveLineVatRatePercent(null, 15, RATES)).toBe(15);
    expect(resolveLineVatRatePercent(undefined, 15, RATES)).toBe(15);
    expect(resolveLineVatRatePercent("", 15, RATES)).toBe(15);
    expect(resolveLineVatRatePercent("   ", 15, RATES)).toBe(15);
  });

  it("uses the line's own VAT code when it names one", () => {
    expect(resolveLineVatRatePercent("Zero Rated", 15, RATES)).toBe(0);
    expect(resolveLineVatRatePercent("Standard Rated", 0, RATES)).toBe(15);
  });

  it("returns null for a code this company does not have — never a silent substitute", () => {
    expect(resolveLineVatRatePercent("Standard-Rated", 15, RATES)).toBeNull();
    expect(resolveLineVatRatePercent("VAT15", 15, RATES)).toBeNull();
  });
});

describe("computeInvoiceTotals — VAT", () => {
  it("1. standard-rated: VAT is 15% of the net", () => {
    const t = computeInvoiceTotals([{ quantity: 1, unitPrice: 1000, vatRatePercent: 15 }]);
    expect(t.subtotal).toBe(1000);
    expect(t.vatAmount).toBe(150);
    expect(t.total).toBe(1150);
  });

  it("2. zero-rated: VAT is 0 and the total equals the net", () => {
    const t = computeInvoiceTotals([{ quantity: 1, unitPrice: 1000, vatRatePercent: 0 }]);
    expect(t).toMatchObject({ subtotal: 1000, vatAmount: 0, total: 1000 });
  });

  it("3./4. Exempt and No VAT are rate-0 treatments — same arithmetic, no special case", () => {
    for (const code of ["Exempt", "No VAT"]) {
      const result = computeInvoiceTotalsFromCodes([{ quantity: 2, unitPrice: 300, vatCode: code }], 15, RATES);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.totals).toMatchObject({ subtotal: 600, vatAmount: 0, total: 600 });
    }
  });

  it("5. mixes rates across lines — each line is charged at its own code, not one blended header rate", () => {
    const result = computeInvoiceTotalsFromCodes(
      [
        { quantity: 1, unitPrice: 1000, vatCode: "Standard Rated" },
        { quantity: 1, unitPrice: 500, vatCode: "Zero Rated" },
      ],
      15,
      RATES,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totals.subtotal).toBe(1500);
    // 150 on the standard line only — NOT 15% of 1500.
    expect(result.totals.vatAmount).toBe(150);
    expect(result.totals.total).toBe(1650);
    expect(result.totals.lines.map((l) => l.vatAmount)).toEqual([150, 0]);
  });

  it("7. reports VAT per line, so the document's VAT column reconciles to the VAT total", () => {
    const t = computeInvoiceTotals([
      { quantity: 3, unitPrice: 100, vatRatePercent: 15 },
      { quantity: 2, unitPrice: 50, vatRatePercent: 15 },
    ]);
    expect(t.lines.map((l) => l.vatAmount)).toEqual([45, 15]);
    expect(t.lines.reduce((s, l) => s + l.vatAmount, 0)).toBe(t.vatAmount);
  });

  it("rejects a line naming a VAT code the company does not have, naming the code", () => {
    const result = computeInvoiceTotalsFromCodes([{ quantity: 1, unitPrice: 100, vatCode: "MADE UP" }], 15, RATES);
    expect(result).toEqual({ ok: false, unknownVatCode: "MADE UP" });
  });

  it("falls back to the header treatment for lines that name no code", () => {
    const result = computeInvoiceTotalsFromCodes([{ quantity: 1, unitPrice: 200, vatCode: null }], 15, RATES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.totals).toMatchObject({ subtotal: 200, vatAmount: 30, total: 230 });
  });
});

describe("computeInvoiceTotals — discount", () => {
  it("11. a discount is a money amount off the line, matching Purchase Orders/Bills/Sales Orders", () => {
    const t = computeInvoiceTotals([{ quantity: 10, unitPrice: 20, discount: 25, vatRatePercent: 0 }]);
    expect(t.lines[0]).toMatchObject({ grossAmount: 200, discount: 25, netAmount: 175 });
    expect(t.subtotal).toBe(175);
    expect(t.discountTotal).toBe(25);
  });

  it("12. VAT is charged on the discounted net, not on the list price", () => {
    const t = computeInvoiceTotals([{ quantity: 10, unitPrice: 20, discount: 25, vatRatePercent: 15 }]);
    expect(t.lines[0].netAmount).toBe(175);
    expect(t.lines[0].vatAmount).toBe(26.25); // 175 * 0.15, not 200 * 0.15 = 30
    expect(t.total).toBe(201.25);
  });

  it("13. totals several discounted lines", () => {
    const t = computeInvoiceTotals([
      { quantity: 1, unitPrice: 100, discount: 10, vatRatePercent: 15 },
      { quantity: 2, unitPrice: 50, discount: 5, vatRatePercent: 15 },
    ]);
    expect(t.discountTotal).toBe(15);
    expect(t.subtotal).toBe(185); // 90 + 95
    expect(t.vatAmount).toBe(27.75); // 13.50 + 14.25
    expect(t.total).toBe(212.75);
  });

  it("treats a missing discount as zero — an undiscounted line is not a special case", () => {
    const without = computeInvoiceTotals([{ quantity: 4, unitPrice: 25, vatRatePercent: 15 }]);
    const withZero = computeInvoiceTotals([{ quantity: 4, unitPrice: 25, discount: 0, vatRatePercent: 15 }]);
    expect(without).toEqual(withZero);
  });

  it("keeps the pre-discount gross visible, so the document can show what was given away", () => {
    const t = computeInvoiceTotals([{ quantity: 3, unitPrice: 33.33, discount: 9.99, vatRatePercent: 15 }]);
    expect(t.lines[0].grossAmount).toBe(99.99);
    expect(t.lines[0].netAmount).toBe(90);
  });
});

describe("computeInvoiceTotals — rounding", () => {
  it("6./14. rounds each line's VAT to 2 decimals once, at the point it is produced", () => {
    // 33.333 * 3 = 99.999 -> net 100.00; 15% of that = 15.00
    const t = computeInvoiceTotals([{ quantity: 3, unitPrice: 33.333, vatRatePercent: 15 }]);
    expect(t.lines[0].netAmount).toBe(100);
    expect(t.lines[0].vatAmount).toBe(15);
    expect(t.total).toBe(115);
  });

  it("rounds a genuine half-cent VAT amount up", () => {
    // 0.10 * 1 = 0.10; 15% = 0.015 -> 0.02
    const t = computeInvoiceTotals([{ quantity: 1, unitPrice: 0.1, vatRatePercent: 15 }]);
    expect(t.lines[0].vatAmount).toBe(0.02);
    expect(t.total).toBe(0.12);
  });

  it("never lets accumulated floating point dust reach a stored figure", () => {
    const t = computeInvoiceTotals(Array.from({ length: 10 }, () => ({ quantity: 1, unitPrice: 0.1, vatRatePercent: 15 })));
    expect(t.subtotal).toBe(1);
    expect(t.vatAmount).toBe(0.2); // 10 x 0.02, not 0.15
    expect(t.total).toBe(1.2);
  });
});

describe("computeInvoiceTotals — the reconciliation guarantee", () => {
  const cases = [
    [{ quantity: 1, unitPrice: 1000, vatRatePercent: 15 }],
    [{ quantity: 3, unitPrice: 33.333, discount: 1.117, vatRatePercent: 15 }],
    [
      { quantity: 7, unitPrice: 19.99, discount: 4.44, vatRatePercent: 15 },
      { quantity: 2, unitPrice: 0.05, vatRatePercent: 0 },
      { quantity: 11, unitPrice: 123.45, discount: 0.01, vatRatePercent: 15 },
    ],
    Array.from({ length: 25 }, (_, i) => ({ quantity: i + 1, unitPrice: 1 / 3, discount: i * 0.01, vatRatePercent: i % 2 ? 15 : 0 })),
  ];

  it("15./16./17./18. subtotal + VAT always equals the total, exactly", () => {
    for (const lines of cases) {
      const t = computeInvoiceTotals(lines);
      expect(t.subtotal + t.vatAmount).toBeCloseTo(t.total, 10);
      expect(t.total).toBe(Math.round(t.total * 100) / 100);
    }
  });

  it("the line totals always sum to the document total — the printed lines cannot disagree with the header", () => {
    for (const lines of cases) {
      const t = computeInvoiceTotals(lines);
      const summed = Math.round(t.lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
      expect(summed).toBe(t.total);
    }
  });

  it("the line nets and line VATs always sum to the header subtotal and header VAT", () => {
    for (const lines of cases) {
      const t = computeInvoiceTotals(lines);
      const net = Math.round(t.lines.reduce((s, l) => s + l.netAmount, 0) * 100) / 100;
      const vat = Math.round(t.lines.reduce((s, l) => s + l.vatAmount, 0) * 100) / 100;
      expect(net).toBe(t.subtotal);
      expect(vat).toBe(t.vatAmount);
    }
  });

  it("every stored figure is a clean 2-decimal amount", () => {
    for (const lines of cases) {
      const t = computeInvoiceTotals(lines);
      const twoDecimals = (v: number) => expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
      [t.subtotal, t.discountTotal, t.vatAmount, t.total].forEach(twoDecimals);
      t.lines.forEach((l) => [l.grossAmount, l.discount, l.netAmount, l.vatAmount, l.lineTotal].forEach(twoDecimals));
    }
  });
});

describe("computeInvoiceTotals — behaviour preserved for documents with no line VAT or discount", () => {
  it("reproduces the pre-5J figures exactly when every line uses the header treatment and no discount", () => {
    // The old `computeTotals`: subtotal = sum(qty * price), VAT = subtotal * rate.
    const lines = [
      { quantity: 1, unitPrice: 10000 },
      { quantity: 2, unitPrice: 2500 },
    ];
    const old = {
      subtotal: 15000,
      vatAmount: Math.round(15000 * 0.15 * 100) / 100,
      total: Math.round((15000 + 2250) * 100) / 100,
    };
    const t = computeInvoiceTotals(lines.map((l) => ({ ...l, vatRatePercent: 15 })));
    expect(t.subtotal).toBe(old.subtotal);
    expect(t.vatAmount).toBe(old.vatAmount);
    expect(t.total).toBe(old.total);
  });

  it("an empty document totals to zero rather than NaN", () => {
    expect(computeInvoiceTotals([])).toMatchObject({ subtotal: 0, discountTotal: 0, vatAmount: 0, total: 0 });
  });
});
