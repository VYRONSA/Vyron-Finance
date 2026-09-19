/**
 * Phase 5O — renders the certification corpus documents.
 *
 * Reads `certification-corpus/authoring/document-content.mjs` (the author's
 * statement of what each page prints) and produces real files in the
 * formats a provider will actually receive: PDF, image-only "scanned" PDF,
 * JPG and PNG.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 *  - It does not write ground truth. The answer keys are authored by hand
 *    in `certification-corpus/ground-truth/*.json` and this script never
 *    reads or writes them.
 *  - It does not embed a machine-readable answer anywhere: no hidden text,
 *    no off-screen elements, no `display:none`, no metadata carrying the
 *    invoice number. The PDF's own /Title is blanked along with its dates.
 *    A test asserts the documents contain no invisible text.
 *  - It does not use Finance's invoice renderer. That template draws
 *    VYRON's OWN sales invoices; these are third-party supplier documents
 *    and should not look like ours.
 *
 * DETERMINISM. Chrome stamps every PDF with a creation date and a random
 * file ID, which would make the corpus hash change on every regeneration.
 * Both are overwritten with fixed values of the SAME BYTE LENGTH, so the
 * cross-reference table stays valid and re-running this script reproduces
 * the corpus byte for byte.
 *
 *   node scripts/author-certification-corpus.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { DOCUMENTS } from "../certification-corpus/authoring/document-content.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "certification-corpus", "documents");

/** A local Chrome or Edge, the same way the PDF regression tests find one. */
const BROWSER_CANDIDATES = [
  process.env.PDF_BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

/**
 * Money as these suppliers' systems would print it: a space for thousands,
 * a full stop for the decimal — "1 512.00".
 *
 * Written out by hand rather than with `toLocaleString("en-ZA")`, which
 * returns a COMMA as the decimal separator ("1 512,00"). Stripping commas
 * to normalise the thousands separator then silently destroyed the decimal
 * point on every amount in the corpus: "189,00" became "189 00". Caught by
 * looking at a rendered page, which is exactly why Part 10 asks for that.
 */
function money(value) {
  const [whole, fraction] = value.toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}.${fraction}`;
}

const COLUMN_HEADINGS = {
  desc: "DESCRIPTION",
  sku: "CODE",
  qty: "QTY",
  uom: "UNIT",
  unit: "UNIT PRICE",
  weight: "MASS (kg)",
  disc: "DISCOUNT",
  vatRate: "VAT %",
  vatAmt: "V.A.T.",
  total: "AMOUNT",
};

const NUMERIC_COLUMNS = new Set(["qty", "unit", "weight", "disc", "vatRate", "vatAmt", "total"]);

function cellValue(column, line) {
  switch (column) {
    case "desc": return line.desc ?? "";
    case "sku": return line.sku ?? "";
    case "qty": return String(line.qty ?? "");
    case "uom": return line.uom ?? "";
    case "unit": return money(line.unit);
    case "weight": return line.weight.toFixed(2);
    case "disc": return line.disc ? money(line.disc) : "-";
    case "vatRate": return `${line.vatRate}%`;
    case "vatAmt": return money(line.vatAmt);
    case "total": return money(line.total);
    default: return "";
  }
}

function buildHtml(doc) {
  const scale = doc.fontScale ?? 1;
  const sym = doc.currency.symbol;
  const vatLine = doc.supplier.vatNumber && !doc.omitSupplierVatNumber
    ? `<div>VAT Reg No: ${doc.supplier.vatNumber}</div>` : "";
  const regLine = doc.supplier.regNumber ? `<div>Co Reg No: ${doc.supplier.regNumber}</div>` : "";

  const rows = doc.lines.map((line, index) => {
    const cells = doc.columns
      .map((c) => `<td class="${NUMERIC_COLUMNS.has(c) ? "num" : ""}">${cellValue(c, line)}</td>`)
      .join("");
    const breakAfter = doc.pageBreakAfterLine === index + 1 ? ' class="page-break"' : "";
    return `<tr${breakAfter}>${cells}</tr>`;
  }).join("\n");

  const headings = doc.columns
    .map((c) => `<th class="${NUMERIC_COLUMNS.has(c) ? "num" : ""}">${COLUMN_HEADINGS[c]}</th>`)
    .join("");

  const totalRows = [
    doc.totals.subtotal !== undefined ? `<tr><td>Subtotal (excl. VAT)</td><td class="num">${sym} ${money(doc.totals.subtotal)}</td></tr>` : "",
    doc.totals.discount !== undefined ? `<tr><td>Trade discount</td><td class="num">${sym} ${money(doc.totals.discount)}</td></tr>` : "",
    doc.totals.vat !== undefined ? `<tr><td>V.A.T.</td><td class="num">${sym} ${money(doc.totals.vat)}</td></tr>` : "",
    `<tr class="grand"><td>TOTAL ${doc.currency.code}</td><td class="num">${sym} ${money(doc.totals.total)}</td></tr>`,
  ].join("\n");

  const reference = doc.referenceLabel
    ? `<tr><th>${doc.referenceLabel}</th><td>${doc.referenceValue}</td></tr>` : "";
  const reason = doc.reason ? `<tr><th>Reason</th><td>${doc.reason}</td></tr>` : "";
  const order = doc.orderReference ? `<tr><th>Your order</th><td>${doc.orderReference}</td></tr>` : "";
  const due = doc.dueDate ? `<tr><th>Due date</th><td>${doc.dueDate}</td></tr>` : "";
  const number = doc.invoiceNumber
    ? `<tr><th>${doc.title === "TAX INVOICE" || doc.title === "INVOICE" ? "Invoice no" : "Document no"}</th><td>${doc.invoiceNumber}</td></tr>`
    : "";

  const watermark = doc.watermark ? `<div class="watermark">${doc.watermark}</div>` : "";
  const faded = doc.degrade?.fade ? "filter: contrast(0.72) brightness(1.1);" : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><title> </title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0;
         font-size: ${12 * scale}px; line-height: 1.45; ${faded} }
  .sheet { position: relative; padding: ${doc.format === "pdf" || doc.format === "scanned-pdf" ? "0" : "14mm"}; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 10px; }
  .supplier { max-width: 60%; }
  .supplier .name { font-size: ${17 * scale}px; font-weight: 700; letter-spacing: 0.2px; }
  .supplier div { font-size: ${11 * scale}px; }
  h1 { font-size: ${20 * scale}px; margin: 0 0 6px 0; text-align: right; letter-spacing: 1px; }
  .meta { margin-top: 14px; display: flex; justify-content: space-between; gap: 20px; }
  .meta table { border-collapse: collapse; font-size: ${11 * scale}px; }
  .meta th { text-align: left; padding: 2px 14px 2px 0; font-weight: 600; white-space: nowrap; }
  .meta td { padding: 2px 0; }
  .billto { font-size: ${11 * scale}px; }
  .billto .label { font-weight: 700; margin-bottom: 3px; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: ${11 * scale}px; }
  table.lines th { border-bottom: 1.5px solid #111; text-align: left; padding: 5px 6px; font-size: ${10 * scale}px; letter-spacing: 0.3px; }
  table.lines td { border-bottom: 0.5px solid #bbb; padding: 5px 6px; }
  .num { text-align: right; }
  .page-break { break-after: page; }
  .totals { margin-top: 16px; display: flex; justify-content: flex-end; }
  .totals table { border-collapse: collapse; font-size: ${11 * scale}px; min-width: 250px; }
  .totals td { padding: 4px 6px; }
  .totals td.num { border-left: 0.5px solid #ccc; }
  .totals tr.grand td { border-top: 1.5px solid #111; font-weight: 700; font-size: ${13 * scale}px; }
  footer { margin-top: 22px; border-top: 0.5px solid #999; padding-top: 8px; font-size: ${10 * scale}px; color: #333; }
  .watermark { position: absolute; top: 38%; left: 18%; font-size: 90px; color: rgba(0,0,0,0.10);
               transform: rotate(-24deg); font-weight: 800; letter-spacing: 6px; }
</style></head>
<body><div class="sheet">
${watermark}
<header>
  <div class="supplier">
    <div class="name">${doc.supplier.name}</div>
    ${doc.supplier.address.map((l) => `<div>${l}</div>`).join("")}
    <div>Tel: ${doc.supplier.phone}</div>
    ${vatLine}
    ${regLine}
  </div>
  <div><h1>${doc.title}</h1></div>
</header>
<div class="meta">
  <div class="billto">
    <div class="label">Bill to</div>
    <div>${doc.billTo.name}</div>
    ${doc.billTo.address.map((l) => `<div>${l}</div>`).join("")}
    <div>VAT Reg No: ${doc.billTo.vatNumber}</div>
  </div>
  <table>
    ${number}
    <tr><th>Date</th><td>${doc.invoiceDate}</td></tr>
    ${due}
    ${order}
    ${reference}
    ${reason}
  </table>
</div>
<table class="lines">
  <thead><tr>${headings}</tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
<div class="totals"><table>
${totalRows}
</table></div>
<footer>${doc.footer}</footer>
</div></body></html>`;
}

