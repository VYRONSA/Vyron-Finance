/**
 * Phase 5I — invoice document presentation.
 *
 * Presentation only: no amount, VAT figure, rate or conversion is
 * computed here. Every number rendered comes from the already-saved
 * invoice, exactly as before; what changed is that the currency is
 * stated, and that a company can choose to show how to pay.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { InvoiceDocumentBody } from "./invoice-body";
import type { SalesInvoice, SalesInvoiceLine } from "@/server/sales/types";

function line(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    id: 1, invoiceId: 1, lineOrder: 1, description: "Consulting services", quantity: 2, unitPrice: 500,
    lineTotal: 1000, stockItemId: null, glAccount: null, vatCode: null, discount: 0, netAmount: 1000, vatAmount: 0,
    ...overrides,
  };
}

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 1, companyId: "co_1", customerId: 1, invoiceNumber: "INV000001", documentType: "Invoice",
    invoiceDate: "2026-06-01", dueDate: "2026-06-30", status: "Posted", reference: "PO-1",
    subtotal: 1000, vatAmount: 150, total: 1150, outstanding: 1150, notes: "",
    vatTreatmentCode: "STD", orderId: null, journalId: null, originalInvoiceId: null,
    submittedAt: null, approvedAt: null, postedAt: null, cancelledAt: null,
    createdAt: "2026-06-01T00:00:00Z", lines: [line()],
    ...overrides,
  } as SalesInvoice;
}

const BANK = { bankName: "First National Bank", accountName: "Acme Ltd", accountNumber: "62050837304", branch: "250655" };

function renderBody(props: Partial<React.ComponentProps<typeof InvoiceDocumentBody>> = {}) {
  return render(
    <InvoiceDocumentBody
      invoice={invoice()}
      customer={{ name: "Meridian Traders", vatNumber: "4123456789", registrationNumber: "2016/112233/07" }}
      addressLine="1 Long Street, Cape Town"
      letterhead={<div>LETTERHEAD</div>}
      {...props}
    />,
  );
}

describe("currency presentation", () => {
  it("states the company's currency against the totals", () => {
    renderBody({ currencyCode: "ZAR" });
    // Total and Amount Due are both 1,150.00 on this fixture.
    expect(screen.getAllByText("ZAR 1,150.00").length).toBeGreaterThan(0);
    expect(screen.getByText("ZAR 1,000.00")).toBeInTheDocument();
    expect(screen.getByText("ZAR 150.00")).toBeInTheDocument();
  });

  it("falls back to bare numbers when no currency is configured — unchanged behaviour", () => {
    renderBody({});
    expect(screen.getAllByText("1,150.00").length).toBeGreaterThan(0);
    expect(screen.queryByText(/ZAR/)).not.toBeInTheDocument();
  });

  it("does not alter the figures themselves", () => {
    // The same invoice totals appear either way; only the prefix differs.
    const { unmount } = renderBody({});
    expect(screen.getAllByText("1,150.00").length).toBeGreaterThan(0);
    unmount();
    renderBody({ currencyCode: "USD" });
    expect(screen.getAllByText("USD 1,150.00").length).toBeGreaterThan(0);
  });

  it("labels the amount still owed as Amount Due", () => {
    renderBody({ currencyCode: "ZAR" });
    expect(screen.getByText("Amount Due")).toBeInTheDocument();
  });
});

describe("payment details", () => {
  it("prints nothing when the company configured nothing", () => {
    renderBody({});
    expect(screen.queryByText("Payment Details")).not.toBeInTheDocument();
  });

  it("prints the banking details a payer needs", () => {
    renderBody({ paymentDetails: { bankAccount: BANK } });
    expect(screen.getByText("Payment Details")).toBeInTheDocument();
    expect(screen.getByText("First National Bank")).toBeInTheDocument();
    expect(screen.getByText("62050837304")).toBeInTheDocument();
    expect(screen.getByText("250655")).toBeInTheDocument();
  });

  it("states the reference to use — the document's own number", () => {
    renderBody({ paymentDetails: { bankAccount: BANK } });
    // The header block also carries a "Reference:" label, so both exist.
    expect(screen.getAllByText(/Reference:/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("INV000001").length).toBeGreaterThan(0);
  });

  it("prints the company's payment instructions alongside", () => {
    renderBody({ paymentDetails: { bankAccount: BANK, paymentInstructions: "EFT only, no cheques." } });
    expect(screen.getByText("EFT only, no cheques.")).toBeInTheDocument();
  });

  it("prints the footer when one is configured", () => {
    renderBody({ paymentDetails: { footer: "Standard trading terms apply. E&OE." } });
    expect(screen.getByText("Standard trading terms apply. E&OE.")).toBeInTheDocument();
  });

  it("omits the banking block but keeps the footer when no account was ticked", () => {
    renderBody({ paymentDetails: { bankAccount: null, footer: "E&OE" } });
    expect(screen.queryByText("Payment Details")).not.toBeInTheDocument();
    expect(screen.getByText("E&OE")).toBeInTheDocument();
  });
});

describe("SARS-relevant particulars still present", () => {
  it('titles a tax invoice "Tax Invoice"', () => {
    renderBody({});
    expect(screen.getByText("Tax Invoice")).toBeInTheDocument();
  });

  it("shows the recipient's name, VAT number and registration number", () => {
    renderBody({});
    expect(screen.getByText("Meridian Traders")).toBeInTheDocument();
    expect(screen.getByText(/4123456789/)).toBeInTheDocument();
    expect(screen.getByText(/2016\/112233\/07/)).toBeInTheDocument();
  });

  it("shows the serial number, date and quantity", () => {
    renderBody({});
    expect(screen.getAllByText("INV000001").length).toBeGreaterThan(0);
    expect(screen.getByText("2026-06-01")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders the notes the create form can now capture", () => {
    renderBody({ invoice: invoice({ notes: "Thank you for your business." }) });
    expect(screen.getByText("Thank you for your business.")).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------
 * Phase 5J — figures that are now real, and the particulars VAT Act
 * s21(3) requires on a credit or debit note. Still presentation only:
 * every number below is read from the saved invoice, never recomputed.
 * ------------------------------------------------------------------- */

