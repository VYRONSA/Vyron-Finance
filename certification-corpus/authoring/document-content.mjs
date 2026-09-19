/**
 * Phase 5O — what each certification document PRINTS.
 *
 * This file is one half of the corpus. It is the author's statement of what
 * appears on the page, and it drives rendering only.
 *
 * The other half — `certification-corpus/ground-truth/*.json` — is what a
 * reader records off the finished page, and it is typed INDEPENDENTLY.
 * Keeping the two apart is the whole point: if this file and the ground
 * truth were the same object, "the document agrees with the answer key"
 * would be true by construction and would prove nothing. Because they are
 * separate, `certification-corpus.test.ts` can compare them, and a typo in
 * either one is a test failure rather than a silent agreement.
 *
 * NOTHING HERE COMES FROM AN EXTRACTION. No provider, no prompt, no
 * schema, no `ExtractionResult`, no parser. The values are invented, and
 * every arithmetic figure below was worked out by hand — not by calling
 * Finance's `computeLineAmounts`, which is the implementation the corpus
 * exists to test against.
 *
 * ALL DATA IS SYNTHETIC. Every supplier, VAT number, registration number,
 * invoice number and amount is invented. No production tenant, customer or
 * supplier appears anywhere.
 */

/** The synthetic cast. Deliberately includes a near-twin pair, a
 * non-registered supplier and a foreign one. */
export const SUPPLIERS = {
  karoo: {
    name: "Karoo Wholesale Supplies",
    address: ["14 Voortrekker Road", "Beaufort West", "6970"],
    vatNumber: "4111222333",
    regNumber: "2015/445566/07",
    phone: "023 414 7788",
  },
  // The near-twin. Different legal entity, no VAT number printed, name
  // differs by one character group. This is what makes resolution
  // genuinely ambiguous rather than merely fuzzy.
  karooTwin: {
    name: "Karoo Wholesale Supply (Pty) Ltd",
    address: ["7 Donkin Street", "Beaufort West", "6970"],
    vatNumber: null,
    regNumber: null,
    phone: "023 414 2019",
  },
  loskop: {
    name: "Loskop Handyman Services",
    address: ["22 Marico Avenue", "Groblersdal", "0470"],
    vatNumber: null,
    regNumber: null,
    phone: "013 262 4411",
  },
  drakensberg: {
    name: "Drakensberg Cold Chain",
    address: ["Unit 9, Riverhorse Valley", "Durban", "4017"],
    vatNumber: "4990887766",
    regNumber: "2011/998877/07",
    phone: "031 569 3300",
  },
  umgeni: {
    name: "Umgeni Packaging Co",
    address: ["31 Sea Cow Lake Road", "Durban", "4051"],
    vatNumber: "4223344556",
    regNumber: "2008/112233/07",
    phone: "031 577 1290",
  },
  highveld: {
    name: "Highveld Fasteners",
    address: ["6 Chrome Street", "Witbank", "1035"],
    vatNumber: "4778899001",
    regNumber: "2013/667788/07",
    phone: "013 692 5510",
  },
  atlas: {
    name: "Atlas Software International Inc",
    address: ["1200 Harbor Boulevard", "Seattle, WA 98101", "United States"],
    vatNumber: null,
    regNumber: null,
    phone: "+1 206 555 0148",
  },
};

const BILL_TO = {
  // Invented. Deliberately NOT the name of any company in this system —
  // an earlier draft used a real production tenant's name here, which is
  // exactly the kind of thing that survives into a report and then into a
  // screenshot.
  name: "Riverbend Test Trading (Pty) Ltd",
  address: ["18 Pine Avenue", "Johannesburg", "2196"],
  vatNumber: "4555666777",
};

/**
 * `columns` names the table columns, left to right, exactly as printed.
 * A case that omits `vatRate`/`vatAmt` prints no VAT column at all — which
 * is a different document from one printing 0.00, and the corpus needs
 * both.
 */
const STANDARD_COLUMNS = ["desc", "sku", "qty", "uom", "unit", "vatRate", "vatAmt", "total"];

