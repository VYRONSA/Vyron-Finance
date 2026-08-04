import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TransactionTimeline } from "./transaction-timeline";
import type { BankTransactionRecord, Journal, TransactionDetail } from "@/server/accounting/types";

function baseJournal(overrides: Partial<Journal> = {}): Journal {
  return {
    id: 1,
    companyId: "co_1",
    journalNumber: "JR000001",
    journalDate: "2026-07-29",
    journalType: "Bank Transactions",
    description: "",
    reference: "",
    sourceType: "bank_transactions_bulk",
    sourceId: null,
    status: "Draft",
    totalDebit: 500,
    totalCredit: 500,
    createdAt: "2026-07-29T15:00:00Z",
    postedAt: null,
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    isReversed: false,
    reversalOfJournalId: null,
    reversedByJournalId: null,
    postingBatchId: null,
    lines: [],
    ...overrides,
  };
}

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
    createdAt: "2026-07-01T10:00:00Z",
    allocationStatus: "Unallocated",
    matchedSupplierId: null,
    matchedSupplierName: null,
    matchedBillId: null,
    confidenceScore: null,
    rulesTriggered: [],
    matchReason: "",
    requiredAction: null,
    suggestedGlAccount: null,
    suggestedVatCode: null,
    allocationMethod: null,
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

describe("TransactionTimeline", () => {
  it("always shows Imported as reached, from the transaction's own import metadata", () => {
    const detail: TransactionDetail = {
      transaction: baseTransaction(),
      bankAccount: null,
      matchedSupplier: null,
      matchedCustomer: null,
      matchedMerchant: null,
      journal: null,
      matchHistory: [],
      allocationHistory: [],
      reviewHistory: [],
    };
    render(<TransactionTimeline detail={detail} />);
    expect(screen.getByText("Imported")).toBeInTheDocument();
    expect(screen.getByText("statement.csv")).toBeInTheDocument();
  });

  it("shows GL/VAT Assigned as reached once the transaction has real suggested values", () => {
    const detail: TransactionDetail = {
      transaction: baseTransaction({ suggestedGlAccount: "6000", suggestedVatCode: "Standard" }),
      bankAccount: null,
      matchedSupplier: null,
      matchedCustomer: null,
      matchedMerchant: null,
      journal: null,
      matchHistory: [],
      allocationHistory: [],
      reviewHistory: [],
    };
    render(<TransactionTimeline detail={detail} />);
    expect(screen.getByText("6000")).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
  });

  it("shows Journal Created only when a real journal exists, with its real journal number and status", () => {
    const withJournal: TransactionDetail = {
      transaction: baseTransaction({ journalId: 1 }),
      bankAccount: null,
      matchedSupplier: null,
      matchedCustomer: null,
      matchedMerchant: null,
      journal: baseJournal(),
      matchHistory: [],
      allocationHistory: [],
      reviewHistory: [],
    };
    render(<TransactionTimeline detail={withJournal} />);
    expect(screen.getByText("JR000001 (Draft)")).toBeInTheDocument();

    const withoutJournal: TransactionDetail = { ...withJournal, journal: null, transaction: baseTransaction() };
    const { unmount } = render(<TransactionTimeline detail={withoutJournal} />);
    expect(screen.getByText("No journal generated yet")).toBeInTheDocument();
    unmount();
  });

  it("shows Posted as not-yet-reached for a Draft journal", () => {
    const detail: TransactionDetail = {
      transaction: baseTransaction({ journalId: 1 }),
      bankAccount: null,
      matchedSupplier: null,
      matchedCustomer: null,
      matchedMerchant: null,
      journal: baseJournal(),
      matchHistory: [],
      allocationHistory: [],
      reviewHistory: [],
    };
    render(<TransactionTimeline detail={detail} />);
    expect(screen.getByText(/not yet posted/i)).toBeInTheDocument();
  });

  it("shows Posted as reached, with its posting timestamp, once the posting engine has actually posted the journal", () => {
    const detail: TransactionDetail = {
      transaction: baseTransaction({ journalId: 1 }),
      bankAccount: null,
      matchedSupplier: null,
      matchedCustomer: null,
      matchedMerchant: null,
      journal: baseJournal({ status: "Posted", postedAt: "2026-07-30T09:00:00Z" }),
      matchHistory: [],
      allocationHistory: [],
      reviewHistory: [],
    };
    render(<TransactionTimeline detail={detail} />);
    expect(screen.getByText(/posted to the general ledger/i)).toBeInTheDocument();
  });
});
