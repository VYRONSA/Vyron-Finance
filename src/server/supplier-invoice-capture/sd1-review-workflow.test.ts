/**
 * SD-1 — the pure logic added to complete the review workflow:
 *  - the upload-time file check (self-match fix; rejected re-upload);
 *  - credit-note validation;
 *  - validating reviewed / hand-entered values.
 */
import { describe, expect, it } from "vitest";
import { assessFileHashMatches, type SameFileDocument } from "./duplicate-detection";
import { buildReviewedExtraction, readExtractionSnapshot, type ExtractionSnapshot, type ReviewedHeader, type ReviewedLine } from "./review-validation";
import { validateExtraction } from "./validation";
import type { ExtractedLine, ExtractionResult } from "./types";

// ---------------------------------------------------------------------
// E. Upload-time file check
// ---------------------------------------------------------------------
function doc(documentId: number, captureStatus: string | null, captureId: number | null = captureStatus ? documentId * 10 : null): SameFileDocument {
  return { documentId, filename: `file-${documentId}.pdf`, captureId, captureStatus };
}

describe("the upload-time file check (E)", () => {
  it("never matches the uploaded document against itself — the old self-match bug", () => {
    // The new document already carries its hash, so it is in the result set.
    expect(assessFileHashMatches(7, [doc(7, "Uploaded")])).toEqual({ kind: "none" });
  });

  it("finds the real earlier copy even when the new document is returned first", () => {
    const decision = assessFileHashMatches(7, [doc(7, "Uploaded"), doc(3, "NeedsReview")]);
    expect(decision).toMatchObject({ kind: "blocked", ofDocumentId: 3, ofCaptureId: 30 });
  });

  it("blocks the same file as a capture still in the workflow, failed, or converted", () => {
    for (const status of ["Queued", "Extracting", "ManualEntry", "NeedsReview", "Failed", "Duplicate", "Converted"]) {
      expect(assessFileHashMatches(9, [doc(2, status)]).kind).toBe("blocked");
    }
  });

  it("blocks the same file stored with no capture at all (e.g. attached to a bill entered by hand)", () => {
    expect(assessFileHashMatches(9, [doc(2, null)])).toMatchObject({ kind: "blocked", ofCaptureId: null });
  });

  it("allows re-uploading a REJECTED capture's file — but flags it as a possible duplicate", () => {
    const decision = assessFileHashMatches(9, [doc(2, "Cancelled")]);
    expect(decision.kind).toBe("possible");
    if (decision.kind !== "possible") return;
    expect(decision.decision).toMatchObject({ status: "Possible", ofCaptureId: 20 });
    expect(decision.decision.reason).toMatch(/rejected/i);
  });

  it("does not weaken protection: one live copy blocks even if others were rejected", () => {
    expect(assessFileHashMatches(9, [doc(2, "Cancelled"), doc(4, "Converted")]).kind).toBe("blocked");
  });

  it("decides deterministically — the earliest blocking document is named", () => {
    expect(assessFileHashMatches(9, [doc(6, "NeedsReview"), doc(4, "Queued")])).toMatchObject({ ofDocumentId: 4 });
  });
});

// ---------------------------------------------------------------------
// F. Credit-note validation
// ---------------------------------------------------------------------
function line(overrides: Partial<ExtractedLine> = {}): ExtractedLine {
  return {
    description: "Returned stock", supplierSku: null, quantity: 5, uom: null, packDescription: null, packQuantity: null,
    unitPrice: 100, discount: null, vatRatePercent: 15, vatAmount: 75, lineTotal: 500, confidence: null,
    ...overrides,
  };
}

function creditNote(overrides: Partial<ExtractionResult> = {}, header: Partial<ExtractionResult["header"]> = {}): ExtractionResult {
  return {
    header: {
      documentType: "Credit Note", supplierName: "Karoo Wholesale Supplies", supplierVatNumber: null, supplierRegistrationNumber: null,
      invoiceNumber: "KW-CN-0007", invoiceDate: "2026-06-12", dueDate: null, orderReference: null, currencyCode: "ZAR",
      subtotal: 500, discountTotal: null, vatAmount: 75, total: 575, confidence: null,
      ...header,
    },
    lines: [line()],
    invoiceNumbersSeen: ["KW-CN-0007"],
    missingFields: [],
    warnings: [],
    declaredLineCount: null,
    ...overrides,
  };
}