export const DOCUMENTS = [
  // -----------------------------------------------------------------
  // 1. clean-pdf — the baseline. Everything present, everything agrees.
  // -----------------------------------------------------------------
  {
    key: "clean-pdf",
    format: "pdf",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.karoo,
    billTo: BILL_TO,
    invoiceNumber: "KW-10041",
    invoiceDate: "11 June 2026",
    dueDate: "11 July 2026",
    orderReference: "PO-4471",
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Maize meal 10kg", sku: "MM10", qty: 10, uom: "bag", unit: 100.0, vatRate: 15, vatAmt: 150.0, total: 1000.0 },
    ],
    totals: { subtotal: 1000.0, vat: 150.0, total: 1150.0 },
    footer: "Payment within 30 days. Banking details on request.",
  },

  // -----------------------------------------------------------------
  // 2. multi-page — 14 lines, forced onto two pages.
  //    14 x R150.00 net = R2 100.00; VAT 14 x R22.50 = R315.00.
  // -----------------------------------------------------------------
  {
    key: "multi-page",
    format: "pdf",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.karoo,
    billTo: BILL_TO,
    invoiceNumber: "KW-10077",
    invoiceDate: "14 June 2026",
    dueDate: "14 July 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    pageBreakAfterLine: 7,
    lines: [
      "Cake flour 12.5kg", "White sugar 10kg", "Brown sugar 10kg", "Long grain rice 10kg",
      "Sunflower oil 2L", "Baked beans 410g", "Chopped tomatoes 410g", "Pilchards in tomato 400g",
      "Instant coffee 750g", "Rooibos tea 200 bags", "Full cream milk powder 1kg", "Peanut butter 800g",
      "Mixed fruit jam 900g", "Cream crackers 200g",
    ].map((desc, i) => ({
      desc,
      sku: `KW-${(200 + i).toString()}`,
      qty: 2,
      uom: "case",
      unit: 75.0,
      vatRate: 15,
      vatAmt: 22.5,
      total: 150.0,
    })),
    totals: { subtotal: 2100.0, vat: 315.0, total: 2415.0 },
    footer: "Payment within 30 days.",
  },

  // -----------------------------------------------------------------
  // 3. scan — rendered, then flattened to an image and wrapped in a PDF,
  //    so the file has NO text layer. This is what a scanner produces.
  //    6 x R240.00 = R1 440.00; VAT R216.00.
  // -----------------------------------------------------------------
  {
    key: "scan",
    format: "scanned-pdf",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.drakensberg,
    billTo: BILL_TO,
    invoiceNumber: "DC-4471",
    invoiceDate: "29 May 2026",
    dueDate: "28 June 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Cold storage pallet handling", sku: "CS-PAL", qty: 6, uom: "pallet", unit: 240.0, vatRate: 15, vatAmt: 216.0, total: 1440.0 },
    ],
    totals: { subtotal: 1440.0, vat: 216.0, total: 1656.0 },
    footer: "Cold chain integrity certificate available on request.",
  },

  // -----------------------------------------------------------------
  // 4. jpg — a photographed invoice. Also the rounding case:
  //    3 x R425.50 = R1 276.50; VAT at 15% = R191.475, printed R191.48.
  // -----------------------------------------------------------------
  {
    key: "jpg",
    format: "jpg",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.highveld,
    billTo: BILL_TO,
    invoiceNumber: "HF-2208",
    invoiceDate: "2 June 2026",
    dueDate: "2 July 2026",
    orderReference: "PO-4488",
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Hex bolt M12 x 80 (box of 100)", sku: "HB1280", qty: 3, uom: "box", unit: 425.5, vatRate: 15, vatAmt: 191.48, total: 1276.5 },
    ],
    totals: { subtotal: 1276.5, vat: 191.48, total: 1467.98 },
    footer: "Goods remain our property until paid in full.",
  },

  // -----------------------------------------------------------------
  // 5. png — a screenshot of an emailed invoice.
  //    250 x R12.40 = R3 100.00; VAT R465.00.
  // -----------------------------------------------------------------
  {
    key: "png",
    format: "png",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.umgeni,
    billTo: BILL_TO,
    invoiceNumber: "UP-9912",
    invoiceDate: "5 June 2026",
    dueDate: "5 July 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Corrugated carton 400x300x200", sku: "CC403020", qty: 250, uom: "each", unit: 12.4, vatRate: 15, vatAmt: 465.0, total: 3100.0 },
    ],
    totals: { subtotal: 3100.0, vat: 465.0, total: 3565.0 },
    footer: "E&OE",
  },

  // -----------------------------------------------------------------
  // 6. rotated — the same page, photographed askew. 8 x R189.00 =
  //    R1 512.00; VAT R226.80.
  // -----------------------------------------------------------------
  {
    key: "rotated",
    format: "png",
    rotateDegrees: 6.5,
    title: "TAX INVOICE",
    supplier: SUPPLIERS.karoo,
    billTo: BILL_TO,
    invoiceNumber: "KW-10102",
    invoiceDate: "18 June 2026",
    dueDate: "18 July 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Sunflower oil 5L", sku: "SO5", qty: 8, uom: "bottle", unit: 189.0, vatRate: 15, vatAmt: 226.8, total: 1512.0 },
    ],
    totals: { subtotal: 1512.0, vat: 226.8, total: 1738.8 },
    footer: "Payment within 30 days.",
  },

  // -----------------------------------------------------------------
  // 7. poor-quality — low resolution, heavy JPEG artefacts, faded.
  //    1 x R2 750.00; VAT R412.50.
  // -----------------------------------------------------------------
  {
    key: "poor-quality",
    format: "jpg",
    degrade: { scale: 0.55, quality: 28, fade: true },
    title: "TAX INVOICE",
    supplier: SUPPLIERS.drakensberg,
    billTo: BILL_TO,
    invoiceNumber: "DC-4503",
    invoiceDate: "9 June 2026",
    dueDate: "9 July 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Blast freezing service", sku: "BF-STD", qty: 1, uom: "service", unit: 2750.0, vatRate: 15, vatAmt: 412.5, total: 2750.0 },
    ],
    totals: { subtotal: 2750.0, vat: 412.5, total: 3162.5 },
    footer: "Thank you for your business.",
  },

  // -----------------------------------------------------------------
  // 8. small-text — 6pt body text.
  //    472.00 + 513.00 + 232.00 = R1 217.00; VAT R182.55.
  // -----------------------------------------------------------------
  {
    key: "small-text",
    format: "pdf",
    fontScale: 0.5,
    title: "TAX INVOICE",
    supplier: SUPPLIERS.karoo,
    billTo: BILL_TO,
    invoiceNumber: "KW-10133",
    invoiceDate: "22 June 2026",
    dueDate: "22 July 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Long grain rice 10kg", sku: "LR10", qty: 4, uom: "bag", unit: 118.0, vatRate: 15, vatAmt: 70.8, total: 472.0 },
      { desc: "White sugar 2.5kg", sku: "WS25", qty: 12, uom: "pack", unit: 42.75, vatRate: 15, vatAmt: 76.95, total: 513.0 },
      { desc: "Table salt 1kg", sku: "TS1", qty: 20, uom: "pack", unit: 11.6, vatRate: 15, vatAmt: 34.8, total: 232.0 },
    ],
    totals: { subtotal: 1217.0, vat: 182.55, total: 1399.55 },
    footer: "E&OE. Payment within 30 days of statement.",
  },

  // -----------------------------------------------------------------
  // 9. many-lines — 20 lines. Unit prices 50.00 rising by 5.00 to
  //    145.00, each qty 1, so the net is 20 x R97.50 = R1 950.00 and
  //    VAT is R292.50.
  // -----------------------------------------------------------------
  {
    key: "many-lines",
    format: "pdf",
    fontScale: 0.8,
    title: "TAX INVOICE",
    supplier: SUPPLIERS.umgeni,
    billTo: BILL_TO,
    invoiceNumber: "UP-10044",
    invoiceDate: "25 June 2026",
    dueDate: "25 July 2026",
    orderReference: "PO-4502",
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    pageBreakAfterLine: 12,
    lines: Array.from({ length: 20 }, (_, i) => {
      const unit = 50 + i * 5;
      return {
        desc: `Packaging component ${String(i + 1).padStart(2, "0")}`,
        sku: `UP-${(500 + i).toString()}`,
        qty: 1,
        uom: "each",
        unit,
        vatRate: 15,
        vatAmt: Math.round(unit * 15) / 100,
        total: unit,
      };
    }),
    totals: { subtotal: 1950.0, vat: 292.5, total: 2242.5 },
    footer: "E&OE",
  },

  // -----------------------------------------------------------------
  // 10. mixed-vat — one standard-rated line and one zero-rated line on
  //     the same invoice. Net R1 300.00, VAT R150.00 on the first line
  //     only.
  // -----------------------------------------------------------------
  {
    key: "mixed-vat",
    format: "pdf",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.karoo,
    billTo: BILL_TO,
    invoiceNumber: "KW-10150",
    invoiceDate: "26 June 2026",
    dueDate: "26 July 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Coffee beans 1kg", sku: "CB1", qty: 10, uom: "bag", unit: 100.0, vatRate: 15, vatAmt: 150.0, total: 1000.0 },
      { desc: "Brown bread 700g", sku: "BB700", qty: 60, uom: "loaf", unit: 5.0, vatRate: 0, vatAmt: 0.0, total: 300.0 },
    ],
    totals: { subtotal: 1300.0, vat: 150.0, total: 1450.0 },
    footer: "Zero-rated items marked 0%.",
  },

  // -----------------------------------------------------------------
  // 11. zero-vat — a VAT-REGISTERED supplier, everything zero-rated.
  //     The VAT column is present and prints 0.00 throughout. This is
  //     the case that must not be confused with no-vat below.
  // -----------------------------------------------------------------
  {
    key: "zero-vat",
    format: "pdf",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.karoo,
    billTo: BILL_TO,
    invoiceNumber: "KW-10166",
    invoiceDate: "29 June 2026",
    dueDate: "29 July 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Maize meal 10kg", sku: "MM10", qty: 1, uom: "bag", unit: 50.0, vatRate: 0, vatAmt: 0.0, total: 50.0 },
      { desc: "Brown bread 700g", sku: "BB700", qty: 1, uom: "loaf", unit: 60.0, vatRate: 0, vatAmt: 0.0, total: 60.0 },
      { desc: "Full cream milk 2L", sku: "FCM2", qty: 1, uom: "bottle", unit: 70.0, vatRate: 0, vatAmt: 0.0, total: 70.0 },
      { desc: "Eggs large 18s", sku: "EG18", qty: 1, uom: "tray", unit: 80.0, vatRate: 0, vatAmt: 0.0, total: 80.0 },
      { desc: "Long grain rice 2kg", sku: "LR2", qty: 1, uom: "bag", unit: 90.0, vatRate: 0, vatAmt: 0.0, total: 90.0 },
      { desc: "Brown lentils 1kg", sku: "BL1", qty: 1, uom: "pack", unit: 100.0, vatRate: 0, vatAmt: 0.0, total: 100.0 },
    ],
    totals: { subtotal: 450.0, vat: 0.0, total: 450.0 },
    footer: "All items zero-rated in terms of the VAT Act.",
  },

  // -----------------------------------------------------------------
  // 12. no-vat — a supplier who is NOT VAT-registered. No VAT number,
  //     no VAT column, no VAT total, and the heading is "INVOICE" not
  //     "TAX INVOICE" — which is the legally correct heading for a
  //     non-vendor and the strongest visible signal of the difference.
  // -----------------------------------------------------------------
  {
    key: "no-vat",
    format: "pdf",
    title: "INVOICE",
    supplier: SUPPLIERS.loskop,
    billTo: BILL_TO,
    invoiceNumber: "LH-0431",
    invoiceDate: "15 June 2026",
    dueDate: null,
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: ["desc", "qty", "unit", "total"],
    lines: [
      { desc: "Repairs to loading bay door", qty: 1, unit: 750.0, total: 750.0 },
    ],
    totals: { total: 750.0 },
    footer: "Not registered for VAT.",
  },

  // -----------------------------------------------------------------
  // 13. discount — a trade discount printed as its own column. VAT is
  //     charged on what remains: R1 000.00 less R100.00 = R900.00 net,
  //     VAT R135.00.
  // -----------------------------------------------------------------
  {
    key: "discount",
    format: "pdf",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.karoo,
    billTo: BILL_TO,
    invoiceNumber: "KW-10188",
    invoiceDate: "1 July 2026",
    dueDate: "31 July 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: ["desc", "sku", "qty", "uom", "unit", "disc", "vatRate", "vatAmt", "total"],
    lines: [
      { desc: "Maize meal 10kg", sku: "MM10", qty: 10, uom: "bag", unit: 100.0, disc: 100.0, vatRate: 15, vatAmt: 135.0, total: 900.0 },
    ],
    totals: { subtotal: 900.0, discount: 100.0, vat: 135.0, total: 1035.0 },
    footer: "Trade discount applied before VAT.",
  },

  // -----------------------------------------------------------------
  // 14. uom-pack — priced by the case, with the pack size printed in
  //     the description. 5 cases x R180.00 = R900.00; VAT R135.00.
  //     Nothing on this page states a per-bottle price, and nothing may
  //     invent one.
  // -----------------------------------------------------------------
  {
    key: "uom-pack",
    format: "pdf",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.umgeni,
    billTo: BILL_TO,
    invoiceNumber: "UP-10101",
    invoiceDate: "2 July 2026",
    dueDate: "1 August 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: ["desc", "sku", "qty", "uom", "unit", "vatRate", "vatAmt", "total"],
    lines: [
      { desc: "Bottled still water 500ml (12 x 500ml)", sku: "BW500-12", qty: 5, uom: "case", unit: 180.0, vatRate: 15, vatAmt: 135.0, total: 900.0 },
    ],
    totals: { subtotal: 900.0, vat: 135.0, total: 1035.0 },
    footer: "Priced per case.",
  },

  // -----------------------------------------------------------------
  // 15. ambiguous-supplier — the near-twin, with NO VAT number and NO
  //     registration number printed, so there is nothing deterministic
  //     to match on and the name alone fits two suppliers on file.
  // -----------------------------------------------------------------
  {
    key: "ambiguous-supplier",
    format: "pdf",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.karooTwin,
    billTo: BILL_TO,
    invoiceNumber: "KWS-3310",
    invoiceDate: "3 July 2026",
    dueDate: "2 August 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Dry goods assortment", sku: "DGA", qty: 1, uom: "pallet", unit: 640.0, vatRate: 15, vatAmt: 96.0, total: 640.0 },
    ],
    totals: { subtotal: 640.0, vat: 96.0, total: 736.0 },
    footer: "E&OE",
  },

  // -----------------------------------------------------------------
  // 16. duplicate — the SAME invoice as clean-pdf: same supplier, same
  //     number, same date, same total. Re-issued as a copy, so the file
  //     differs while the invoice identity does not. That is the layer
  //     worth certifying: a file-hash match is trivial, a same-invoice
  //     match is the one that catches a re-sent statement.
  // -----------------------------------------------------------------
  {
    key: "duplicate",
    format: "pdf",
    watermark: "COPY",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.karoo,
    billTo: BILL_TO,
    invoiceNumber: "KW-10041",
    invoiceDate: "11 June 2026",
    dueDate: "11 July 2026",
    orderReference: "PO-4471",
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Maize meal 10kg", sku: "MM10", qty: 10, uom: "bag", unit: 100.0, vatRate: 15, vatAmt: 150.0, total: 1000.0 },
    ],
    totals: { subtotal: 1000.0, vat: 150.0, total: 1150.0 },
    footer: "Duplicate copy. Payment within 30 days.",
  },

  // -----------------------------------------------------------------
  // 17. repeated-invoice-number — a DIFFERENT supplier whose own
  //     numbering happens to produce "KW-10041". Not a duplicate: two
  //     suppliers may use the same string and frequently do.
  //     500 x R1.15 = R575.00; VAT R86.25.
  // -----------------------------------------------------------------
  {
    key: "repeated-invoice-number",
    format: "pdf",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.highveld,
    billTo: BILL_TO,
    invoiceNumber: "KW-10041",
    invoiceDate: "4 July 2026",
    dueDate: "3 August 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Washer M12 galvanised", sku: "WM12G", qty: 500, uom: "each", unit: 1.15, vatRate: 15, vatAmt: 86.25, total: 575.0 },
    ],
    totals: { subtotal: 575.0, vat: 86.25, total: 661.25 },
    footer: "Goods remain our property until paid in full.",
  },

  // -----------------------------------------------------------------
  // 18. missing-vat-number — headed TAX INVOICE, from a supplier who IS
  //     registered, but the VAT number is not printed. That makes it a
  //     genuinely MISSING particular (and a defective tax invoice),
  //     not a correctly-absent one.
  // -----------------------------------------------------------------
  {
    key: "missing-vat-number",
    format: "pdf",
    omitSupplierVatNumber: true,
    title: "TAX INVOICE",
    supplier: SUPPLIERS.drakensberg,
    billTo: BILL_TO,
    invoiceNumber: "DC-4570",
    invoiceDate: "6 July 2026",
    dueDate: "5 August 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Refrigerated transport Durban to Gauteng", sku: "RT-DBN-JHB", qty: 1, uom: "trip", unit: 4300.0, vatRate: 15, vatAmt: 645.0, total: 4300.0 },
    ],
    totals: { subtotal: 4300.0, vat: 645.0, total: 4945.0 },
    footer: "Thank you for your business.",
  },

  // -----------------------------------------------------------------
  // 19. missing-invoice-number — no serial number anywhere on the page.
  //     3 x R640.00 = R1 920.00; VAT R288.00.
  // -----------------------------------------------------------------
  {
    key: "missing-invoice-number",
    format: "pdf",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.karoo,
    billTo: BILL_TO,
    invoiceNumber: null,
    invoiceDate: "7 July 2026",
    dueDate: "6 August 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Cooking oil 20L", sku: "CO20", qty: 3, uom: "drum", unit: 640.0, vatRate: 15, vatAmt: 288.0, total: 1920.0 },
    ],
    totals: { subtotal: 1920.0, vat: 288.0, total: 2208.0 },
    footer: "E&OE",
  },

  // -----------------------------------------------------------------
  // 20. arithmetic-mismatch — the document is WRONG and stays wrong.
  //     It prints VAT of R165.00 on a net of R1 000.00, where 15% is
  //     R150.00, and a total of R1 165.00. The corpus records both what
  //     is printed and what the arithmetic should be. Nothing here
  //     corrects it: silently fixing a supplier's invoice is how a
  //     wrong figure enters a ledger looking correct.
  // -----------------------------------------------------------------
  {
    key: "arithmetic-mismatch",
    format: "pdf",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.karoo,
    billTo: BILL_TO,
    invoiceNumber: "KW-10222",
    invoiceDate: "8 July 2026",
    dueDate: "7 August 2026",
    orderReference: null,
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Maize meal 10kg", sku: "MM10", qty: 10, uom: "bag", unit: 100.0, vatRate: 15, vatAmt: 165.0, total: 1000.0 },
    ],
    totals: { subtotal: 1000.0, vat: 165.0, total: 1165.0 },
    footer: "E&OE",
  },

  // -----------------------------------------------------------------
  // 21. credit-note — visibly a CREDIT NOTE, referencing the invoice it
  //     credits. 5 x R100.00 = R500.00; VAT R75.00.
  // -----------------------------------------------------------------
  {
    key: "credit-note",
    format: "pdf",
    title: "CREDIT NOTE",
    supplier: SUPPLIERS.karoo,
    billTo: BILL_TO,
    invoiceNumber: "KW-CN-0007",
    invoiceDate: "9 July 2026",
    dueDate: null,
    orderReference: null,
    referenceLabel: "Credit against invoice",
    referenceValue: "KW-10041",
    reason: "Goods returned — damaged in transit",
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Returned stock — maize meal 10kg", sku: "MM10", qty: 5, uom: "bag", unit: 100.0, vatRate: 15, vatAmt: 75.0, total: 500.0 },
    ],
    totals: { subtotal: 500.0, vat: 75.0, total: 575.0 },
    footer: "This credit note reduces the amount owing.",
  },

  // -----------------------------------------------------------------
  // 22. debit-note — visibly a DEBIT NOTE. 1 x R200.00; VAT R30.00.
  // -----------------------------------------------------------------
  {
    key: "debit-note",
    format: "pdf",
    title: "DEBIT NOTE",
    supplier: SUPPLIERS.karoo,
    billTo: BILL_TO,
    invoiceNumber: "KW-DN-0002",
    invoiceDate: "10 July 2026",
    dueDate: null,
    orderReference: null,
    referenceLabel: "Debit against invoice",
    referenceValue: "KW-10041",
    reason: "Undercharge on original invoice",
    currency: { code: "ZAR", symbol: "R" },
    columns: STANDARD_COLUMNS,
    lines: [
      { desc: "Undercharge correction — maize meal 10kg", sku: "MM10", qty: 1, uom: "bag", unit: 200.0, vatRate: 15, vatAmt: 30.0, total: 200.0 },
    ],
    totals: { subtotal: 200.0, vat: 30.0, total: 230.0 },
    footer: "This debit note increases the amount owing.",
  },

  // -----------------------------------------------------------------
  // 23. foreign-currency — a USD invoice from a foreign supplier. No
  //     South African VAT arises. The currency is printed explicitly
  //     and repeatedly, so "is this foreign?" is visible rather than
  //     inferred.
  // -----------------------------------------------------------------
  {
    key: "foreign-currency",
    format: "pdf",
    title: "INVOICE",
    supplier: SUPPLIERS.atlas,
    billTo: BILL_TO,
    invoiceNumber: "ASI-77214",
    invoiceDate: "13 July 2026",
    dueDate: "12 August 2026",
    orderReference: null,
    currency: { code: "USD", symbol: "$" },
    columns: ["desc", "sku", "qty", "uom", "unit", "total"],
    lines: [
      { desc: "Annual software subscription — 25 seats", sku: "ASI-SUB-25", qty: 1, uom: "licence", unit: 1200.0, total: 1200.0 },
    ],
    totals: { subtotal: 1200.0, total: 1200.0 },
    footer: "All amounts in United States Dollars (USD). No VAT applicable.",
  },

  // -----------------------------------------------------------------
  // 24. weight-column — the additional realistic baseline, and the
  //     exact failure VYRON COST measured in production: a numeric
  //     column that is NOT money, printed between UNIT PRICE and VAT.
  //     R1 930.00 + R1 648.00 = R3 578.00 net; VAT R536.70.
  //     The weights (5.33, 47.10) are kilograms and must never appear
  //     as a price, a VAT amount or a line total.
  // -----------------------------------------------------------------
  {
    key: "weight-column",
    format: "pdf",
    title: "TAX INVOICE",
    supplier: SUPPLIERS.highveld,
    billTo: BILL_TO,
    invoiceNumber: "HF-2260",
    invoiceDate: "14 July 2026",
    dueDate: "13 August 2026",
    orderReference: "PO-4530",
    currency: { code: "ZAR", symbol: "R" },
    columns: ["desc", "sku", "qty", "uom", "unit", "weight", "vatRate", "vatAmt", "total"],
    lines: [
      { desc: "Steel bar 12mm x 6m", sku: "SB126", qty: 20, uom: "each", unit: 96.5, weight: 5.33, vatRate: 15, vatAmt: 289.5, total: 1930.0 },
      { desc: "Steel plate 3mm 1m x 2m", sku: "SP312", qty: 4, uom: "sheet", unit: 412.0, weight: 47.1, vatRate: 15, vatAmt: 247.2, total: 1648.0 },
    ],
    totals: { subtotal: 3578.0, vat: 536.7, total: 4114.7 },
    footer: "Mass shown per unit in kilograms. E&OE",
  },
];
