/**
 * SD-3C — what each supplier-statement certification document PRINTS.
 *
 * One half of the statement corpus: the author's statement of what appears
 * on each page, used for rendering only. The other half —
 * `statement-corpus/ground-truth/*.json` — is what a person reads off the
 * finished page, typed INDEPENDENTLY, including every expected line, every
 * value expected to be UNREADABLE, and the validation verdict. Keeping the
 * two apart is the point: the reader is tested against an answer key that
 * did not come from this file or from the reader.
 *
 * Every figure was worked out by hand. ALL DATA IS SYNTHETIC: every
 * supplier, customer, account number, VAT number and amount is invented.
 *
 * Coverage (owner list, SD-3A §16 / SD-3C): several supplier layouts; text
 * PDFs; multi-page with repeated headings and with a heading-less
 * continuation page; tables spanning pages; wrapped descriptions; brought/
 * carried forward; page totals and sub-totals; leading-zero references;
 * spaces, decimal commas and points; parentheses, CR, DR and trailing
 * minus; ambiguous and unreadable values; running, opening and closing
 * balances; a repeated line; arithmetic errors; a reversed debit/credit
 * convention; an encrypted PDF; a scanned PDF, JPEG and PNG; CSV and XLSX.
 * SD-3G adds a monthly, newest-first layout with negative credits (see the
 * "monthly-negative-credits" entry).
 */

const KAROO = {
  name: "Karoo Building Supplies (Pty) Ltd",
  address: ["14 Voortrekker Road", "Beaufort West", "6970"],
  ids: ["VAT No: 4123456789", "Reg No: 2011/123456/07"],
};

const CUSTOMER = ["Riverbend Trading (Pty) Ltd", "PO Box 2210", "Oudtshoorn 6620"];

const STANDARD_COLUMNS = [
  { label: "Date", align: "left" },
  { label: "Reference", align: "left" },
  { label: "Description", align: "left" },
  { label: "Debit", align: "right" },
  { label: "Credit", align: "right" },
  { label: "Balance", align: "right" },
];

/** Each document: letterhead, customer block (with label lines), optional
 * summary lines, then pages of table rows. A row is the printed text of
 * each column ("" for an empty cell). `heading: false` on a page prints no
 * column headings there (a continuation page). */
