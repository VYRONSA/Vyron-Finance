/**
 * Phase 5M — the accuracy harness, tested.
 *
 * A scoring harness that scores generously is worse than none: it produces
 * a number that reads like evidence. These tests exist to prove it does not
 * — particularly that a missing field is not treated as a correct one.
 */
import { describe, expect, it } from "vitest";
import {
  buildCertificationReport,
  FIELD_IMPORTANCE,
  formatCertificationReport,
  scoreDocument,
  scoreField,
  summariseFields,
  type GroundTruth,
} from "./certification-harness";
import type { ExtractionResult } from "./types";

const TRUTH: GroundTruth = {
  key: "clean-pdf",
  supplierName: "Karoo Wholesale Supplies",
  supplierVatNumber: "4111222333",
  supplierRegistrationNumber: null,
  invoiceNumber: "KW-10041",
  invoiceDate: "2026-06-11",
  dueDate: "2026-07-11",
  orderReference: null,
  currencyCode: "ZAR",
  subtotal: 1000,
  discountTotal: null,
  vatAmount: 150,
  total: 1150,
  lines: [
    { description: "Maize meal 10kg", supplierSku: "MM10", quantity: 10, uom: "bag", packDescription: null, unitPrice: 100, discount: null, vatAmount: 150, lineTotal: 1000 },
  ],
  verifiedBy: "human read of the synthetic source document",
};

function extraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    header: {
      documentType: "Invoice",
      supplierName: "Karoo Wholesale Supplies",
      supplierVatNumber: "4111222333",
      supplierRegistrationNumber: null,
      invoiceNumber: "KW-10041",
      invoiceDate: "2026-06-11",
      dueDate: "2026-07-11",
      orderReference: null,
      currencyCode: "ZAR",
      subtotal: 1000,
      discountTotal: null,
      vatAmount: 150,
      total: 1150,
      confidence: 88,
      ...overrides.header,
    },
    lines: overrides.lines ?? [
      { description: "Maize meal 10kg", supplierSku: "MM10", quantity: 10, uom: "bag", packDescription: null, packQuantity: null, unitPrice: 100, discount: null, vatRatePercent: 15, vatAmount: 150, lineTotal: 1000, confidence: 90 },
    ],
    invoiceNumbersSeen: ["KW-10041"],
    missingFields: [],
    warnings: [],
    declaredLineCount: 1,
  };
}

describe("scoreField — the five outcomes", () => {
  it("exact when it matches", () => {
    expect(scoreField("invoiceNumber", "KW-10041", "KW-10041").outcome).toBe("exact");
    expect(scoreField("total", 1150, 1150).outcome).toBe("exact");
  });

  it("normalised only where the difference cannot change meaning", () => {
    expect(scoreField("supplierVatNumber", "4111222333", "4111 222 333").outcome).toBe("normalised");
    expect(scoreField("invoiceNumber", "KW-10041", "kw 10041").outcome).toBe("normalised");
    expect(scoreField("supplierName", "Karoo Wholesale Supplies", "  karoo   wholesale supplies ").outcome).toBe("normalised");
  });

  it("incorrect when a value was produced and it is wrong", () => {
    expect(scoreField("total", 1150, 1015).outcome).toBe("incorrect");
    expect(scoreField("supplierName", "Karoo Wholesale", "Kalahari Wholesale").outcome).toBe("incorrect");
  });

  it("MISSING when the document had a value and the model produced none — never 'correct'", () => {
    const score = scoreField("invoiceNumber", "KW-10041", null);
    expect(score.outcome).toBe("missing");
    // The decisive property: a miss counts in the denominator.
    expect(summariseFields([score]).answerable).toBe(1);
    expect(summariseFields([score]).accuracy).toBe(0);
  });

  it("HALLUCINATED when the document had no value and the model supplied one", () => {
    expect(scoreField("orderReference", null, "PO-99999").outcome).toBe("hallucinated");
    expect(scoreField("supplierVatNumber", null, "4000000000").outcome).toBe("hallucinated");
  });

  it("correctly-absent when neither had a value, and it does not inflate the score", () => {
    const b = summariseFields([scoreField("dueDate", null, null)]);
    expect(b.correctlyAbsent).toBe(1);
    expect(b.answerable).toBe(0);
    expect(b.accuracy).toBeNull();
  });

  it("treats a money value that came back unparseable as incorrect, not missing", () => {
    expect(scoreField("total", 1150, "not a number" as never).outcome).toBe("incorrect");
  });

  it("does not accept a money value that is merely close", () => {
    expect(scoreField("total", 1150, 1150.01).outcome).toBe("incorrect");
    expect(scoreField("total", 1150, 1150.004).outcome).toBe("exact"); // sub-cent representation noise
  });
});

describe("field importance follows the brief's classification", () => {
  it("marks supplier identity, document identity and every accounting figure as critical", () => {
    for (const field of ["supplierName", "supplierVatNumber", "invoiceNumber", "invoiceDate", "currencyCode", "subtotal", "vatAmount", "total", "line.quantity", "line.unitPrice", "line.lineTotal"]) {
      expect(`${field}:${FIELD_IMPORTANCE[field]}`).toBe(`${field}:critical`);
    }
  });

  it("marks due date, reference, UOM and SKU as important, not critical", () => {
    for (const field of ["dueDate", "orderReference", "line.uom", "line.supplierSku"]) {
      expect(`${field}:${FIELD_IMPORTANCE[field]}`).toBe(`${field}:important`);
    }
  });

  it("marks descriptive metadata as optional", () => {
    expect(FIELD_IMPORTANCE["line.description"]).toBe("optional");
  });
});

