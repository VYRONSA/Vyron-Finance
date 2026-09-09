import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { TransactionBulkActionBar } from "./transaction-bulk-action-bar";
import type { BankTransactionRecord, Supplier } from "@/server/accounting/types";
import type { Merchant } from "@/server/banking-rules/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

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
    postedFlag: false,
    postedAt: null,
    postingBatchId: null,
    sourceOccurrence: 1,
    reviewHold: false,
    reviewHoldReason: "",
    reviewHoldBy: null,
    reviewHoldAt: null,
    ...overrides,
  };
}

const SUPPLIERS: Supplier[] = [
  {
    id: 1, companyId: "co_1", name: "ABC Supplies", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
    supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "", bankBranchCode: "",
    vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 30, spendingLimit: 0,
  },
];

function supplier(overrides: Partial<Supplier> & Pick<Supplier, "id" | "name">): Supplier {
  return {
    companyId: "co_1", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
    supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "",
    bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 0, spendingLimit: 0,
    ...overrides,
  };
}

const CUSTOMERS = [{ id: 1, name: "Meridian Traders" }];

const MERCHANTS: Merchant[] = [
  {
    id: 1, companyId: "co_1", name: "ABC Supplies", aliases: [], defaultSupplierId: 1, defaultCustomerId: null,
    defaultGlAccount: "", defaultVatCode: "", notes: "", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  },
];

const CHART_OF_ACCOUNTS: ChartOfAccount[] = [
  {
    id: 1, companyId: "co_1", accountCode: "7000", description: "Sales", accountType: "Income", category: "", normalBalance: "Credit",
    parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "", branchId: null, departmentId: null,
    costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00Z",
  },
];

const noop = () => {};