export const STATEMENTS = [
  {
    key: "karoo-point",
    format: "pdf",
    supplier: KAROO,
    customer: CUSTOMER,
    labels: ["Account No: 000123", "Statement Date: 30/09/2026", "Period: 01/09/2026 to 30/09/2026"],
    columns: STANDARD_COLUMNS,
    pages: [
      {
        heading: true,
        rows: [
          ["01/09/2026", "", "Balance brought forward", "", "", "1 500.00"],
          ["03/09/2026", "0001042", "Tax Invoice", "2 300.00", "", "3 800.00"],
          ["10/09/2026", "0001057", "Tax Invoice", "845.50", "", "4 645.50"],
          ["15/09/2026", "PMT 2026-09", "Payment received - thank you", "", "1 500.00", "3 145.50"],
          ["18/09/2026", "CN000311", "Credit Note - damaged goods", "", "120.00", "3 025.50"],
          ["25/09/2026", "0001093", "Tax Invoice", "1 234.56", "", "4 260.06"],
          ["Totals", "", "", "4 380.06", "1 620.00", ""],
          ["", "", "Balance due", "", "", "4 260.06"],
        ],
      },
    ],
    ageing: [["Current", "1 234.56"], ["30 Days", "3 025.50"], ["60 Days", "0.00"], ["90 Days", "0.00"], ["120+ Days", "0.00"]],
  },
  {
    key: "highveld-comma-crdr",
    format: "pdf",
    supplier: { name: "Highveld Packaging CC", address: ["Unit 7, Alrode South", "Alberton", "1451"], ids: ["VAT Number: 4987654321"] },
    customer: CUSTOMER,
    labels: ["Customer Code: CUST-0042", "As at: 30 Sep 2026", "Opening balance: 2 000,00", "Closing balance: 5 210,55"],
    columns: [
      { label: "Date", align: "left" },
      { label: "Type", align: "left" },
      { label: "Doc No", align: "left" },
      { label: "Details", align: "left" },
      { label: "Amount", align: "right" },
      { label: "Balance", align: "right" },
    ],
    pages: [
      {
        heading: true,
        rows: [
          ["05 Sep 2026", "INV", "IN0045821", "Corrugated boxes", "4 500,00", "6 500,00 DR"],
          ["12 Sep 2026", "PMT", "EFT0912", "Payment - thank you", "2 000,00 CR", "4 500,00 DR"],
          ["19 Sep 2026", "CN", "CN0007", "Short delivery", "289,45 CR", "4 210,55 DR"],
          ["26 Sep 2026", "INV", "IN0045903", "Tape and film", "1 000,00", "5 210,55 DR"],
        ],
      },
    ],
  },
  {
    key: "multipage-repeated",
    format: "pdf",
    supplier: { name: "Overberg Builders Merchants", address: ["3 Industria Street", "Caledon", "7230"], ids: ["VAT No: 4555666777"] },
    customer: CUSTOMER,
    labels: ["Account No: 004417", "Statement Date: 31/08/2026", "Period: 01/08/2026 to 31/08/2026"],
    columns: STANDARD_COLUMNS,
    pages: [
      {
        heading: true,
        rows: [
          ["01/08/2026", "", "Balance brought forward", "", "", "10,000.00"],
          ["02/08/2026", "00004501", "Invoice - cement 50kg", "1,250.00", "", "11,250.00"],
          ["", "", "delivered to site 4", "", "", ""],
          ["05/08/2026", "00004533", "Invoice - steel mesh", "3,400.00", "", "14,650.00"],
          ["09/08/2026", "RCPT-881", "Payment received", "", "10,000.00", "4,650.00"],
          ["12/08/2026", "00004560", "Invoice - bricks", "2,100.00", "", "6,750.00"],
          ["", "", "Page total", "6,750.00", "10,000.00", ""],
          ["", "", "Balance carried forward", "", "", "6,750.00"],
        ],
      },
      {
        heading: true,
        rows: [
          ["", "", "Balance brought forward", "", "", "6,750.00"],
          ["15/08/2026", "00004588", "Invoice - timber", "980.00", "", "7,730.00"],
          ["18/08/2026", "CRN-0091", "Credit note - returned timber", "", "245.00", "7,485.00"],
          ["22/08/2026", "00004601", "Invoice - roof sheeting", "5,600.00", "", "13,085.00"],
          ["", "", "0.5mm Z275, 6m lengths", "", "", ""],
          ["25/08/2026", "00004622", "Invoice - fasteners", "312.40", "", "13,397.40"],
          ["", "", "Sub-total", "6,892.40", "245.00", ""],
          ["", "", "Balance carried forward", "", "", "13,397.40"],
        ],
      },
      {
        heading: true,
        rows: [
          ["", "", "Balance brought forward", "", "", "13,397.40"],
          ["28/08/2026", "RCPT-902", "Payment received", "", "6,750.00", "6,647.40"],
          ["31/08/2026", "00004650", "Invoice - paint", "1,105.15", "", "7,752.55"],
          ["Totals", "", "", "14,747.55", "16,995.00", ""],
          ["", "", "Closing balance", "", "", "7,752.55"],
        ],
      },
    ],
  },
  {
    key: "multipage-continuation",
    format: "pdf",
    supplier: { name: "Lowveld Electrical Wholesalers", address: ["88 Brown Street", "Mbombela", "1200"], ids: ["VAT No: 4222333444"] },
    customer: CUSTOMER,
    labels: ["Account Number: 7788-001", "Statement Date: 31-08-26"],
    columns: [
      { label: "Date", align: "left" },
      { label: "Invoice No", align: "left" },
      { label: "Description", align: "left" },
      { label: "Amount", align: "right" },
    ],
    pages: [
      {
        heading: true,
        rows: [
          ["", "", "Opening balance", "0.00"],
          ["03-08-26", "0000981", "Cable 2.5mm 100m", "2,150.00"],
          ["07-08-26", "0000994", "DB board 12-way", "865.00"],
          ["11-08-26", "PAY-0811", "Payment", "(2,150.00)"],
          ["14-08-26", "0001011", "LED panels x20", "4,320.00"],
        ],
      },
      {
        heading: false,
        pageNote: "Lowveld Electrical Wholesalers - continued",
        rows: [
          ["19-08-26", "CN-0042", "Credit - faulty panel", "216.00-"],
          ["24-08-26", "0001037", "Conduit 20mm", "512.75"],
          ["", "", "Closing balance", "5,481.75"],
        ],
      },
    ],
  },
  {
    key: "ambiguous-unreadable",
    format: "pdf",
    supplier: { name: "Boland Fresh Produce", address: ["Farm 112", "Paarl", "7646"], ids: ["VAT No: 4333444555"] },
    customer: CUSTOMER,
    labels: ["Account No: 000555", "Statement Date: 30/09/2026"],
    columns: [
      { label: "Date", align: "left" },
      { label: "Ref", align: "left" },
      { label: "Details", align: "left" },
      { label: "Debit", align: "right" },
      { label: "Credit", align: "right" },
      { label: "Balance", align: "right" },
    ],
    pages: [
      {
        heading: true,
        rows: [
          ["01/09/2026", "", "Balance brought forward", "", "", "0"],
          ["04/09/2026", "0101", "Produce", "1,234", "", "1,234"],
          ["31/02/2026", "0102", "Produce", "750", "", "1,984"],
          ["15/09/2026", "0103", "Produce", "12 34", "", ""],
          ["20/09/2026", "P-77", "Payment", "", "984", ""],
          ["", "", "Balance due", "", "", "1,000"],
        ],
      },
    ],
  },
  {
    key: "repeated-line",
    format: "pdf",
    supplier: { name: "Garden Route Timber", address: ["9 Sawmill Road", "George", "6530"], ids: ["VAT No: 4666777888"] },
    customer: CUSTOMER,
    labels: ["Account No: 000870-R", "Statement Date: 30/09/2026"],
    columns: STANDARD_COLUMNS,
    pages: [
      {
        heading: true,
        rows: [
          ["01/09/2026", "", "Balance brought forward", "", "", "500.00"],
          ["02/09/2026", "000870", "Invoice", "600.00", "", "1 100.00"],
          ["02/09/2026", "000870", "Invoice", "600.00", "", "1 700.00"],
          ["10/09/2026", "EFT 4411", "Payment", "", "500.00", "1 200.00"],
          ["", "", "Closing balance", "", "", "1 200.00"],
        ],
      },
    ],
  },
  {
    key: "arithmetic-errors",
    format: "pdf",
    supplier: { name: "Cape Flats Hardware", address: ["21 Klipfontein Road", "Athlone", "7764"], ids: ["VAT No: 4777888999"] },
    customer: CUSTOMER,
    labels: ["Account No: 0000311", "Statement Date: 30/09/2026"],
    columns: STANDARD_COLUMNS,
    pages: [
      {
        heading: true,
        rows: [
          ["01/09/2026", "", "Balance brought forward", "", "", "2 000.00"],
          ["03/09/2026", "0000311", "Invoice", "450.00", "", "2 450.00"],
          ["08/09/2026", "0000319", "Invoice", "1 200.00", "", "3 650.00"],
          ["12/09/2026", "RC 120", "Payment", "", "2 000.00", "1 560.00"],
          ["20/09/2026", "0000340", "Invoice", "300.00", "", "1 860.00"],
          ["Totals", "", "", "1 950.00", "2 000.00", ""],
          ["", "", "Balance due", "", "", "1 860.00"],
        ],
      },
    ],
    ageing: [["Current", "1 860.00"], ["30 Days", "0.00"], ["60 Days", "0.00"], ["90 Days", "0.00"]],
  },
  {
    key: "reverse-convention",
    format: "pdf",
    supplier: { name: "Mpumalanga Agri Supplies", address: ["5 Silo Road", "Ermelo", "2350"], ids: ["VAT No: 4888999000"] },
    customer: CUSTOMER,
    labels: ["Account No: MAS-0201", "Statement Date: 30/09/2026"],
    columns: STANDARD_COLUMNS,
    pages: [
      {
        heading: true,
        rows: [
          ["01/09/2026", "", "Opening balance", "", "", "1 000.00"],
          ["05/09/2026", "INV 5501", "Invoice", "", "2 000.00", "3 000.00"],
          ["15/09/2026", "PAY 0915", "Payment", "1 000.00", "", "2 000.00"],
          ["", "", "Closing balance", "", "", "2 000.00"],
        ],
      },
    ],
  },
  {
    key: "layout-variation",
    format: "pdf",
    supplier: { name: "Eastern Cape Logistics (Pty) Ltd", address: ["Harbour Arterial", "Gqeberha", "6001"], ids: ["VAT Reg No: 4999000111", "Company Reg No: 2008/765432/07"] },
    customer: CUSTOMER,
    labels: ["Debtor Code: ECL/0091", "Date of statement: 30.09.2026"],
    columns: [
      { label: "Doc No", align: "left" },
      { label: "Date", align: "left" },
      { label: "Particulars", align: "left" },
      { label: "Charges", align: "right" },
      { label: "Payments", align: "right" },
      { label: "Balance", align: "right" },
    ],
    pages: [
      {
        heading: true,
        rows: [
          ["", "01.09.2026", "Balance B/F", "", "", "R 3 300.00"],
          ["TI-7781", "04.09.2026", "Freight JHB-PE", "R 1 850.00", "", "R 5 150.00"],
          ["TI-7790", "11.09.2026", "Freight PE-EL", "R 920.00", "", "R 6 070.00"],
          ["RC-3301", "18.09.2026", "Receipt", "", "R 3 300.00", "R 2 770.00"],
          ["", "", "Amount payable", "", "", "R 2 770.00"],
        ],
      },
    ],
    ageing: [["Current", "R 2 770.00"], ["30 Days", "R 100.00"], ["60 Days", "R 0.00"], ["90 Days", "R 0.00"]],
  },
  // SD-3G — the layout of a real supplier statement met in production UAT,
  // rebuilt with INVENTED data: a large telephone line above a small business
  // name; a bare "Date:" label; rows printed NEWEST FIRST and grouped by month
  // with "Total: <Month YYYY>" subtotals; credits printed with a minus sign in
  // the Credit column ("-R 2 000,00"); two identical payment rows; references
  // zero-padded to 15 digits; no type column; no opening balance; an ageing
  // block (90+ Days … Total Due, Overdue) with its values BENEATH the headings,
  // on the first page and again on the last.
  {
    key: "monthly-negative-credits",
    format: "pdf",
    letterhead: [
      { text: "T 021 555 0199", px: 22, bold: true },
      { text: "Cape Harbour Fine Foods (Pty) Ltd", px: 11, bold: true },
      { text: "Unit 4, Harbour Park, Paarden Eiland, 7405", px: 9 },
      { text: "VAT No: 4555012345", px: 9 },
      { text: "Reg No: 2014/555123/07", px: 9 },
    ],
    supplier: { name: "", address: [], ids: [] },
    customer: ["Riverbend Trading (Pty) Ltd", "PO Box 2210", "Oudtshoorn 6620"],
    labels: ["Account No: 40-1234-5678", "Date: 06/10/2026"],
    ageingTop: true,
    columns: [
      { label: "Date", align: "left" },
      { label: "Invoice", align: "left" },
      { label: "Our Reference", align: "left" },
      { label: "Delivery Note", align: "left" },
      { label: "Debit", align: "right" },
      { label: "Credit", align: "right" },
      { label: "Balance", align: "right" },
    ],
    pages: [
      {
        heading: true,
        rows: [
          ["06/10/2026", "000000002293957", "PO-100107", "000000010200007", "R 12 669,26", "", "R 23 251,95"],
          ["03/10/2026", "000000002251125", "PO-100106", "000000010200006", "R 811,34", "", "R 10 582,69"],
          ["01/10/2026", "000000002252003", "Payment", "", "", "-R 2 000,00", "R 9 771,35"],
          ["01/10/2026", "000000002252003", "Payment", "", "", "-R 2 000,00", "R 11 771,35"],
          ["Total:", "October 2026", "", "", "R 13 480,60", "-R 4 000,00", "R 9 480,60"],
          ["28/09/2026", "000000002248992", "PO-100105", "000000010200005", "R 10 771,35", "", "R 13 771,35"],
          ["22/09/2026", "000000002247200", "Credit Note - short delivery", "000000010200010", "", "-R 239,55", "R 3 000,00"],
          ["15/09/2026", "000000002247107", "PO-100104", "000000010200004", "R 1 239,55", "", "R 3 239,55"],
          ["09/09/2026", "000000002252002", "Payment", "", "", "-R 1 100,50", "R 2 000,00"],
          ["02/09/2026", "000000002252001", "Payment", "", "", "-R 4 250,00", "R 3 100,50"],
          ["Total:", "September 2026", "", "", "R 12 010,90", "-R 5 590,05", "R 6 420,85"],
        ],
      },
      {
        heading: true,
        rows: [
          ["20/08/2026", "000000002201003", "PO-100103", "000000010200003", "R 2 000,00", "", "R 7 350,50"],
          ["12/08/2026", "000000002201002", "PO-100102", "000000010200002", "R 1 100,50", "", "R 5 350,50"],
          ["05/08/2026", "000000002201001", "PO-100101", "000000010200001", "R 4 250,00", "", "R 4 250,00"],
          ["Total:", "August 2026", "", "", "R 7 350,50", "R 0,00", "R 7 350,50"],
        ],
      },
    ],
    ageing: [["90+ Days", "R 0,00"], ["60 Days", "R 0,00"], ["30 Days", "R 9 771,35"], ["Current", "R 13 480,60"], ["Total Due", "23 251,95"], ["Overdue", "R 9 771,35"]],
    footer: "We look forward to your timeous payment as per your agreed terms.",
  },
  // SD-3G (real-PDF diagnosis) — the STRUCTURE of the real supplier statement
  // met in production UAT, reproduced item by item at the real PDF's own
  // positions (points from the top-left), with INVENTED data:
  //   - the letterhead name is a LOGO (an image, no text); the centred text is
  //     only telephone, fax, e-mail, web, a licence number and an address;
  //   - "STATEMENT", "V.A.T. REG. No. …", and a Date | Page box whose values
  //     sit BELOW the labels;
  //   - the customer (bill-to) on the left; the supplier's BANK details on the
  //     right, headed by the payee name, with the supplier's bank account;
  //   - "Overdue: …" and an ageing block (90+ days … Total Due) with values on
  //     the row beneath, on page 1 and again at the end;
  //   - Date | Invoice | Description | Our Reference | Debit | Credit | Balance
  //     on every page; newest first; 15-digit zero-padded invoice numbers;
  //   - a SIGNED Credit column: allocations "-R …", a lump receipt "_CR…"
  //     printed WITHOUT a minus, "Unapplied cash R 0,00", "IMMEDIATE TRF CR";
  //   - monthly "Total: <Month YYYY>" rows with signed credit totals;
  //   - no brought-forward balance; the lines add up to the Total Due from 0;
  //   - a Balance column accumulated down the page (not in date order).
  remittanceStatement(),
  // Scans: the karoo-point statement, flattened to an image (no text layer).
  { key: "scanned", format: "scanned-pdf", from: "karoo-point" },
  { key: "scan-jpg", format: "jpg", from: "karoo-point" },
  { key: "scan-png", format: "png", from: "highveld-comma-crdr" },
  // A password-protected PDF (built directly; Chrome cannot encrypt).
  { key: "encrypted", format: "encrypted-pdf" },
  // Secondary formats: the same kind of statement as a spreadsheet.
  {
    key: "csv-semicolon",
    format: "csv",
    grid: [
      ["Supplier", "Northern Cape Steel"],
      ["Account No", "000999"],
      ["Statement Date", "30/09/2026"],
      [],
      ["Date", "Reference", "Description", "Debit", "Credit", "Balance"],
      ["01/09/2026", "", "Balance brought forward", "", "", "1 000,00"],
      ["03/09/2026", "0007001", "Invoice", "2 500,00", "", "3 500,00"],
      ["14/09/2026", "EFT-14", "Payment", "", "1 000,00", "2 500,00"],
      ["", "", "Closing balance", "", "", "2 500,00"],
    ],
  },
  {
    key: "xlsx-typed",
    format: "xlsx",
    // Typed cells: numbers are numbers, dates are dates, in the workbook.
    grid: [
      ["Supplier", "Northern Cape Steel"],
      ["Account No", "000999"],
      ["Statement Date", { date: "2026-09-30" }],
      [],
      ["Date", "Reference", "Description", "Debit", "Credit", "Balance"],
      [{ date: "2026-09-01" }, "", "Balance brought forward", "", "", 1000],
      [{ date: "2026-09-03" }, "0007001", "Invoice", 2500, "", 3500],
      [{ date: "2026-09-14" }, "EFT-14", "Payment", "", 1000, 2500],
      ["", "", "Closing balance", "", "", 2500],
    ],
  },
];

