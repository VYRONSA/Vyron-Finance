// Renders Reporting Centre and Document Centre pages to PDF with EXACTLY
// the options production uses (pdf-generation-service.ts: A4,
// printBackground, zero margins), rasterises every page with the
// project's own pdfjs-dist + @napi-rs/canvas, and checks each PDF is a
// white page with its content starting on page 1 — the two print defects
// found and fixed in DocumentPreviewOverlay (dark page; blank first page).
//
// Run against a Preview-Mode dev server (mock data only, never Supabase):
//   NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next dev --webpack -p 3100
//   node scripts/verify-report-pdfs.mjs
// Env: BASE, BROWSER_PATH, OUT (output directory, default: OS temp).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { createCanvas } from "@napi-rs/canvas";

const BASE = process.env.BASE ?? "http://localhost:3100";
const BROWSER = process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const OUT = process.env.OUT ?? os.tmpdir();
const PAGES = [
  ["report-trial-balance", "/company/demo/reporting/print/trial-balance"],
  ["report-customer-aging", "/company/demo/reporting/print/customer-aging"],
  ["report-management-pack", "/company/demo/reporting/print/management-pack"],
  ["document-sales-invoice", "/company/demo/reporting/documents/sales-invoice/2?print=1"],
  ["document-supplier-bill", "/company/demo/reporting/documents/purchase-bill/101?print=1"],
];

const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true });
const page = await browser.newPage();
let failures = 0;
for (const [name, route] of PAGES) {
  const res = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle0", timeout: 300000 });
  const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
  const file = path.join(OUT, `${name}.pdf`);
  fs.writeFileSync(file, pdf);
  const doc = await getDocument({ data: new Uint8Array(pdf) }).promise;
  const stats = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const viewport = p.getViewport({ scale: 1 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    await p.render({ canvasContext: ctx, viewport, canvas }).promise;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    let brightness = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
      brightness += v;
      if (v < 128) ink++;
    }
    stats.push({ page: n, ink, brightness: Math.round(brightness / (d.length / 4)) });
    fs.writeFileSync(file.replace(/\.pdf$/, `-p${n}.png`), canvas.toBuffer("image/png"));
  }
  const ok = res?.ok() && stats[0].brightness > 200 && stats[0].ink > 500;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${doc.numPages} page(s); page 1 brightness ${stats[0].brightness}/255, ink pixels ${stats[0].ink}`);
}
await browser.close();
console.log(failures ? `${failures} PDF(s) failed` : `All ${PAGES.length} PDFs are white pages with content on page 1 (written to ${OUT})`);
process.exitCode = failures ? 1 : 0;
