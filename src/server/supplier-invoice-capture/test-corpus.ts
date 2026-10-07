/**
 * Phase 5L — the synthetic certification corpus.
 *
 * SYNTHETIC AND LOCAL. Every supplier, invoice number, VAT number and
 * amount below is invented. No production invoice is used, referenced or
 * needed, which is what makes this runnable in CI on every suite.
 *
 * Each fixture is a PROVIDER ANSWER — what a model returned — paired with
 * what the deterministic pipeline must then conclude about it. That is the
 * useful boundary to fix in place: the model's behaviour will drift, and
 * what must not drift is what this system does when handed a given answer.
 *
 * The profiles cover the document shapes the brief names, plus the two
 * failure modes VYRON COST measured in production.
 */

import type { ExtractionResult } from "./types";

export type CorpusCase = {
  key: string;
  /** What kind of document produced this answer — for the report, and so a
   * gap in coverage is visible. */
  profile:
    | "clean-pdf"
    | "scan"
    | "jpg"
    | "png"
    | "multi-page"
    | "rotated"
    | "poor-quality"
    | "weight-column"
    | "mixed-vat"
    | "zero-vat"
    | "no-vat"
    | "discount"
    | "missing-invoice-number"
    | "missing-vat-number"
    | "ambiguous-supplier"
    | "duplicate"
    | "repeated-invoice-number"
    | "uom-pack"
    | "arithmetic-mismatch"
    | "batch-scan"
    | "small-text"
    | "many-lines"
    | "credit-note"
    | "debit-note"
    | "foreign-currency";
  description: string;
  answer: ExtractionResult;
  /** What `validateExtraction` must conclude. */
  expect: {
    validation: "Pass" | "Review" | "Incomplete";
    /** Finding codes that must be present. */
    findings?: string[];
    /** True when a retry is justified — deterministic failure only. */
    retryable?: boolean;
  };
};

function header(overrides: Partial<ExtractionResult["header"]> = {}): ExtractionResult["header"] {
  return {
    documentType: "Invoice",
    supplierName: "Karoo Wholesale Supplies",
    supplierVatNumber: "4111222333",
    supplierRegistrationNumber: "2015/445566/07",
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
    ...overrides,
  };
}

function line(overrides: Partial<ExtractionResult["lines"][number]> = {}): ExtractionResult["lines"][number] {
  return {
    description: "Maize meal 10kg",
    supplierSku: "MM10",
    quantity: 10,
    uom: "bag",
    packDescription: null,
    packQuantity: null,
    unitPrice: 100,
    discount: null,
    vatRatePercent: 15,
    vatAmount: 150,
    lineTotal: 1000,
    confidence: 90,
    ...overrides,
  };
}

function answer(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  const lines = overrides.lines ?? [line()];
  return {
    header: overrides.header ?? header(),
    lines,
    invoiceNumbersSeen: overrides.invoiceNumbersSeen ?? [(overrides.header ?? header()).invoiceNumber ?? "KW-10041"],
    missingFields: overrides.missingFields ?? [],
    warnings: overrides.warnings ?? [],
    declaredLineCount: overrides.declaredLineCount ?? lines.length,
  };
}

