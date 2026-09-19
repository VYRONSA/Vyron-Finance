/**
 * Phase 5I — the customer, supplier and invoice CREATE panels, mounted.
 *
 * These exercise the real components with `previewMode={false}`, which is
 * the only way to reach the panels: in Preview Mode (no Supabase) every
 * mutation button is disabled, so a browser session cannot open them.
 * Mounting them here is both stronger and more durable than a screenshot
 * — it runs on every suite.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CustomerWorkspace } from "./customers/customer-workspace";
import { SupplierWorkspace } from "./suppliers/supplier-workspace";
import { InvoicesTab } from "./sales/invoices-tab";
import type { Customer } from "@/server/customer-management/types";
import type { Supplier } from "@/server/accounting/types";
import type { VatTreatment } from "@/server/company-management/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/test",
  useSearchParams: () => new URLSearchParams(),
}));

function customer(overrides: Partial<Customer> & Pick<Customer, "id" | "name">): Customer {
  return {
    companyId: "co_1", customerCode: "C1", customerType: "Company", customerGroup: "", industry: "",
    vatNumber: "", registrationNumber: "", creditLimit: 0, paymentTermsDays: 30, currencyCode: null,
    priceList: "", salesRep: "", isActive: true, riskRating: "Low", notes: "", createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function supplier(overrides: Partial<Supplier> & Pick<Supplier, "id" | "name">): Supplier {
  return {
    companyId: "co_1", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
    supplierCode: "S1", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "",
    bankBranchCode: "", vatNumber: "", taxNumber: "", registrationNumber: "", riskRating: "Low",
    paymentTermsDays: 30, spendingLimit: 0,
    ...overrides,
  };
}

const VAT: VatTreatment[] = [
  { id: 1, companyId: "co_1", code: "STD", name: "Standard Rated", rate: 15, vatType: "Standard", isActive: true, createdAt: "2026-01-01T00:00:00Z" } as VatTreatment,
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ customer: { id: 1 }, supplier: { id: 1 } }) }));
});

describe("Customer create panel", () => {
  function open() {
    render(<CustomerWorkspace companyId="co_1" customers={[]} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Add Customer/i }));
  }

  it("groups the fields instead of one flat grid", () => {
    open();
    for (const heading of ["Basic Information", "Tax Information", "Billing Address", "Contact Information", "Accounting Defaults"]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
  });

  it("captures the tax details an invoice needs", () => {
    open();
    expect(screen.getByLabelText(/VAT Number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Registration Number/i)).toBeInTheDocument();
  });

  it("captures an address and a contact", () => {
    open();
    expect(screen.getByLabelText(/Address Line 1/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^City/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Contact Person/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Telephone/i)).toBeInTheDocument();
  });

  it("refuses a malformed VAT number and does not call the API", () => {
    open();
    fireEvent.change(screen.getByLabelText(/Customer Code/i), { target: { value: "ACME" } });
    fireEvent.change(screen.getByLabelText(/Customer Name/i), { target: { value: "Acme Ltd" } });
    fireEvent.change(screen.getByLabelText(/VAT Number/i), { target: { value: "123" } });

    fireEvent.click(screen.getByRole("button", { name: /Create Customer/i }));

    expect(screen.getByText("A VAT number is 10 digits.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the VAT and registration numbers when they are valid", () => {
    open();
    fireEvent.change(screen.getByLabelText(/Customer Code/i), { target: { value: "ACME" } });
    fireEvent.change(screen.getByLabelText(/Customer Name/i), { target: { value: "Acme Ltd" } });
    fireEvent.change(screen.getByLabelText(/VAT Number/i), { target: { value: "4123456789" } });
    fireEvent.change(screen.getByLabelText(/Registration Number/i), { target: { value: "2016/112233/07" } });

    fireEvent.click(screen.getByRole("button", { name: /Create Customer/i }));

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({ customerCode: "ACME", name: "Acme Ltd", vatNumber: "4123456789", registrationNumber: "2016/112233/07" });
  });

  it("posts to this company's own endpoint (tenant isolation)", () => {
    render(<CustomerWorkspace companyId="co_9" customers={[]} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Add Customer/i }));
    fireEvent.change(screen.getByLabelText(/Customer Code/i), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText(/Customer Name/i), { target: { value: "A Ltd" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Customer/i }));

    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("/api/companies/co_9/customers");
  });
});

describe("Supplier create panel", () => {
  function open(suppliers: Supplier[] = []) {
    render(<SupplierWorkspace companyId="co_1" suppliers={suppliers} chartOfAccounts={[]} vatTreatments={VAT} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Add Supplier/i }));
  }

  it("groups the fields", () => {
    open();
    for (const heading of ["Basic Information", "Tax Information", "Accounting Defaults", "Contact Information"]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
  });

  it("offers the two fields the Allocation Engine reads", () => {
    open();
    expect(screen.getByLabelText("Default GL Account")).toBeInTheDocument();
    expect(screen.getByLabelText("Default VAT Code")).toBeInTheDocument();
  });

  it("offers the VAT and registration numbers", () => {
    open();
    expect(screen.getByLabelText(/VAT Number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Registration Number/i)).toBeInTheDocument();
  });

  it("warns when a supplier of the same name already exists, without blocking", () => {
    open([supplier({ id: 1, name: "Acme Supplies", supplierCode: "ACME" })]);
    fireEvent.change(screen.getByLabelText(/Supplier Name/i), { target: { value: "acme supplies" } });

    expect(screen.getByRole("status")).toHaveTextContent(/already exists/i);
    // Advice, not a rule: Save stays available.
    expect(screen.getByRole("button", { name: /Create Supplier/i })).not.toBeDisabled();
  });

  it("refuses a malformed VAT number", () => {
    open();
    fireEvent.change(screen.getByLabelText(/Supplier Name/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/VAT Number/i), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Supplier/i }));

    expect(screen.getByText("A VAT number is 10 digits.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the accounting defaults with the new supplier", () => {
    open();
    fireEvent.change(screen.getByLabelText(/Supplier Name/i), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Supplier/i }));

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body).toHaveProperty("defaultGlAccount");
    expect(body).toHaveProperty("defaultVatCode");
    expect(body).toHaveProperty("registrationNumber");
  });
});

describe("Invoice create panel", () => {
  function open(customers: Customer[]) {
    render(
      <InvoicesTab
        companyId="co_1"
        invoices={[]}
        customers={customers}
        vatTreatments={VAT}
        chartOfAccounts={[]}
        previewMode={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /New Document/i }));
  }

  const two = [customer({ id: 1, name: "Alpha Ltd" }), customer({ id: 2, name: "Beta Ltd" })];

  it("selects NO customer by default — the first customer is never billed silently", () => {
    open(two);
    const combo = screen.getByLabelText("Customer") as HTMLInputElement;
    expect(combo.value).toBe("");
  });

  it("keeps Save unreachable until a customer is chosen", () => {
    open(two);
    expect(screen.getByRole("button", { name: /Create Invoice/i })).toBeDisabled();
  });

  it("offers a notes field, which the printed document already renders", () => {
    open(two);
    expect(screen.getByLabelText(/Notes/i)).toBeInTheDocument();
  });

  /* Phase 5J replaced the 5I assertion here ("Lines total (excl. VAT)" /
   * "VAT is calculated on saving"). That copy was honest while the form
   * could not compute VAT — the per-line VAT codes and discounts fed
   * nothing, so any VAT figure shown would have been invented. They feed
   * the totals now, so the panel shows the real breakdown, and what
   * matters is that it IS the breakdown. */
  it("shows the full subtotal / VAT / total breakdown before saving", () => {
    open(two);
    expect(screen.getByText("Subtotal (excl. VAT)")).toBeInTheDocument();
    expect(screen.getByText("VAT")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText(/server recalculates these figures on saving/i)).toBeInTheDocument();
  });

  it("previews the same VAT the server will store — per line, from that line's own code", () => {
    open(two);
    fireEvent.change(screen.getByLabelText(/Description for line 1/i), { target: { value: "Consulting" } });
    fireEvent.change(screen.getByLabelText(/Quantity for line 1/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/Unit price for line 1/i), { target: { value: "500" } });
    expect(screen.getByText("150.00")).toBeInTheDocument(); // 15% of 1,000
    expect(screen.getByText("1,150.00")).toBeInTheDocument();
  });

  it("shows a discount line only once a discount is entered, and charges VAT on what remains", () => {
    open(two);
    fireEvent.change(screen.getByLabelText(/Description for line 1/i), { target: { value: "Consulting" } });
    fireEvent.change(screen.getByLabelText(/Quantity for line 1/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/Unit price for line 1/i), { target: { value: "500" } });
    expect(screen.queryByText("Discount")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Discount for line 1/i), { target: { value: "100" } });
    expect(screen.getByText("Discount")).toBeInTheDocument();
    expect(screen.getByText("900.00")).toBeInTheDocument(); // subtotal after discount
    expect(screen.getByText("135.00")).toBeInTheDocument(); // 15% of 900, not of 1,000
  });

  it("asks a credit note for the particulars VAT Act s21(3) requires", () => {
    open(two);
    expect(screen.queryByLabelText("Original Invoice")).not.toBeInTheDocument();
    fireEvent.change(document.getElementById("inv-type")!, { target: { value: "Credit Note" } });
    expect(screen.getByLabelText("Original Invoice")).toBeInTheDocument();
    expect(screen.getByLabelText(/Reason/i)).toBeInTheDocument();
  });

  it("tells the user what the customer field can be searched by", () => {
    open(two);
    expect(screen.getByLabelText("Customer")).toHaveAttribute("placeholder", expect.stringMatching(/VAT|registration/i));
  });

  it("explains an empty list caused by every customer being inactive", () => {
    open([customer({ id: 1, name: "Alpha Ltd", isActive: false })]);
    expect(screen.getByText(/marked inactive/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to Customers/i })).toHaveAttribute("href", "/company/co_1/customers");
  });

  it("says why New Document is unavailable when there are no customers at all", () => {
    render(<InvoicesTab companyId="co_1" invoices={[]} customers={[]} vatTreatments={VAT} chartOfAccounts={[]} previewMode={false} />);
    const button = screen.getByRole("button", { name: /New Document/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/Add a customer first/i));
  });

  it("says why New Document is unavailable when no VAT treatment is set up", () => {
    render(<InvoicesTab companyId="co_1" invoices={[]} customers={two} vatTreatments={[]} chartOfAccounts={[]} previewMode={false} />);
    const button = screen.getByRole("button", { name: /New Document/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/VAT treatment/i));
  });

  it("stays out of the way once there is an active customer to pick", () => {
    open(two);
    expect(screen.queryByRole("link", { name: /Go to Customers/i })).not.toBeInTheDocument();
  });

  it("offers no inline customer creation — capture stays on the Customers screen", () => {
    // Part 4 decision, asserted so it is not reversed by accident: a
    // customer created mid-invoice would lack the recipient VAT number and
    // address a tax invoice needs, and duplicates split an AR balance.
    open(two);
    expect(screen.queryByRole("button", { name: /(New|Add|Create) Customer/i })).not.toBeInTheDocument();
  });
});
