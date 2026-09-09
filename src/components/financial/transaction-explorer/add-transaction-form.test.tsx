/**
 * Phase 40 — "+ Add Transaction" had no test file at all after Phase 39,
 * despite the feature being explicitly requested. This is the isolated,
 * stable component test (no `TransactionGrid`/full-page render — see
 * `transaction-explorer.test.tsx`'s own doc comment for why that crashes
 * the jsdom worker) proving the form itself actually enforces the
 * required behaviour: Debit/Credit mutual exclusivity, required fields,
 * Active-only supplier selection, and a real submit to the API.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddTransactionForm } from "./add-transaction-form";
import type { Supplier } from "@/server/accounting/types";

function supplier(overrides: Partial<Supplier> & Pick<Supplier, "id" | "name">): Supplier {
  return {
    companyId: "co_1", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
    supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "",
    bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 0, spendingLimit: 0,
    ...overrides,
  };
}

const BANK_ACCOUNTS = [{ id: 1, accountName: "Main Account" }];
const SUPPLIERS = [supplier({ id: 1, name: "Active Supplies", status: "Active" }), supplier({ id: 2, name: "Deactivated Duplicate", status: "Inactive" })];

function renderForm(onCreated = vi.fn(), onCancel = vi.fn()) {
  render(
    <AddTransactionForm
      companyId="co_1"
      bankAccounts={BANK_ACCOUNTS}
      suppliers={SUPPLIERS}
      customers={[{ id: 1, name: "Meridian Traders", customerCode: "CUST-1" }]}
      chartOfAccounts={[]}
      previewMode={false}
      onCreated={onCreated}
      onCancel={onCancel}
    />,
  );
  return { onCreated, onCancel };
}

/** Fills every field required to pass client-side validation EXCEPT
 * Debit/Credit — the one dimension every test below varies. */
function fillRequiredFieldsExceptAmount() {
  fireEvent.change(screen.getByLabelText("Bank Account"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-20" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Cash deposit" } });
  fireEvent.change(screen.getByLabelText("Beneficiary"), { target: { value: "Walk-in customer" } });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddTransactionForm (Phase 40)", () => {
  it("renders every required field", () => {
    renderForm();
    expect(screen.getByLabelText("Bank Account")).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
    expect(screen.getByLabelText("Reference")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Beneficiary")).toBeInTheDocument();
    expect(screen.getByLabelText("Debit")).toBeInTheDocument();
    expect(screen.getByLabelText("Credit")).toBeInTheDocument();
    expect(screen.getByLabelText("Balance")).toBeInTheDocument();
    expect(screen.getByLabelText("VAT")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "GL account code" })).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
  });

  it("shows a client-side error and never submits when required fields are blank", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Transaction" }));
    expect(await screen.findByText(/bank account is required/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a client-side error and never submits when Description is blank specifically", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Bank Account"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText("Beneficiary"), { target: { value: "Walk-in customer" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Transaction" }));
    expect(await screen.findByText(/description is required/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a client-side error and never submits when neither Debit nor Credit is entered", async () => {
    renderForm();
    fillRequiredFieldsExceptAmount();

    fireEvent.click(screen.getByRole("button", { name: "Create Transaction" }));
    expect(await screen.findByText(/enter either a debit or a credit amount/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects entering both Debit and Credit — the Debit field disables once Credit has a value, and vice versa", () => {
    renderForm();
    const debit = screen.getByLabelText("Debit") as HTMLInputElement;
    const credit = screen.getByLabelText("Credit") as HTMLInputElement;

    fireEvent.change(credit, { target: { value: "100" } });
    expect(debit).toBeDisabled();

    fireEvent.change(credit, { target: { value: "" } });
    fireEvent.change(debit, { target: { value: "50" } });
    expect(credit).toBeDisabled();
  });

  it("submits a valid Credit transaction with the exact expected body", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ transaction: { id: 900 } }) } as Response);
    const { onCreated } = renderForm();
    fillRequiredFieldsExceptAmount();
    fireEvent.change(screen.getByLabelText("Credit"), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText("Balance"), { target: { value: "1000" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Transaction" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 900 }));
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/companies/co_1/transactions");
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body).toMatchObject({
      bankAccountId: 1,
      debit: 0,
      credit: 250,
      balance: 1000,
      description: "Cash deposit",
      beneficiary: "Walk-in customer",
      supplierId: null,
      customerId: null,
    });
  });

  it("submits a valid Debit transaction", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ transaction: { id: 901 } }) } as Response);
    const { onCreated } = renderForm();
    fillRequiredFieldsExceptAmount();
    fireEvent.change(screen.getByLabelText("Debit"), { target: { value: "75.50" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Transaction" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 901 }));
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ debit: 75.5, credit: 0 });
  });

  it("shows an Active supplier as a selectable option and never shows the Inactive one — Phase 38 Active-only convention", () => {
    renderForm();
    fireEvent.click(screen.getByText("Supplier")); // switches the Allocate-to radio to Supplier
    const combobox = screen.getByRole("combobox", { name: "Supplier" }) as HTMLInputElement;
    fireEvent.change(combobox, { target: { value: "Active" } });
    expect(screen.getByText("Active Supplies")).toBeInTheDocument();
    expect(screen.queryByText("Deactivated Duplicate")).not.toBeInTheDocument();
  });

  it("includes the chosen Active supplier's id in the submitted body", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ transaction: { id: 902 } }) } as Response);
    renderForm();
    fillRequiredFieldsExceptAmount();
    fireEvent.change(screen.getByLabelText("Credit"), { target: { value: "100" } });

    fireEvent.click(screen.getByText("Supplier"));
    const combobox = screen.getByRole("combobox", { name: "Supplier" });
    fireEvent.change(combobox, { target: { value: "Active Supplies" } });
    fireEvent.keyDown(combobox, { key: "Tab" });

    fireEvent.click(screen.getByRole("button", { name: "Create Transaction" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.supplierId).toBe(1);
    expect(body.customerId).toBeNull();
  });

  it("surfaces a server-side ValidationError (e.g. Inactive supplier rejected server-side) without pretending success", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Supplier "Deactivated Duplicate" is Inactive and cannot be assigned.' }) } as Response);
    const { onCreated } = renderForm();
    fillRequiredFieldsExceptAmount();
    fireEvent.change(screen.getByLabelText("Credit"), { target: { value: "250" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Transaction" }));

    expect(await screen.findByText(/inactive and cannot be assigned/i)).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("Cancel calls onCancel without ever calling fetch", () => {
    const { onCancel } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("disables the submit button in Preview Mode", () => {
    render(
      <AddTransactionForm companyId="co_1" bankAccounts={BANK_ACCOUNTS} suppliers={SUPPLIERS} customers={[]} chartOfAccounts={[]} previewMode onCreated={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Create Transaction" })).toBeDisabled();
  });
});
