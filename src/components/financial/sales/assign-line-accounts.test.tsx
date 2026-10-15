import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssignLineAccounts } from "./invoices-tab";
import type { SalesInvoice, SalesInvoiceLine } from "@/server/sales/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const line = (id: number, glAccount: string | null) => ({ id, glAccount }) as SalesInvoiceLine;
const invoice = (overrides: Partial<SalesInvoice> = {}) =>
  ({ id: 501, invoiceNumber: "SI-01667102", documentType: "Invoice", status: "Draft", lines: [line(1, null), line(2, null), line(3, "1005")], ...overrides }) as SalesInvoice;
const chart = [
  { accountCode: "1000", description: "Product Sales", accountType: "Income", isActive: true },
  { accountCode: "1005", description: "Bakery Sales", accountType: "Income", isActive: true },
  { accountCode: "1500", description: "COS - Food Products", accountType: "Cost of Sales", isActive: true },
  { accountCode: "1010", description: "Baked Goods Sales", accountType: "Income", isActive: false },
] as ChartOfAccount[];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AssignLineAccounts", () => {
  it("shows how many lines have no account and offers only active Income accounts, 1000 preselected", () => {
    render(<AssignLineAccounts companyId="co_1" invoice={invoice()} chartOfAccounts={chart} previewMode={false} onDone={() => {}} />);
    expect(screen.getByText("2 line(s) have no revenue account.")).toBeInTheDocument();
    const select = screen.getByLabelText("Revenue account for lines without one") as HTMLSelectElement;
    expect(select.value).toBe("1000");
    expect([...select.options].map((o) => o.value)).toEqual(["", "1000", "1005"]);
  });

  it.each(["Submitted", "Approved", "Cancelled"] as const)("is not shown on a %s invoice", (status) => {
    const { container } = render(<AssignLineAccounts companyId="co_1" invoice={invoice({ status })} chartOfAccounts={chart} previewMode={false} onDone={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(["Credit Note", "Debit Note"] as const)("is not shown on a Posted %s", (documentType) => {
    const { container } = render(<AssignLineAccounts companyId="co_1" invoice={invoice({ status: "Posted", documentType })} chartOfAccounts={chart} previewMode={false} onDone={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("on a Posted invoice offers only account 1000, says no journal changes, and sends assign-posted-line-accounts", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ invoice: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(<AssignLineAccounts companyId="co_1" invoice={invoice({ status: "Posted" })} chartOfAccounts={chart} previewMode={false} onDone={onDone} />);
    expect(screen.getByText(/Assigning one changes no journal, amount or VAT\./)).toBeInTheDocument();
    const select = screen.getByLabelText("Revenue account for lines without one") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["", "1000"]);
    fireEvent.click(screen.getByRole("button", { name: "Assign to lines without an account" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/companies/co_1/sales/invoices/501", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "assign-posted-line-accounts", glAccount: "1000" }) }));
  });

  it("on a Posted invoice offers nothing when 1000 is not an active Income account", () => {
    render(<AssignLineAccounts companyId="co_1" invoice={invoice({ status: "Posted" })} chartOfAccounts={chart.filter((a) => a.accountCode !== "1000")} previewMode={false} onDone={() => {}} />);
    const select = screen.getByLabelText("Revenue account for lines without one") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([""]);
    expect(screen.getByRole("button", { name: "Assign to lines without an account" })).toBeDisabled();
  });

  it("is not shown when every line has an account", () => {
    const { container } = render(<AssignLineAccounts companyId="co_1" invoice={invoice({ lines: [line(1, "1000")] })} chartOfAccounts={chart} previewMode={false} onDone={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sends the assign-line-accounts action for this invoice and refreshes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ invoice: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(<AssignLineAccounts companyId="co_1" invoice={invoice()} chartOfAccounts={chart} previewMode={false} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign to lines without an account" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/companies/co_1/sales/invoices/501", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "assign-line-accounts", glAccount: "1000" }) }));
  });

  it("shows the server's refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Your role does not have the \"Sales:Edit\" permission." }), { status: 403 })));
    render(<AssignLineAccounts companyId="co_1" invoice={invoice()} chartOfAccounts={chart} previewMode={false} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign to lines without an account" }));
    expect(await screen.findByText('Your role does not have the "Sales:Edit" permission.')).toBeInTheDocument();
  });

  it("is disabled in preview mode", () => {
    render(<AssignLineAccounts companyId="co_1" invoice={invoice()} chartOfAccounts={chart} previewMode={true} onDone={() => {}} />);
    expect(screen.getByRole("button", { name: "Assign to lines without an account" })).toBeDisabled();
  });
});