/**
 * Waits until every image has actually decoded AND a frame has been
 * painted.
 *
 * `waitUntil: "load"` fires when the image RESOURCE is loaded, which is not
 * the same as it having been decoded and composited. Screenshotting in
 * that gap produced a `rotated.png` that differed between runs — the one
 * file in the corpus that was not reproducible. Certification depends on
 * the corpus hash being stable, so this is not cosmetic.
 */
async function settle(page) {
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images).map((img) => (img.decode ? img.decode().catch(() => {}) : null)));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/** Chrome stamps a creation date and a random ID into every PDF. Both are
 * replaced with fixed values of identical byte length, so the file is
 * reproducible and its hash is stable. Same length => the xref offsets
 * stay correct, so the PDF remains valid. */
function normalisePdf(buffer) {
  let bytes = Buffer.from(buffer);
  let text = bytes.toString("latin1");

  text = text.replace(/\/CreationDate \(D:\d{14}[+\-Z]\d{2}'\d{2}'\)/g,
    "/CreationDate (D:20260101000000+00'00')");
  text = text.replace(/\/ModDate \(D:\d{14}[+\-Z]\d{2}'\d{2}'\)/g,
    "/ModDate (D:20260101000000+00'00')");
  // The file ID: two hex strings. Replaced with zeros of the same length.
  text = text.replace(/\/ID \[\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\]/g,
    (match, a, b) => match.replace(a, "0".repeat(a.length)).replace(b, "0".repeat(b.length)));

  return Buffer.from(text, "latin1");
}

