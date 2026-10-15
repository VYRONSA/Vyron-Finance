import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InvoicesTab } from "./invoices-tab";
import type { Customer } from "@/server/customer-management/types";
import type { SalesInvoice, SalesInvoiceLine } from "@/server/sales/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

const customer = { id: 10, companyId: "co_1", name: "Acme Retail" } as Customer;
const line = (id: number, glAccount: string | null) => ({ id, glAccount, description: `Line ${id}`, quantity: 1, unitPrice: 100, lineTotal: 115 }) as SalesInvoiceLine;

function invoice(id: number, overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id, companyId: "co_1", customerId: 10, orderId: null, deliveryId: null, invoiceNumber: `SI-${id}`, documentType: "Invoice", invoiceDate: "2026-09-01",
    dueDate: "2026-09-30", vatTreatmentCode: "Standard Rated", status: "Posted", journalId: 1000 + id, subtotal: 100, vatAmount: 15, total: 115, outstanding: 115,
    isRecurringTemplate: false, recurrencePattern: "", reference: "", notes: "", createdAt: "2026-09-01T00:00:00Z", submittedBy: null, submittedAt: null,
    approvedBy: null, approvedAt: null, postedAt: "2026-10-15T06:10:00Z", cancelledBy: null, cancelledAt: null, originalInvoiceId: null, reason: "",
    paymentTermsDays: null, lines: [line(id * 10, null)], ...overrides,
  } as SalesInvoice;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ scopes: [] }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderTab = (invoices: SalesInvoice[]) =>
  render(<InvoicesTab companyId="co_1" invoices={invoices} customers={[customer]} vatTreatments={[]} chartOfAccounts={[]} previewMode={false} />);

describe("InvoicesTab — bulk account repair selection", () => {
  it("offers a selection box only on Posted invoices with a line without an account", () => {
    renderTab([
      invoice(1),
      invoice(2, { status: "Draft", journalId: null }),
      invoice(3, { documentType: "Credit Note" }),
      invoice(4, { lines: [line(40, "1000")] }),
      invoice(5),
    ]);
    expect(screen.getByLabelText("Select SI-1 for account repair")).toBeInTheDocument();
    expect(screen.getByLabelText("Select SI-5 for account repair")).toBeInTheDocument();
    for (const n of ["SI-2", "SI-3", "SI-4"]) expect(screen.queryByLabelText(`Select ${n} for account repair`)).toBeNull();
    expect(screen.getByText("2 posted invoice(s) have lines without a revenue account.")).toBeInTheDocument();
  });

  it("counts a row ticked in the table", () => {
    renderTab([invoice(1), invoice(5)]);
    fireEvent.click(screen.getByLabelText("Select SI-5 for account repair"));
    expect(screen.getByText(/Selected:/).textContent).toBe("Selected: 1 invoice(s), 1 line(s) without an account, invoice total R115.00.");
  });

  it("adds no column and no panel when nothing needs repair", () => {
    renderTab([invoice(1, { lines: [line(1, "1000")] })]);
    expect(screen.queryByLabelText("Repair missing revenue accounts")).toBeNull();
    expect(screen.queryByText("Select for account repair")).toBeNull();
  });
});
