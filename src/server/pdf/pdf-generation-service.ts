/**
 * Phase 24A — server-generated PDF documents. The ONE place that turns
 * an existing, already-approved document view into real PDF bytes.
 *
 * Approach, and why: headless Chromium (`puppeteer-core` +
 * `@sparticuz/chromium`, the established Vercel-compatible pattern —
 * `@sparticuz/chromium` ships a Chromium build packaged specifically for
 * serverless deployment, and this project already has a proven pattern
 * for shipping a native-binary Node package through Vercel's file
 * tracing, applied identically here — see `next.config.ts`) navigates to
 * a REAL, unmodified render of the EXISTING `InvoiceDocument`/
 * `StatementDocument` components (via the new `pdf-view` pages) and
 * calls `page.pdf()`. This was chosen over `@react-pdf/renderer` or a
 * from-scratch HTML string precisely because it requires ZERO changes to
 * those components: `DocumentBrandingHeader`/`useCustomerAddress` are
 * client components that self-fetch via `useEffect` — a real browser
 * (which is what Chromium is) runs that code exactly as a user's own
 * browser would, forwarded cookies and all, where a static
 * `renderToStaticMarkup()` approach would render them permanently empty
 * (effects never fire during a static server render). `page.pdf()` also
 * emulates PRINT media by default, so the exact same `@media print`
 * rule `document-preview-overlay.tsx` already uses to hide its own
 * toolbar/backdrop for `window.print()` applies here too, with no
 * separate "print mode" ever needed for PDF capture.
 *
 * On-demand generation, not stored (this ticket's own section 13
 * decision): a Company's invoices/statements can change (a credit note
 * against an invoice, a new receipt affecting a statement), so a stored
 * PDF would risk silently going stale. Nothing in this codebase's
 * existing architecture (no document-storage table for invoices/
 * statements) suggested a compelling reason to add one for this phase.
 */

import type { Browser } from "puppeteer-core";

export class PdfGenerationError extends Error {}

const NAVIGATION_TIMEOUT_MS = 20_000;

/** Lazily imports both the Chromium binary locator and `puppeteer-core`
 * itself — mirrors this codebase's own established "never touch a heavy
 * external dependency at module import time" convention (see
 * `vyron-ai-engine.ts::getDefaultAIProvider`), so importing this file
 * (e.g. from a test) never triggers a real Chromium binary resolution. */
async function launchBrowser() {
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([import("@sparticuz/chromium"), import("puppeteer-core")]);
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });
}

/** Prefers Vercel's own deployment hostname (always correct in
 * production, including preview deployments) over the incoming
 * request's own `Host` header — a `Host` header is attacker-influenceable
 * in theory, and this URL determines exactly what content gets rendered
 * into a PDF, so it's safer to prefer the platform's own authoritative
 * value where one exists. Falls back to the incoming request's host only
 * for local development, where `VERCEL_URL` is never set. */
function resolveBaseUrl(request: Request): string {
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  const host = request.headers.get("host") ?? "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/** Renders one internal `pdf-view` path to PDF bytes. Forwards the
 * INCOMING request's own `Cookie` header (the same session that already
 * passed `requireSession()`/`requirePermission()` in the calling route)
 * so the `pdf-view` page's own, independent auth check succeeds — never
 * a service-role bypass, never a second authentication mechanism. */
async function renderPagePdf(request: Request, path: string): Promise<Buffer> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const url = `${resolveBaseUrl(request)}${path}`;

  let browser: Browser | undefined;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    if (cookieHeader) await page.setExtraHTTPHeaders({ cookie: cookieHeader });

    const response = await page.goto(url, { waitUntil: "networkidle0", timeout: NAVIGATION_TIMEOUT_MS });
    if (!response || !response.ok()) {
      throw new PdfGenerationError(`The document could not be rendered for PDF generation (status ${response?.status() ?? "unknown"}).`);
    }

    const pdfBytes = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
    return Buffer.from(pdfBytes);
  } catch (error) {
    if (error instanceof PdfGenerationError) throw error;
    // Never a raw Puppeteer/Chromium stack trace or file-system path
    // reaching a caller — this ticket's own section 18/19 requirement.
    throw new PdfGenerationError("PDF generation failed. Please try again.");
  } finally {
    await browser?.close().catch(() => {});
  }
}

export function generateInvoicePdf(request: Request, companyId: string, invoiceId: number): Promise<Buffer> {
  return renderPagePdf(request, `/company/${companyId}/documents/invoice/${invoiceId}/pdf-view`);
}

export function generateStatementPdf(request: Request, companyId: string, customerId: number): Promise<Buffer> {
  return renderPagePdf(request, `/company/${companyId}/documents/statement/${customerId}/pdf-view`);
}

/** Reporting Centre — any report, rendered by its print view with the
 * same filters, so the PDF is exactly the report the user is looking at.
 * `query` is the report's filter query string (without a leading `?`). */
export function generateReportPdf(request: Request, companyId: string, reportId: string, query: string): Promise<Buffer> {
  return renderPagePdf(request, `/company/${companyId}/reporting/print/${encodeURIComponent(reportId)}${query ? `?${query}` : ""}`);
}

/** Reporting Centre Document Centre — reprint of any customer/supplier
 * document by its document view. */
export function generateBusinessDocumentPdf(request: Request, companyId: string, docType: string, docId: number): Promise<Buffer> {
  return renderPagePdf(request, `/company/${companyId}/reporting/documents/${encodeURIComponent(docType)}/${docId}?print=1`);
}