describe("credit-note validation (F)", () => {
  it("a clean credit note needs a reviewer's confirmation, not a refusal", () => {
    const report = validateExtraction(creditNote());
    expect(report.status).toBe("Review");
    expect(report.findings.map((f) => [f.code, f.severity])).toEqual([["not-an-invoice", "review"]]);
  });

  it("the invoice it credits, printed on the page, is a review question — not a multi-invoice file", () => {
    const report = validateExtraction(creditNote({ invoiceNumbersSeen: ["KW-CN-0007", "KW-10041"] }));
    expect(report.status).toBe("Review");
    const finding = report.findings.find((f) => f.code === "multiple-invoices")!;
    expect(finding.severity).toBe("review");
    expect(finding.message).toContain("KW-10041");
  });

  it("but three numbers on a credit note still block", () => {
    const report = validateExtraction(creditNote({ invoiceNumbersSeen: ["KW-CN-0007", "KW-10041", "KW-10042"] }));
    expect(report.status).toBe("Incomplete");
  });

  it("two numbers that do not include its own still block", () => {
    const report = validateExtraction(creditNote({ invoiceNumbersSeen: ["KW-10041", "KW-10042"] }));
    expect(report.status).toBe("Incomplete");
  });

  it("two numbers on an INVOICE still block — the narrowing is for credit notes only", () => {
    const report = validateExtraction(creditNote({ invoiceNumbersSeen: ["KW-CN-0007", "KW-10041"] }, { documentType: "Invoice" }));
    expect(report.status).toBe("Incomplete");
  });

  it("negative amounts are a credit note's sign, not a finding", () => {
    const report = validateExtraction(
      creditNote({ lines: [line({ quantity: -5, vatAmount: -75, lineTotal: -500 })] }, { subtotal: -500, vatAmount: -75, total: -575 }),
    );
    expect(report.findings.some((f) => f.code === "negative-amount")).toBe(false);
  });

  it("a credit note whose lines disagree in sign is refused", () => {
    const report = validateExtraction(
      creditNote({ lines: [line(), line({ description: "Restocking fee", quantity: 1, unitPrice: -50, vatAmount: -7.5, lineTotal: -50 })] }),
    );
    expect(report.status).toBe("Incomplete");
    expect(report.findings.find((f) => f.code === "credit-note-mixed-signs")?.severity).toBe("blocking");
  });

  it("a debit note is still refused", () => {
    expect(validateExtraction(creditNote({}, { documentType: "Debit Note" })).status).toBe("Incomplete");
  });
});

// ---------------------------------------------------------------------
// C/D. Validating reviewed and hand-entered values
// ---------------------------------------------------------------------
function reviewedHeader(overrides: Partial<ReviewedHeader> = {}): ReviewedHeader {
  return {
    documentType: "Invoice", supplierName: "Acme Supplies", supplierVatNumber: null, supplierRegistrationNumber: null,
    invoiceNumber: "INV-100", invoiceDate: "2026-06-01", dueDate: null, orderReference: null, currencyCode: "ZAR",
    subtotal: 1000, discountTotal: null, vatAmount: 150, total: 1150,
    ...overrides,
  };
}

