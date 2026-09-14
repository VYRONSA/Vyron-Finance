/**
 * Server-generated PDF documents — invoices, customer statements, Reporting
 * Centre reports and Document Centre documents, for download and as email
 * attachments.
 *
 * HOW: the document is built on the server as ONE self-contained HTML page
 * (`pdf-documents.tsx` → `print-html.ts`) and handed to headless Chromium
 * with `page.setContent()`. No URL is ever loaded.
 *
 * PRODUCTION DEFECT this replaces: Chromium used to navigate to an internal
 * `pdf-view` page on `https://${VERCEL_URL}`, forwarding the user's cookie.
 * `VERCEL_URL` is the deployment's own hostname, which Vercel Deployment
 * Protection puts behind Vercel's login — so every PDF, downloaded or
 * emailed, was a picture of the "Log in to Vercel" page. It also made every
 * document depend on a network round-trip to a public URL.
 *
 * Now:
 *  - the data is read by the SAME services the app's routes use, under the
 *    signed-in user's own Supabase session — RLS applies, no service role;
 *  - Chromium receives only the finished HTML, with JavaScript disabled and
 *    every network request refused: it cannot fetch anything, and no URL,
 *    cookie or credential is ever given to it;
 *  - Deployment Protection and the app's authentication are unchanged.
 *
 * Chromium comes from `@sparticuz/chromium` (the Vercel-compatible build,
 * see `next.config.ts`); `PDF_BROWSER_PATH` points at a locally installed
 * Chrome/Edge instead, for local development and the PDF regression tests.
 */

import type { Browser } from "puppeteer-core";
import type { BusinessDocument } from "@/server/report-centre/documents";
import type { ReportResult } from "@/server/report-centre/types";
import { businessDocumentPdfHtml, invoicePdfHtml, reportPdfHtml, statementPdfHtml } from "./pdf-documents";

export class PdfGenerationError extends Error {}

const RENDER_TIMEOUT_MS = 20_000;
/** Top/bottom page margins so continuation pages don't start at the paper
 * edge; the document bodies supply their own side padding. */
const PAGE_MARGIN = { top: "10mm", right: "0", bottom: "10mm", left: "0" };

/** Lazily imports both the Chromium binary locator and `puppeteer-core` —
 * importing this file (e.g. from a test) never resolves a Chromium binary. */
async function launchBrowser() {
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([import("@sparticuz/chromium"), import("puppeteer-core")]);
  const localBrowser = process.env.PDF_BROWSER_PATH;
  if (localBrowser) return puppeteer.launch({ executablePath: localBrowser, headless: true });
  return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
}

/** Renders a complete HTML document to PDF bytes, fully offline: the page
 * is given the HTML directly, JavaScript is off, and any request other
 * than an inline `data:` resource is refused. */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url().startsWith("data:")) void request.continue();
      else void request.abort("blockedbyclient");
    });
    await page.setContent(html, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
    const pdfBytes = await page.pdf({ format: "A4", printBackground: true, margin: PAGE_MARGIN });
    return Buffer.from(pdfBytes);
  } catch (error) {
    if (error instanceof PdfGenerationError) throw error;
    // Never a raw Puppeteer/Chromium stack trace or file-system path
    // reaching a caller.
    throw new PdfGenerationError("PDF generation failed. Please try again.");
  } finally {
    await browser?.close().catch(() => {});
  }
}

function requireDocument(html: string | null): string {
  if (html === null) throw new PdfGenerationError("The document could not be found for PDF generation.");
  return html;
}

export async function generateInvoicePdf(companyId: string, invoiceId: number): Promise<Buffer> {
  return renderHtmlToPdf(requireDocument(await invoicePdfHtml(companyId, invoiceId)));
}

export async function generateStatementPdf(companyId: string, customerId: number): Promise<Buffer> {
  return renderHtmlToPdf(requireDocument(await statementPdfHtml(companyId, customerId)));
}

/** Reporting Centre — the report the caller already ran with the user's
 * filters, so the PDF is exactly the report on screen. */
export async function generateReportPdf(companyId: string, result: ReportResult): Promise<Buffer> {
  return renderHtmlToPdf(await reportPdfHtml(companyId, result));
}

/** Document Centre — reprint of a customer/supplier document the caller loaded. */
export async function generateBusinessDocumentPdf(companyId: string, document: BusinessDocument): Promise<Buffer> {
  return renderHtmlToPdf(await businessDocumentPdfHtml(companyId, document));
}
