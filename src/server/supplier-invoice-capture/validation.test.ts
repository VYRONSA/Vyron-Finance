/**
 * Phase 5L — deterministic validation.
 *
 * The centrepiece is "the COST failure": a scanned invoice where a WEIGHT
 * column printed between UNIT PRICE and V.A.T. was read as money, producing
 * invented figures on 11 of 12 rows at confidence 95, with valid JSON, a
 * matching row count and correct header totals. Every check in place at the
 * time passed. These tests exist so that cannot pass here.
 */
import { describe, expect, it } from "vitest";
import {
  assessInvoiceBoundary,
  assessLineCoherence,
  detectConstantMoneyColumn,
  lineNet,
  normaliseInvoiceNumber,
  reconcileTotals,
  shouldRetryExtraction,
  validateExtraction,
} from "./validation";
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
    vatAmount: 15,
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
      subtotal: 100,
      discountTotal: null,
      vatAmount: 15,
      total: 115,
      confidence: 90,
      ...overrides.header,
    },
    lines,
    invoiceNumbersSeen: overrides.invoiceNumbersSeen ?? ["INV-001"],
    missingFields: overrides.missingFields ?? [],
    warnings: overrides.warnings ?? [],
    declaredLineCount: overrides.declaredLineCount ?? lines.length,
  };
}

describe("lineNet", () => {
  it("is quantity x unit price less discount, matching the rest of the accounting paths", () => {
    expect(lineNet(line({ quantity: 10, unitPrice: 20, discount: 25 }))).toBe(175);
  });

  it("is null when the line cannot be computed — never a guessed zero", () => {
    expect(lineNet(line({ quantity: null }))).toBeNull();
    expect(lineNet(line({ unitPrice: null }))).toBeNull();
  });
});

describe("assessLineCoherence", () => {
  it("accepts a VAT-exclusive line total", () => {
    expect(assessLineCoherence(line({ quantity: 2, unitPrice: 50, lineTotal: 100 }))).toMatchObject({ coherent: true, basis: "exclusive" });
  });

  it("accepts a VAT-inclusive line total — suppliers differ, and assuming one basis rejects correct documents", () => {
    expect(assessLineCoherence(line({ quantity: 2, unitPrice: 50, vatAmount: 15, lineTotal: 115 }))).toMatchObject({
      coherent: true,
      basis: "inclusive",
    });
  });

  it("accepts a total derived from a printed VAT rate", () => {
    expect(assessLineCoherence(line({ quantity: 1, unitPrice: 200, vatAmount: null, vatRatePercent: 15, lineTotal: 230 }))).toMatchObject({
      coherent: true,
    });
  });

  it("rejects a line that adds up on neither basis", () => {
    expect(assessLineCoherence(line({ quantity: 2, unitPrice: 50, vatAmount: 15, lineTotal: 137 })).coherent).toBe(false);
  });

  it("reports a line it cannot check rather than guessing", () => {
    expect(assessLineCoherence(line({ quantity: null, lineTotal: 100 })).checkable).toBe(false);
  });
});

describe("detectConstantMoneyColumn — THE COST FAILURE", () => {
  it("catches a weight column read as the VAT amount on every row", () => {
    // COST's measured case: a printed weight of 30.00 landed in VAT on 14
    // of 15 rows, with every line total genuinely different.
    const lines = [12, 45, 78, 103, 56, 91].map((total, i) =>
      line({ description: `Item ${i}`, quantity: 1, unitPrice: total, vatAmount: 30, lineTotal: total }),
    );
    expect(detectConstantMoneyColumn(lines)).toEqual({ field: "vatAmount", value: 30 });
  });

  it("catches a constant unit price across rows with differing totals", () => {
    const lines = [10, 20, 30, 40, 50, 60].map((total) => line({ quantity: 1, unitPrice: 109.5, lineTotal: total }));
    expect(detectConstantMoneyColumn(lines)).toEqual({ field: "unitPrice", value: 109.5 });
  });

  it("does NOT flag a zero-rated invoice — a column of zeros is a fact, not a misread", () => {
    const lines = [10, 20, 30, 40, 50, 60].map((total) => line({ quantity: 1, unitPrice: total, vatAmount: 0, lineTotal: total }));
    expect(detectConstantMoneyColumn(lines)).toBeNull();
  });

  it("does not flag a short table, where repetition is unremarkable", () => {
    const lines = [10, 20, 30].map((total) => line({ quantity: 1, unitPrice: 5, lineTotal: total }));
    expect(detectConstantMoneyColumn(lines)).toBeNull();
  });

  it("does not flag genuinely repeated prices when the totals barely vary", () => {
    // Same item, same price, six times: distinct totals < 3, so the signal
    // stays silent rather than rejecting a real invoice.
    const lines = Array.from({ length: 6 }, () => line({ quantity: 1, unitPrice: 25, lineTotal: 25 }));
    expect(detectConstantMoneyColumn(lines)).toBeNull();
  });

  it("makes the whole extraction Incomplete, which is what justifies a retry", () => {
    const lines = [12, 45, 78, 103, 56, 91].map((total) => line({ quantity: 1, unitPrice: total, vatAmount: 30, lineTotal: total }));
    const report = validateExtraction(result({ lines, header: { subtotal: 385, vatAmount: 180, total: 565 } as never }));
    expect(report.status).toBe("Incomplete");
    expect(report.findings.some((f) => f.code === "constant-money-column")).toBe(true);
  });
});

