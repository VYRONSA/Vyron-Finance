// @vitest-environment node
/**
 * REAL PDFs, rendered by a real Chromium-based browser through the
 * production renderer (`renderHtmlToPdf`), then read back with pdf.js.
 *
 * PRODUCTION DEFECT these guard: every production PDF was Vercel's "Log in
 * to Vercel" page (the renderer navigated to the protection-guarded
 * deployment URL). Earlier checks only measured page brightness — which a
 * login page passes — so these read the PDF's actual TEXT.
 *
 * Needs a local Chrome/Edge (`PDF_BROWSER_PATH`, or a standard install
 * path); skipped, not faked, where none exists.
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createCanvas } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Only the renderer is under test here; the data loaders are covered by pdf-documents.test.tsx.
vi.mock("./pdf-documents", () => ({}));

import { renderHtmlToPdf } from "./pdf-generation-service";
import { renderPrintHtml } from "./print-html";
import { InvoiceDocumentBody } from "@/components/documents/print/invoice-body";
import { DocumentBrandingBlock } from "@/components/documents/print/branding-block";
import { ReportDocument } from "@/components/financial/reporting/report-document";
import { createPreviewSource } from "@/server/report-centre/preview-source";
import { runReport } from "@/server/report-centre/run";
import { reportHomeMap } from "@/server/report-centre/registry";
import type { SalesInvoice } from "@/server/sales/types";

const BROWSER = [
  process.env.PDF_BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)));

const invoice = {
  id: 17, companyId: "company-a", customerId: 5, documentType: "Invoice", invoiceNumber: "INV-0017", invoiceDate: "2026-07-31", dueDate: "2026-08-31",
  reference: "PO-88", status: "Draft", subtotal: 20000, vatAmount: 3000, total: 23000, outstanding: 23000, notes: "",
  lines: [{ id: 1, description: "Catering services for July", quantity: 1, unitPrice: 20000, vatAmount: 3000, lineTotal: 23000 }],
} as unknown as SalesInvoice;
const company = { name: "Metanoia Hospitality (Pty) Ltd", tradingName: "", address: "12 Long Street, Cape Town", postalAddress: "", telephone: "", email: "", website: "", registrationNumber: "", vatNumber: "4000000001" };
const letterhead = { ...company, logoUrl: null };

async function readPdf(pdf: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(pdf) }).promise;
  const page = await doc.getPage(1);
  const text = (await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join(" ");
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context as never, viewport, canvas: canvas as never }).promise;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  let brightness = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const v = (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3;
    brightness += v;
    if (v < 128) ink++;
  }
  return { pages: doc.numPages, text, compact: text.replace(/\s+/g, ""), ink, brightness: brightness / (pixels.length / 4) };
}

const describeWithBrowser = BROWSER ? describe : describe.skip;

describeWithBrowser(`server-rendered PDFs (${BROWSER ?? "no local browser"})`, () => {
  const originalPath = process.env.PDF_BROWSER_PATH;
  beforeAll(() => {
    process.env.PDF_BROWSER_PATH = BROWSER;
  });
  afterAll(() => {
    if (originalPath === undefined) delete process.env.PDF_BROWSER_PATH;
    else process.env.PDF_BROWSER_PATH = originalPath;
  });

  it("an invoice PDF contains the invoice — not a login page — with content on page 1", async () => {
    const html = await renderPrintHtml(
      <InvoiceDocumentBody
        invoice={invoice}
        customer={{ name: "Kingdom Foods", vatNumber: "4123456789", registrationNumber: "" }}
        addressLine="1 Main Road, Cape Town"
        letterhead={<DocumentBrandingBlock company={company} logoSrc={null} />}
      />,
      "Tax Invoice INV-0017",
    );
    const pdf = await readPdf(await renderHtmlToPdf(html));
    for (const text of ["TaxInvoice", "INV-0017", "KingdomFoods", "MetanoiaHospitality", "Cateringservices", "20,000.00", "23,000.00"]) {
      expect(pdf.compact).toContain(text);
    }
    expect(pdf.compact).not.toMatch(/vercel|login|signin/i);
    expect(pdf.ink).toBeGreaterThan(500); // page 1 is not blank
    expect(pdf.brightness).toBeGreaterThan(200); // white paper, not the dark app canvas
  }, 120_000);

  it.each(["trial-balance", "profit-and-loss"])("the %s report PDF contains the report — not a login page", async (reportId) => {
    const { result } = await runReport(createPreviewSource("demo"), reportId, {});
    const html = await renderPrintHtml(<ReportDocument result={result} letterhead={letterhead} companyId="demo" reportHome={reportHomeMap()} />, result.title);
    const pdf = await readPdf(await renderHtmlToPdf(html));
    expect(pdf.compact).toContain(result.title.replace(/\s+/g, ""));
    expect(pdf.compact).toContain("MetanoiaHospitality");
    expect(pdf.compact).not.toMatch(/vercel|login|signin/i);
    expect(pdf.ink).toBeGreaterThan(500);
    expect(pdf.brightness).toBeGreaterThan(200);
  }, 120_000);

  it("the renderer makes no network request, even for markup that references one", async () => {
    let hits = 0;
    const server = http.createServer((_request, response) => {
      hits++;
      response.end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const html = await renderPrintHtml(
        <div className="p-10">
          {/* eslint-disable-next-line @next/next/no-img-element -- deliberately a network URL the renderer must refuse */}
          <img src={`http://127.0.0.1:${port}/beacon.png`} alt="" />
          <link rel="stylesheet" href={`http://127.0.0.1:${port}/style.css`} />
          <p className="text-vf-ink">Offline document</p>
        </div>,
        "Beacon",
      );
      const pdf = await readPdf(await renderHtmlToPdf(html));
      expect(pdf.compact).toContain("Offlinedocument");
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  }, 120_000);
});
