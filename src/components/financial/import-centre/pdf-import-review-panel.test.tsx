import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PdfImportReviewPanel, transactionsStorageKey, type PdfStatementPreview } from "./pdf-import-review-panel";
import type { ParsedBankTransaction } from "@/server/import-centre/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

function transaction(overrides: Partial<ParsedBankTransaction> & Pick<ParsedBankTransaction, "rowNumber">): ParsedBankTransaction {
  return {
    transactionDate: "2026-07-01",
    reference: "REF-1",
    description: "POS Purchase",
    beneficiary: "",
    debit: 150,
    credit: 0,
    balance: 1000,
    bankAccount: "123456789",
    vat: null,
    glAccount: "",
    notes: "",
    sourceFilename: "statement.pdf",
    importBatch: "BATCH-PDF-1",
    ...overrides,
  };
}

function preview(transactions: ParsedBankTransaction[]): PdfStatementPreview {
  return {
    batchId: "BATCH-PDF-1",
    sourceFilename: "statement.pdf",
    pdfDetection: { bankId: "fnb", bankName: "FNB", confidence: 0.95, status: "validated" },
    metadata: {
      accountHolder: "Test Co", accountNumber: "123456789", statementPeriodStart: "2026-07-01", statementPeriodEnd: "2026-07-31",
      openingBalance: 1000, closingBalance: 850, statementNumber: null, creditLimit: null, availableBalance: null, interestSummary: null, vat: null, fees: null,
    },
    transactions,
    exceptions: [],
    validation: {
      balanceReconciliation: { reconciles: true, expectedClosingBalance: 850, delta: 0 },
      runningBalanceIssues: [],
      transactionCount: { reconciles: null, expectedCount: null, actualCount: transactions.length },
      invalidValueIssues: [],
    },
    duplicateOfBatch: null,
    expectedTransactionCount: null,
    reconciliationExplanation: null,
  };
}

describe("PdfImportReviewPanel — Finding #209 (RC-9)", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("persists an edited row to sessionStorage under the batch's key", async () => {
    render(<PdfImportReviewPanel companyId="co_1" preview={preview([transaction({ rowNumber: 1 })])} onDiscard={vi.fn()} />);

    const descriptionInput = screen.getByDisplayValue("POS Purchase");
    fireEvent.change(descriptionInput, { target: { value: "POS Purchase — corrected" } });
    fireEvent.blur(descriptionInput);

    await waitFor(() => {
      const raw = sessionStorage.getItem(transactionsStorageKey("co_1", "BATCH-PDF-1"));
      expect(raw).not.toBeNull();
      const stored = JSON.parse(raw!) as ParsedBankTransaction[];
      expect(stored[0].description).toBe("POS Purchase — corrected");
    });
  });

  it("rehydrates from a previously-persisted draft instead of the original preview transactions", () => {
    const draft = [transaction({ rowNumber: 1, description: "Recovered after navigating away" })];
    sessionStorage.setItem(transactionsStorageKey("co_1", "BATCH-PDF-1"), JSON.stringify(draft));

    render(<PdfImportReviewPanel companyId="co_1" preview={preview([transaction({ rowNumber: 1, description: "Original extracted value" })])} onDiscard={vi.fn()} />);

    expect(screen.getByDisplayValue("Recovered after navigating away")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Original extracted value")).not.toBeInTheDocument();
  });

  it("clears the persisted draft once the import is confirmed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, exceptions: [] }) }));
    const onConfirmed = vi.fn();
    render(<PdfImportReviewPanel companyId="co_1" preview={preview([transaction({ rowNumber: 1 })])} onDiscard={vi.fn()} onConfirmed={onConfirmed} />);

    fireEvent.click(screen.getByRole("button", { name: /confirm import/i }));

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(transactionsStorageKey("co_1", "BATCH-PDF-1"))).toBeNull();
    vi.unstubAllGlobals();
  });
});