describe("Phase 5J — per-line VAT and discount on the document", () => {
  it("7. prints each line's own VAT instead of a dash on every line", () => {
    renderBody({
      invoice: invoice({
        lines: [
          line({ id: 1, description: "Standard-rated work", netAmount: 1000, vatAmount: 150, lineTotal: 1150 }),
          line({ id: 2, description: "Zero-rated export", netAmount: 500, vatAmount: 0, lineTotal: 500 }),
        ],
        subtotal: 1500, vatAmount: 150, total: 1650, outstanding: 1650,
      }),
    });
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    // Columns: Description | Qty | Unit Price | VAT | Total
    expect(within(rows[0]).getAllByRole("cell")[3]).toHaveTextContent("150.00");
    // A zero-rated line now states zero, which is a fact — not "—", which
    // used to mean "this document never computed line VAT at all".
    expect(within(rows[1]).getAllByRole("cell")[3]).toHaveTextContent("0.00");
    expect(within(screen.getByRole("table")).queryByText("—")).not.toBeInTheDocument();
  });

  it("shows no Discount column when no line carries one", () => {
    renderBody();
    expect(within(screen.getByRole("table")).queryByRole("columnheader", { name: "Discount" })).not.toBeInTheDocument();
  });

  it("shows a Discount column, with the line's own discount, as soon as a line carries one", () => {
    renderBody({
      invoice: invoice({
        lines: [line({ discount: 100, netAmount: 900, vatAmount: 135, lineTotal: 1035 })],
        subtotal: 900, vatAmount: 135, total: 1035, outstanding: 1035,
      }),
    });
    const table = within(screen.getByRole("table"));
    expect(table.getByRole("columnheader", { name: "Discount" })).toBeInTheDocument();
    // Columns become: Description | Qty | Unit Price | Discount | VAT | Total
    const cells = within(table.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("−100.00");
    expect(cells[5]).toHaveTextContent("1,035.00");
  });

  it("16. sums the discount total from the saved lines — it never recomputes it from prices", () => {
    const { container } = renderBody({
      invoice: invoice({
        lines: [
          line({ id: 1, discount: 60, netAmount: 940, vatAmount: 141, lineTotal: 1081 }),
          line({ id: 2, discount: 40, netAmount: 460, vatAmount: 69, lineTotal: 529 }),
        ],
        subtotal: 1400, vatAmount: 210, total: 1610, outstanding: 1610,
      }),
    });
    const totals = container.querySelector("dl.w-64")!;
    expect(within(totals as HTMLElement).getByText("Discount").parentElement).toHaveTextContent("−100.00");
    expect(within(totals as HTMLElement).getByText("Subtotal").parentElement).toHaveTextContent("1,400.00");
    expect(within(totals as HTMLElement).getByText("Total").parentElement).toHaveTextContent("1,610.00");
  });
});

describe("Phase 5J — credit and debit note particulars (VAT Act s21(3))", () => {
  const original = { invoiceNumber: "INV000042", invoiceDate: "2026-05-14" };

  for (const documentType of ["Credit Note", "Debit Note"] as const) {
    it(`34./41. titles a ${documentType} with exactly those words — s21(3) allows no alternative wording`, () => {
      renderBody({ invoice: invoice({ documentType }) });
      expect(screen.getByText(documentType)).toBeInTheDocument();
    });

    it(`32./39. prints the original tax invoice's number AND date on a ${documentType}`, () => {
      renderBody({
        invoice: invoice({ documentType, originalInvoiceId: 42, reason: "Goods returned damaged" }),
        originalInvoice: original,
      });
      expect(screen.getByText(/INV000042 dated 2026-05-14/)).toBeInTheDocument();
    });

    it(`33./40. prints the stated reason on a ${documentType}`, () => {
      renderBody({
        invoice: invoice({ documentType, originalInvoiceId: 42, reason: "Charged for 400 units instead of 300" }),
        originalInvoice: original,
      });
      expect(screen.getByText("Charged for 400 units instead of 300")).toBeInTheDocument();
    });

    it(`says plainly when a pre-5J ${documentType} carries neither, rather than printing a blank that reads as compliant`, () => {
      renderBody({ invoice: invoice({ documentType, originalInvoiceId: null, reason: "" }), originalInvoice: null });
      expect(screen.getAllByText("not recorded on this document")).toHaveLength(2);
    });
  }

  it("prints no adjustment block at all on an Invoice — there is no earlier document to reference", () => {
    renderBody({ invoice: invoice({ documentType: "Invoice" }) });
    expect(screen.queryByText(/adjusts tax invoice/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Reason:/i)).not.toBeInTheDocument();
  });
});
