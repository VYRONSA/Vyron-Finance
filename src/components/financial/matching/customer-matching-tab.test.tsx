import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CustomerMatchingTab } from "./customer-matching-tab";
import type { CustomerMatchingWorkspaceData } from "@/server/services/customer-matching-service";
import type { SalesInvoice } from "@/server/sales/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/company/co_1/matching",
  useSearchParams: () => new URLSearchParams(),
}));

function postedInvoice(): SalesInvoice {
  return {
    id: 1, companyId: "co_1", customerId: 10, orderId: null, deliveryId: null, invoiceNumber: "INV-0001",
    documentType: "Invoice", invoiceDate: "2026-08-01", dueDate: "2026-08-31", vatTreatmentCode: "Standard Rated",
    status: "Posted", journalId: 5, subtotal: 1000, vatAmount: 150, total: 1150, outstanding: 1150,
    isRecurringTemplate: false, recurrencePattern: "", reference: "", notes: "",
    createdAt: "2026-08-01T00:00:00Z", submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null,
    postedAt: "2026-08-01T00:00:00Z", cancelledBy: null, cancelledAt: null, originalInvoiceId: null, lines: [],
  };
}

function workspace(overrides: Partial<CustomerMatchingWorkspaceData> = {}): CustomerMatchingWorkspaceData {
  return {
    invoices: [postedInvoice()],
    creditNotes: [],
    debitNotes: [],
    receipts: [],
    candidates: [],
    customers: [{ id: 10, name: "Acme Retail", vatNumber: "4123456789", registrationNumber: "2020/000111/07" }],
    ...overrides,
  };
}

const EMPTY_BRANDING = { hasLogo: false, logoUrl: null, logoFilename: null, logoMimeType: null, logoSizeBytes: null, updatedAt: null };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CustomerMatchingTab — existing functionality regression (Phase 20C)", () => {
  it("still switches between sub-tabs, including Statement", () => {
    render(<CustomerMatchingTab companyId="co_1" data={workspace()} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Statement" }));
    expect(screen.getByLabelText("Customer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /load statement/i })).toBeInTheDocument();
  });

  it("still shows the Suggestions empty state by default", () => {
    render(<CustomerMatchingTab companyId="co_1" data={workspace()} previewMode={false} />);
    expect(screen.getByText(/no suggested matches/i)).toBeInTheDocument();
  });
});

describe("CustomerMatchingTab — View Statement document action (Phase 20C)", () => {
  it("only offers View Statement once a statement has been loaded and has entries", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/companies/co_1/matching/customers/10/statement") {
        return Promise.resolve({ ok: true, json: async () => ({ statement: [{ date: "2026-08-01", type: "Invoice", reference: "INV-0001", documentId: 1, debit: 1150, credit: 0, balance: 1150 }] }) });
      }
      if (url === "/api/companies/co_1") return Promise.resolve({ ok: true, json: async () => ({ company: { id: "co_1", name: "Fenwick & Rowe Ltd", address: "", registrationNumber: "" } }) });
      if (url === "/api/companies/co_1/branding") return Promise.resolve({ ok: true, json: async () => ({ branding: EMPTY_BRANDING }) });
      if (url.includes("/addresses")) return Promise.resolve({ ok: true, json: async () => ({ addresses: [] }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CustomerMatchingTab companyId="co_1" data={workspace()} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Statement" }));

    expect(screen.queryByRole("button", { name: /view statement/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /load statement/i }));
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /view statement/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Acme Retail");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The existing Statement grid is still there after closing the document view.
    expect(screen.getByText("INV-0001")).toBeInTheDocument();
  });

  it("does not offer View Statement for a customer with no activity (empty statement)", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/companies/co_1/matching/customers/10/statement") return Promise.resolve({ ok: true, json: async () => ({ statement: [] }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CustomerMatchingTab companyId="co_1" data={workspace()} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Statement" }));
    fireEvent.click(screen.getByRole("button", { name: /load statement/i }));

    await waitFor(() => expect(screen.getByText(/no statement activity/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /view statement/i })).not.toBeInTheDocument();
  });
});