/** SD-3G — builds the positioned items of the "remittance-structure" document
 * (see its entry in STATEMENTS). Every figure is invented and worked by hand:
 * debits 6 500,75; signed credits −1 000,00; Total Due 5 500,75. */
function remittanceStatement() {
  const p1 = [];
  const p2 = [];
  const t = (items, x, top, text, size = 9, extra = {}) => items.push({ x, top, text, size, ...extra });
  const r = (items, right, top, text, size = 9, extra = {}) => items.push({ right, top, text, size, ...extra });
  // Letterhead (text only beside the logo).
  t(p1, 262, 32, "T 021 555 0100", 10); t(p1, 262, 42, "F 021 555 0101", 10);
  t(p1, 232, 52, "E accounts@atlanticgourmet.example", 10); t(p1, 235, 62, "W www.atlanticgourmet.example", 10);
  t(p1, 240, 82, "Liquor Licence No: 99999", 10);
  t(p1, 264, 102, "SUITE No. 12", 10); t(p1, 256, 112, "PRIVATE BAG X99", 10); t(p1, 261, 122, "SEAPOINT 8005", 10);
  t(p1, 438, 36, "STATEMENT", 14, { bold: true }); t(p1, 415, 46, "V.A.T. REG. No. 4999888777", 10);
  t(p1, 421, 80, "Date", 10, { bold: true }); t(p1, 519, 80, "Page", 10, { bold: true });
  t(p1, 407, 94, "06/10/2026", 10); t(p1, 518, 94, "1 of 1", 10);
  // Customer (left) and the supplier's bank details (right).
  t(p1, 22, 158, "Riverbend Trading (Pty) Ltd", 9, { bold: true }); t(p1, 22, 223, "TERMS: 30", 9, { bold: true });
  t(p1, 389, 158, "Atlantic Gourmet Foods", 9, { bold: true }); t(p1, 389, 171, "Example Bank", 9);
  t(p1, 389, 197, "Business Banking", 9); t(p1, 389, 210, "Account Number: 40-0000-1234", 9); t(p1, 389, 223, "Branch Code: 600000", 9);
  t(p1, 389, 249, "Overdue: R 2 000,75", 9, { bold: true });
  const ageing = (items, top) => {
    t(items, 52, top, "90+ days", 9, { bold: true }); t(items, 168, top, "60 days", 9, { bold: true }); t(items, 283, top, "30 Day", 9, { bold: true });
    t(items, 394, top, "Current", 9, { bold: true }); t(items, 537, top, "Total Due", 9, { bold: true });
    t(items, 58, top + 13, "R 0,00"); t(items, 160, top + 13, "R 2 000,75"); t(items, 270, top + 13, "R 0,00");
    t(items, 386, top + 13, "R 3 500,00"); t(items, 533, top + 13, "5 500,75");
  };
  ageing(p1, 285);
  const heading = (items, top) => {
    for (const [x, label] of [[17, "Date"], [73.5, "Invoice"], [158.3, "Description"], [259.9, "Our Reference"], [408.6, "Debit"], [478.6, "Credit"], [543.5, "Balance"]]) t(items, x, top, label, 9, { bold: true });
  };
  const row = (items, top, [date, invoice, description, ours, debit, credit, balance]) => {
    t(items, 17, top, date); t(items, 73.5, top, invoice);
    if (description) t(items, 158.3, top, description);
    if (ours) t(items, 259.9, top, ours);
    if (debit) r(items, 431, top, debit);
    if (credit) r(items, 505, top, credit);
    r(items, 578, top, balance);
  };
  const total = (items, top, [label, period, debit, credit, net]) => {
    t(items, 17, top, label); t(items, 74, top, period); r(items, 431, top, debit); r(items, 505, top, credit); r(items, 578, top, net);
  };
  heading(p1, 329);
  const page1 = [
    ["06/10/2026", "000000002300002", "PO-200002", "000000010400002", "R 1 500,00", "", "R 3 500,00"],
    ["02/10/2026", "000000002300001", "PO-200001", "000000010400001", "R 2 000,00", "", "R 5 500,00"],
  ];
  let top = 342;
  for (const line of page1) { row(p1, top, line); top += 13; }
  total(p1, top, ["Total:", "October 2026", "R 3 500,00", "R 0,00", "R 3 500,00"]); top += 13;
  for (const line of [
    ["09/09/2026", "000000002290003", "Payment", "", "", "-R 700,00", "R 4 800,00"],
    ["09/09/2026", "000000002290004", "Payment", "", "", "-R 300,00", "R 4 500,00"],
    ["09/09/2026", "_CR00002", "Payment", "", "", "R 1 000,00", "R 5 500,00"],
    ["08/09/2026", "_CR00002", "Unapplied cash", "", "", "R 0,00", "R 5 500,00"],
    ["08/09/2026", "_CR00002", "Payment", "IMMEDIATE TRF CR", "", "-R 1 000,00", "R 4 500,00"],
    ["05/09/2026", "000000002290002", "PO-190002", "000000010390002", "R 700,00", "", "R 5 200,00"],
    ["01/09/2026", "000000002290001", "PO-190001", "000000010390001", "R 300,00", "", "R 5 500,00"],
  ]) { row(p1, top, line); top += 13; }
  total(p1, top, ["Total:", "September 2026", "R 1 000,00", "-R 1 000,00", "R 0,00"]);
  heading(p2, 31);
  top = 44;
  for (const line of [
    ["20/08/2026", "000000002280002", "PO-180002", "000000010380002", "R 1 250,50", "", "R 6 750,50"],
    ["10/08/2026", "000000002280001", "PO-180001", "000000010380001", "R 750,25", "", "R 7 500,75"],
  ]) { row(p2, top, line); top += 13; }
  total(p2, top, ["Total:", "August 2026", "R 2 000,75", "R 0,00", "R 2 000,75"]); top += 13;
  ageing(p2, top);
  t(p2, 177, top + 28, "We look forward to your timeous payment as per your agreed terms.");
  return {
    key: "remittance-structure",
    format: "pdf",
    layout: "positioned",
    logo: { x: 22, top: 20, width: 150, height: 70 },
    positionedPages: [p1, p2],
  };
}
