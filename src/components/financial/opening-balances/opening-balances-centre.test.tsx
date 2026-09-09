import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OpeningBalancesCentre } from "./opening-balances-centre";
import type { OpeningBalanceEntry, OpeningBalanceGovernance } from "@/server/opening-balances/types";
import type { Customer } from "@/server/customer-management/types";
import type { Supplier } from "@/server/accounting/types";

function supplier(overrides: Partial<Supplier> & Pick<Supplier, "id" | "name">): Supplier {
  return {
    companyId: "co_1", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
    supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "",
    bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 0, spendingLimit: 0,
    ...overrides,
  };
}

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), back: vi.fn() }),
}));

function entry(overrides: Partial<OpeningBalanceEntry> & Pick<OpeningBalanceEntry, "id" | "customerId">): OpeningBalanceEntry {
  return {
    companyId: "co_1",
    category: "Customer",
    accountCode: null,
    bankAccountId: null,
    supplierId: null,
    description: "Opening debtor balance",
    amount: 1000,
    reference: "",
    balanceDate: "2026-03-01",
    status: "draft",
    journalId: null,
    createdBy: "tester@vyron.test",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

const CUSTOMERS: Customer[] = [{ id: 1, name: "Meridian Traders" } as Customer];

function governance(overrides: Partial<OpeningBalanceGovernance> = {}): OpeningBalanceGovernance {
  return { requiresGovernance: false, reasonRequired: false, ...overrides };
}

describe("OpeningBalancesCentre — Finding #212 (RC-3)", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("requires confirmation before calling the delete API", () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(
      <OpeningBalancesCentre
        companyId="co_1"
        entries={[entry({ id: 1, customerId: 1 })]}
        governance={governance()}
        bankAccounts={[]}
        customers={CUSTOMERS}
        suppliers={[]}
        chartOfAccounts={[]}
        previewMode={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(screen.getByText(/remove this opening balance entry\?/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByText(/remove this opening balance entry\?/i)).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls the delete API once confirmed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    render(
      <OpeningBalancesCentre
        companyId="co_1"
        entries={[entry({ id: 1, customerId: 1 })]}
        governance={governance()}
        bankAccounts={[]}
        customers={CUSTOMERS}
        suppliers={[]}
        chartOfAccounts={[]}
        previewMode={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/companies/co_1/opening-balances/1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("requires an inline reason before confirming when governance requires one", () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <OpeningBalancesCentre
        companyId="co_1"
        entries={[entry({ id: 1, customerId: 1 })]}
        governance={governance({ requiresGovernance: true, reasonRequired: true })}
        bankAccounts={[]}
        customers={CUSTOMERS}
        suppliers={[]}
        chartOfAccounts={[]}
        previewMode={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    const reasonInput = screen.getByLabelText(/reason for removing this opening balance/i);
    expect(reasonInput).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    expect(screen.getByText(/a reason is required/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.change(reasonInput, { target: { value: "Duplicate entry captured in error." } });
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/companies/co_1/opening-balances/1",
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ reason: "Duplicate entry captured in error." }) }),
    );
  });
});

// Phase 38 — Phase 37's production audit found Inactive suppliers
// (deactivated merge duplicates) selectable in the "new entry" Supplier
// picker, letting a NEW opening balance be created against one.
describe("OpeningBalancesCentre — Supplier picker Active-only (Phase 38)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("the new-entry Supplier picker shows only the Active supplier", () => {
    render(
      <OpeningBalancesCentre
        companyId="co_1"
        entries={[]}
        governance={governance()}
        bankAccounts={[]}
        customers={CUSTOMERS}
        suppliers={[supplier({ id: 1, name: "Active Supplies", status: "Active" }), supplier({ id: 2, name: "Deactivated Duplicate", status: "Inactive" })]}
        chartOfAccounts={[]}
        previewMode={false}
      />,
    );

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Supplier" } });

    const picker = screen.getByLabelText("Supplier") as HTMLSelectElement;
    const optionLabels = Array.from(picker.options).map((o) => o.text);
    expect(optionLabels).toContain("Active Supplies");
    expect(optionLabels).not.toContain("Deactivated Duplicate");
  });
});
