import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SendDocumentEmailAction } from "./send-document-email-action";

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function baseProps(overrides: Partial<Parameters<typeof SendDocumentEmailAction>[0]> = {}) {
  return {
    sendUrl: "/api/companies/company-a/sales/invoices/501/send-email",
    recipientEmail: "jane@northwood.co.za",
    documentLabel: "Tax Invoice INV000125",
    attachmentFilename: "INV000125.pdf",
    companyName: "Fenwick & Rowe",
    previewMode: false,
    ...overrides,
  };
}

describe("SendDocumentEmailAction — trigger state", () => {
  it("is disabled when the customer has no email on file", () => {
    render(<SendDocumentEmailAction {...baseProps({ recipientEmail: null })} />);
    expect(screen.getByRole("button", { name: /send email/i })).toBeDisabled();
  });

  it("is disabled in Preview Mode", () => {
    render(<SendDocumentEmailAction {...baseProps({ previewMode: true })} />);
    expect(screen.getByRole("button", { name: /send email/i })).toBeDisabled();
  });

  it("is enabled with a real recipient email outside Preview Mode", () => {
    render(<SendDocumentEmailAction {...baseProps()} />);
    expect(screen.getByRole("button", { name: /send email/i })).not.toBeDisabled();
  });
});

describe("SendDocumentEmailAction — confirmation", () => {
  it("shows recipient/document/attachment/company before sending", () => {
    render(<SendDocumentEmailAction {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /send email/i }));

    expect(screen.getByText("jane@northwood.co.za")).toBeInTheDocument();
    expect(screen.getByText("Tax Invoice INV000125")).toBeInTheDocument();
    expect(screen.getByText("INV000125.pdf")).toBeInTheDocument();
    expect(screen.getByText("Fenwick & Rowe")).toBeInTheDocument();
  });

  it("does not send until the user explicitly confirms", () => {
    render(<SendDocumentEmailAction {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /send email/i }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("POSTs to sendUrl only after Send is clicked, and shows the honest Queued status", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: async () => ({ communication: { id: 1, status: "Queued" } }) } as Response);
    render(<SendDocumentEmailAction {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /send email/i }));
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/companies/company-a/sales/invoices/501/send-email", { method: "POST" }));
    await waitFor(() => expect(screen.getByText("Queued — status: Queued")).toBeInTheDocument());
  });

  it("shows an honest error message on failure, without exposing internals", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "This customer has no email address on file." }) } as Response);
    render(<SendDocumentEmailAction {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /send email/i }));
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(screen.getByText("This customer has no email address on file.")).toBeInTheDocument());
  });

  it("cancel closes the confirm panel without sending", () => {
    render(<SendDocumentEmailAction {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /send email/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /send email/i })).toBeInTheDocument();
  });
});
