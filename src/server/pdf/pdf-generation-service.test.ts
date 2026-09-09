/**
 * Phase 24A — every dependency is mocked; this NEVER launches a real
 * Chromium binary. Covers: URL construction (VERCEL_URL vs. incoming
 * request host), cookie forwarding (the session-authentication bridge
 * into the internal `pdf-view` page), honest error handling (never a
 * raw Puppeteer/Chromium error reaching a caller), and that the browser
 * is always closed, success or failure.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockPage = { setExtraHTTPHeaders: vi.fn(), goto: vi.fn(), pdf: vi.fn() };
const mockBrowser = { newPage: vi.fn(), close: vi.fn() };
const launchMock = vi.fn();
const executablePathMock = vi.fn();

vi.mock("puppeteer-core", () => ({ default: { launch: launchMock } }));
vi.mock("@sparticuz/chromium", () => ({ default: { args: ["--no-sandbox"], executablePath: executablePathMock } }));

import { generateInvoicePdf, generateStatementPdf, PdfGenerationError } from "./pdf-generation-service";

const ORIGINAL_VERCEL_URL = process.env.VERCEL_URL;

function request(overrides: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/companies/company-a/sales/invoices/1/pdf", { headers: overrides });
}

beforeEach(() => {
  launchMock.mockReset().mockResolvedValue(mockBrowser);
  executablePathMock.mockReset().mockResolvedValue("/opt/chromium");
  mockBrowser.newPage.mockReset().mockResolvedValue(mockPage);
  mockBrowser.close.mockReset().mockResolvedValue(undefined);
  mockPage.setExtraHTTPHeaders.mockReset().mockResolvedValue(undefined);
  mockPage.goto.mockReset().mockResolvedValue({ ok: () => true, status: () => 200 });
  mockPage.pdf.mockReset().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])); // "%PDF"
  delete process.env.VERCEL_URL;
});

afterEach(() => {
  if (ORIGINAL_VERCEL_URL === undefined) delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL = ORIGINAL_VERCEL_URL;
});

describe("generateInvoicePdf — URL construction", () => {
  it("uses VERCEL_URL (https) when set, over the incoming request's own host", async () => {
    process.env.VERCEL_URL = "my-app.vercel.app";
    await generateInvoicePdf(request({ host: "attacker-controlled.example" }), "company-a", 501);
    expect(mockPage.goto).toHaveBeenCalledWith("https://my-app.vercel.app/company/company-a/documents/invoice/501/pdf-view", expect.anything());
  });

  it("falls back to the request's own host/proto only when VERCEL_URL is absent (local dev)", async () => {
    await generateInvoicePdf(request({ host: "localhost:3000", "x-forwarded-proto": "http" }), "company-a", 501);
    expect(mockPage.goto).toHaveBeenCalledWith("http://localhost:3000/company/company-a/documents/invoice/501/pdf-view", expect.anything());
  });
});

describe("generateStatementPdf — URL construction", () => {
  it("targets the statement pdf-view path for the exact customer", async () => {
    process.env.VERCEL_URL = "my-app.vercel.app";
    await generateStatementPdf(request(), "company-a", 42);
    expect(mockPage.goto).toHaveBeenCalledWith("https://my-app.vercel.app/company/company-a/documents/statement/42/pdf-view", expect.anything());
  });
});

describe("cookie forwarding", () => {
  it("forwards the incoming request's Cookie header to the internal page (session bridge)", async () => {
    await generateInvoicePdf(request({ cookie: "sb-session=abc123" }), "company-a", 501);
    expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledWith({ cookie: "sb-session=abc123" });
  });

  it("does not set a Cookie header at all when the incoming request has none", async () => {
    await generateInvoicePdf(request(), "company-a", 501);
    expect(mockPage.setExtraHTTPHeaders).not.toHaveBeenCalled();
  });
});

describe("PDF options and result", () => {
  it("requests A4 with printed backgrounds and zero margins (the document supplies its own padding)", async () => {
    await generateInvoicePdf(request(), "company-a", 501);
    expect(mockPage.pdf).toHaveBeenCalledWith({ format: "A4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
  });

  it("returns a real Buffer of the PDF bytes", async () => {
    const result = await generateInvoicePdf(request(), "company-a", 501);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.slice(0, 4).toString()).toBe("%PDF");
  });

  it("always closes the browser after a successful generation", async () => {
    await generateInvoicePdf(request(), "company-a", 501);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });
});

describe("honest error handling", () => {
  it("throws PdfGenerationError, never exposing the raw status, when the internal page fails to load", async () => {
    mockPage.goto.mockResolvedValue({ ok: () => false, status: () => 404 });
    await expect(generateInvoicePdf(request(), "company-a", 501)).rejects.toBeInstanceOf(PdfGenerationError);
  });

  it("throws a generic PdfGenerationError (never the raw Chromium/Puppeteer error) when launch itself fails", async () => {
    launchMock.mockRejectedValue(new Error("/opt/chromium: no such file or directory, EACCES permission denied at /tmp/secret-path"));
    let caught: unknown;
    try {
      await generateInvoicePdf(request(), "company-a", 501);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PdfGenerationError);
    expect(String(caught)).not.toContain("/tmp/secret-path");
    expect(String(caught)).not.toContain("EACCES");
  });

  it("closes the browser even when page.pdf() itself throws", async () => {
    mockPage.pdf.mockRejectedValue(new Error("rendering crashed"));
    await expect(generateInvoicePdf(request(), "company-a", 501)).rejects.toBeInstanceOf(PdfGenerationError);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("does not attempt to close a browser that never successfully launched", async () => {
    launchMock.mockRejectedValue(new Error("launch failed"));
    await expect(generateInvoicePdf(request(), "company-a", 501)).rejects.toBeInstanceOf(PdfGenerationError);
    expect(mockBrowser.close).not.toHaveBeenCalled();
  });
});
