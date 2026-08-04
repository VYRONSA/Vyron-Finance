import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { TransactionRecoveryPanel } from "./transaction-recovery-panel";
import type { BankTransactionRecord, TransactionDetail } from "@/server/accounting/types";

function baseTransaction(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1,
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
    rulesTriggered: ["Exact Supplier Name", "Exact Amount"],
    matchReason: "Matched on exact name and amount.",
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
    entrySource: "Imported",
    captureStatus: null,
    cashbookBatchId: null,
    reconciliationId: null,
    reversalOfTransactionId: null,
    isSplit: false,
    ...overrides,
  };
}

function detailFor(transaction: BankTransactionRecord): TransactionDetail {
  return { transaction, bankAccount: null, matchedSupplier: null, matchedCustomer: null, matchedMerchant: null, journal: null, matchHistory: [], allocationHistory: [], reviewHistory: [] };
}

describe("TransactionRecoveryPanel", () => {
  it("surfaces the real confidence, reasoning, and rules-triggered data", () => {
    render(<TransactionRecoveryPanel detail={detailFor(baseTransaction())} onAccept={() => {}} onReject={() => {}} previewMode={false} />);
    expect(screen.getByText("98% confidence")).toBeInTheDocument();
    expect(screen.getByText("Matched on exact name and amount.")).toBeInTheDocument();
    expect(screen.getByText("Exact Supplier Name")).toBeInTheDocument();
    expect(screen.getByText("Exact Amount")).toBeInTheDocument();
  });

  it("flags a possible duplicate payment when the engine set that required action", () => {
    render(
      <TransactionRecoveryPanel
        detail={detailFor(baseTransaction({ requiredAction: "Review — possible duplicate payment" }))}
        onAccept={() => {}}
        onReject={() => {}}
        previewMode={false}
      />,
    );
    expect(screen.getByText("Possible duplicate payment")).toBeInTheDocument();
  });

  it("states plainly when no customer or merchant has been identified yet", () => {
    render(<TransactionRecoveryPanel detail={detailFor(baseTransaction())} onAccept={() => {}} onReject={() => {}} previewMode={false} />);
    expect(screen.getByText("None identified")).toBeInTheDocument();
    expect(screen.getByText("Not yet identified")).toBeInTheDocument();
  });

  it("Learn Rule is disabled when no onLearnRule handler is supplied, enabled when one is", () => {
    const { rerender } = render(<TransactionRecoveryPanel detail={detailFor(baseTransaction())} onAccept={() => {}} onReject={() => {}} previewMode={false} />);
    expect(screen.getByRole("button", { name: /learn rule/i })).toBeDisabled();

    const onLearnRule = vi.fn();
    rerender(<TransactionRecoveryPanel detail={detailFor(baseTransaction())} onAccept={() => {}} onReject={() => {}} onLearnRule={onLearnRule} previewMode={false} />);
    const button = screen.getByRole("button", { name: /learn rule/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onLearnRule).toHaveBeenCalledOnce();
  });

  it("calls onAccept/onReject when clicked outside Preview Mode", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(<TransactionRecoveryPanel detail={detailFor(baseTransaction())} onAccept={onAccept} onReject={onReject} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("disables Accept/Reject in Preview Mode", () => {
    render(<TransactionRecoveryPanel detail={detailFor(baseTransaction())} onAccept={() => {}} onReject={() => {}} previewMode />);
    expect(screen.getByRole("button", { name: /^accept$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeDisabled();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(
      <TransactionRecoveryPanel detail={detailFor(baseTransaction())} onAccept={() => {}} onReject={() => {}} previewMode={false} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