async function launch() {
  for (const path of BROWSER_CANDIDATES) {
    try {
      return await puppeteer.launch({ executablePath: path, headless: true, args: ["--no-sandbox", "--font-render-hinting=none"] });
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`No local Chrome or Edge found. Tried:\n${BROWSER_CANDIDATES.join("\n")}`);
}

async function renderOne(browser, doc) {
  const page = await browser.newPage();
  // Nothing may be fetched: the page is self-contained and must stay that
  // way, or a document could quietly depend on the network.
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith("data:") ? r.continue() : r.abort()));

  const html = buildHtml(doc);
  const deviceScaleFactor = doc.degrade?.scale ?? (doc.format === "png" || doc.format === "jpg" ? 1.6 : 1);
  await page.setViewport({ width: 900, height: 1250, deviceScaleFactor });
  await page.setContent(html, { waitUntil: "load" });
  await settle(page);

  let filename;
  let output;

  if (doc.format === "pdf") {
    filename = `${doc.key}.pdf`;
    output = normalisePdf(await page.pdf({ format: "A4", printBackground: true, margin: { top: "14mm", right: "14mm", bottom: "14mm", left: "14mm" } }));
  } else if (doc.format === "scanned-pdf") {
    // A real scan: flatten to an image FIRST so there is no text layer at
    // all, then wrap that image in a PDF. Anything reading this file has
    // to look at it, which is the whole point of the case.
    const image = await page.screenshot({ type: "png", fullPage: true });
    const imagePage = await browser.newPage();
    await imagePage.setContent(
      `<!doctype html><html><head><title> </title><style>@page{size:A4;margin:0}
       html,body{margin:0;padding:0}img{width:100%;display:block;filter:grayscale(1) contrast(1.15)}
       </style></head><body><img src="data:image/png;base64,${image.toString("base64")}"></body></html>`,
      { waitUntil: "load" },
    );
    await settle(imagePage);
    filename = `${doc.key}.pdf`;
    output = normalisePdf(await imagePage.pdf({ format: "A4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } }));
    await imagePage.close();
  } else if (doc.format === "png" && doc.rotateDegrees) {
    // Photographed askew. The rotation is applied to the rendered page in
    // a second pass so the text is genuinely on a slant, not merely a
    // rotated viewport.
    const flat = await page.screenshot({ type: "png", fullPage: true });
    const rotatePage = await browser.newPage();
    await rotatePage.setViewport({ width: 1100, height: 1500, deviceScaleFactor: 1.2 });
    await rotatePage.setContent(
      `<!doctype html><html><head><title> </title><style>
        html,body{margin:0;padding:0;background:#d8d8d4;width:1100px;height:1500px;overflow:hidden}
        .wrap{display:flex;align-items:center;justify-content:center;width:1100px;height:1500px}
        img{transform:rotate(${doc.rotateDegrees}deg);width:78%;box-shadow:0 0 26px rgba(0,0,0,0.35)}
       </style></head><body><div class="wrap"><img src="data:image/png;base64,${flat.toString("base64")}"></div></body></html>`,
      { waitUntil: "load" },
    );
    await settle(rotatePage);
    filename = `${doc.key}.png`;
    output = await rotatePage.screenshot({ type: "png" });
    await rotatePage.close();
  } else if (doc.format === "png") {
    filename = `${doc.key}.png`;
    output = await page.screenshot({ type: "png", fullPage: true });
  } else if (doc.format === "jpg") {
    filename = `${doc.key}.jpg`;
    output = await page.screenshot({ type: "jpeg", quality: doc.degrade?.quality ?? 88, fullPage: true });
  } else {
    throw new Error(`Unknown format "${doc.format}" for case "${doc.key}".`);
  }

  await page.close();
  writeFileSync(join(OUT_DIR, filename), output);
  return { key: doc.key, filename, bytes: output.length };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launch();
  const results = [];
  try {
    for (const doc of DOCUMENTS) {
      results.push(await renderOne(browser, doc));
    }
  } finally {
    await browser.close();
  }

  for (const r of results) {
    console.log(`${r.key.padEnd(26)} ${r.filename.padEnd(30)} ${(r.bytes / 1024).toFixed(1)} KB`);
  }
  console.log(`\n${results.length} documents written to certification-corpus/documents/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