export const CORPUS: CorpusCase[] = [
  {
    key: "clean-pdf",
    profile: "clean-pdf",
    description: "A born-digital PDF that reconciles with itself.",
    answer: answer(),
    expect: { validation: "Pass" },
  },
  {
    key: "scan",
    profile: "scan",
    description: "A 200 DPI scan; readable, arithmetic sound.",
    answer: answer({ header: header({ confidence: 61 }), lines: [line({ confidence: 58 })] }),
    // Low confidence, sound arithmetic: it passes, and is NOT retried.
    expect: { validation: "Pass", retryable: false },
  },
  {
    key: "jpg-photo",
    profile: "jpg",
    description: "A phone photograph of an invoice.",
    answer: answer({ header: header({ confidence: 44 }), lines: [line({ confidence: 40 })] }),
    expect: { validation: "Pass", retryable: false },
  },
  {
    key: "png-screenshot",
    profile: "png",
    description: "A PNG screenshot of an emailed invoice.",
    answer: answer(),
    expect: { validation: "Pass" },
  },
  {
    key: "multi-page",
    profile: "multi-page",
    description: "One invoice continued across three pages, 14 lines.",
    answer: (() => {
      const lines = Array.from({ length: 14 }, (_, i) =>
        line({ description: `Item ${i + 1}`, supplierSku: `SKU${i + 1}`, quantity: 1, unitPrice: 100 + i, vatAmount: Math.round((100 + i) * 0.15 * 100) / 100, lineTotal: 100 + i }),
      );
      const net = lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
      const vat = Math.round(lines.reduce((s, l) => s + (l.vatAmount ?? 0), 0) * 100) / 100;
      return answer({ lines, header: header({ subtotal: net, vatAmount: vat, total: Math.round((net + vat) * 100) / 100 }) });
    })(),
    expect: { validation: "Pass" },
  },
  {
    key: "rotated",
    profile: "rotated",
    description: "A sideways scan; the model read it but missed the last row.",
    answer: answer({ lines: [line(), line({ description: "Sugar 2.5kg", unitPrice: 55, vatAmount: 8.25, lineTotal: 55 })], declaredLineCount: 3 }),
    expect: { validation: "Incomplete", findings: ["row-count-short"], retryable: true },
  },
  {
    key: "poor-quality",
    profile: "poor-quality",
    description: "A faint fax; nothing usable came back.",
    answer: answer({ lines: [], declaredLineCount: 0, header: header({ subtotal: null, vatAmount: null, total: null }) }),
    expect: { validation: "Incomplete", findings: ["no-lines"], retryable: true },
  },
  {
    key: "weight-column",
    profile: "weight-column",
    description:
      "THE COST FAILURE. A WEIGHT column printed between UNIT PRICE and V.A.T. was read as the VAT amount on every row, at confidence 95.",
    answer: (() => {
      const lines = [124.5, 318.0, 96.75, 240.0, 512.4, 88.2].map((total, i) =>
        line({ description: `Carcass ${i + 1}`, quantity: 1, unitPrice: total, vatAmount: 30, lineTotal: total, confidence: 95 }),
      );
      return answer({ lines, header: header({ subtotal: 1379.85, vatAmount: 206.98, total: 1586.83, confidence: 95 }) });
    })(),
    expect: { validation: "Incomplete", findings: ["constant-money-column"], retryable: true },
  },
  {
    key: "mixed-vat",
    profile: "mixed-vat",
    description: "A standard-rated line and a zero-rated line on one invoice.",
    answer: answer({
      lines: [
        line({ description: "Cleaning chemicals", quantity: 4, unitPrice: 250, vatRatePercent: 15, vatAmount: 150, lineTotal: 1000 }),
        line({ description: "Brown bread (zero-rated)", supplierSku: "BB1", quantity: 20, unitPrice: 15, vatRatePercent: 0, vatAmount: 0, lineTotal: 300 }),
      ],
      header: header({ subtotal: 1300, vatAmount: 150, total: 1450 }),
    }),
    expect: { validation: "Pass" },
  },
  {
    key: "zero-vat",
    profile: "zero-vat",
    description: "A wholly zero-rated invoice — a column of zero VAT is a fact, not a misread.",
    answer: answer({
      lines: Array.from({ length: 6 }, (_, i) =>
        line({ description: `Zero-rated item ${i + 1}`, quantity: 1, unitPrice: 50 + i * 10, vatRatePercent: 0, vatAmount: 0, lineTotal: 50 + i * 10 }),
      ),
      header: header({ subtotal: 450, vatAmount: 0, total: 450 }),
    }),
    expect: { validation: "Pass" },
  },
  {
    key: "no-vat",
    profile: "no-vat",
    description:
      "A supplier who is NOT VAT-registered: no VAT number, no VAT column, no VAT line. Distinct from zero-rated — " +
      "there a registered supplier charges 0%, here VAT does not arise at all. Both print R0, and reading one as " +
      "the other puts the wrong treatment on the VAT return.",
    answer: answer({
      header: header({ supplierName: "Loskop Handyman Services", supplierVatNumber: null, invoiceNumber: "LH-0431", vatAmount: null, subtotal: 750, total: 750 }),
      lines: [line({ description: "Repairs to loading bay door", supplierSku: null, quantity: 1, uom: null, unitPrice: 750, vatRatePercent: null, vatAmount: null, lineTotal: 750 })],
      invoiceNumbersSeen: ["LH-0431"],
    }),
    expect: { validation: "Pass" },
  },
  {
    key: "discount",
    profile: "discount",
    description: "A trade discount printed per line; VAT charged on what remains.",
    answer: answer({
      lines: [line({ quantity: 10, unitPrice: 100, discount: 100, vatRatePercent: 15, vatAmount: 135, lineTotal: 900 })],
      header: header({ subtotal: 900, discountTotal: 100, vatAmount: 135, total: 1035 }),
    }),
    expect: { validation: "Pass" },
  },
  {
    key: "missing-invoice-number",
    profile: "missing-invoice-number",
    description: "The serial number is illegible — null, never a placeholder string.",
    answer: answer({ header: header({ invoiceNumber: null }), invoiceNumbersSeen: [], missingFields: ["invoiceNumber"] }),
    expect: { validation: "Review", findings: ["missing-required-field"], retryable: false },
  },
  {
    key: "missing-vat-number",
    profile: "missing-vat-number",
    description: "No supplier VAT number printed. Not required to capture; resolution falls to the next tier.",
    answer: answer({ header: header({ supplierVatNumber: null }) }),
    expect: { validation: "Pass" },
  },
  {
    key: "ambiguous-supplier",
    profile: "ambiguous-supplier",
    description: "A trading name that resembles two suppliers on file.",
    answer: answer({ header: header({ supplierName: "Karoo Wholesale Supply", supplierVatNumber: null, supplierRegistrationNumber: null }) }),
    expect: { validation: "Pass" },
  },
  {
    key: "duplicate",
    profile: "duplicate",
    description: "Identical to an invoice already on the ledger.",
    answer: answer({ header: header({ invoiceNumber: "KW-10041" }) }),
    expect: { validation: "Pass" },
  },
  {
    key: "repeated-invoice-number",
    profile: "repeated-invoice-number",
    description: "The same serial number reused by the supplier in a later period.",
    answer: answer({ header: header({ invoiceNumber: "KW-10041", invoiceDate: "2027-06-11", dueDate: "2027-07-11" }) }),
    expect: { validation: "Pass" },
  },
  {
    key: "uom-pack",
    profile: "uom-pack",
    description: "A case-priced line: '12 x 1L' at R180 the case. The case price must stay the unit price.",
    answer: answer({
      lines: [
        line({
          description: "12 x 1L Cola",
          supplierSku: "COLA12",
          quantity: 5,
          uom: "case",
          packDescription: "12 x 1L",
          packQuantity: 12,
          unitPrice: 180,
          vatRatePercent: 15,
          vatAmount: 135,
          lineTotal: 900,
        }),
      ],
      header: header({ subtotal: 900, vatAmount: 135, total: 1035 }),
    }),
    expect: { validation: "Pass" },
  },
  {
    key: "arithmetic-mismatch",
    profile: "arithmetic-mismatch",
    description: "THE BRIEF'S EXAMPLE. Extracted total 11,500; the lines add to 11,350.",
    answer: answer({
      lines: [line({ quantity: 1, unitPrice: 9869.57, vatRatePercent: 15, vatAmount: 1480.43, lineTotal: 9869.57 })],
      header: header({ subtotal: 10000, vatAmount: 1500, total: 11500 }),
    }),
    expect: { validation: "Review", findings: ["totals-disagree"], retryable: false },
  },
  {
    key: "batch-scan",
    profile: "batch-scan",
    description: "Five invoices scanned into one file — refused, never merged.",
    answer: answer({ invoiceNumbersSeen: ["KW-10041", "KW-10042", "KW-10043", "KW-10044", "KW-10045"] }),
    expect: { validation: "Incomplete", findings: ["multiple-invoices"], retryable: false },
  },
  {
    key: "small-text",
    profile: "small-text",
    description: "A dense invoice set in very small type; read correctly but with low reported confidence.",
    answer: answer({
      lines: Array.from({ length: 8 }, (_, i) =>
        line({ description: `Small-print item ${i + 1}`, quantity: 1, unitPrice: 12.5 + i, vatRatePercent: 15, vatAmount: Math.round((12.5 + i) * 0.15 * 100) / 100, lineTotal: 12.5 + i, confidence: 35 }),
      ),
      header: header({ subtotal: 128, vatAmount: 19.22, total: 147.22, confidence: 32 }),
    }),
    expect: { validation: "Pass", retryable: false },
  },
  {
    key: "many-lines",
    profile: "many-lines",
    description: "40 charged lines — the length at which a truncated answer becomes likely.",
    answer: (() => {
      const lines = Array.from({ length: 40 }, (_, i) =>
        line({ description: `Item ${i + 1}`, supplierSku: `SKU${i + 1}`, quantity: 2, unitPrice: 25 + i, vatRatePercent: 15, vatAmount: Math.round(2 * (25 + i) * 0.15 * 100) / 100, lineTotal: 2 * (25 + i) }),
      );
      const net = lines.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0);
      const vat = Math.round(lines.reduce((sum, l) => sum + (l.vatAmount ?? 0), 0) * 100) / 100;
      return answer({ lines, header: header({ subtotal: net, vatAmount: vat, total: Math.round((net + vat) * 100) / 100 }) });
    })(),
    expect: { validation: "Pass" },
  },
  {
    key: "credit-note",
    profile: "credit-note",
    description:
      "A supplier CREDIT NOTE. It reduces what is owed. SD-1: captured as a credit note (never as a bill), after a reviewer confirms the type.",
    answer: answer({
      header: header({ documentType: "Credit Note", invoiceNumber: "KW-CN-0007", subtotal: 500, vatAmount: 75, total: 575 }),
      lines: [line({ description: "Returned stock — damaged", quantity: 5, unitPrice: 100, vatAmount: 75, lineTotal: 500 })],
      invoiceNumbersSeen: ["KW-CN-0007"],
    }),
    expect: { validation: "Review", findings: ["not-an-invoice"], retryable: false },
  },
  {
    key: "debit-note",
    profile: "debit-note",
    description: "A supplier DEBIT NOTE. Same treatment — refused rather than mis-booked as an invoice.",
    answer: answer({
      header: header({ documentType: "Debit Note", invoiceNumber: "KW-DN-0002", subtotal: 200, vatAmount: 30, total: 230 }),
      lines: [line({ description: "Undercharge on KW-10041", quantity: 1, unitPrice: 200, vatAmount: 30, lineTotal: 200 })],
      invoiceNumbersSeen: ["KW-DN-0002"],
    }),
    expect: { validation: "Incomplete", findings: ["not-an-invoice"], retryable: false },
  },
  {
    key: "foreign-currency",
    profile: "foreign-currency",
    description:
      "A USD invoice. Extraction captures the printed currency; whether Finance can BOOK a foreign-currency bill is a separate question the report records.",
    answer: answer({
      header: header({ currencyCode: "USD", subtotal: 1200, vatAmount: 0, total: 1200 }),
      lines: [line({ description: "Software subscription (annual)", quantity: 1, unitPrice: 1200, vatRatePercent: 0, vatAmount: 0, lineTotal: 1200 })],
    }),
    expect: { validation: "Pass" },
  },
];

/** Every profile the brief asks for, so a gap in coverage is a test
 * failure rather than something noticed later. */
export const REQUIRED_PROFILES: CorpusCase["profile"][] = [
  "clean-pdf", "scan", "jpg", "png", "multi-page", "rotated", "poor-quality", "weight-column",
  "mixed-vat", "zero-vat", "no-vat", "discount", "missing-invoice-number", "missing-vat-number",
  "ambiguous-supplier", "duplicate", "repeated-invoice-number", "uom-pack", "arithmetic-mismatch", "batch-scan",
  "small-text", "many-lines", "credit-note", "debit-note", "foreign-currency",
];