function baseProps(overrides: Partial<Parameters<typeof TransactionBulkActionBar>[0]> = {}) {
  return {
    selected: [txn({ id: 1 })],
    suppliers: SUPPLIERS,
    customers: CUSTOMERS,
    merchants: MERCHANTS,
    chartOfAccounts: CHART_OF_ACCOUNTS,
    vatTreatments: [],
    onAssignSupplier: noop,
    onAssignMerchant: noop,
    onAssignCustomer: noop,
    onAssignGl: noop,
    onAssignVat: noop,
    onReview: noop,
    onGenerateJournal: noop,
    onApplyRule: noop,
    onDeleteImport: noop,
    onDeleteTransactions: noop,
    onClassifyWithAi: noop,
    onSaveSelected: noop,
    saveSelectedDirtyCount: 0,
    savingSelected: false,
    loading: false,
    previewMode: false,
    companyId: "co_1",
    onPosted: noop,
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

  it("Finding #003 (RC-3) — Delete Import requires confirmation before calling onDeleteImport", () => {
    const onDeleteImport = vi.fn();
    render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1, importBatch: "BATCH-1" })], onDeleteImport })} />);

    fireEvent.click(screen.getByRole("button", { name: /delete import/i }));
    expect(screen.getByText(/delete this entire import batch/i)).toBeInTheDocument();
    expect(onDeleteImport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onDeleteImport).not.toHaveBeenCalled();
    expect(screen.queryByText(/delete this entire import batch/i)).not.toBeInTheDocument();
  });

  it("calls onDeleteImport once the confirmation is accepted", () => {
    const onDeleteImport = vi.fn();
    render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1, importBatch: "BATCH-1" })], onDeleteImport })} />);

    fireEvent.click(screen.getByRole("button", { name: /delete import/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onDeleteImport).toHaveBeenCalledTimes(1);
  });

  // Phase 39/41, Part 2 — Delete Transaction. Distinct from Delete Import
  // above: this deletes only the selection, states permanence, and
  // Cancel must fully close (never a bare no-op leaving state dangling).
  // Phase 41 — the button label itself changes with the selection size
  // ("Delete" for one, "Delete Selected" for many), per the exact
  // requested workflow, so it's never mistaken for "delete everything."
  it("shows plain 'Delete' for a single selection, requires confirmation, and states permanence", () => {
    const onDeleteTransactions = vi.fn();
    render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1 })], onDeleteTransactions })} />);

    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/delete this transaction\?/i)).toBeInTheDocument();
    expect(screen.getByText(/permanently removed/i)).toBeInTheDocument();
    expect(onDeleteTransactions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onDeleteTransactions).not.toHaveBeenCalled();
    expect(screen.queryByText(/delete this transaction\?/i)).not.toBeInTheDocument();
  });

  it("shows 'Delete Selected' (not plain 'Delete') for a multi-transaction selection, and pluralizes the confirmation", () => {
    render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1 }), txn({ id: 2 }), txn({ id: 3 })] })} />);
    expect(screen.getByRole("button", { name: "Delete Selected" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Selected" }));
    expect(screen.getByText(/delete 3 transactions\?/i)).toBeInTheDocument();
    expect(screen.getByText(/permanently removed/i)).toBeInTheDocument();
  });

  it("calls onDeleteTransactions once the confirmation is accepted, via the exact 'Delete Transactions' confirm button", () => {
    const onDeleteTransactions = vi.fn();
    render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1 })], onDeleteTransactions })} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Transactions" }));
    expect(onDeleteTransactions).toHaveBeenCalledTimes(1);
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
    fireEvent.blur(screen.getByPlaceholderText("GL account code"));
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
    fireEvent.blur(screen.getByPlaceholderText("GL account code"));
    fireEvent.click(screen.getByLabelText("Create Banking Rule"));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onAssignGl).toHaveBeenCalledWith("7000", {
      matchField: "beneficiary",
      matchDescription: "ABC Supplies",
      matchType: "contains",
      // Phase 51 — production defect: this used to default to true,
      // silently sweeping the whole company the moment a rule was
      // created — see the Phase 50 forensic report.
      applyToRemaining: false,
      applyToFutureImports: true,
    });
  });

  it("Phase 51 — Apply to Remaining Transactions starts UNCHECKED when Create Banking Rule is freshly checked, and can be explicitly re-enabled", () => {
    const onAssignGl = vi.fn();
    render(<TransactionBulkActionBar {...baseProps({ onAssignGl, selected: [txn({ id: 1, beneficiary: "ABC Supplies" })] })} />);
    fireEvent.click(screen.getByRole("button", { name: /assign gl/i }));
    fireEvent.click(screen.getByLabelText("Create Banking Rule"));

    expect(screen.getByRole("checkbox", { name: "Apply to Remaining Transactions" })).not.toBeChecked();

    // Still available when explicitly enabled — Fix 1's own requirement:
    // "existing functionality must remain available when explicitly enabled."
    fireEvent.click(screen.getByRole("checkbox", { name: "Apply to Remaining Transactions" }));
    fireEvent.change(screen.getByPlaceholderText("GL account code"), { target: { value: "7000" } });
    fireEvent.blur(screen.getByPlaceholderText("GL account code"));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onAssignGl).toHaveBeenCalledWith("7000", expect.objectContaining({ applyToRemaining: true }));
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

// -----------------------------------------------------------------------
// Phase 22B — "Classify with AI". The default `txn()` fixture (Matched,
// a supplier and suggestedGlAccount already set) is NOT eligible, so
// these tests build an explicitly eligible one rather than relying on it.
// -----------------------------------------------------------------------

function eligibleTxn(id: number) {
  return txn({
    id,
    allocationStatus: "Unallocated",
    matchedSupplierId: null,
    matchedSupplierName: null,
    matchedBillId: null,
    suggestedGlAccount: null,
    suggestedVatCode: null,
    allocationMethod: null,
    matchedCustomerId: null,
    matchedMerchantId: null,
    ruleId: null,
  });
}

describe("TransactionBulkActionBar — Classify with AI (Phase 22B)", () => {
  it("is disabled when nothing in the selection is eligible", () => {
    render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1 })] })} />);
    expect(screen.getByRole("button", { name: /^classify with ai$/i })).toBeDisabled();
  });

  it("is enabled when the whole selection is eligible, with no count suffix", () => {
    render(<TransactionBulkActionBar {...baseProps({ selected: [eligibleTxn(1), eligibleTxn(2)] })} />);
    const button = screen.getByRole("button", { name: /^classify with ai$/i });
    expect(button).not.toBeDisabled();
  });

  it("shows the eligible count when only some of the selection is eligible", () => {
    render(<TransactionBulkActionBar {...baseProps({ selected: [eligibleTxn(1), txn({ id: 2 })] })} />);
    const button = screen.getByRole("button", { name: /classify with ai \(1\)/i });
    expect(button).not.toBeDisabled();
  });

  it("calls onClassifyWithAi when clicked", () => {
    const onClassifyWithAi = vi.fn();
    render(<TransactionBulkActionBar {...baseProps({ selected: [eligibleTxn(1)], onClassifyWithAi })} />);
    fireEvent.click(screen.getByRole("button", { name: /classify with ai/i }));
    expect(onClassifyWithAi).toHaveBeenCalledTimes(1);
  });

  it("is disabled during a loading action even if eligible", () => {
    render(<TransactionBulkActionBar {...baseProps({ selected: [eligibleTxn(1)], loading: true })} />);
    expect(screen.getByRole("button", { name: /classify with ai/i })).toBeDisabled();
  });
});

