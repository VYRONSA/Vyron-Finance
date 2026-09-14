/**
 * The Update action on the transaction detail panel.
 *
 * Before this existed the only way to change a transaction's allocation
 * was a per-cell "Save" button that appeared in the grid *after* you had
 * already begun editing a cell — there was no visible, labelled way to
 * update a transaction you had opened. These tests hold that action to
 * the three things that matter: it is visible and labelled "Update", it
 * commits through the existing authorised path, and it cannot touch the
 * imported Xero evidence or post anything.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TransactionDetailPanel } from "./transaction-detail-panel";
import type { AllocateRowPayload } from "./transaction-grid";
import type { BankTransactionRecord, TransactionDetail } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 2013, companyId: "co_1", transactionDate: "2026-03-05", reference: "", description: "Spend Money — Capitec Bank",
    beneficiary: "Capitec Bank", debit: 6, credit: 0, balance: null, bankAccount: "Metanoia Hospitality", bankAccountId: 3,
    glAccount: "3030 - Bank Charges, 820 - VAT", vat: null, notes: "Migrated from Xero. Source: Spend Money.",
    importBatch: "XERO-Metanoia Hospitality", sourceFilename: "bank.xlsx", createdAt: "2026-09-09T00:00:00Z",
    allocationStatus: "Unallocated", matchedSupplierId: null, matchedSupplierName: null, matchedBillId: null,
    confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null, suggestedGlAccount: null,
    suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null,
    matchedCustomerId: null, matchedMerchantId: null, ruleId: null, allocationType: null, allocationNotes: "",
    entrySource: "Imported", captureStatus: null, cashbookBatchId: null, reconciliationId: null,
    reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null,
    sourceOccurrence: 2, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false, overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
    ...overrides,
  };
}

function detailFor(t: BankTransactionRecord): TransactionDetail {
  return {
    transaction: t, bankAccount: null, matchedSupplier: null, matchedCustomer: null, matchedMerchant: null,
    journal: null, matchHistory: [], allocationHistory: [], reviewHistory: [],
  };
}

const CHART: ChartOfAccount[] = [
  {
    id: 1, companyId: "co_1", accountCode: "3030", description: "Bank Charges", accountType: "Expense",
    category: "Operating Expense", normalBalance: "Debit", parentAccountId: null, reportingGroup: "",
    financialStatementGroup: "", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null,
    projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00Z",
  },
];

const VAT: VatTreatment[] = [
  { id: 1, companyId: "co_1", code: "Standard Rated", name: "Standard Rated", rate: 15, vatType: "Standard", isActive: true, createdAt: "2026-01-01T00:00:00Z" },
];

type UpdateResult = { ok: true } | { ok: false; error: string };
type UpdateFn = (input: AllocateRowPayload) => Promise<UpdateResult>;

const okUpdate: UpdateFn = async () => ({ ok: true });

function renderPanel(t: BankTransactionRecord, impl: UpdateFn = okUpdate) {
  const onUpdate = vi.fn(impl);
  render(
    <TransactionDetailPanel
      detail={detailFor(t)}
      loading={false}
      onClose={() => {}}
      onUpdate={onUpdate}
      chartOfAccounts={CHART}
      vatTreatments={VAT}
      suppliers={[]}
      customers={[]}
    />,
  );
  return onUpdate;
}

describe("Update button — visibility", () => {
  it("is rendered, labelled exactly 'Update', and is a real button", () => {
    renderPanel(txn());
    const button = screen.getByRole("button", { name: "Update" });
    expect(button).toBeInTheDocument();
    expect(button.textContent).toBe("Update");
  });

  it("is visible on an unprocessed transaction without any prior edit gesture", () => {
    // The defect this fixes: the grid's "Save" only appeared once a cell
    // was already being edited, so an opened transaction offered no way
    // to update it at all.
    renderPanel(txn({ suggestedGlAccount: null, allocationType: null }));
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("is not hidden behind the column chooser or any menu — it sits in the panel itself", () => {
    renderPanel(txn());
    expect(screen.getByText("Update Allocation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeVisible();
  });

  it("is omitted when the caller supplies no update handler, rather than rendering a dead button", () => {
    render(<TransactionDetailPanel detail={detailFor(txn())} loading={false} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
  });
});

describe("Update button — commits through the existing authorised path", () => {
  it("sends an AllocateRowPayload with the chosen GL account", async () => {
    const onUpdate = renderPanel(txn({ allocationType: "G", suggestedGlAccount: "3030" }));

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const payload = onUpdate.mock.calls[0][0] as unknown as AllocateRowPayload;
    expect(payload).toMatchObject({ type: "G", accountCode: "3030", supplierId: null, customerId: null });
  });

  it("never sends the transaction's description — the imported evidence stays untouched", async () => {
    const onUpdate = renderPanel(txn({ allocationType: "G", suggestedGlAccount: "3030" }));
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    const payload = onUpdate.mock.calls[0][0] as unknown as AllocateRowPayload;
    // `null` means "unchanged, don't write it".
    expect(payload.description).toBeNull();
  });

  it("carries no field that could alter the Xero source account, amount, date or reference", async () => {
    const onUpdate = renderPanel(txn({ allocationType: "G", suggestedGlAccount: "3030" }));
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    const payload = onUpdate.mock.calls[0][0] as Record<string, unknown>;
    for (const forbidden of ["glAccount", "debit", "credit", "transactionDate", "reference", "sourceOccurrence", "postedFlag"]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it("reports success back to the user", async () => {
    renderPanel(txn({ allocationType: "G", suggestedGlAccount: "3030" }));
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(await screen.findByText("Updated.")).toBeInTheDocument();
  });

  it("surfaces a server refusal instead of silently claiming success", async () => {
    renderPanel(txn({ allocationType: "G", suggestedGlAccount: "3030" }), async () => ({
      ok: false,
      error: "This transaction has already been posted to the general ledger and cannot be modified.",
    }));

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(await screen.findByText(/already been posted/i)).toBeInTheDocument();
    expect(screen.queryByText("Updated.")).not.toBeInTheDocument();
  });
});

describe("Update button — safeguards", () => {
  it("refuses to update a posted transaction, and says why", () => {
    renderPanel(txn({ postedFlag: true, journalId: 900, suggestedGlAccount: "3030", allocationType: "G" }));
    expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
    expect(screen.getByText(/posted to the General Ledger and can no longer be edited/i)).toBeInTheDocument();
  });

  it("refuses to update a reconciled transaction", () => {
    renderPanel(txn({ postedFlag: true, reconciliationId: 7 }));
    expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
  });

  it("is disabled until an allocation names its target", () => {
    renderPanel(txn({ allocationType: "G", suggestedGlAccount: null }));
    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
  });

  it("allows a notes-only update on a still-unallocated transaction", async () => {
    const onUpdate = renderPanel(txn({ allocationType: null, suggestedGlAccount: null }));
    const button = screen.getByRole("button", { name: "Update" });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect((onUpdate.mock.calls[0][0] as unknown as AllocateRowPayload).type).toBeNull();
  });

  it("is disabled in preview mode", () => {
    render(
      <TransactionDetailPanel
        detail={detailFor(txn({ allocationType: "G", suggestedGlAccount: "3030" }))}
        loading={false}
        onClose={() => {}}
        onUpdate={vi.fn(async () => ({ ok: true as const }))}
        chartOfAccounts={CHART}
        vatTreatments={VAT}
        suppliers={[]}
        customers={[]}
        previewMode
      />,
    );
    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
  });

  it("shows the transaction's posting status alongside the action, so 'updated' is never read as 'posted'", () => {
    renderPanel(txn({ suggestedGlAccount: "3030" }));
    expect(screen.getAllByText("Ready to Post").length).toBeGreaterThan(0);
  });
});
