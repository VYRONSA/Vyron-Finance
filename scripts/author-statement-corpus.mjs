/**
 * SD-3C — renders the supplier-statement certification corpus.
 *
 * Reads `statement-corpus/authoring/statement-content.mjs` (what each page
 * prints) and produces real files in the formats statements actually
 * arrive in: text PDF (primary), image-only "scanned" PDF, JPEG, PNG, a
 * password-protected PDF, CSV and XLSX. Writes `statement-corpus/manifest.json`
 * with each file's SHA-256 so the corpus cannot change unnoticed.
 *
 * It never writes or reads the ground truth (`statement-corpus/ground-truth`),
 * which is typed by hand from the rendered pages. Nothing machine-readable
 * is hidden in any document: no invisible text, no metadata answers.
 *
 *   node scripts/author-statement-corpus.mjs
 *   node scripts/author-statement-corpus.mjs --only <key>   (one document)
 *
 * Same approach as `author-certification-corpus.mjs` (local Chrome/Edge via
 * puppeteer-core; fixed PDF dates and IDs for reproducibility).
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import ExcelJS from "exceljs";
import { STATEMENTS } from "../statement-corpus/authoring/statement-content.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "statement-corpus", "documents");

const BROWSER_CANDIDATES = [
  process.env.PDF_BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function tableHtml(doc, page, index) {
  const head = page.heading
    ? `<thead><tr>${doc.columns.map((c) => `<th class="${c.align}">${escape(c.label)}</th>`).join("")}</tr></thead>`
    : "";
  const rows = page.rows
    .map((row) => {
      const strong = /^(Totals|Balance due|Closing balance|Amount payable)$/i.test(row.find((c) => c) ?? "");
      return `<tr class="${strong ? "strong" : ""}">${row.map((cell, i) => `<td class="${doc.columns[i].align}">${escape(cell)}</td>`).join("")}</tr>`;
    })
    .join("");
  const note = page.pageNote ? `<p class="note">${escape(page.pageNote)}</p>` : "";
  return `<section class="${index > 0 ? "break" : ""}">${note}<table class="lines">${head}<tbody>${rows}</tbody></table></section>`;
}

function buildHtml(doc) {
  const s = doc.supplier;
  // SD-3G: an optional letterhead of explicitly sized lines (e.g. a large
  // telephone line above a small business name), an ageing block on the
  // first page as well, and a document-specific footer. Documents that do
  // not use them render exactly as before.
  const letterhead = doc.letterhead
    ? `<div>${doc.letterhead.map((l) => `<div style="font-size:${l.px}px;${l.bold ? "font-weight:bold;" : ""}margin-bottom:2px">${escape(l.text)}</div>`).join("")}</div>`
    : `<div><div class="name">${escape(s.name)}</div>${s.address.map((a) => `<div>${escape(a)}</div>`).join("")}
      <div class="ids">${s.ids.map((i) => `<span>${escape(i)}</span>`).join("")}</div></div>`;
  const ageing = doc.ageing
    ? `<table class="ageing"><tr>${doc.ageing.map(([l]) => `<td>${escape(l)}</td>`).join("")}</tr>
       <tr>${doc.ageing.map(([, v]) => `<td>${escape(v)}</td>`).join("")}</tr></table>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title> </title><style>
    @page { size: A4; margin: 14mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; margin: 0; }
    .letterhead { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5px solid #333; padding-bottom: 8px; }
    .name { font-size: 20px; font-weight: bold; margin-bottom: 3px; }
    .title { font-size: 14px; font-weight: bold; letter-spacing: 2px; }
    .ids span { margin-right: 28px; }
    .parties { display: flex; justify-content: space-between; margin: 12px 0; }
    .labels div { margin-bottom: 2px; }
    table.lines { width: 100%; border-collapse: collapse; margin-top: 6px; }
    table.lines th { border-bottom: 1px solid #333; padding: 4px 6px; font-weight: bold; }
    table.lines td { padding: 3px 6px; }
    .left { text-align: left; } .right { text-align: right; }
    tr.strong td { font-weight: bold; border-top: 1px solid #999; }
    table.ageing { margin-top: 14px; border-collapse: collapse; }
    table.ageing td { padding: 3px 18px 3px 0; text-align: right; min-width: 70px; }
    .break { break-before: page; }
    .note { color: #555; margin: 0 0 6px; }
    .footer { margin-top: 18px; color: #444; }
  </style></head><body>
    <div class="letterhead">${letterhead}
      <div class="title">STATEMENT</div></div>
    <div class="parties"><div>${doc.customer.map((c) => `<div>${escape(c)}</div>`).join("")}</div>
      <div class="labels">${doc.labels.map((l) => `<div>${escape(l)}</div>`).join("")}</div></div>
    ${doc.ageingTop ? ageing : ""}
    ${doc.pages.map((p, i) => tableHtml(doc, p, i)).join("")}
    ${ageing}
    <p class="footer">${escape(doc.footer ?? "Please quote your account number with every payment.")}</p>
  </body></html>`;
}

function normalisePdf(buffer) {
  let text = Buffer.from(buffer).toString("latin1");
  text = text.replace(/\/CreationDate \(D:\d{14}[+\-Z]\d{2}'\d{2}'\)/g, "/CreationDate (D:20260101000000+00'00')");
  text = text.replace(/\/ModDate \(D:\d{14}[+\-Z]\d{2}'\d{2}'\)/g, "/ModDate (D:20260101000000+00'00')");
  text = text.replace(/\/ID \[\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\]/g, (m, a, b) => m.replace(a, "0".repeat(a.length)).replace(b, "0".repeat(b.length)));
  return Buffer.from(text, "latin1");
}

/** A minimal, valid PDF protected by the standard security handler with a
 * user password nobody knows: any reader must ask for the password. */
