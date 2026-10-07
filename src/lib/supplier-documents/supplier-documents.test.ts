/**
 * SD-2 — the Supplier Documents screens' pure logic: stages, approval
 * blockers, totals, and exactly which fields a reviewer changed.
 */
import { describe, expect, it } from "vitest";
import { captureStage, documentKindLabel, isCreditNote } from "./capture-stages";
import { conversionBlockers, eventSummary, headerChanges, lineAmounts, lineChanges, linesTotals, type HeaderValues, type LineValues } from "./review-logic";
import { contentDisposition, detectInlineFileType } from "@/server/documents/inline-file-type";

describe("stages", () => {
  it("maps every capture status to exactly one stage", () => {
    expect(captureStage("Uploaded", null)).toBe("inbox");
    expect(captureStage("Queued", null)).toBe("inbox");
    expect(captureStage("ManualEntry", null)).toBe("inbox");
    expect(captureStage("Failed", null)).toBe("inbox");
    expect(captureStage("Duplicate", null)).toBe("inbox");
    expect(captureStage("Extracting", null)).toBe("processing");
    expect(captureStage("NeedsReview", null)).toBe("needs-review");
    expect(captureStage("Cancelled", null)).toBe("rejected");
  });

  it("Approved and Posted are decided by the draft's own posting status", () => {
    for (const s of ["Draft", "Submitted", "Approved", "Cancelled", null]) expect(captureStage("Converted", s)).toBe("approved");
    expect(captureStage("Converted", "Posted")).toBe("posted");
  });

  it("names credit notes, whatever the casing", () => {
    expect(isCreditNote("Credit Note")).toBe(true);
    expect(isCreditNote("credit note")).toBe(true);
    expect(isCreditNote("Invoice")).toBe(false);
    expect(documentKindLabel(null)).toBe("Invoice");
    expect(documentKindLabel("Credit Note")).toBe("Credit note");
  });
});

const header: HeaderValues = {
  documentType: "Invoice", invoiceNumber: "INV-1", invoiceDate: "2026-09-01", dueDate: null, orderReference: null,
  currencyCode: "ZAR", subtotal: 1000, discountTotal: null, vatAmount: 150, total: 1150,
};

describe("header changes", () => {
  it("sends only the fields the reviewer changed", () => {
    expect(headerChanges(header, { ...header, total: 1150.0, invoiceNumber: "INV-1A" })).toEqual({ invoiceNumber: "INV-1A" });
  });
  it("treats a cleared field as a change to null", () => {
    expect(headerChanges(header, { ...header, currencyCode: null })).toEqual({ currencyCode: null });
  });
  it("nothing changed means nothing sent", () => {
    expect(headerChanges(header, { ...header })).toEqual({});
  });
});

function line(overrides: Partial<LineValues> = {}): LineValues {
  return {
    lineOrder: 0, description: "Widget", supplierSku: null, quantity: 10, uom: null, unitPrice: 100, discount: null,
    vatRatePercent: 15, vatAmount: 150, lineTotal: 1000, glAccount: "5100", vatCode: "Standard Rated", isExcluded: false,
    ...overrides,
  };
}

describe("line changes", () => {
  it("corrections carry only changed fields — an untouched suggestion is never sent as a confirmation", () => {
    const result = lineChanges([line()], [line({ quantity: 11 })]);
    expect(result).toEqual({ lines: [{ lineOrder: 0, quantity: 11 }], add: [], remove: [] });
  });
  it("additions and removals", () => {
    const result = lineChanges(
      [line(), line({ lineOrder: 1, description: "Freight" })],
      [line(), line({ lineOrder: 1, description: "Freight", remove: true }), line({ lineOrder: null, description: "Missed", quantity: 1, unitPrice: 50 })],
    );
    expect(result.remove).toEqual([1]);
    expect(result.add).toHaveLength(1);
    expect(result.add[0]).toMatchObject({ description: "Missed", quantity: 1, unitPrice: 50 });
    expect(result.lines).toEqual([]);
  });
  it("a line added and then removed again sends nothing", () => {
    expect(lineChanges([line()], [line(), line({ lineOrder: null, remove: true })])).toEqual({ lines: [], add: [], remove: [] });
  });
});

