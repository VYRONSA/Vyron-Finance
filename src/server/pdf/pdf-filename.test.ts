import { describe, expect, it } from "vitest";
import { invoicePdfFilename, statementPdfFilename } from "./pdf-filename";
import type { SalesInvoice } from "@/server/sales/types";

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 1, companyId: "company-a", documentType: "Invoice", invoiceNumber: "INV000125", customerId: 1, invoiceDate: "2026-08-01",
    dueDate: null, reference: "", status: "Posted", subtotal: 100, vatAmount: 15, total: 115, outstanding: 0, notes: "",
    lines: [], journalId: null, createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  } as SalesInvoice;
}

describe("invoicePdfFilename", () => {
  it("uses the real invoiceNumber, not an invented format", () => {
    expect(invoicePdfFilename(invoice({ invoiceNumber: "INV000125" }))).toBe("INV000125.pdf");
  });

  it("uses the real invoiceNumber for a Credit Note too, unchanged from its own real identifier", () => {
    expect(invoicePdfFilename(invoice({ invoiceNumber: "CN000014", documentType: "Credit Note" }))).toBe("CN000014.pdf");
  });

  it("sanitizes characters unsafe for a filename/Content-Disposition header", () => {
    expect(invoicePdfFilename(invoice({ invoiceNumber: 'INV/000"125<>' }))).toBe("INV-000-125.pdf");
  });

  it("never produces an empty filename", () => {
    expect(invoicePdfFilename(invoice({ invoiceNumber: "///" }))).toBe("document.pdf");
  });
});

describe("statementPdfFilename", () => {
  it("builds a predictable name from the real customer name and as-of date", () => {
    expect(statementPdfFilename("Northwood Management", "2026-07-31")).toBe("STATEMENT-Northwood-Management-2026-07-31.pdf");
  });

  it("sanitizes a customer name with special characters", () => {
    expect(statementPdfFilename("O'Brien & Sons (Pty) Ltd", "2026-07-31")).toBe("STATEMENT-O-Brien-Sons-Pty-Ltd-2026-07-31.pdf");
  });

  it("strips diacritics", () => {
    expect(statementPdfFilename("Café Deluxe", "2026-07-31")).toContain("STATEMENT-Cafe-Deluxe");
  });
});
