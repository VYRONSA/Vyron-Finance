import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InvoicesTab } from "./invoices-tab";
import type { Customer } from "@/server/customer-management/types";
import type { SalesInvoice } from "@/server/sales/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 10, companyId: "co_1", customerCode: "CUST-010", name: "Acme Retail", customerType: "Company",
    customerGroup: "", industry: "Retail", vatNumber: "4123456789", registrationNumber: "2020/000111/07",
    creditLimit: 50000, paymentTermsDays: 30, currencyCode: "ZAR", priceList: "", salesRep: "", isActive: true,
    riskRating: "Low", notes: "", createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 1, companyId: "co_1", customerId: 10, orderId: null, deliveryId: null, invoiceNumber: "INV-0001",
    documentType: "Invoice", invoiceDate: "2026-08-01", dueDate: "2026-08-31", vatTreatmentCode: "Standard Rated",
    status: "Draft", journalId: null, subtotal: 1000, vatAmount: 150, total: 1150, outstanding: 1150,
    isRecurringTemplate: false, recurrencePattern: "", reference: "PO-77", notes: "",
    createdAt: "2026-08-01T00:00:00Z", submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null,
    postedAt: null, cancelledBy: null, cancelledAt: null, originalInvoiceId: null, lines: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Expanding a row also mounts CommunicationHistoryPanel/DocumentsPanel,
  // which fetch on mount (see documents-panel.test.tsx's own precedent) —
  // a harmless default stub so tests that don't care about those calls
  // don't leak an unhandled real-fetch rejection into the test run.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

describe("InvoicesTab — existing functionality regression (Phase 20C)", () => {
  it("still lists invoices with search/filter controls intact", () => {
    render(<InvoicesTab companyId="co_1" invoices={[invoice()]} customers={[customer()]} vatTreatments={[]} chartOfAccounts={[]} previewMode={false} />);
    expect(screen.getByText("INV-0001")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search document/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new document/i })).toBeInTheDocument();
  });

  it("still expands a row to show its lines and history", () => {
    render(<InvoicesTab companyId="co_1" invoices={[invoice()]} customers={[customer()]} vatTreatments={[]} chartOfAccounts={[]} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /expand inv-0001/i }));
    expect(screen.getByText(/subtotal/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no matching documents", () => {
    render(<InvoicesTab companyId="co_1" invoices={[]} customers={[]} vatTreatments={[]} chartOfAccounts={[]} previewMode={false} />);
    expect(screen.getByText(/no sales documents/i)).toBeInTheDocument();
  });
});

describe("InvoicesTab — View Invoice document action (Phase 20C)", () => {
  it("opens the invoice document view scoped to this company and this invoice, without breaking existing row actions", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/companies/co_1") return Promise.resolve({ ok: true, json: async () => ({ company: { id: "co_1", name: "Fenwick & Rowe Ltd", address: "", registrationNumber: "" } }) });
      if (url === "/api/companies/co_1/branding") return Promise.resolve({ ok: true, json: async () => ({ branding: { hasLogo: false, logoUrl: null, logoFilename: null, logoMimeType: null, logoSizeBytes: null, updatedAt: null } }) });
      if (url.includes("/addresses")) return Promise.resolve({ ok: true, json: async () => ({ addresses: [] }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<InvoicesTab companyId="co_1" invoices={[invoice()]} customers={[customer()]} vatTreatments={[]} chartOfAccounts={[]} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("INV-0001");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // The existing Draft-status row actions are still present after closing the document view.
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });
});
