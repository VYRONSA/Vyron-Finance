/**
 * Phase 5O — writes the independent ground-truth records.
 *
 * WHAT MAKES THIS INDEPENDENT
 *
 * Every value below was typed by the author from the rendered document. This
 * script does not import `document-content.mjs`, does not import anything
 * from `src/`, has never seen an `ExtractionResult`, and calls none of
 * Finance's arithmetic. It is a standalone file whose only inputs are typed
 * literals.
 *
 * THE ARITHMETIC IS WORKED OUT HERE, NOT BORROWED
 *
 * Part 6 forbids using Finance's invoice-total implementation to produce the
 * answer key — the whole purpose is to detect disagreement between what a
 * document says, what a model reads, and what Finance calculates. If the key
 * came from Finance, Finance could never be caught being wrong. So
 * `expectedArithmetic()` below is four lines of plain multiplication and
 * addition written for this file alone.
 *
 * IT CHECKS THE AUTHOR, TOO
 *
 * Hand-typed totals are exactly where an author slips a digit — it happened
 * in Phase 5J. So every record's typed `independentArithmetic` is recompared
 * against the line values before it is written, and a mismatch throws. For
 * `arithmetic-mismatch` the DOCUMENT is deliberately wrong; the check still
 * applies to the independent arithmetic, and the disagreement with the
 * printed figures is recorded rather than corrected.
 *
 *   node scripts/author-ground-truth.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "certification-corpus", "ground-truth");

const VERIFIED_BY =
  "Authored by Claude (Opus 5) for VYRON on 2026-09-19, read from the rendered page at " +
  "certification-corpus/documents/. Typed independently of the extraction schema, prompt and provider. " +
  "Not yet countersigned by a second reader.";

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The independent arithmetic. Plain multiplication and addition, written
 * for this file and used nowhere else in the codebase.
 *
 *   extension      = quantity x unit price
 *   taxable amount = extension - discount
 *   VAT            = taxable amount x rate / 100
 *   line total     = taxable amount        (VAT shown separately)
 */
function expectedArithmetic(lines) {
  const perLine = lines.map((l) => {
    const extension = round2(l.quantity * l.unitPrice);
    const taxable = round2(extension - (l.discount ?? 0));
    const vat = l.vatRatePercent === null || l.vatRatePercent === undefined ? null : round2((taxable * l.vatRatePercent) / 100);
    return { extension, discount: l.discount ?? 0, taxableAmount: taxable, vat, lineTotal: taxable };
  });

  const subtotal = round2(perLine.reduce((s, l) => s + l.taxableAmount, 0));
  const discountTotal = round2(perLine.reduce((s, l) => s + l.discount, 0));
  const vatTotal = perLine.every((l) => l.vat === null) ? null : round2(perLine.reduce((s, l) => s + (l.vat ?? 0), 0));
  const total = round2(subtotal + (vatTotal ?? 0));

  return { perLine, subtotal, discountTotal, vatTotal, total };
}

/** Builds one record and proves the author's own typed figures. */
function record(input) {
  const computed = expectedArithmetic(input.lines);

  // Catch an author's slipped digit before it becomes an answer key.
  for (const [index, line] of input.lines.entries()) {
    const c = computed.perLine[index];
    if (line.lineTotal !== c.lineTotal) {
      throw new Error(`${input.caseId} line ${index + 1}: typed lineTotal ${line.lineTotal}, arithmetic gives ${c.lineTotal}`);
    }
    if (line.vatAmount !== undefined && line.vatAmount !== null && c.vat !== null && line.vatAmount !== c.vat) {
      throw new Error(`${input.caseId} line ${index + 1}: typed vatAmount ${line.vatAmount}, arithmetic gives ${c.vat}`);
    }
  }

  const independentArithmetic = {
    lineExtensions: computed.perLine.map((l) => l.extension),
    discountTotal: computed.discountTotal,
    taxableAmount: computed.subtotal,
    vat: computed.vatTotal,
    total: computed.total,
  };

  const printed = input.printedTotals;
  const agreesWithDocument =
    (printed.subtotal === undefined || printed.subtotal === independentArithmetic.taxableAmount) &&
    (printed.vatAmount === undefined || printed.vatAmount === independentArithmetic.vat) &&
    printed.total === independentArithmetic.total;

  if (input.documentIsArithmeticallyWrong !== !agreesWithDocument) {
    throw new Error(
      `${input.caseId}: expected documentIsArithmeticallyWrong=${input.documentIsArithmeticallyWrong}, ` +
        `but printed ${JSON.stringify(printed)} vs independent ${JSON.stringify(independentArithmetic)}`,
    );
  }

  return {
    caseId: input.caseId,
    documentId: input.documentId,
    verifiedBy: VERIFIED_BY,
    verifiedOn: "2026-09-19",
    documentType: input.documentType,
    supplier: input.supplier,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    dueDate: input.dueDate,
    orderReference: input.orderReference ?? null,
    currency: input.currency,
    lines: input.lines,
    printedTotals: printed,
    independentArithmetic,
    documentIsArithmeticallyWrong: input.documentIsArithmeticallyWrong,
    fieldStatus: input.fieldStatus,
    expected: input.expected,
    ...(input.duplicateScenario ? { duplicateScenario: input.duplicateScenario } : {}),
    notes: input.notes,
  };
}

