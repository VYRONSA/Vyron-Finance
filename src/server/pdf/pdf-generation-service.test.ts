/**
 * The PDF renderer's contract, with the browser mocked (no Chromium is
 * launched here — `pdf-rendering.test.tsx` renders real PDFs).
 *
 * PRODUCTION DEFECT this guards: the renderer used to `page.goto()` a
 * `pdf-view` page on `https://${VERCEL_URL}` with the user's cookie
 * forwarded; Vercel Deployment Protection answered with its login page, so
 * every PDF was that login page. The renderer must now load NO URL at all:
 * it is handed finished HTML, runs no JavaScript, refuses every network
 * request, and is never given a cookie or credential.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type InterceptedRequest = { url: () => string; continue: () => Promise<void>; abort: (reason?: string) => Promise<void> };
const requestHandlers: Array<(request: InterceptedRequest) => void> = [];
const mockPage = {
  setJavaScriptEnabled: vi.fn(),
  setRequestInterception: vi.fn(),
  on: vi.fn((event: string, handler: (request: InterceptedRequest) => void) => {
    if (event === "request") requestHandlers.push(handler);
  }),
  setContent: vi.fn(),
  pdf: vi.fn(),
  goto: vi.fn(),
  setExtraHTTPHeaders: vi.fn(),
  setCookie: vi.fn(),
};
const mockBrowser = { newPage: vi.fn(), close: vi.fn() };
const launchMock = vi.fn();
const executablePathMock = vi.fn();

vi.mock("puppeteer-core", () => ({ default: { launch: launchMock } }));
vi.mock("@sparticuz/chromium", () => ({ default: { args: ["--no-sandbox"], executablePath: executablePathMock } }));
vi.mock("./pdf-documents", () => ({ invoicePdfHtml: vi.fn(), statementPdfHtml: vi.fn(), reportPdfHtml: vi.fn(), businessDocumentPdfHtml: vi.fn() }));

import {
  generateBusinessDocumentPdf,
  generateInvoicePdf,
  generateReportPdf,
  generateStatementPdf,
  PdfGenerationError,
  renderHtmlToPdf,
} from "./pdf-generation-service";
import { businessDocumentPdfHtml, invoicePdfHtml, reportPdfHtml, statementPdfHtml } from "./pdf-documents";
import type { BusinessDocument } from "@/server/report-centre/documents";
import type { ReportResult } from "@/server/report-centre/types";

const HTML = "<!doctype html><html><body><p>INV-0017</p></body></html>";
const ORIGINAL_BROWSER_PATH = process.env.PDF_BROWSER_PATH;

beforeEach(() => {
  requestHandlers.length = 0;
  launchMock.mockReset().mockResolvedValue(mockBrowser);
  executablePathMock.mockReset().mockResolvedValue("/opt/chromium");
  mockBrowser.newPage.mockReset().mockResolvedValue(mockPage);
  mockBrowser.close.mockReset().mockResolvedValue(undefined);
  for (const fn of [mockPage.setJavaScriptEnabled, mockPage.setRequestInterception, mockPage.setContent, mockPage.goto, mockPage.setExtraHTTPHeaders, mockPage.setCookie]) {
    fn.mockReset().mockResolvedValue(undefined);
  }
  mockPage.pdf.mockReset().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])); // "%PDF"
  vi.mocked(invoicePdfHtml).mockReset().mockResolvedValue(HTML);
  vi.mocked(statementPdfHtml).mockReset().mockResolvedValue(HTML);
  vi.mocked(reportPdfHtml).mockReset().mockResolvedValue(HTML);
  vi.mocked(businessDocumentPdfHtml).mockReset().mockResolvedValue(HTML);
  delete process.env.PDF_BROWSER_PATH;
});

afterEach(() => {
  if (ORIGINAL_BROWSER_PATH === undefined) delete process.env.PDF_BROWSER_PATH;
  else process.env.PDF_BROWSER_PATH = ORIGINAL_BROWSER_PATH;
});

function intercepted(url: string) {
  const request = { url: () => url, continue: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) };
  for (const handler of requestHandlers) handler(request);
  return request;
}

describe("renderHtmlToPdf — loads no URL", () => {
  it("hands the browser the finished HTML and never navigates", async () => {
    await renderHtmlToPdf(HTML);
    expect(mockPage.setContent).toHaveBeenCalledWith(HTML, expect.objectContaining({ waitUntil: "load" }));
    expect(mockPage.goto).not.toHaveBeenCalled();
  });

  it("never gives the browser a cookie, header or credential", async () => {
    await renderHtmlToPdf(HTML);
    expect(mockPage.setExtraHTTPHeaders).not.toHaveBeenCalled();
    expect(mockPage.setCookie).not.toHaveBeenCalled();
  });

  it("runs no JavaScript in the document", async () => {
    await renderHtmlToPdf(HTML);
    expect(mockPage.setJavaScriptEnabled).toHaveBeenCalledWith(false);
  });

  it("refuses every network request — the Vercel deployment, the app, localhost, anything", async () => {
    await renderHtmlToPdf(HTML);
    expect(mockPage.setRequestInterception).toHaveBeenCalledWith(true);
    for (const url of ["https://web-9hay38hsn-vyronsa.vercel.app/company/x/documents/invoice/1/pdf-view", "https://web-omega-liard-89.vercel.app/", "http://127.0.0.1:3000/", "https://fonts.gstatic.com/x.woff2"]) {
      const request = intercepted(url);
      expect(request.abort).toHaveBeenCalled();
      expect(request.continue).not.toHaveBeenCalled();
    }
  });

  it("allows only inline data: resources (embedded fonts and logo)", async () => {
    await renderHtmlToPdf(HTML);
    const request = intercepted("data:font/woff2;base64,AAAA");
    expect(request.continue).toHaveBeenCalled();
    expect(request.abort).not.toHaveBeenCalled();
  });
});

describe("renderHtmlToPdf — output and browser lifecycle", () => {
  it("prints A4 with backgrounds and top/bottom page margins", async () => {
    await renderHtmlToPdf(HTML);
    expect(mockPage.pdf).toHaveBeenCalledWith({ format: "A4", printBackground: true, margin: { top: "10mm", right: "0", bottom: "10mm", left: "0" } });
  });

  it("returns the PDF bytes as a Buffer and closes the browser", async () => {
    const result = await renderHtmlToPdf(HTML);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.slice(0, 4).toString()).toBe("%PDF");
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("uses the serverless Chromium build by default", async () => {
    await renderHtmlToPdf(HTML);
    expect(launchMock).toHaveBeenCalledWith({ args: ["--no-sandbox"], executablePath: "/opt/chromium", headless: true });
  });

  it("uses a locally installed browser when PDF_BROWSER_PATH is set (development and tests)", async () => {
    process.env.PDF_BROWSER_PATH = "C:/Edge/msedge.exe";
    await renderHtmlToPdf(HTML);
    expect(launchMock).toHaveBeenCalledWith({ executablePath: "C:/Edge/msedge.exe", headless: true });
    expect(executablePathMock).not.toHaveBeenCalled();
  });
});

describe("honest error handling", () => {
  it("never exposes a raw Chromium/Puppeteer error", async () => {
    launchMock.mockRejectedValue(new Error("/opt/chromium: EACCES permission denied at /tmp/secret-path"));
    const caught = await renderHtmlToPdf(HTML).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(PdfGenerationError);
    expect(String(caught)).not.toContain("/tmp/secret-path");
    expect(String(caught)).not.toContain("EACCES");
  });

  it("closes the browser even when page.pdf() throws", async () => {
    mockPage.pdf.mockRejectedValue(new Error("rendering crashed"));
    await expect(renderHtmlToPdf(HTML)).rejects.toBeInstanceOf(PdfGenerationError);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("does not try to close a browser that never launched", async () => {
    launchMock.mockRejectedValue(new Error("launch failed"));
    await expect(renderHtmlToPdf(HTML)).rejects.toBeInstanceOf(PdfGenerationError);
    expect(mockBrowser.close).not.toHaveBeenCalled();
  });
});

describe("the four document kinds", () => {
  it("invoice — builds the invoice server-side for the exact company and invoice", async () => {
    await generateInvoicePdf("company-a", 501);
    expect(invoicePdfHtml).toHaveBeenCalledWith("company-a", 501);
    expect(mockPage.setContent).toHaveBeenCalledWith(HTML, expect.anything());
  });

  it("invoice not found → PdfGenerationError, no browser launched", async () => {
    vi.mocked(invoicePdfHtml).mockResolvedValue(null);
    await expect(generateInvoicePdf("company-a", 999)).rejects.toBeInstanceOf(PdfGenerationError);
    expect(launchMock).not.toHaveBeenCalled();
  });

  it("statement — for the exact company and customer", async () => {
    await generateStatementPdf("company-a", 42);
    expect(statementPdfHtml).toHaveBeenCalledWith("company-a", 42);
  });

  it("report — renders the report result the caller already ran", async () => {
    const result = { title: "Trial Balance" } as ReportResult;
    await generateReportPdf("company-a", result);
    expect(reportPdfHtml).toHaveBeenCalledWith("company-a", result);
  });

  it("Document Centre document — renders the document the caller loaded", async () => {
    const document = { title: "Supplier Bill", number: "016083" } as BusinessDocument;
    await generateBusinessDocumentPdf("company-a", document);
    expect(businessDocumentPdfHtml).toHaveBeenCalledWith("company-a", document);
  });
});

describe("source guard", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/server/pdf/pdf-generation-service.ts"), "utf8");
  it("never reads the deployment URL or navigates the browser", () => {
    expect(source).not.toMatch(/process\.env\.VERCEL_URL/);
    expect(source).not.toMatch(/\.goto\(/);
    expect(source).not.toMatch(/setExtraHTTPHeaders|setCookie/);
  });
});
