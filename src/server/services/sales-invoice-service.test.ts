import { describe, expect, it } from "vitest";
import {
  canTransitionInvoiceStatus,
  computeInvoiceableLines,
  createSalesInvoice,
  resolveDueDate,
  validateAdjustmentNoteParticulars,
  validateInvoiceLines,
  ValidationError,
} from "./sales-invoice-service";
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

/* ---------------------------------------------------------------------
 * Phase 5J — payment terms and credit/debit note particulars.
 * ------------------------------------------------------------------- */

describe("validateInvoiceLines — discount bounds (Phase 5J)", () => {
  it("accepts a discount within the line", () => {
    expect(() => validateInvoiceLines([{ description: "Consulting", quantity: 2, unitPrice: 100, discount: 50 }])).not.toThrow();
  });

  it("accepts a discount exactly equal to the line", () => {
    expect(() => validateInvoiceLines([{ description: "Consulting", quantity: 2, unitPrice: 100, discount: 200 }])).not.toThrow();
  });

  it("rejects a negative discount — it would increase the VAT charged", () => {
    expect(() => validateInvoiceLines([{ description: "Consulting", quantity: 1, unitPrice: 100, discount: -10 }])).toThrow(/cannot be negative/i);
  });

  it("rejects a discount larger than the line — it would make the line, and the output VAT, negative", () => {
    expect(() => validateInvoiceLines([{ description: "Consulting", quantity: 1, unitPrice: 100, discount: 150 }])).toThrow(/more than the line/i);
  });

  it("treats an absent discount as zero", () => {
    expect(() => validateInvoiceLines([{ description: "Consulting", quantity: 1, unitPrice: 100 }])).not.toThrow();
  });
});

describe("resolveDueDate", () => {
  it("26. derives the due date from the customer's payment terms when none is given", () => {
    expect(resolveDueDate({ invoiceDate: "2026-06-01", customerPaymentTermsDays: 30 })).toEqual({
      dueDate: "2026-07-01",
      paymentTermsDays: 30,
    });
  });

  it("falls back to the company default when the customer has none", () => {
    expect(resolveDueDate({ invoiceDate: "2026-06-01", customerPaymentTermsDays: null, companyDefaultPaymentTermsDays: 14 })).toEqual({
      dueDate: "2026-06-15",
      paymentTermsDays: 14,
    });
  });

  it("prefers the customer's own terms over the company default", () => {
    const result = resolveDueDate({ invoiceDate: "2026-06-01", customerPaymentTermsDays: 7, companyDefaultPaymentTermsDays: 60 });
    expect(result).toEqual({ dueDate: "2026-06-08", paymentTermsDays: 7 });
  });

  it("27./28. an explicit due date wins, and records no derived terms — nothing computed it", () => {
    expect(resolveDueDate({ explicitDueDate: "2026-12-25", invoiceDate: "2026-06-01", customerPaymentTermsDays: 30 })).toEqual({
      dueDate: "2026-12-25",
      paymentTermsDays: null,
    });
  });

  it("treats 0-day terms as due on the invoice date, not as 'no terms'", () => {
    expect(resolveDueDate({ invoiceDate: "2026-06-01", customerPaymentTermsDays: 0 })).toEqual({
      dueDate: "2026-06-01",
      paymentTermsDays: 0,
    });
  });

  it("crosses month and year boundaries correctly", () => {
    expect(resolveDueDate({ invoiceDate: "2026-12-20", customerPaymentTermsDays: 30 }).dueDate).toBe("2027-01-19");
    expect(resolveDueDate({ invoiceDate: "2028-02-01", customerPaymentTermsDays: 29 }).dueDate).toBe("2028-03-01"); // leap year
  });

  it("does not shift a date across a DST boundary — the arithmetic is UTC, and the column is a DATE", () => {
    // South Africa has no DST, but the server running this does not have
    // to be in South Africa. Adding 30 days to 2026-10-01 must give
    // 2026-10-31 regardless of the host's zone.
    expect(resolveDueDate({ invoiceDate: "2026-10-01", customerPaymentTermsDays: 30 }).dueDate).toBe("2026-10-31");
    expect(resolveDueDate({ invoiceDate: "2026-03-01", customerPaymentTermsDays: 30 }).dueDate).toBe("2026-03-31");
  });

  it("30. yields no due date when there are no terms anywhere — it never invents one", () => {
    expect(resolveDueDate({ invoiceDate: "2026-06-01" })).toEqual({ dueDate: null, paymentTermsDays: null });
    expect(resolveDueDate({ invoiceDate: "2026-06-01", customerPaymentTermsDays: null, companyDefaultPaymentTermsDays: null })).toEqual({
      dueDate: null,
      paymentTermsDays: null,
    });
  });

  it("refuses to derive from negative or non-finite terms rather than producing a date before the invoice", () => {
    expect(resolveDueDate({ invoiceDate: "2026-06-01", customerPaymentTermsDays: -30 }).dueDate).toBeNull();
    expect(resolveDueDate({ invoiceDate: "2026-06-01", customerPaymentTermsDays: Number.NaN }).dueDate).toBeNull();
  });

  it("yields no due date from an unparseable invoice date instead of 'Invalid Date'", () => {
    expect(resolveDueDate({ invoiceDate: "not-a-date", customerPaymentTermsDays: 30 }).dueDate).toBeNull();
  });
});

