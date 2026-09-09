import { describe, expect, it } from "vitest";
import { buildInvoiceEmailHtml, buildStatementEmailHtml } from "./document-email-template";
import type { Company } from "@/server/company-management/types";

// Matches this module's own `money()` exactly (`toLocaleString(undefined, ...)`
// — the SAME locale-dependent convention already used throughout this
// codebase, e.g. invoice-document.tsx/statement-document.tsx) — computed
// the same way here rather than hardcoded, since the runtime's default
// locale (and therefore the exact grouping/decimal characters) can differ
// between environments.
function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "company-a", organisationId: "org_1", name: "Fenwick & Rowe Ltd", industry: "Professional Services",
    status: "active", registrationNumber: "2019/123456/07", address: "12 Fenwick Street, Cape Town",
    financialYearStartMonth: 3, baseCurrencyCode: "ZAR", createdAt: "2025-02-10T09:00:00Z",
    tradingName: "", vatNumber: "", telephone: "", email: "", website: "", postalAddress: "",
    city: "", province: "", postalCode: "", country: "",
    ...overrides,
  };
}

describe("buildInvoiceEmailHtml", () => {
  it("includes the real invoice figures, never fabricated ones", () => {
    const html = buildInvoiceEmailHtml({
      company: company({ tradingName: "Fenwick & Rowe" }),
      branding: { logoDataUri: null },
      customerName: "Northwood Management",
      documentLabel: "Tax Invoice",
      invoiceNumber: "INV000125",
      invoiceDate: "2026-08-01",
      total: 1150.75,
      outstanding: 0,
    });
    expect(html).toContain("Northwood Management");
    expect(html).toContain("INV000125");
    expect(html).toContain("2026-08-01");
    expect(html).toContain(money(1150.75));
  });

  it("shows Outstanding only when there really is one", () => {
    const withOutstanding = buildInvoiceEmailHtml({
      company: company(), branding: { logoDataUri: null }, customerName: "X", documentLabel: "Tax Invoice",
      invoiceNumber: "INV1", invoiceDate: "2026-08-01", total: 100, outstanding: 50,
    });
    expect(withOutstanding).toContain("Outstanding");
    expect(withOutstanding).toContain(money(50));

    const withoutOutstanding = buildInvoiceEmailHtml({
      company: company(), branding: { logoDataUri: null }, customerName: "X", documentLabel: "Tax Invoice",
      invoiceNumber: "INV1", invoiceDate: "2026-08-01", total: 100, outstanding: 0,
    });
    expect(withoutOutstanding).not.toContain("Outstanding");
  });

  it("shows the logo img tag only when a data URI is supplied", () => {
    const withLogo = buildInvoiceEmailHtml({
      company: company(), branding: { logoDataUri: "data:image/png;base64,AAAA" }, customerName: "X", documentLabel: "Tax Invoice",
      invoiceNumber: "INV1", invoiceDate: "2026-08-01", total: 100, outstanding: 0,
    });
    expect(withLogo).toContain("data:image/png;base64,AAAA");

    const withoutLogo = buildInvoiceEmailHtml({
      company: company(), branding: { logoDataUri: null }, customerName: "X", documentLabel: "Tax Invoice",
      invoiceNumber: "INV1", invoiceDate: "2026-08-01", total: 100, outstanding: 0,
    });
    expect(withoutLogo).not.toContain("<img");
  });

  it("omits empty company contact fields rather than showing a placeholder", () => {
    const html = buildInvoiceEmailHtml({
      company: company({ telephone: "", email: "", website: "", vatNumber: "" }),
      branding: { logoDataUri: null }, customerName: "X", documentLabel: "Tax Invoice",
      invoiceNumber: "INV1", invoiceDate: "2026-08-01", total: 100, outstanding: 0,
    });
    expect(html).not.toContain("Tel:");
    expect(html).not.toContain("VAT No:");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("includes populated company contact fields", () => {
    const html = buildInvoiceEmailHtml({
      company: company({ telephone: "021 555 0123", email: "accounts@fenwickrowe.co.za", vatNumber: "4123456789" }),
      branding: { logoDataUri: null }, customerName: "X", documentLabel: "Tax Invoice",
      invoiceNumber: "INV1", invoiceDate: "2026-08-01", total: 100, outstanding: 0,
    });
    expect(html).toContain("021 555 0123");
    expect(html).toContain("accounts@fenwickrowe.co.za");
    expect(html).toContain("4123456789");
  });

  it("escapes HTML-unsafe characters in customer name (defends against stored XSS in a customer record)", () => {
    const html = buildInvoiceEmailHtml({
      company: company(), branding: { logoDataUri: null }, customerName: '<script>alert(1)</script>', documentLabel: "Tax Invoice",
      invoiceNumber: "INV1", invoiceDate: "2026-08-01", total: 100, outstanding: 0,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("indicates a PDF attachment is present", () => {
    const html = buildInvoiceEmailHtml({
      company: company(), branding: { logoDataUri: null }, customerName: "X", documentLabel: "Tax Invoice",
      invoiceNumber: "INV1", invoiceDate: "2026-08-01", total: 100, outstanding: 0,
    });
    expect(html.toLowerCase()).toContain("attached");
  });
});

describe("buildStatementEmailHtml", () => {
  it("includes the real closing balance and as-of date, never fabricated ones", () => {
    const html = buildStatementEmailHtml({
      company: company(), branding: { logoDataUri: null }, customerName: "Northwood Management", asOfDate: "2026-07-31", closingBalance: 4520.5,
    });
    expect(html).toContain("Northwood Management");
    expect(html).toContain("2026-07-31");
    expect(html).toContain(money(4520.5));
  });

  it("never mentions a statement period the current engine doesn't support", () => {
    const html = buildStatementEmailHtml({
      company: company(), branding: { logoDataUri: null }, customerName: "X", asOfDate: "2026-07-31", closingBalance: 0,
    });
    expect(html.toLowerCase()).not.toContain("period");
  });
});
