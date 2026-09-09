import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImportUploadCard, pdfPreviewStorageKey } from "./import-upload-card";
import type { PdfStatementPreview } from "@/components/financial/import-centre/pdf-import-review-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

function preview(): PdfStatementPreview {
  return {
    batchId: "BATCH-PDF-1",
    sourceFilename: "statement.pdf",
    pdfDetection: { bankId: "fnb", bankName: "FNB", confidence: 0.95, status: "validated" },
    metadata: {
      accountHolder: "Test Co", accountNumber: "123456789", statementPeriodStart: "2026-07-01", statementPeriodEnd: "2026-07-31",
      openingBalance: 1000, closingBalance: 850, statementNumber: null, creditLimit: null, availableBalance: null, interestSummary: null, vat: null, fees: null,
    },
    transactions: [],
    exceptions: [],
    validation: {
      balanceReconciliation: { reconciles: true, expectedClosingBalance: 850, delta: 0 },
      runningBalanceIssues: [],
      transactionCount: { reconciles: null, expectedCount: null, actualCount: 0 },
      invalidValueIssues: [],
    },
    duplicateOfBatch: null,
    expectedTransactionCount: null,
    reconciliationExplanation: null,
  };
}

describe("ImportUploadCard — Finding #209 (RC-9)", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("rehydrates a persisted PDF review draft on mount instead of showing the empty upload dropzone", () => {
    sessionStorage.setItem(pdfPreviewStorageKey("co_1", "bank-transactions"), JSON.stringify(preview()));

    render(
      <ImportUploadCard companyId="co_1" kind="bank-transactions" title="Bank Statements" description="" templateHint="" previewMode={false} />,
    );

    expect(screen.getByText(/review — statement\.pdf/i)).toBeInTheDocument();
    expect(screen.queryByText(/drag & drop a file here/i)).not.toBeInTheDocument();
  });

  it("shows the empty upload dropzone when there is no persisted draft", () => {
    render(
      <ImportUploadCard companyId="co_1" kind="bank-transactions" title="Bank Statements" description="" templateHint="" previewMode={false} />,
    );

    expect(screen.getByText(/drag & drop a file here/i)).toBeInTheDocument();
  });
});

// Phase 32 — "every import function must provide a downloadable
// template." Bank Transactions is the one importer that genuinely
// supports both CSV and Excel, so it gets both template buttons; Bills
// gets one (CSV-only).
describe("ImportUploadCard — Download Template (Phase 32)", () => {
  it("bank-transactions shows both a CSV and an Excel template button", () => {
    render(<ImportUploadCard companyId="co_1" kind="bank-transactions" title="Bank Statements" description="" templateHint="" previewMode={false} />);
    expect(screen.getByRole("button", { name: /download csv template/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download excel template/i })).toBeInTheDocument();
  });

  it("bills shows exactly one (CSV) template button, no Excel option", () => {
    render(<ImportUploadCard companyId="co_1" kind="bills" title="Bills" description="" templateHint="" previewMode={false} />);
    expect(screen.getByRole("button", { name: /download template/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /excel/i })).not.toBeInTheDocument();
  });

  it("the template buttons are shown even in preview mode — a user must never have to guess required columns", () => {
    render(<ImportUploadCard companyId="co_1" kind="bills" title="Bills" description="" templateHint="" previewMode />);
    expect(screen.getByRole("button", { name: /download template/i })).toBeInTheDocument();
  });
});