describe("validateAdjustmentNoteParticulars (VAT Act s21(3))", () => {
  it("requires nothing of an Invoice — there is no earlier document to reference or explain", () => {
    expect(() => validateAdjustmentNoteParticulars({ documentType: "Invoice" })).not.toThrow();
    expect(() => validateAdjustmentNoteParticulars({ documentType: "Invoice", originalInvoiceId: null, reason: "" })).not.toThrow();
  });

  for (const documentType of ["Credit Note", "Debit Note"] as const) {
    const noun = documentType === "Credit Note" ? "credit note" : "debit note";

    it(`31./38. requires a ${documentType} to name the invoice it adjusts`, () => {
      expect(() => validateAdjustmentNoteParticulars({ documentType, originalInvoiceId: null, reason: "Goods returned" })).toThrow(
        new RegExp(`${noun} must name the invoice`, "i"),
      );
    });

    it(`33./40. requires a ${documentType} to state a reason`, () => {
      expect(() => validateAdjustmentNoteParticulars({ documentType, originalInvoiceId: 5, reason: "   " })).toThrow(
        new RegExp(`${noun} must state the reason`, "i"),
      );
      expect(() => validateAdjustmentNoteParticulars({ documentType, originalInvoiceId: 5 })).toThrow(ValidationError);
    });

    it(`accepts a ${documentType} carrying both particulars`, () => {
      expect(() =>
        validateAdjustmentNoteParticulars({ documentType, originalInvoiceId: 5, reason: "Charged for 400 units instead of 300" }),
      ).not.toThrow();
    });
  }

  it("treats invoice id 0 as 'not named' rather than a valid reference", () => {
    expect(() => validateAdjustmentNoteParticulars({ documentType: "Credit Note", originalInvoiceId: 0, reason: "x" })).toThrow(ValidationError);
  });
});

describe("createSalesInvoice — a caller may not choose the serial number (Phase 5J)", () => {
  /* The POST route passes the request body to the service verbatim, so
   * without this a Sales:Create user could name their own invoice number:
   * duplicate serials, or a number jumped ahead of the 0105 counter that a
   * later real invoice then collides with. VAT Act s20(4)(b) makes that
   * number a legal identifier.
   *
   * Asserted before any database work happens, so this needs no Supabase:
   * the rejection is the first thing `createSalesInvoice` does after its
   * required-field checks, and it throws before reaching a repository. */
  it("refuses a request that supplies its own invoice number", async () => {
    await expect(
      createSalesInvoice("co_1", {
        invoiceNumber: "INV999999",
        customerId: 1,
        invoiceDate: "2026-06-01",
        vatTreatmentCode: "Standard Rated",
        lines: [{ description: "Consulting", quantity: 1, unitPrice: 100 }],
      }),
    ).rejects.toThrow(/allocated by the system/i);
  });

  it("names the field rather than failing obscurely", async () => {
    await expect(
      createSalesInvoice("co_1", {
        invoiceNumber: "",
        customerId: 1,
        invoiceDate: "2026-06-01",
        vatTreatmentCode: "Standard Rated",
        lines: [{ description: "Consulting", quantity: 1, unitPrice: 100 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
