import { describe, expect, it } from "vitest";
import { canTransitionInvoiceStatus, computeInvoiceableLines, validateInvoiceLines, ValidationError } from "./sales-invoice-service";
import type { SalesInvoiceStatus } from "@/server/sales/types";

describe("canTransitionInvoiceStatus", () => {
  it("allows Draft -> Submitted -> Approved", () => {
    expect(canTransitionInvoiceStatus("Draft", "Submitted")).toBe(true);
    expect(canTransitionInvoiceStatus("Submitted", "Approved")).toBe(true);
  });

  it("allows cancelling from Draft or Submitted", () => {
    expect(canTransitionInvoiceStatus("Draft", "Cancelled")).toBe(true);
    expect(canTransitionInvoiceStatus("Submitted", "Cancelled")).toBe(true);
  });

  it("rejects skipping Submitted (Draft cannot go straight to Approved)", () => {
    expect(canTransitionInvoiceStatus("Draft", "Approved")).toBe(false);
  });

  it("treats Approved, Posted, and Cancelled as terminal from this service's perspective (Approved -> Posted happens atomically inside approveAndPostInvoice, not as a separate manual transition)", () => {
    for (const from of ["Approved", "Posted", "Cancelled"] as SalesInvoiceStatus[]) {
      for (const to of ["Draft", "Submitted", "Approved", "Posted", "Cancelled"] as SalesInvoiceStatus[]) {
        expect(canTransitionInvoiceStatus(from, to)).toBe(false);
      }
    }
  });
});

describe("computeInvoiceableLines", () => {
  it("Finding #053 — invoices only the delivered-but-not-yet-invoiced remainder of a PartiallyDelivered order", () => {
    const result = computeInvoiceableLines([
      { id: 1, quantity: 10, deliveredQuantity: 6, invoicedQuantity: 0 },
      { id: 2, quantity: 5, deliveredQuantity: 5, invoicedQuantity: 5 },
    ]);
    expect(result).toEqual([{ id: 1, quantity: 10, deliveredQuantity: 6, invoicedQuantity: 0, invoiceQuantity: 6 }]);
  });

  it("excludes a line with nothing new to invoice", () => {
    const result = computeInvoiceableLines([{ id: 1, quantity: 10, deliveredQuantity: 6, invoicedQuantity: 6 }]);
    expect(result).toEqual([]);
  });

  it("never goes negative for an over-invoiced line (defensive)", () => {
    const result = computeInvoiceableLines([{ id: 1, quantity: 10, deliveredQuantity: 6, invoicedQuantity: 8 }]);
    expect(result).toEqual([]);
  });
});

describe("validateInvoiceLines", () => {
  it("accepts well-formed lines", () => {
    expect(() => validateInvoiceLines([{ description: "Consulting", quantity: 1, unitPrice: 1000 }])).not.toThrow();
  });

  it("rejects an empty line list", () => {
    expect(() => validateInvoiceLines([])).toThrow(ValidationError);
  });

  it("rejects a blank description", () => {
    expect(() => validateInvoiceLines([{ description: "  ", quantity: 1, unitPrice: 100 }])).toThrow(ValidationError);
  });
});