/** Shorthand for the common supplier shape. */
const sup = (name, vatNumber, registrationNumber) => ({ name, vatNumber, registrationNumber });

const KAROO = sup("Karoo Wholesale Supplies", "4111222333", "2015/445566/07");
const DRAKENSBERG_NO_VAT_PRINTED = sup("Drakensberg Cold Chain", null, "2011/998877/07");
const DRAKENSBERG = sup("Drakensberg Cold Chain", "4990887766", "2011/998877/07");
const UMGENI = sup("Umgeni Packaging Co", "4223344556", "2008/112233/07");
const HIGHVELD = sup("Highveld Fasteners", "4778899001", "2013/667788/07");

/** The standard "everything as expected" field statuses. */
const ALL_PRESENT = {
  supplierName: "present",
  supplierVatNumber: "present",
  supplierRegistrationNumber: "present",
  invoiceNumber: "present",
  invoiceDate: "present",
  dueDate: "present",
  currency: "present",
};

const RECORDS = [
  // 1 -----------------------------------------------------------------
  record({
    caseId: "clean-pdf",
    documentId: "clean-pdf.pdf",
    documentType: "Invoice",
    supplier: KAROO,
    invoiceNumber: "KW-10041",
    invoiceDate: "2026-06-11",
    dueDate: "2026-07-11",
    orderReference: "PO-4471",
    currency: "ZAR",
    lines: [
      { description: "Maize meal 10kg", supplierSku: "MM10", quantity: 10, uom: "bag", unitPrice: 100.0, discount: 0, vatRatePercent: 15, vatAmount: 150.0, lineTotal: 1000.0 },
    ],
    printedTotals: { subtotal: 1000.0, vatAmount: 150.0, total: 1150.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "present" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "The baseline. Every particular present, arithmetic agrees, one line.",
  }),

  // 2 -----------------------------------------------------------------
  record({
    caseId: "multi-page",
    documentId: "multi-page.pdf",
    documentType: "Invoice",
    supplier: KAROO,
    invoiceNumber: "KW-10077",
    invoiceDate: "2026-06-14",
    dueDate: "2026-07-14",
    currency: "ZAR",
    lines: [
      "Cake flour 12.5kg", "White sugar 10kg", "Brown sugar 10kg", "Long grain rice 10kg",
      "Sunflower oil 2L", "Baked beans 410g", "Chopped tomatoes 410g", "Pilchards in tomato 400g",
      "Instant coffee 750g", "Rooibos tea 200 bags", "Full cream milk powder 1kg", "Peanut butter 800g",
      "Mixed fruit jam 900g", "Cream crackers 200g",
    ].map((description, i) => ({
      description, supplierSku: `KW-${200 + i}`, quantity: 2, uom: "case",
      unitPrice: 75.0, discount: 0, vatRatePercent: 15, vatAmount: 22.5, lineTotal: 150.0,
    })),
    printedTotals: { subtotal: 2100.0, vatAmount: 315.0, total: 2415.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "correctly-absent" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "14 lines across two pages. Lines 8-14 are on page 2; an extraction that reads only page 1 must be visible as a line-count failure, not as a plausible smaller invoice.",
  }),

  // 3 -----------------------------------------------------------------
  record({
    caseId: "scan",
    documentId: "scan.pdf",
    documentType: "Invoice",
    supplier: DRAKENSBERG,
    invoiceNumber: "DC-4471",
    invoiceDate: "2026-05-29",
    dueDate: "2026-06-28",
    currency: "ZAR",
    lines: [
      { description: "Cold storage pallet handling", supplierSku: "CS-PAL", quantity: 6, uom: "pallet", unitPrice: 240.0, discount: 0, vatRatePercent: 15, vatAmount: 216.0, lineTotal: 1440.0 },
    ],
    printedTotals: { subtotal: 1440.0, vatAmount: 216.0, total: 1656.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "correctly-absent" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "Image-only PDF with NO text layer, greyscaled — a genuine scan. Anything reading this must look at the page rather than parse it.",
  }),

  // 4 -----------------------------------------------------------------
  record({
    caseId: "jpg",
    documentId: "jpg.jpg",
    documentType: "Invoice",
    supplier: HIGHVELD,
    invoiceNumber: "HF-2208",
    invoiceDate: "2026-06-02",
    dueDate: "2026-07-02",
    orderReference: "PO-4488",
    currency: "ZAR",
    lines: [
      { description: "Hex bolt M12 x 80 (box of 100)", supplierSku: "HB1280", quantity: 3, uom: "box", unitPrice: 425.5, discount: 0, vatRatePercent: 15, vatAmount: 191.48, lineTotal: 1276.5 },
    ],
    printedTotals: { subtotal: 1276.5, vatAmount: 191.48, total: 1467.98 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "present" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "Also the rounding case: 15% of 1 276.50 is 191.475, printed as 191.48. A reader that returns 191.47 has rounded the other way and the difference is real.",
  }),

  // 5 -----------------------------------------------------------------
  record({
    caseId: "png",
    documentId: "png.png",
    documentType: "Invoice",
    supplier: UMGENI,
    invoiceNumber: "UP-9912",
    invoiceDate: "2026-06-05",
    dueDate: "2026-07-05",
    currency: "ZAR",
    lines: [
      { description: "Corrugated carton 400x300x200", supplierSku: "CC403020", quantity: 250, uom: "each", unitPrice: 12.4, discount: 0, vatRatePercent: 15, vatAmount: 465.0, lineTotal: 3100.0 },
    ],
    printedTotals: { subtotal: 3100.0, vatAmount: 465.0, total: 3565.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "correctly-absent" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "A screenshot of an emailed invoice. The description contains dimensions (400x300x200) that are NOT money and must not become one.",
  }),

  // 6 -----------------------------------------------------------------
  record({
    caseId: "rotated",
    documentId: "rotated.png",
    documentType: "Invoice",
    supplier: KAROO,
    invoiceNumber: "KW-10102",
    invoiceDate: "2026-06-18",
    dueDate: "2026-07-18",
    currency: "ZAR",
    lines: [
      { description: "Sunflower oil 5L", supplierSku: "SO5", quantity: 8, uom: "bottle", unitPrice: 189.0, discount: 0, vatRatePercent: 15, vatAmount: 226.8, lineTotal: 1512.0 },
    ],
    printedTotals: { subtotal: 1512.0, vatAmount: 226.8, total: 1738.8 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "correctly-absent" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "Photographed about 6.5 degrees off square on a grey surface. Every value is legible; rotation is not an excuse for a missing field.",
  }),

  // 7 -----------------------------------------------------------------
  record({
    caseId: "poor-quality",
    documentId: "poor-quality.jpg",
    documentType: "Invoice",
    supplier: DRAKENSBERG,
    invoiceNumber: "DC-4503",
    invoiceDate: "2026-06-09",
    dueDate: "2026-07-09",
    currency: "ZAR",
    lines: [
      { description: "Blast freezing service", supplierSku: "BF-STD", quantity: 1, uom: "service", unitPrice: 2750.0, discount: 0, vatRatePercent: 15, vatAmount: 412.5, lineTotal: 2750.0 },
    ],
    printedTotals: { subtotal: 2750.0, vatAmount: 412.5, total: 3162.5 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "correctly-absent" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "Low resolution, faded, heavy JPEG artefacts. Verified legible by eye at full size. A field returned WRONG here is a worse outcome than one returned null.",
  }),

  // 8 -----------------------------------------------------------------
  record({
    caseId: "small-text",
    documentId: "small-text.pdf",
    documentType: "Invoice",
    supplier: KAROO,
    invoiceNumber: "KW-10133",
    invoiceDate: "2026-06-22",
    dueDate: "2026-07-22",
    currency: "ZAR",
    lines: [
      { description: "Long grain rice 10kg", supplierSku: "LR10", quantity: 4, uom: "bag", unitPrice: 118.0, discount: 0, vatRatePercent: 15, vatAmount: 70.8, lineTotal: 472.0 },
      { description: "White sugar 2.5kg", supplierSku: "WS25", quantity: 12, uom: "pack", unitPrice: 42.75, discount: 0, vatRatePercent: 15, vatAmount: 76.95, lineTotal: 513.0 },
      { description: "Table salt 1kg", supplierSku: "TS1", quantity: 20, uom: "pack", unitPrice: 11.6, discount: 0, vatRatePercent: 15, vatAmount: 34.8, lineTotal: 232.0 },
    ],
    printedTotals: { subtotal: 1217.0, vatAmount: 182.55, total: 1399.55 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "correctly-absent" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "Body text at roughly 6pt. Descriptions contain quantities (10kg, 2.5kg, 1kg) that are part of the product name, not the invoice quantity.",
  }),

  // 9 -----------------------------------------------------------------
  record({
    caseId: "many-lines",
    documentId: "many-lines.pdf",
    documentType: "Invoice",
    supplier: UMGENI,
    invoiceNumber: "UP-10044",
    invoiceDate: "2026-06-25",
    dueDate: "2026-07-25",
    orderReference: "PO-4502",
    currency: "ZAR",
    lines: Array.from({ length: 20 }, (_, i) => {
      const unitPrice = 50 + i * 5;
      return {
        description: `Packaging component ${String(i + 1).padStart(2, "0")}`,
        supplierSku: `UP-${500 + i}`,
        quantity: 1,
        uom: "each",
        unitPrice,
        discount: 0,
        vatRatePercent: 15,
        vatAmount: round2((unitPrice * 15) / 100),
        lineTotal: unitPrice,
      };
    }),
    printedTotals: { subtotal: 1950.0, vatAmount: 292.5, total: 2242.5 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "present" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "20 lines, unit prices rising 50.00 to 145.00 in steps of 5.00, across two pages. Tests whether long tables are truncated silently.",
  }),

  // 10 ----------------------------------------------------------------
  record({
    caseId: "mixed-vat",
    documentId: "mixed-vat.pdf",
    documentType: "Invoice",
    supplier: KAROO,
    invoiceNumber: "KW-10150",
    invoiceDate: "2026-06-26",
    dueDate: "2026-07-26",
    currency: "ZAR",
    lines: [
      { description: "Coffee beans 1kg", supplierSku: "CB1", quantity: 10, uom: "bag", unitPrice: 100.0, discount: 0, vatRatePercent: 15, vatAmount: 150.0, lineTotal: 1000.0 },
      { description: "Brown bread 700g", supplierSku: "BB700", quantity: 60, uom: "loaf", unitPrice: 5.0, discount: 0, vatRatePercent: 0, vatAmount: 0.0, lineTotal: 300.0 },
    ],
    printedTotals: { subtotal: 1300.0, vatAmount: 150.0, total: 1450.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "correctly-absent" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "Two rates on one document. VAT is 150.00 — 15% of the first line ONLY. A blended header rate (1 300 x 15% = 195.00) is the wrong answer and is the mistake this case exists to catch.",
  }),

  // 11 ----------------------------------------------------------------
  record({
    caseId: "zero-vat",
    documentId: "zero-vat.pdf",
    documentType: "Invoice",
    supplier: KAROO,
    invoiceNumber: "KW-10166",
    invoiceDate: "2026-06-29",
    dueDate: "2026-07-29",
    currency: "ZAR",
    lines: [
      { description: "Maize meal 10kg", supplierSku: "MM10", quantity: 1, uom: "bag", unitPrice: 50.0, discount: 0, vatRatePercent: 0, vatAmount: 0.0, lineTotal: 50.0 },
      { description: "Brown bread 700g", supplierSku: "BB700", quantity: 1, uom: "loaf", unitPrice: 60.0, discount: 0, vatRatePercent: 0, vatAmount: 0.0, lineTotal: 60.0 },
      { description: "Full cream milk 2L", supplierSku: "FCM2", quantity: 1, uom: "bottle", unitPrice: 70.0, discount: 0, vatRatePercent: 0, vatAmount: 0.0, lineTotal: 70.0 },
      { description: "Eggs large 18s", supplierSku: "EG18", quantity: 1, uom: "tray", unitPrice: 80.0, discount: 0, vatRatePercent: 0, vatAmount: 0.0, lineTotal: 80.0 },
      { description: "Long grain rice 2kg", supplierSku: "LR2", quantity: 1, uom: "bag", unitPrice: 90.0, discount: 0, vatRatePercent: 0, vatAmount: 0.0, lineTotal: 90.0 },
      { description: "Brown lentils 1kg", supplierSku: "BL1", quantity: 1, uom: "pack", unitPrice: 100.0, discount: 0, vatRatePercent: 0, vatAmount: 0.0, lineTotal: 100.0 },
    ],
    printedTotals: { subtotal: 450.0, vatAmount: 0.0, total: 450.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "correctly-absent" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "ZERO-RATED, not VAT-free. The supplier IS registered, the VAT number IS printed, the VAT column IS present and reads 0.00. Compare with no-vat, which is a different thing that looks the same.",
  }),

  // 12 ----------------------------------------------------------------
  record({
    caseId: "no-vat",
    documentId: "no-vat.pdf",
    documentType: "Invoice",
    supplier: sup("Loskop Handyman Services", null, null),
    invoiceNumber: "LH-0431",
    invoiceDate: "2026-06-15",
    dueDate: null,
    currency: "ZAR",
    lines: [
      { description: "Repairs to loading bay door", supplierSku: null, quantity: 1, uom: null, unitPrice: 750.0, discount: 0, vatRatePercent: null, vatAmount: null, lineTotal: 750.0 },
    ],
    printedTotals: { total: 750.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: {
      supplierName: "present",
      // The decisive distinction in this whole corpus. This supplier is not
      // a VAT vendor, so there is no VAT number to omit. Absent is CORRECT.
      supplierVatNumber: "correctly-absent",
      supplierRegistrationNumber: "correctly-absent",
      invoiceNumber: "present",
      invoiceDate: "present",
      dueDate: "correctly-absent",
      currency: "present",
      orderReference: "correctly-absent",
      vatAmount: "not-applicable",
      vatRatePercent: "not-applicable",
      supplierSku: "correctly-absent",
      uom: "correctly-absent",
    },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "Headed INVOICE, not TAX INVOICE — the legally correct heading for a non-vendor, and the strongest visible signal. No VAT number, no VAT column, no VAT total. Absent VAT here is CORRECTLY ABSENT and must never be scored as missing, nor reported as a finding.",
  }),

  // 13 ----------------------------------------------------------------
  record({
    caseId: "discount",
    documentId: "discount.pdf",
    documentType: "Invoice",
    supplier: KAROO,
    invoiceNumber: "KW-10188",
    invoiceDate: "2026-07-01",
    dueDate: "2026-07-31",
    currency: "ZAR",
    lines: [
      { description: "Maize meal 10kg", supplierSku: "MM10", quantity: 10, uom: "bag", unitPrice: 100.0, discount: 100.0, vatRatePercent: 15, vatAmount: 135.0, lineTotal: 900.0 },
    ],
    printedTotals: { subtotal: 900.0, discountTotal: 100.0, vatAmount: 135.0, total: 1035.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "correctly-absent", discount: "present" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "VAT is charged on 900.00, not on 1 000.00. A reader that returns VAT of 150.00 has taxed the pre-discount amount — the defect Phase 5J fixed in Finance's own invoicing.",
  }),

  // 14 ----------------------------------------------------------------
  record({
    caseId: "uom-pack",
    documentId: "uom-pack.pdf",
    documentType: "Invoice",
    supplier: UMGENI,
    invoiceNumber: "UP-10101",
    invoiceDate: "2026-07-02",
    dueDate: "2026-08-01",
    currency: "ZAR",
    lines: [
      { description: "Bottled still water 500ml (12 x 500ml)", supplierSku: "BW500-12", quantity: 5, uom: "case", packDescription: "12 x 500ml", unitPrice: 180.0, discount: 0, vatRatePercent: 15, vatAmount: 135.0, lineTotal: 900.0 },
    ],
    printedTotals: { subtotal: 900.0, vatAmount: 135.0, total: 1035.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "correctly-absent", packDescription: "present" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes: "Priced per CASE at 180.00. The pack expression '12 x 500ml' is printed and may be reported, but NOTHING on this page states a per-bottle price. A unit price of 15.00 (180 / 12) is invented and is wrong — the VYRON COST defect where a derived unit cost was stored as if printed.",
  }),

  // 15 ----------------------------------------------------------------
  record({
    caseId: "ambiguous-supplier",
    documentId: "ambiguous-supplier.pdf",
    documentType: "Invoice",
    supplier: sup("Karoo Wholesale Supply (Pty) Ltd", null, null),
    invoiceNumber: "KWS-3310",
    invoiceDate: "2026-07-03",
    dueDate: "2026-08-02",
    currency: "ZAR",
    lines: [
      { description: "Dry goods assortment", supplierSku: "DGA", quantity: 1, uom: "pallet", unitPrice: 640.0, discount: 0, vatRatePercent: 15, vatAmount: 96.0, lineTotal: 640.0 },
    ],
    printedTotals: { subtotal: 640.0, vatAmount: 96.0, total: 736.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: {
      supplierName: "ambiguous",
      supplierVatNumber: "correctly-absent",
      supplierRegistrationNumber: "correctly-absent",
      invoiceNumber: "present",
      invoiceDate: "present",
      dueDate: "present",
      currency: "present",
      orderReference: "correctly-absent",
    },
    expected: {
      validationFindings: [],
      // The decisive expectation: AMBIGUOUS, never resolved. A high fuzzy
      // score is not a match. Posting a bill against the wrong legal entity
      // is not recoverable by editing a name.
      supplierResolution: "ambiguous",
      duplicate: "none",
      conversion: "blocked-no-supplier",
    },
    notes: "'Karoo Wholesale Supply (Pty) Ltd' is a DIFFERENT legal entity from 'Karoo Wholesale Supplies'. No VAT number and no registration number are printed, so there is nothing deterministic to match on. The correct outcome is to ask a human, not to pick the closer string.",
  }),

  // 16 ----------------------------------------------------------------
  record({
    caseId: "duplicate",
    documentId: "duplicate.pdf",
    documentType: "Invoice",
    supplier: KAROO,
    invoiceNumber: "KW-10041",
    invoiceDate: "2026-06-11",
    dueDate: "2026-07-11",
    orderReference: "PO-4471",
    currency: "ZAR",
    lines: [
      { description: "Maize meal 10kg", supplierSku: "MM10", quantity: 10, uom: "bag", unitPrice: 100.0, discount: 0, vatRatePercent: 15, vatAmount: 150.0, lineTotal: 1000.0 },
    ],
    printedTotals: { subtotal: 1000.0, vatAmount: 150.0, total: 1150.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "present" },
    expected: {
      validationFindings: [],
      supplierResolution: "resolved-exact",
      duplicate: "blocked",
      conversion: "blocked-duplicate",
    },
    duplicateScenario: "Same supplier, same invoice number, same date and same total as clean-pdf, re-issued as a COPY. The FILE differs, so a content-hash check alone will not catch it; the supplier+number match must.",
    notes: "Must be captured AFTER clean-pdf for the expectation to hold. Carries a visible COPY watermark, as a re-issued invoice does.",
  }),

  // 17 ----------------------------------------------------------------
  record({
    caseId: "repeated-invoice-number",
    documentId: "repeated-invoice-number.pdf",
    documentType: "Invoice",
    supplier: HIGHVELD,
    invoiceNumber: "KW-10041",
    invoiceDate: "2026-07-04",
    dueDate: "2026-08-03",
    currency: "ZAR",
    lines: [
      { description: "Washer M12 galvanised", supplierSku: "WM12G", quantity: 500, uom: "each", unitPrice: 1.15, discount: 0, vatRatePercent: 15, vatAmount: 86.25, lineTotal: 575.0 },
    ],
    printedTotals: { subtotal: 575.0, vatAmount: 86.25, total: 661.25 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "correctly-absent" },
    expected: {
      validationFindings: [],
      supplierResolution: "resolved-exact",
      // NOT a duplicate. Two suppliers may use the same number string and
      // frequently do. Blocking this would reject a legitimate invoice.
      duplicate: "none",
      conversion: "draft-bill",
    },
    duplicateScenario: "Same invoice NUMBER as clean-pdf and duplicate, but a DIFFERENT supplier. The correct answer is 'not a duplicate'.",
    notes: "The false-positive guard for duplicate detection. An invoice number is unique per supplier, never globally.",
  }),

  // 18 ----------------------------------------------------------------
  record({
    caseId: "missing-vat-number",
    documentId: "missing-vat-number.pdf",
    documentType: "Invoice",
    supplier: DRAKENSBERG_NO_VAT_PRINTED,
    invoiceNumber: "DC-4570",
    invoiceDate: "2026-07-06",
    dueDate: "2026-08-05",
    currency: "ZAR",
    lines: [
      { description: "Refrigerated transport Durban to Gauteng", supplierSku: "RT-DBN-JHB", quantity: 1, uom: "trip", unitPrice: 4300.0, discount: 0, vatRatePercent: 15, vatAmount: 645.0, lineTotal: 4300.0 },
    ],
    printedTotals: { subtotal: 4300.0, vatAmount: 645.0, total: 4945.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: {
      supplierName: "present",
      // MISSING, not correctly-absent. The document is headed TAX INVOICE
      // and charges VAT, so the supplier is a vendor and the number should
      // be there. Its absence is a defect in the document.
      supplierVatNumber: "missing",
      supplierRegistrationNumber: "present",
      invoiceNumber: "present",
      invoiceDate: "present",
      dueDate: "present",
      currency: "present",
      orderReference: "correctly-absent",
    },
    expected: {
      validationFindings: ["missing-required-field"],
      supplierResolution: "resolved-exact",
      duplicate: "none",
      conversion: "draft-bill",
    },
    notes: "The contrast case for no-vat. Here VAT IS charged and the heading IS 'TAX INVOICE', so the absent VAT number is genuinely MISSING — a defective tax invoice. Scoring this as correctly-absent would hide a real compliance problem.",
  }),

  // 19 ----------------------------------------------------------------
  record({
    caseId: "missing-invoice-number",
    documentId: "missing-invoice-number.pdf",
    documentType: "Invoice",
    supplier: KAROO,
    invoiceNumber: null,
    invoiceDate: "2026-07-07",
    dueDate: "2026-08-06",
    currency: "ZAR",
    lines: [
      { description: "Cooking oil 20L", supplierSku: "CO20", quantity: 3, uom: "drum", unitPrice: 640.0, discount: 0, vatRatePercent: 15, vatAmount: 288.0, lineTotal: 1920.0 },
    ],
    printedTotals: { subtotal: 1920.0, vatAmount: 288.0, total: 2208.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: {
      supplierName: "present",
      supplierVatNumber: "present",
      supplierRegistrationNumber: "present",
      invoiceNumber: "missing",
      invoiceDate: "present",
      dueDate: "present",
      currency: "present",
      orderReference: "correctly-absent",
    },
    expected: {
      validationFindings: ["missing-required-field"],
      supplierResolution: "resolved-exact",
      duplicate: "none",
      conversion: "blocked-missing-invoice-number",
    },
    notes: "No serial number is printed anywhere on the page. The correct answer is null. A plausible invented number ('INV-001', the date, the PO) is the worst possible outcome: it would post, and it would be untraceable.",
  }),

  // 20 ----------------------------------------------------------------
  record({
    caseId: "arithmetic-mismatch",
    documentId: "arithmetic-mismatch.pdf",
    documentType: "Invoice",
    supplier: KAROO,
    invoiceNumber: "KW-10222",
    invoiceDate: "2026-07-08",
    dueDate: "2026-08-07",
    currency: "ZAR",
    lines: [
      // The line's own VAT is printed as 165.00 and that is what the page
      // says. The typed `vatAmount` here is the PRINTED figure, deliberately
      // left disagreeing with the independent arithmetic below.
      { description: "Maize meal 10kg", supplierSku: "MM10", quantity: 10, uom: "bag", unitPrice: 100.0, discount: 0, vatRatePercent: 15, vatAmount: null, lineTotal: 1000.0, printedVatAmount: 165.0 },
    ],
    printedTotals: { subtotal: 1000.0, vatAmount: 165.0, total: 1165.0 },
    documentIsArithmeticallyWrong: true,
    fieldStatus: { ...ALL_PRESENT, orderReference: "correctly-absent" },
    expected: {
      validationFindings: ["totals-mismatch"],
      supplierResolution: "resolved-exact",
      duplicate: "none",
      conversion: "review-arithmetic-disagreement",
    },
    notes:
      "THE DOCUMENT IS WRONG AND STAYS WRONG. It prints VAT of 165.00 on a net of 1 000.00, where 15% is 150.00, and a total of 1 165.00 instead of 1 150.00. " +
      "The correct extraction is what is PRINTED (165.00 / 1 165.00); the correct SYSTEM behaviour is to notice the disagreement and ask. " +
      "An extraction that returns 150.00 has silently corrected a supplier's invoice, which is how a wrong figure enters a ledger looking right.",
  }),

  // 21 ----------------------------------------------------------------
  record({
    caseId: "credit-note",
    documentId: "credit-note.pdf",
    documentType: "Credit Note",
    supplier: KAROO,
    invoiceNumber: "KW-CN-0007",
    invoiceDate: "2026-07-09",
    dueDate: null,
    currency: "ZAR",
    lines: [
      { description: "Returned stock — maize meal 10kg", supplierSku: "MM10", quantity: 5, uom: "bag", unitPrice: 100.0, discount: 0, vatRatePercent: 15, vatAmount: 75.0, lineTotal: 500.0 },
    ],
    printedTotals: { subtotal: 500.0, vatAmount: 75.0, total: 575.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, dueDate: "correctly-absent", orderReference: "correctly-absent" },
    expected: {
      validationFindings: ["not-an-invoice"],
      supplierResolution: "resolved-exact",
      duplicate: "none",
      conversion: "not-supported-credit-note",
    },
    notes:
      "Visibly headed CREDIT NOTE, referencing KW-10041, with a stated reason. The amounts are POSITIVE on the page — a credit note states what is being credited, it does not print negatives. " +
      "Expected outcome is classification plus refusal: it must NOT become a Bill, because a Bill would increase what is owed when this document reduces it.",
  }),

  // 22 ----------------------------------------------------------------
  record({
    caseId: "debit-note",
    documentId: "debit-note.pdf",
    documentType: "Debit Note",
    supplier: KAROO,
    invoiceNumber: "KW-DN-0002",
    invoiceDate: "2026-07-10",
    dueDate: null,
    currency: "ZAR",
    lines: [
      { description: "Undercharge correction — maize meal 10kg", supplierSku: "MM10", quantity: 1, uom: "bag", unitPrice: 200.0, discount: 0, vatRatePercent: 15, vatAmount: 30.0, lineTotal: 200.0 },
    ],
    printedTotals: { subtotal: 200.0, vatAmount: 30.0, total: 230.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, dueDate: "correctly-absent", orderReference: "correctly-absent" },
    expected: {
      validationFindings: ["not-an-invoice"],
      supplierResolution: "resolved-exact",
      duplicate: "none",
      conversion: "not-supported-debit-note",
    },
    notes:
      "Visibly headed DEBIT NOTE. A debit note moves the balance the SAME way a bill does, which makes it the more tempting one to convert — and still wrong, because it is not an invoice and would double-count against KW-10041. Refused for the same reason as the credit note.",
  }),

  // 23 ----------------------------------------------------------------
  record({
    caseId: "foreign-currency",
    documentId: "foreign-currency.pdf",
    documentType: "Invoice",
    supplier: sup("Atlas Software International Inc", null, null),
    invoiceNumber: "ASI-77214",
    invoiceDate: "2026-07-13",
    dueDate: "2026-08-12",
    currency: "USD",
    lines: [
      { description: "Annual software subscription — 25 seats", supplierSku: "ASI-SUB-25", quantity: 1, uom: "licence", unitPrice: 1200.0, discount: 0, vatRatePercent: null, vatAmount: null, lineTotal: 1200.0 },
    ],
    printedTotals: { subtotal: 1200.0, total: 1200.0 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: {
      supplierName: "present",
      supplierVatNumber: "not-applicable",
      supplierRegistrationNumber: "not-applicable",
      invoiceNumber: "present",
      invoiceDate: "present",
      dueDate: "present",
      // Present and CORRECT. The currency is not missing, not ambiguous —
      // it is printed, and the conversion refusal follows from reading it
      // right, not from failing to read it.
      currency: "present",
      orderReference: "correctly-absent",
      vatAmount: "not-applicable",
    },
    expected: {
      validationFindings: [],
      supplierResolution: "unresolved",
      duplicate: "none",
      conversion: "not-supported-foreign-currency",
    },
    notes:
      "USD 1 200.00, stated three times on the page ('TOTAL USD', the $ symbol, and the footer). A foreign supplier, so no South African VAT arises — not-applicable, not missing. " +
      "Finance's CreatePurchaseBillInput has no currency field at all, so converting this would book R1 200.00. Expected: extract correctly, then refuse. No rate, no conversion, no silent ZAR.",
  }),

  // 24 ----------------------------------------------------------------
  record({
    caseId: "weight-column",
    documentId: "weight-column.pdf",
    documentType: "Invoice",
    supplier: HIGHVELD,
    invoiceNumber: "HF-2260",
    invoiceDate: "2026-07-14",
    dueDate: "2026-08-13",
    orderReference: "PO-4530",
    currency: "ZAR",
    lines: [
      { description: "Steel bar 12mm x 6m", supplierSku: "SB126", quantity: 20, uom: "each", unitPrice: 96.5, discount: 0, vatRatePercent: 15, vatAmount: 289.5, lineTotal: 1930.0, printedNonMoneyColumns: { "MASS (kg)": 5.33 } },
      { description: "Steel plate 3mm 1m x 2m", supplierSku: "SP312", quantity: 4, uom: "sheet", unitPrice: 412.0, discount: 0, vatRatePercent: 15, vatAmount: 247.2, lineTotal: 1648.0, printedNonMoneyColumns: { "MASS (kg)": 47.1 } },
    ],
    printedTotals: { subtotal: 3578.0, vatAmount: 536.7, total: 4114.7 },
    documentIsArithmeticallyWrong: false,
    fieldStatus: { ...ALL_PRESENT, orderReference: "present" },
    expected: { validationFindings: [], supplierResolution: "resolved-exact", duplicate: "none", conversion: "draft-bill" },
    notes:
      "THE VYRON COST PRODUCTION FAILURE, reproduced. A MASS (kg) column sits between UNIT PRICE and V.A.T. The values 5.33 and 47.10 are kilograms and are NOT money. " +
      "They must never appear as unitPrice, vatAmount or lineTotal. In COST this exact layout put a weight into a cost field on every row of a real invoice.",
  }),
];

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const keys = RECORDS.map((r) => r.caseId);
  const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (duplicates.length > 0) throw new Error(`Duplicate case ids: ${duplicates.join(", ")}`);

  for (const rec of RECORDS) {
    writeFileSync(join(OUT_DIR, `${rec.caseId}.json`), `${JSON.stringify(rec, null, 2)}\n`, "utf8");
  }

  console.log(`${RECORDS.length} ground-truth records written to certification-corpus/ground-truth/`);
  for (const rec of RECORDS) {
    const a = rec.independentArithmetic;
    const flag = rec.documentIsArithmeticallyWrong ? "  <-- document deliberately disagrees" : "";
    console.log(
      `${rec.caseId.padEnd(26)} lines=${String(rec.lines.length).padStart(2)}  net=${String(a.taxableAmount).padStart(8)}  vat=${String(a.vat ?? "n/a").padStart(7)}  total=${String(a.total).padStart(8)}${flag}`,
    );
  }
}

main();