describe("totals as the bill engine computes them", () => {
  const rates = new Map([["Standard Rated", 15], ["Zero Rated", 0]]);
  it("quantity × price − discount, then the VAT code's rate", () => {
    expect(lineAmounts(line({ discount: 50 }), rates)).toEqual({ net: 950, vat: 142.5, total: 1092.5 });
  });
  it("a credit note's negative figures are added as magnitudes", () => {
    expect(lineAmounts(line({ quantity: -10 }), rates)).toEqual({ net: 1000, vat: 150, total: 1150 });
  });
  it("excluded and removed lines do not count; incomplete ones are reported", () => {
    const t = linesTotals([line(), line({ isExcluded: true }), line({ remove: true }), line({ unitPrice: null })], rates);
    expect(t).toEqual({ net: 1000, vat: 150, total: 1150, complete: false });
  });
});

describe("approval blockers", () => {
  const ready = {
    status: "NeedsReview", documentType: "Invoice", supplierId: 7, invoiceNumber: "INV-1", invoiceDate: "2026-09-01",
    validationStatus: "Pass", duplicateStatus: "None", duplicateReason: "",
    lines: [{ description: "Widget", quantity: 1, unitPrice: 100, glAccount: "5100", vatCode: "Standard Rated", isExcluded: false }],
  };
  it("a reviewed, validated, complete document has none", () => {
    expect(conversionBlockers(ready)).toEqual([]);
    expect(conversionBlockers({ ...ready, documentType: "Credit Note", validationStatus: "Review" })).toEqual([]);
  });
  it("lists every reason at once, in plain words", () => {
    const blockers = conversionBlockers({
      ...ready, supplierId: null, validationStatus: "Pending", duplicateStatus: "Blocked", duplicateReason: "Already captured.",
      lines: [{ description: "Widget", quantity: null, unitPrice: null, glAccount: null, vatCode: null, isExcluded: false }],
    });
    expect(blockers).toEqual(expect.arrayContaining([
      "Already captured.",
      expect.stringMatching(/not been validated/),
      expect.stringMatching(/supplier/),
      expect.stringMatching(/GL account/),
      expect.stringMatching(/VAT code/),
      expect.stringMatching(/quantity and a unit price/),
    ]));
  });
  it("a debit note cannot be approved here", () => {
    expect(conversionBlockers({ ...ready, documentType: "Debit Note" })[0]).toMatch(/debit note cannot be captured/i);
  });
});

describe("audit summaries carry no document content", () => {
  it("summarises a correction by counts only", () => {
    expect(eventSummary("FieldCorrected", { fields: ["total", "invoiceNumber"] })).toBe("2 fields");
    expect(eventSummary("FieldCorrected", { lines: [0], added: 1, removed: [2] })).toBe("1 line corrected, 1 added, 1 removed");
  });
});

describe("what may be shown inline (viewer)", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  it("recognises PDF, JPEG and PNG from their bytes", () => {
    expect(detectInlineFileType(new TextEncoder().encode("%PDF-1.7\n..."))).toBe("application/pdf");
    expect(detectInlineFileType(new TextEncoder().encode("﻿ %PDF-1.4"))).toBe("application/pdf");
    expect(detectInlineFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectInlineFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
  });
  it("refuses everything else — HTML and SVG never run as this application", () => {
    expect(detectInlineFileType(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
    expect(detectInlineFileType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(detectInlineFileType(bytes())).toBeNull();
  });
  it("builds a header-safe file name", () => {
    expect(contentDisposition("inline", 'in"voice\r\n.pdf')).toBe(`inline; filename="in_voice__.pdf"; filename*=UTF-8''in%22voice%0D%0A.pdf`);
  });
});
