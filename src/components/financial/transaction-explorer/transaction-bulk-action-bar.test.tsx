import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { TransactionBulkActionBar } from "./transaction-bulk-action-bar";
import type { BankTransactionRecord, Supplier } from "@/server/accounting/types";
import type { Merchant } from "@/server/banking-rules/types";

function txn(overrides: Partial<BankTransactionRecord> & Pick<BankTransactionRecord, "id">): BankTransactionRecord {
  return {
    companyId: "co_1",
    transactionDate: "2026-07-01",
    reference: "REF-1",
    description: "Payment",
    beneficiary: "ABC Supplies",
    debit: 500,
    credit: 0,
    balance: null,
    bankAccount: "MAIN-001",
    bankAccountId: 1,
    glAccount: "",
    vat: null,
    notes: "",
    importBatch: "BATCH-1",
    sourceFilename: "statement.csv",
    createdAt: "2026-07-01T00:00:00Z",
    allocationStatus: "Matched",
    matchedSupplierId: 1,
    matchedSupplierName: "ABC Supplies",
    matchedBillId: 1,
    confidenceScore: 98,
    rulesTriggered: [],
    matchReason: "",
    requiredAction: null,
    suggestedGlAccount: "6000",
    suggestedVatCode: "Standard",
    allocationMethod: "Matched Bill",
    allocationReason: "",
    isManualOverride: false,
    reviewStatus: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    journalId: null,
    matchedCustomerId: null,
    matchedMerchantId: null,
    ruleId: null,
    allocationType: null,
    allocationNotes: "",
    entrySource: "Imported",
    captureStatus: null,
    cashbookBatchId: null,
    reconciliationId: null,
    reversalOfTransactionId: null,
    isSplit: false,
    ...overrides,
  };
}

const SUPPLIERS: Supplier[] = [
  {
    id: 1, companyId: "co_1", name: "ABC Supplies", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
    supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "", bankBranchCode: "",
    vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 30,
  },
];

const CUSTOMERS = [{ id: 1, name: "Meridian Traders" }];

const MERCHANTS: Merchant[] = [
  {
    id: 1, companyId: "co_1", name: "ABC Supplies", aliases: [], defaultSupplierId: 1, defaultCustomerId: null,
    defaultGlAccount: "", defaultVatCode: "", notes: "", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  },
];

const noop = () => {};

function baseProps(overrides: Partial<Parameters<typeof TransactionBulkActionBar>[0]> = {}) {
  return {
    selected: [txn({ id: 1 })],
    suppliers: SUPPLIERS,
    customers: CUSTOMERS,
    merchants: MERCHANTS,
    onAssignSupplier: noop,
    onAssignMerchant: noop,
    onAssignCustomer: noop,
    onAssignGl: noop,
    onAssignVat: noop,
    onReview: noop,
    onGenerateJournal: noop,
    onApplyRule: noop,
    onDeleteImport: noop,
    loading: false,
    previewMode: false,
    ...overrides,
  };
}

describe("TransactionBulkActionBar", () => {
  it("renders nothing when nothing is selected", () => {
    const { container } = render(<TransactionBulkActionBar {...baseProps({ selected: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("enables Assign Merchant, Assign Customer, and Apply Rule now that their modules are real", () => {
    render(<TransactionBulkActionBar {...baseProps()} />);
    for (const name of [/assign merchant/i, /assign customer/i, /apply rule/i]) {
      expect(screen.getByRole("button", { name })).not.toBeDisabled();
    }
  });

  it("enables Generate Journal only when every selected transaction has a GL account and no existing journal", () => {
    const { rerender } = render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1, suggestedGlAccount: "6000", journalId: null })] })} />);
    expect(screen.getByRole("button", { name: /generate journal/i })).not.toBeDisabled();

    rerender(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1, suggestedGlAccount: null })] })} />);
    expect(screen.getByRole("button", { name: /generate journal/i })).toBeDisabled();

    rerender(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1, suggestedGlAccount: "6000", journalId: 5 })] })} />);
    expect(screen.getByRole("button", { name: /generate journal/i })).toBeDisabled();
  });

  it("enables Delete Import only when every selected transaction shares one import batch", () => {
    const { rerender } = render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1, importBatch: "BATCH-1" }), txn({ id: 2, importBatch: "BATCH-1" })] })} />);
    expect(screen.getByRole("button", { name: /delete import/i })).not.toBeDisabled();

    rerender(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1, importBatch: "BATCH-1" }), txn({ id: 2, importBatch: "BATCH-2" })] })} />);
    expect(screen.getByRole("button", { name: /delete import/i })).toBeDisabled();
  });

  it("disables every real action in Preview Mode", () => {
    render(<TransactionBulkActionBar {...baseProps({ previewMode: true })} />);
    const supplierButton = screen.getByRole("button", { name: /assign supplier/i });
    expect(supplierButton).toBeDisabled();
    expect(supplierButton).toHaveAttribute("title", expect.stringContaining("Supabase"));
    expect(screen.getByRole("button", { name: /assign merchant/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /apply rule/i })).toBeDisabled();
  });

  it("submits the chosen GL account through the inline form with no rule when the checkbox is unchecked", () => {
    const onAssignGl = vi.fn();
    render(<TransactionBulkActionBar {...baseProps({ onAssignGl })} />);
    fireEvent.click(screen.getByRole("button", { name: /assign gl/i }));
    fireEvent.change(screen.getByPlaceholderText("GL account code"), { target: { value: "7000" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onAssignGl).toHaveBeenCalledWith("7000", null);
  });

  it("shows the Create Banking Rule panel only when exactly one transaction is selected", () => {
    const { rerender } = render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1 })] })} />);
    fireEvent.click(screen.getByRole("button", { name: /assign gl/i }));
    expect(screen.getByText("Create Banking Rule")).toBeInTheDocument();

    rerender(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1 }), txn({ id: 2 })] })} />);
    fireEvent.click(screen.getByRole("button", { name: /assign gl/i }));
    expect(screen.queryByText("Create Banking Rule")).not.toBeInTheDocument();
  });

  it("submits a populated rule when Create Banking Rule is checked", () => {
    const onAssignGl = vi.fn();
    render(<TransactionBulkActionBar {...baseProps({ onAssignGl, selected: [txn({ id: 1, beneficiary: "ABC Supplies" })] })} />);
    fireEvent.click(screen.getByRole("button", { name: /assign gl/i }));
    fireEvent.change(screen.getByPlaceholderText("GL account code"), { target: { value: "7000" } });
    fireEvent.click(screen.getByLabelText("Create Banking Rule"));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onAssignGl).toHaveBeenCalledWith("7000", {
      matchDescription: "ABC Supplies",
      matchType: "contains",
      applyToRemaining: true,
      applyToFutureImports: true,
    });
  });

  it("submits the chosen merchant through the inline form", () => {
    const onAssignMerchant = vi.fn();
    render(<TransactionBulkActionBar {...baseProps({ onAssignMerchant })} />);
    fireEvent.click(screen.getByRole("button", { name: /assign merchant/i }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onAssignMerchant).toHaveBeenCalledWith(1);
  });

  it("calls onApplyRule directly with no inline form", () => {
    const onApplyRule = vi.fn();
    render(<TransactionBulkActionBar {...baseProps({ onApplyRule })} />);
    fireEvent.click(screen.getByRole("button", { name: /apply rule/i }));
    expect(onApplyRule).toHaveBeenCalledOnce();
  });

  it("has no obvious accessibility violations with a selection active", async () => {
    const { container } = render(<TransactionBulkActionBar {...baseProps()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
