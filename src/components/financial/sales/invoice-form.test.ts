/**
 * Phase 5I — invoice create-form validation.
 *
 * Deliberately mirrors the server's own rules
 * (`sales-invoice-service.ts::validateInvoiceLines` and the required-field
 * checks above it). The server re-validates all of this and remains the
 * authority; this exists so the person is told WHICH field is wrong
 * before a round trip.
 *
 * Phase 5J — the boundary moved. A discount is now an accounting input:
 * it reduces what is charged and the VAT charged on it, so the form
 * checks its bounds (the server enforces the same ones). A credit or
 * debit note's required particulars are checked here too. The form still
 * computes no VAT of its own — it previews the server's own calculation
 * module and the server's stored result remains the authority.
 */
import { describe, expect, it } from "vitest";
import { validateInvoiceForm } from "./invoices-tab";

const line = { description: "Consulting", quantity: "1", unitPrice: "100", glAccount: null, vatCode: null, discount: "0" };
const valid = { customerId: 7, invoiceDate: "2026-06-01", dueDate: "2026-06-30", lines: [line] };

describe("validateInvoiceForm", () => {
  it("accepts a complete document", () => {
    expect(validateInvoiceForm(valid)).toEqual({});
  });

  it("REQUIRES a customer — nothing may be billed by default", () => {
    // The form no longer preselects `customers[0]`, so 0 means "nobody
    // chosen" and must be refused rather than silently billing someone.
    expect(validateInvoiceForm({ ...valid, customerId: 0 }).customerId).toMatch(/choose the customer/i);
  });

  it("requires an invoice date", () => {
    expect(validateInvoiceForm({ ...valid, invoiceDate: "" }).invoiceDate).toMatch(/invoice date is required/i);
  });

  it("leaves the due date optional", () => {
    expect(validateInvoiceForm({ ...valid, dueDate: "" }).dueDate).toBeUndefined();
  });

  it("rejects a due date before the invoice date", () => {
    // This would feed AR ageing with a document that was overdue the
    // moment it was raised.
    expect(validateInvoiceForm({ ...valid, dueDate: "2026-05-31" }).dueDate).toMatch(/cannot be before/i);
  });

  it("accepts a due date equal to the invoice date", () => {
    expect(validateInvoiceForm({ ...valid, dueDate: "2026-06-01" }).dueDate).toBeUndefined();
  });

  it("requires a description on every line", () => {
    const errors = validateInvoiceForm({ ...valid, lines: [{ ...line, description: "   " }] });
    expect(errors.lines?.[0]?.description).toMatch(/describe what/i);
  });

  it("requires a quantity greater than zero", () => {
    expect(validateInvoiceForm({ ...valid, lines: [{ ...line, quantity: "0" }] }).lines?.[0]?.quantity).toMatch(/more than zero/i);
    expect(validateInvoiceForm({ ...valid, lines: [{ ...line, quantity: "-2" }] }).lines?.[0]?.quantity).toMatch(/more than zero/i);
    expect(validateInvoiceForm({ ...valid, lines: [{ ...line, quantity: "" }] }).lines?.[0]?.quantity).toMatch(/enter a quantity/i);
  });

  it("rejects a negative unit price but allows zero", () => {
    expect(validateInvoiceForm({ ...valid, lines: [{ ...line, unitPrice: "-1" }] }).lines?.[0]?.unitPrice).toMatch(/cannot be negative/i);
    expect(validateInvoiceForm({ ...valid, lines: [{ ...line, unitPrice: "0" }] }).lines?.[0]?.unitPrice).toBeUndefined();
    expect(validateInvoiceForm({ ...valid, lines: [{ ...line, unitPrice: "" }] }).lines?.[0]?.unitPrice).toMatch(/enter a unit price/i);
  });

  it("names the line that is wrong, not just that something is", () => {
    const errors = validateInvoiceForm({
      ...valid,
      lines: [line, { ...line, description: "" }, line],
    });
    expect(Object.keys(errors.lines ?? {})).toEqual(["1"]);
  });

  /* Phase 5J replaced the 5I case that asserted the opposite ("says
   * nothing about VAT or discount"). That was correct while a discount
   * changed no figure; now that it reduces the charge and the VAT on it,
   * an unbounded discount is an accounting error and the form says so. */
  it("rejects a negative discount — it reduces the VAT charged, so it cannot be a surcharge in disguise", () => {
    const errors = validateInvoiceForm({ ...valid, lines: [{ ...line, discount: "-50" }] });
    expect(errors.lines?.[0]?.discount).toMatch(/cannot be negative/i);
  });

  it("rejects a discount larger than the line it applies to", () => {
    const errors = validateInvoiceForm({ ...valid, lines: [{ ...line, quantity: "2", unitPrice: "100", discount: "250" }] });
    expect(errors.lines?.[0]?.discount).toMatch(/more than the line/i);
  });

  it("accepts a discount exactly equal to the line (a fully discounted line is legitimate)", () => {
    const errors = validateInvoiceForm({ ...valid, lines: [{ ...line, quantity: "2", unitPrice: "100", discount: "200" }] });
    expect(errors.lines).toBeUndefined();
  });

  it("still says nothing about an unrecognised VAT code — the server names it, with the company's own treatments in hand", () => {
    const errors = validateInvoiceForm({ ...valid, lines: [{ ...line, vatCode: "NONSENSE" }] });
    expect(errors.lines).toBeUndefined();
  });

  describe("credit and debit note particulars (VAT Act s21(3))", () => {
    it("requires an Invoice to carry neither — there is no earlier document to reference", () => {
      expect(validateInvoiceForm({ ...valid, documentType: "Invoice" })).toEqual({});
    });

    for (const documentType of ["Credit Note", "Debit Note"] as const) {
      it(`requires a ${documentType} to name the invoice it adjusts`, () => {
        const errors = validateInvoiceForm({ ...valid, documentType, originalInvoiceId: null, reason: "Goods returned" });
        expect(errors.originalInvoiceId).toMatch(/choose the invoice/i);
      });

      it(`requires a ${documentType} to state a reason`, () => {
        const errors = validateInvoiceForm({ ...valid, documentType, originalInvoiceId: 42, reason: "   " });
        expect(errors.reason).toMatch(/say why/i);
      });

      it(`accepts a ${documentType} carrying both particulars`, () => {
        const errors = validateInvoiceForm({ ...valid, documentType, originalInvoiceId: 42, reason: "Charged for 400 units instead of 300" });
        expect(errors).toEqual({});
      });
    }
  });

  it("reports customer, date and line problems together", () => {
    const errors = validateInvoiceForm({
      customerId: 0,
      invoiceDate: "",
      dueDate: "",
      lines: [{ ...line, description: "", quantity: "0" }],
    });
    expect(errors.customerId).toBeDefined();
    expect(errors.invoiceDate).toBeDefined();
    expect(errors.lines?.[0]).toBeDefined();
  });
});
