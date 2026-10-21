import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AllocateCreditNote, availableCredit } from "./invoices-tab";
import type { SalesInvoice } from "@/server/sales/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const doc = (overrides: Partial<SalesInvoice>) =>
  ({ id: 1, invoiceNumber: "X", documentType: "Invoice", status: "Posted", customerId: 70, total: 0, outstanding: 0, lines: [], ...overrides }) as SalesInvoice;

// CN-3607 (stored positive, as written after 0121) and What's The Scoop's invoices.
const cn = doc({ id: 495, invoiceNumber: "CN-3607", documentType: "Credit Note", total: 343.39, outstanding: 343.39 });
const invoices = [
  cn,
  doc({ id: 514, invoiceNumber: "INV-3576", total: 1597.58, outstanding: 1597.58 }),
  doc({ id: 625, invoiceNumber: "INV-3624", total: 2283.56, outstanding: 2283.56 }),
  doc({ id: 700, invoiceNumber: "INV-9000", total: 100, outstanding: 0 }),
  doc({ id: 701, invoiceNumber: "INV-9001", total: 100, outstanding: 100, status: "Submitted" }),
  doc({ id: 702, invoiceNumber: "INV-9002", total: 100, outstanding: 100, customerId: 71 }),
];

function renderIt(creditNote: SalesInvoice = cn, previewMode = false) {
  const onDone = vi.fn();
  const view = render(<AllocateCreditNote companyId="co_1" creditNote={creditNote} invoices={invoices} previewMode={previewMode} onDone={onDone} />);
  return { ...view, onDone };
}

const choose = (id: string) => fireEvent.change(screen.getByLabelText("Invoice to apply the credit to"), { target: { value: id } });
const ok = (allocation: Record<string, unknown>) => ({ ok: true, json: async () => ({ allocation }) });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("availableCredit", () => {
  it("is the positive credit left, whichever sign the credit note is stored with", () => {
    expect(availableCredit({ total: 343.39, outstanding: 343.39 })).toBe(343.39);
    expect(availableCredit({ total: -1656, outstanding: -10 })).toBe(10); // CN-3406 as imported
    expect(availableCredit({ total: 1656, outstanding: 0 })).toBe(0);
  });
});

describe("AllocateCreditNote", () => {
  it("offers only this customer's Posted invoices that still have something outstanding", () => {
    renderIt();
    expect(screen.getByText(/R?343\.39 of this credit note is not yet applied/)).toBeInTheDocument();
    const select = screen.getByLabelText("Invoice to apply the credit to") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["", "514", "625"]);
  });

  it.each([
    ["an invoice", doc({ id: 514, total: 10, outstanding: 10 })],
    ["a Submitted credit note", doc({ id: 495, documentType: "Credit Note", status: "Submitted", total: 10, outstanding: 10 })],
    ["a fully applied credit note", doc({ id: 495, documentType: "Credit Note", total: 10, outstanding: 0 })],
  ])("is not shown on %s", (_label, d) => {
    const { container } = renderIt(d);
    expect(container).toBeEmptyDOMElement();
  });

  it("says so when no invoice is open for the customer", () => {
    render(<AllocateCreditNote companyId="co_1" creditNote={cn} invoices={[cn]} previewMode={false} onDone={() => {}} />);
    expect(screen.getByText("No posted invoice for this customer has an outstanding balance.")).toBeInTheDocument();
  });

  it("proposes the smaller of the credit left and the invoice's outstanding", () => {
    renderIt();
    choose("514");
    expect((screen.getByLabelText("Amount to apply") as HTMLInputElement).value).toBe("343.39");
  });

  it("applies CN-3607 to INV-3576 with a request key, reports the result and refreshes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ amount: 343.39, invoiceNumber: "INV-3576", invoiceOutstanding: 1254.19 }));
    vi.stubGlobal("fetch", fetchMock);
    const { onDone } = renderIt();
    choose("514");
    fireEvent.click(screen.getByRole("button", { name: "Apply credit" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/companies/co_1/sales/invoices/495");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ action: "allocate-credit-note", invoiceId: 514, amount: 343.39 });
    expect(body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText(/Applied .*343\.39 to INV-3576\. INV-3576 now has .*1[ ,]?254\.19 outstanding\./)).toBeInTheDocument();
  });

  it("retrying after a lost response sends the SAME request key, so the credit cannot be applied twice", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(ok({ amount: 343.39, invoiceNumber: "INV-3576", invoiceOutstanding: 1254.19 }));
    vi.stubGlobal("fetch", fetchMock);
    renderIt();
    choose("514");
    fireEvent.click(screen.getByRole("button", { name: "Apply credit" }));
    await screen.findByText(/Trying again is safe/);
    fireEvent.click(screen.getByRole("button", { name: "Apply credit" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const keys = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).requestKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it("changing the amount starts a new request (a new key)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "nope" }) });
    vi.stubGlobal("fetch", fetchMock);
    renderIt();
    choose("514");
    fireEvent.click(screen.getByRole("button", { name: "Apply credit" }));
    await screen.findByText("nope");
    fireEvent.change(screen.getByLabelText("Amount to apply"), { target: { value: "100.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply credit" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [first, second] = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(second.amount).toBe(100);
    expect(second.requestKey).not.toBe(first.requestKey);
  });

  it("shows the server's refusal and does not refresh", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "CN-3607 has only 343.39 of credit left to apply." }) }));
    const { onDone } = renderIt();
    choose("514");
    fireEvent.click(screen.getByRole("button", { name: "Apply credit" }));
    expect(await screen.findByText("CN-3607 has only 343.39 of credit left to apply.")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("cannot be clicked twice while a request is in flight", async () => {
    let resolve: (v: unknown) => void = () => {};
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((r) => (resolve = r))));
    renderIt();
    choose("514");
    fireEvent.click(screen.getByRole("button", { name: "Apply credit" }));
    expect(screen.getByRole("button", { name: "Applying…" })).toBeDisabled();
    resolve(ok({ amount: 343.39, invoiceNumber: "INV-3576", invoiceOutstanding: 1254.19 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply credit" })).toBeInTheDocument());
  });

  it("is disabled in preview mode", () => {
    renderIt(cn, true);
    choose("514");
    expect(screen.getByRole("button", { name: "Apply credit" })).toBeDisabled();
  });
});