describe("TransactionBulkActionBar — Save Selected (Phase 31)", () => {
  it("is disabled when nothing in the selection has unsaved changes — the recommended, not merely possible, state", () => {
    render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1 }), txn({ id: 2 })], saveSelectedDirtyCount: 0 })} />);
    expect(screen.getByRole("button", { name: /^save selected$/i })).toBeDisabled();
  });

  it("is enabled and shows the dirty count once at least one selected row has unsaved changes", () => {
    render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1 })], saveSelectedDirtyCount: 1 })} />);
    const button = screen.getByRole("button", { name: /save selected \(1\)/i });
    expect(button).not.toBeDisabled();
  });

  it("the dirty count reflects only SELECTED dirty rows, not the whole page — 50 selected, 10 dirty shows 10", () => {
    const selected = Array.from({ length: 50 }, (_, i) => txn({ id: i + 1 }));
    render(<TransactionBulkActionBar {...baseProps({ selected, saveSelectedDirtyCount: 10 })} />);
    expect(screen.getByRole("button", { name: /save selected \(10\)/i })).not.toBeDisabled();
  });

  it("calls onSaveSelected when clicked", () => {
    const onSaveSelected = vi.fn();
    render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1 })], saveSelectedDirtyCount: 1, onSaveSelected })} />);
    fireEvent.click(screen.getByRole("button", { name: /save selected/i }));
    expect(onSaveSelected).toHaveBeenCalledTimes(1);
  });

  it("shows a saving state and is disabled while a bulk save is already running — prevents duplicate submission", () => {
    render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1 })], saveSelectedDirtyCount: 5, savingSelected: true })} />);
    const button = screen.getByRole("button", { name: /saving 5/i });
    expect(button).toBeDisabled();
  });

  it("clicking while already saving does not fire a second call — duplicate-submission guard at the button level", () => {
    const onSaveSelected = vi.fn();
    render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1 })], saveSelectedDirtyCount: 5, savingSelected: true, onSaveSelected })} />);
    fireEvent.click(screen.getByRole("button", { name: /saving 5/i }));
    expect(onSaveSelected).not.toHaveBeenCalled();
  });

  it("is disabled in preview mode even with dirty rows selected, same as every other bulk action", () => {
    render(<TransactionBulkActionBar {...baseProps({ selected: [txn({ id: 1 })], saveSelectedDirtyCount: 1, previewMode: true })} />);
    expect(screen.getByRole("button", { name: /save selected/i })).toBeDisabled();
  });
});

// Phase 38 — Phase 37's production audit found Inactive suppliers
// (deactivated merge duplicates) selectable in the bulk "Assign Supplier"
// dropdown, since it built its options from the raw `suppliers` prop with
// no status filter.
describe("Assign Supplier — Active-only picker (Phase 38)", () => {
  const active = supplier({ id: 1, name: "Active Supplies", status: "Active" });
  const inactive = supplier({ id: 2, name: "Deactivated Duplicate", status: "Inactive" });

  it("shows the Active supplier as a selectable option", () => {
    render(<TransactionBulkActionBar {...baseProps({ suppliers: [active, inactive] })} />);
    fireEvent.click(screen.getByRole("button", { name: /assign supplier/i }));
    expect(screen.getByRole("option", { name: "Active Supplies" })).toBeInTheDocument();
  });

  it("does NOT show the Inactive supplier as a selectable option", () => {
    render(<TransactionBulkActionBar {...baseProps({ suppliers: [active, inactive] })} />);
    fireEvent.click(screen.getByRole("button", { name: /assign supplier/i }));
    expect(screen.queryByRole("option", { name: "Deactivated Duplicate" })).not.toBeInTheDocument();
  });
});