function reviewedLine(overrides: Partial<ReviewedLine> = {}): ReviewedLine {
  return {
    description: "Widget", supplierSku: null, quantity: 10, uom: null, unitPrice: 100, discount: null,
    vatRatePercent: 15, vatAmount: 150, lineTotal: 1000, isExcluded: false,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ExtractionSnapshot> = {}): ExtractionSnapshot {
  return {
    header: { ...reviewedHeader(), documentType: "Invoice", confidence: null, invoiceNumber: "INV-10O" } as ExtractionSnapshot["header"],
    lines: [],
    invoiceNumbersSeen: ["INV-10O"],
    declaredLineCount: 1,
    missingFields: [],
    warnings: [],
    ...overrides,
  };
}

describe("validating reviewed values (C)", () => {
  it("a reviewer's correction of a misread total turns an Incomplete-by-totals capture into a clean one", () => {
    // As extracted: the total was misread, so the totals disagree.
    const before = validateExtraction(buildReviewedExtraction(reviewedHeader({ total: 11500 }), [reviewedLine()], null));
    expect(before.findings.map((f) => f.code)).toContain("totals-disagree");
    // As corrected:
    const after = validateExtraction(buildReviewedExtraction(reviewedHeader(), [reviewedLine()], null));
    expect(after.status).toBe("Pass");
  });

  it("a corrected invoice number replaces the misread one in the page's number list", () => {
    const result = buildReviewedExtraction(reviewedHeader({ invoiceNumber: "INV-100" }), [reviewedLine()], snapshot());
    expect(result.invoiceNumbersSeen).toEqual(["INV-100"]);
    expect(validateExtraction(result).findings.some((f) => f.code === "multiple-invoices")).toBe(false);
  });

  it("a multi-invoice FILE stays refused whatever the reviewer types — it is a fact about the page", () => {
    const result = buildReviewedExtraction(reviewedHeader(), [reviewedLine()], snapshot({ invoiceNumbersSeen: ["INV-10O", "INV-200", "INV-300"] }));
    expect(validateExtraction(result).status).toBe("Incomplete");
  });

  it("excluding a line is not mistaken for a truncated read", () => {
    const result = buildReviewedExtraction(
      reviewedHeader({ subtotal: 1000, total: 1150 }),
      [reviewedLine(), reviewedLine({ description: "Delivery note line", isExcluded: true })],
      snapshot({ declaredLineCount: 2 }),
    );
    expect(result.declaredLineCount).toBeNull();
    expect(result.lines).toHaveLength(1);
  });

  it("but fewer lines than the page declares is still caught", () => {
    const result = buildReviewedExtraction(reviewedHeader(), [reviewedLine()], snapshot({ declaredLineCount: 3 }));
    expect(validateExtraction(result).findings.map((f) => f.code)).toContain("row-count-short");
  });

  it("validates only the lines that will be converted", () => {
    const result = buildReviewedExtraction(reviewedHeader(), [reviewedLine(), reviewedLine({ isExcluded: true })], null);
    expect(result.lines).toHaveLength(1);
  });
});

describe("validating a hand-entered invoice (D)", () => {
  it("a complete manual entry whose lines agree with its totals passes", () => {
    expect(validateExtraction(buildReviewedExtraction(reviewedHeader(), [reviewedLine()], null)).status).toBe("Pass");
  });

  it("a manual entry with no supplier, number or date is sent back for review, not passed", () => {
    const report = validateExtraction(
      buildReviewedExtraction(reviewedHeader({ supplierName: null, invoiceNumber: null, invoiceDate: null }), [reviewedLine()], null),
    );
    expect(report.status).toBe("Review");
    expect(report.findings.filter((f) => f.code === "missing-required-field")).toHaveLength(3);
  });

  it("a manual entry with no lines is refused", () => {
    expect(validateExtraction(buildReviewedExtraction(reviewedHeader(), [], null)).status).toBe("Incomplete");
  });

  it("SD-2: a typed line with only a VAT code is checked with that code's rate (200 + 15% = 230 passes)", () => {
    const report = validateExtraction(
      buildReviewedExtraction(
        reviewedHeader({ subtotal: 200, vatAmount: 30, total: 230 }),
        [reviewedLine({ quantity: 2, unitPrice: 100, vatRatePercent: null, vatAmount: null, lineTotal: null, vatCodeRatePercent: 15 })],
        null,
      ),
    );
    expect(report.status).toBe("Pass");
  });

  it("SD-2: a printed VAT figure is never overridden by the VAT code", () => {
    const result = buildReviewedExtraction(reviewedHeader(), [reviewedLine({ vatCodeRatePercent: 0 })], null);
    expect(result.lines[0].vatAmount).toBe(150);
    expect(result.lines[0].vatRatePercent).toBe(15);
  });

  it("a typed total that the typed lines do not add up to is flagged", () => {
    const report = validateExtraction(buildReviewedExtraction(reviewedHeader({ total: 2000 }), [reviewedLine()], null));
    expect(report.findings.map((f) => f.code)).toContain("totals-disagree");
  });
});

describe("the stored snapshot is read defensively", () => {
  it("anything that is not the expected shape is treated as no snapshot", () => {
    expect(readExtractionSnapshot(null)).toBeNull();
    expect(readExtractionSnapshot("x")).toBeNull();
    expect(readExtractionSnapshot({ header: {}, lines: "nope", invoiceNumbersSeen: [] })).toBeNull();
  });

  it("a valid snapshot round-trips", () => {
    const s = snapshot();
    expect(readExtractionSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});