describe("scoreDocument", () => {
  it("scores a perfect extraction as perfect", () => {
    const report = buildCertificationReport([scoreDocument(TRUTH, extraction())]);
    expect(report.overall.accuracy).toBe(1);
    expect(report.criticalFailures).toEqual([]);
    expect(report.byImportance.critical.accuracy).toBe(1);
  });

  it("lists every critical failure in full — these decide certification", () => {
    const wrong = extraction({ header: { ...extraction().header, total: 9999, invoiceNumber: null } });
    const report = buildCertificationReport([scoreDocument(TRUTH, wrong)]);
    const codes = report.criticalFailures.map((f) => `${f.field}:${f.outcome}`);
    expect(codes).toContain("total:incorrect");
    expect(codes).toContain("invoiceNumber:missing");
    expect(report.byImportance.critical.accuracy).toBeLessThan(1);
  });

  it("counts a hallucinated field separately, and never as accuracy", () => {
    const invented = extraction({ header: { ...extraction().header, orderReference: "PO-INVENTED" } });
    const report = buildCertificationReport([scoreDocument(TRUTH, invented)]);
    expect(report.overall.hallucinated).toBe(1);
    // It is not in the denominator, so it cannot dilute — but it IS reported.
    expect(report.overall.accuracy).toBe(1);
    expect(report.criticalFailures.length).toBe(0); // orderReference is "important", not critical
  });

  it("reports a missing line as missing fields, and flags the line-count mismatch", () => {
    const short = extraction({ lines: [] });
    const score = scoreDocument(TRUTH, short);
    expect(score.lineCountMatches).toBe(false);
    const report = buildCertificationReport([score]);
    expect(report.lineCountMismatches).toEqual([{ key: "clean-pdf", expected: 1, actual: 0 }]);
    expect(report.criticalFailures.some((f) => f.field === "line.quantity" && f.outcome === "missing")).toBe(true);
  });

  it("catches an extra invented line as hallucinated fields", () => {
    const extra = extraction({
      lines: [
        ...extraction().lines,
        { description: "Invented", supplierSku: null, quantity: 1, uom: null, packDescription: null, packQuantity: null, unitPrice: 50, discount: null, vatRatePercent: null, vatAmount: null, lineTotal: 50, confidence: 95 },
      ],
    });
    const report = buildCertificationReport([scoreDocument(TRUTH, extra)]);
    expect(report.overall.hallucinated).toBeGreaterThan(0);
    expect(report.lineCountMismatches).toHaveLength(1);
  });
});

describe("confidence cannot influence the score", () => {
  it("a wrong field at confidence 100 scores exactly as a wrong field at confidence 0", () => {
    const wrongHigh = extraction({ header: { ...extraction().header, total: 9999, confidence: 100 } });
    const wrongLow = extraction({ header: { ...extraction().header, total: 9999, confidence: 0 } });
    const a = buildCertificationReport([scoreDocument(TRUTH, wrongHigh)]);
    const b = buildCertificationReport([scoreDocument(TRUTH, wrongLow)]);
    expect(a.overall).toEqual(b.overall);
    expect(a.criticalFailures.length).toBe(b.criticalFailures.length);
  });

  it("confidence is not a parameter of any scoring function", () => {
    expect(scoreField.length).toBeLessThanOrEqual(4);
    expect(scoreDocument.length).toBe(2);
  });
});

describe("the report states numbers, not a verdict", () => {
  it("renders critical, important and optional accuracy separately", () => {
    const text = formatCertificationReport(buildCertificationReport([scoreDocument(TRUTH, extraction())]));
    expect(text).toContain("CRITICAL");
    expect(text).toContain("IMPORTANT");
    expect(text).toContain("OPTIONAL");
    expect(text).toContain("Documents scored: 1");
  });

  it("contains no invented pass threshold and no verdict", () => {
    const text = formatCertificationReport(buildCertificationReport([scoreDocument(TRUTH, extraction())]));
    // "Critical-field failures: n" is a count and belongs here; a VERDICT
    // does not. The brief forbids inventing "95% = good" — the harness
    // reports, a human decides.
    expect(text).not.toMatch(/CERTIFICATION (PASSED|FAILED)/i);
    expect(text).not.toMatch(/threshold|acceptable|good enough|\b95%\b/i);
  });

  it("names each critical failure with what was expected and what came back", () => {
    const wrong = extraction({ header: { ...extraction().header, total: 9999 } });
    const text = formatCertificationReport(buildCertificationReport([scoreDocument(TRUTH, wrong)]));
    expect(text).toContain("total");
    expect(text).toContain("1150");
    expect(text).toContain("9999");
  });
});

describe("ground truth integrity", () => {
  it("records how the truth was established, so a reader can judge it", () => {
    expect(TRUTH.verifiedBy).toMatch(/human/i);
  });

  it("the harness never reads the model's own answer as truth", async () => {
    // A structural guard: `scoreDocument` takes truth FIRST and extraction
    // second, and nothing in the module derives truth from an extraction.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/server/supplier-invoice-capture/certification-harness.ts", "utf8"),
    );
    expect(source).not.toMatch(/truth\s*=\s*extraction|groundTruth\s*=\s*result/);
  });
});