describe("reconcileTotals — reports disagreement, never corrects it", () => {
  it("agrees when the lines add to the header", () => {
    const r = reconcileTotals(result({ lines: [line({ quantity: 1, unitPrice: 100, vatAmount: 15, lineTotal: 100 })] }));
    expect(r.agrees).toBe(true);
    expect(r.computedSubtotal).toBe(100);
    expect(r.computedVat).toBe(15);
    expect(r.computedTotal).toBe(115);
  });

  it("THE BRIEF'S EXAMPLE: extracted 11,500 vs reconciled 11,350 is a disagreement, not a correction", () => {
    const lines = [line({ quantity: 1, unitPrice: 9869.57, vatAmount: 1480.43, lineTotal: 9869.57 })];
    const r = reconcileTotals(result({ lines, header: { subtotal: 10000, vatAmount: 1500, total: 11500 } as never }));
    expect(r.extractedTotal).toBe(11500);
    expect(r.computedTotal).toBe(11350);
    expect(r.agrees).toBe(false);
    // The extracted figures are returned untouched — nothing was overwritten.
    expect(r.extractedSubtotal).toBe(10000);
    expect(r.extractedVat).toBe(1500);
  });

  it("raises a review finding for the disagreement, naming both figures", () => {
    const lines = [line({ quantity: 1, unitPrice: 9869.57, vatAmount: 1480.43, lineTotal: 9869.57 })];
    const report = validateExtraction(result({ lines, header: { subtotal: 10000, vatAmount: 1500, total: 11500 } as never }));
    expect(report.status).toBe("Review");
    const finding = report.findings.find((f) => f.code === "totals-disagree");
    expect(finding?.message).toContain("11500.00");
    expect(finding?.message).toContain("11350.00");
  });

  it("tolerates a cent of supplier rounding across many lines", () => {
    const lines = Array.from({ length: 3 }, () => line({ quantity: 1, unitPrice: 33.33, vatAmount: 5, lineTotal: 33.33 }));
    const r = reconcileTotals(result({ lines, header: { subtotal: 99.99, vatAmount: 15, total: 115.0 } as never }));
    expect(r.agrees).toBe(true);
  });

  it("infers the inclusive basis from how the lines behave rather than assuming", () => {
    const lines = [
      line({ quantity: 1, unitPrice: 100, vatAmount: 15, lineTotal: 115 }),
      line({ quantity: 2, unitPrice: 50, vatAmount: 15, lineTotal: 115 }),
    ];
    expect(reconcileTotals(result({ lines })).basis).toBe("inclusive");
  });

  it("reports indeterminate rather than picking a basis it cannot see", () => {
    const lines = [line({ quantity: null, unitPrice: null, lineTotal: 115 })];
    expect(reconcileTotals(result({ lines })).basis).toBe("indeterminate");
  });
});