function encryptedPdf() {
  const hex = (seed) => createHash("sha256").update(seed).digest("hex").slice(0, 64);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
    `<< /Filter /Standard /V 2 /R 3 /Length 128 /P -3904 /O <${hex("sd3c-owner")}> /U <${hex("sd3c-user")}> >>`,
  ];
  let body = "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<${hex("sd3c-id").slice(0, 32)}> <${hex("sd3c-id").slice(0, 32)}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

async function xlsx(grid) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(Date.UTC(2026, 0, 1));
  workbook.modified = new Date(Date.UTC(2026, 0, 1));
  const sheet = workbook.addWorksheet("Statement");
  grid.forEach((row, r) => {
    row.forEach((cell, c) => {
      const target = sheet.getCell(r + 1, c + 1);
      if (cell && typeof cell === "object" && cell.date) {
        target.value = new Date(`${cell.date}T00:00:00Z`);
        target.numFmt = "dd/mm/yyyy";
      } else if (typeof cell === "number") {
        target.value = cell;
        target.numFmt = "# ##0.00";
      } else if (cell !== "") {
        target.value = cell;
      }
    });
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function settle(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function launch() {
  for (const path of BROWSER_CANDIDATES) {
    try {
      return await puppeteer.launch({ executablePath: path, headless: true, args: ["--no-sandbox", "--font-render-hinting=none"] });
    } catch {
      // next candidate
    }
  }
  throw new Error(`No local Chrome or Edge found. Tried:\n${BROWSER_CANDIDATES.join("\n")}`);
}

async function render(browser, doc) {
  const source = doc.from ? STATEMENTS.find((d) => d.key === doc.from) : doc;
  if (doc.format === "encrypted-pdf") return { filename: `${doc.key}.pdf`, output: encryptedPdf() };
  if (doc.format === "csv") return { filename: `${doc.key}.csv`, output: Buffer.from(doc.grid.map((r) => r.join(";")).join("\r\n") + "\r\n", "utf8") };
  if (doc.format === "xlsx") return { filename: `${doc.key}.xlsx`, output: await xlsx(doc.grid) };

  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith("data:") ? r.continue() : r.abort()));
  await page.setViewport({ width: 900, height: 1250, deviceScaleFactor: doc.format === "pdf" ? 1 : 1.6 });
  await page.setContent(buildHtml(source), { waitUntil: "load" });
  await settle(page);
  try {
    if (doc.format === "pdf") {
      return { filename: `${doc.key}.pdf`, output: normalisePdf(await page.pdf({ format: "A4", printBackground: true, margin: { top: "14mm", right: "14mm", bottom: "14mm", left: "14mm" } })) };
    }
    const image = await page.screenshot({ type: doc.format === "jpg" ? "jpeg" : "png", quality: doc.format === "jpg" ? 85 : undefined, fullPage: true });
    if (doc.format === "jpg") return { filename: `${doc.key}.jpg`, output: image };
    if (doc.format === "png") return { filename: `${doc.key}.png`, output: image };
    // scanned-pdf: the page as an image, wrapped in a PDF with no text layer.
    const imagePage = await browser.newPage();
    await imagePage.setContent(
      `<!doctype html><html><head><title> </title><style>@page{size:A4;margin:0}html,body{margin:0}img{width:100%;display:block;filter:grayscale(1) contrast(1.1)}</style></head>
       <body><img src="data:image/png;base64,${Buffer.from(image).toString("base64")}"></body></html>`,
      { waitUntil: "load" },
    );
    await settle(imagePage);
    const output = normalisePdf(await imagePage.pdf({ format: "A4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } }));
    await imagePage.close();
    return { filename: `${doc.key}.pdf`, output };
  } finally {
    await page.close();
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  // `--only <key>`: render that document alone and update only its manifest
  // entry — every other pinned file stays byte-for-byte as it is.
  const onlyAt = process.argv.indexOf("--only");
  const only = onlyAt >= 0 ? process.argv[onlyAt + 1] : null;
  if (only) {
    const doc = STATEMENTS.find((d) => d.key === only);
    if (!doc) throw new Error(`No corpus document "${only}".`);
    const browser = await launch();
    try {
      const { filename, output } = await render(browser, doc);
      writeFileSync(join(OUT_DIR, filename), output);
      const path = join(ROOT, "statement-corpus", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      const entry = { key: doc.key, file: `documents/${filename}`, format: doc.format, sha256: createHash("sha256").update(output).digest("hex") };
      const at = manifest.documents.findIndex((d) => d.key === doc.key);
      if (at >= 0) manifest.documents[at] = entry;
      else manifest.documents.push(entry);
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(`${doc.key} ${filename} ${(output.length / 1024).toFixed(1)} KB ${entry.sha256}`);
    } finally {
      await browser.close();
    }
    return;
  }
  const browser = await launch();
  const manifest = [];
  try {
    for (const doc of STATEMENTS) {
      const { filename, output } = await render(browser, doc);
      writeFileSync(join(OUT_DIR, filename), output);
      manifest.push({ key: doc.key, file: `documents/${filename}`, format: doc.format, sha256: createHash("sha256").update(output).digest("hex") });
      console.log(`${doc.key.padEnd(26)} ${filename.padEnd(30)} ${(output.length / 1024).toFixed(1)} KB`);
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(ROOT, "statement-corpus", "manifest.json"), `${JSON.stringify({ corpus: "supplier-statements-sd3c", documents: manifest }, null, 2)}\n`);
  console.log(`\n${manifest.length} documents written to statement-corpus/documents/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