describe("assessInvoiceBoundary — a batch scan is refused, never merged", () => {
  it("passes a single invoice", () => {
    expect(assessInvoiceBoundary(result()).kind).toBe("single");
  });

  it("refuses a file carrying several invoice numbers", () => {
    const r = result({ invoiceNumbersSeen: ["INV-001", "INV-002", "INV-003"] });
    expect(assessInvoiceBoundary(r).kind).toBe("multiple");
    const report = validateExtraction(r);
    expect(report.status).toBe("Incomplete");
    expect(report.findings.find((f) => f.code === "multiple-invoices")?.message).toMatch(/Split it and upload each invoice separately/);
  });

  it("treats formatting differences as the same serial number", () => {
    expect(normaliseInvoiceNumber("INV-001")).toBe(normaliseInvoiceNumber("inv 001"));
    expect(assessInvoiceBoundary(result({ invoiceNumbersSeen: ["INV-001", "inv001", "INV 001"] })).kind).toBe("single");
  });

  it("is never retried — splitting the file is the human's job, not the model's", () => {
    const report = validateExtraction(result({ invoiceNumbersSeen: ["INV-001", "INV-002"] }));
    expect(shouldRetryExtraction(report, 1, 3)).toBe(false);
  });
});

describe("validateExtraction — required fields and row counts", () => {
  it("passes a coherent document", () => {
    expect(validateExtraction(result()).status).toBe("Pass");
  });

  it("asks for a missing required header field by name", () => {
    const report = validateExtraction(result({ header: { invoiceNumber: null } as never }));
    expect(report.status).toBe("Review");
    expect(report.findings.find((f) => f.code === "missing-required-field")?.message).toMatch(/invoice number/i);
  });

  it("treats a truncated answer as Incomplete — a deterministic signal, unlike confidence", () => {
    const report = validateExtraction(result({ lines: [line(), line()], declaredLineCount: 16 }));
    expect(report.status).toBe("Incomplete");
    expect(report.findings.some((f) => f.code === "row-count-short")).toBe(true);
  });

  it("rejects a document with no readable lines", () => {
    expect(validateExtraction(result({ lines: [], declaredLineCount: 0 })).status).toBe("Incomplete");
  });

  it("names an individual incoherent row without discarding the good ones", () => {
    const lines = [
      line({ quantity: 1, unitPrice: 100, vatAmount: 15, lineTotal: 100 }),
      line({ quantity: 1, unitPrice: 100, vatAmount: 15, lineTotal: 100 }),
      line({ quantity: 1, unitPrice: 100, vatAmount: 15, lineTotal: 100 }),
      line({ description: "Odd one", quantity: 2, unitPrice: 50, vatAmount: 15, lineTotal: 137 }),
    ];
    const report = validateExtraction(result({ lines, header: { subtotal: 400, vatAmount: 60, total: 460 } as never }));
    expect(report.status).toBe("Review");
    expect(report.incoherentRowIndexes).toEqual([3]);
    expect(report.findings.find((f) => f.code === "line-incoherent")?.lineIndex).toBe(3);
  });

  it("flags a negative amount rather than treating it as a credit", () => {
    const report = validateExtraction(result({ lines: [line({ quantity: 1, unitPrice: -100, vatAmount: 0, lineTotal: -100 })] }));
    expect(report.findings.some((f) => f.code === "negative-amount")).toBe(true);
  });

  it("ignores blank filler rows rather than counting them as unreadable lines", () => {
    const blank = line({ description: null, quantity: null, unitPrice: null, vatAmount: null, lineTotal: null });
    const report = validateExtraction(result({ lines: [line(), blank], declaredLineCount: 1 }));
    expect(report.status).toBe("Pass");
  });
});

describe("shouldRetryExtraction — confidence can never cause a retry", () => {
  it("retries a deterministically incomplete extraction", () => {
    const lines = [12, 45, 78, 103, 56, 91].map((t) => line({ quantity: 1, unitPrice: t, vatAmount: 30, lineTotal: t }));
    const report = validateExtraction(result({ lines, header: { subtotal: 385, vatAmount: 180, total: 565 } as never }));
    expect(shouldRetryExtraction(report, 1, 3)).toBe(true);
  });

  it("does NOT retry a document that merely disagrees — that is a human's decision", () => {
    const lines = [line({ quantity: 1, unitPrice: 9869.57, vatAmount: 1480.43, lineTotal: 9869.57 })];
    const report = validateExtraction(result({ lines, header: { subtotal: 10000, vatAmount: 1500, total: 11500 } as never }));
    expect(report.status).toBe("Review");
    expect(shouldRetryExtraction(report, 1, 3)).toBe(false);
  });

  it("does NOT retry a low-confidence but arithmetically sound document", () => {
    const lowConfidence = result({ lines: [line({ confidence: 3 })], header: { confidence: 1 } as never });
    const report = validateExtraction(lowConfidence);
    expect(report.status).toBe("Pass");
    expect(shouldRetryExtraction(report, 1, 3)).toBe(false);
  });

  it("is bounded — it cannot loop", () => {
    const lines = [12, 45, 78, 103, 56, 91].map((t) => line({ quantity: 1, unitPrice: t, vatAmount: 30, lineTotal: t }));
    const report = validateExtraction(result({ lines, header: { subtotal: 385, vatAmount: 180, total: 565 } as never }));
    expect(shouldRetryExtraction(report, 3, 3)).toBe(false);
    expect(shouldRetryExtraction(report, 99, 3)).toBe(false);
  });
});

describe("the fabricated-table scenario end to end", () => {
  it("rejects a confidently fabricated table that satisfies every non-arithmetic check", () => {
    // Valid JSON. Row count matches what the model declared. Header totals
    // internally consistent. Confidence 95 on every row. This is precisely
    // the shape that passed in COST.
    const lines = Array.from({ length: 12 }, (_, i) =>
      line({ description: `Item ${i + 1}`, quantity: 1, unitPrice: 109.5, vatAmount: 30, lineTotal: 100 + i * 7, confidence: 95 }),
    );
    const r = result({ lines, declaredLineCount: 12, header: { subtotal: 1662, vatAmount: 360, total: 2022, confidence: 95 } as never });
    const report = validateExtraction(r);

    expect(report.status).toBe("Incomplete");
    expect(report.findings.some((f) => f.code === "constant-money-column")).toBe(true);
    // And the high confidence changed nothing about that verdict.
    expect(r.header.confidence).toBe(95);
  });
});

/* ---------------------------------------------------------------------
 * Phase 5M — document KIND.
 *
 * Found while building the certification corpus: a supplier credit note
 * captured through this flow would have become a Bill, because conversion
 * only ever creates one. A credit note REDUCES what is owed; booking it as
 * a bill increases it — the opposite sign, silently, on a real liability.
 * ------------------------------------------------------------------- */
describe("a document that is not an invoice is refused, not guessed at", () => {
  it("SD-1: asks a person to confirm a supplier credit note, rather than refusing it", () => {
    const report = validateExtraction(result({ header: { documentType: "Credit Note" } as never }));
    const finding = report.findings.find((f) => f.code === "not-an-invoice");
    expect(finding?.severity).toBe("review");
    expect(finding?.message).toMatch(/reduces what is owed/i);
    expect(report.findings.some((f) => f.code === "not-an-invoice" && f.severity === "blocking")).toBe(false);
  });

  it("blocks a supplier debit note", () => {
    expect(validateExtraction(result({ header: { documentType: "Debit Note" } as never })).status).toBe("Incomplete");
  });

  it("blocks a document that is not recognisably an invoice at all", () => {
    const report = validateExtraction(result({ header: { documentType: "Other" } as never }));
    expect(report.findings.find((f) => f.code === "not-an-invoice")?.message).toMatch(/does not look like a supplier invoice/i);
  });

  it("allows an invoice, and a document whose kind could not be read", () => {
    expect(validateExtraction(result({ header: { documentType: "Invoice" } as never })).status).toBe("Pass");
    // Unknown kind is not the same as wrong kind: the rest of the checks
    // still apply, and a reviewer sees the document.
    expect(validateExtraction(result({ header: { documentType: null } as never })).status).toBe("Pass");
  });

  it("is NOT retried — re-reading cannot change what kind of document it is", () => {
    const report = validateExtraction(result({ header: { documentType: "Credit Note" } as never }));
    expect(shouldRetryExtraction(report, 1, 3)).toBe(false);
    // Contrast: a genuinely re-readable failure IS retried.
    const truncated = validateExtraction(result({ lines: [line()], declaredLineCount: 9 }));
    expect(shouldRetryExtraction(truncated, 1, 3)).toBe(true);
  });
});
