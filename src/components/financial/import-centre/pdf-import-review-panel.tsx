"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BatchEntryGrid, type GridColumn } from "@/components/financial/shared/batch-entry-grid";
import type { BankStatementMetadata, ImportExceptionRecord, ParsedBankTransaction } from "@/server/import-centre/types";
import type { StatementValidationResult } from "@/server/import-centre/pdf-statement-validation";
import type { ImportBatch } from "@/server/accounting/types";

export type PdfStatementPreview = {
  batchId: string;
  sourceFilename: string;
  pdfDetection: { bankId: string; bankName: string; confidence: number; status: "validated" | "implemented-unvalidated" | "awaiting-validation" };
  metadata: BankStatementMetadata;
  transactions: ParsedBankTransaction[];
  exceptions: ImportExceptionRecord[];
  validation: StatementValidationResult;
  duplicateOfBatch: ImportBatch | null;
};

const COLUMNS: GridColumn<ParsedBankTransaction>[] = [
  { key: "transactionDate", label: "Date", type: "date", width: "w-32" },
  { key: "description", label: "Description", type: "text" },
  { key: "reference", label: "Reference", type: "text", width: "w-32" },
  { key: "debit", label: "Debit", type: "number", align: "right", width: "w-28" },
  { key: "credit", label: "Credit", type: "number", align: "right", width: "w-28" },
  { key: "balance", label: "Running Balance", type: "number", align: "right", width: "w-32" },
];

function statusBadge(status: PdfStatementPreview["pdfDetection"]["status"]) {
  if (status === "validated") return <Badge tone="good">Validated parser</Badge>;
  if (status === "implemented-unvalidated") return <Badge tone="warn">Implemented — awaiting second-sample validation</Badge>;
  return <Badge tone="warn">Awaiting validation</Badge>;
}

/** Pilot Review Round 1 — PDF Bank Statement Import, Product Review
 * Board's Final Outstanding Requirement. "Display all extracted
 * transactions for user review before import. Allow manual correction
 * of any extracted values before posting." Every named bank still
 * extracts zero transactions today (see `bank-statement-adapter-registry.ts`),
 * so this renders an honest "0 extracted, awaiting validation" state
 * until a real parser lands — the grid, validation banners, and confirm
 * flow are fully wired for that day, not a placeholder. */
export function PdfImportReviewPanel({ companyId, preview, onDiscard }: { companyId: string; preview: PdfStatementPreview; onDiscard: () => void }) {
  const router = useRouter();
  const [transactions, setTransactions] = useState<ParsedBankTransaction[]>(preview.transactions);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedOutcome, setConfirmedOutcome] = useState<{ importedCount: number; duplicateCount: number; rulesAutoAllocated: number } | null>(null);

  const { balanceReconciliation, runningBalanceIssues } = preview.validation;

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      const response = await fetch(`/api/companies/${companyId}/import-centre/bank-transactions/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: preview.batchId,
          sourceFilename: preview.sourceFilename,
          metadata: preview.metadata,
          transactions,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? `Request failed (${response.status})`);
        return;
      }
      setConfirmedOutcome(body);
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setConfirming(false);
    }
  }

  if (confirmedOutcome) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="good">{confirmedOutcome.importedCount} imported</Badge>
            {confirmedOutcome.duplicateCount > 0 && <Badge tone="muted">{confirmedOutcome.duplicateCount} already on file</Badge>}
            {confirmedOutcome.rulesAutoAllocated > 0 && <Badge tone="info">{confirmedOutcome.rulesAutoAllocated} auto-allocated by Banking Rules</Badge>}
          </div>
          <Button variant="subtle" size="sm" onClick={onDiscard}>
            Import another statement
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review — {preview.sourceFilename}</CardTitle>
        <CardDescription>
          Detected <span className="font-medium text-vf-ink">{preview.pdfDetection.bankName}</span> ({Math.round(preview.pdfDetection.confidence * 100)}% confidence) — {statusBadge(preview.pdfDetection.status)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="flex flex-wrap gap-2">
          {balanceReconciliation.reconciles === false && (
            <Badge tone="danger">
              Opening + transactions ≠ closing balance (off by {balanceReconciliation.delta?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
            </Badge>
          )}
          {balanceReconciliation.reconciles === true && <Badge tone="good">Balances reconcile</Badge>}
          {balanceReconciliation.reconciles === null && <Badge tone="muted">Balance reconciliation unavailable — opening/closing balance not extracted</Badge>}
          {runningBalanceIssues.length > 0 && <Badge tone="danger">{runningBalanceIssues.length} row(s) with a running-balance mismatch</Badge>}
          {preview.duplicateOfBatch && (
            <Badge tone="warn">Possible duplicate — a statement for this account and period was already imported ({preview.duplicateOfBatch.batchId})</Badge>
          )}
        </div>

        {preview.exceptions.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-vf-md border border-vf-paper-border bg-vf-paper-alt p-3 text-xs text-vf-ink-faint">
            {preview.exceptions.map((exc, i) => (
              <li key={i}>{exc.description}</li>
            ))}
          </ul>
        )}

        <BatchEntryGrid
          columns={COLUMNS}
          rows={transactions}
          onRowsChange={setTransactions}
          createEmptyRow={() => ({
            transactionDate: null,
            reference: "",
            description: "",
            beneficiary: "",
            debit: 0,
            credit: 0,
            balance: null,
            bankAccount: preview.metadata.accountNumber ?? "",
            vat: null,
            glAccount: "",
            notes: "",
            sourceFilename: preview.sourceFilename,
            importBatch: preview.batchId,
            rowNumber: transactions.length + 1,
          })}
          getRowId={(row) => String(row.rowNumber)}
          allowRowManagement={false}
          emptyLabel="No transactions were extracted from this statement — this bank's parser is still awaiting validation with a real sample statement."
        />

        {error && (
          <p role="alert" className="text-xs text-vf-danger">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button variant="primary" size="sm" onClick={handleConfirm} disabled={confirming}>
            {confirming ? "Importing…" : `Confirm Import (${transactions.length} transaction${transactions.length === 1 ? "" : "s"})`}
          </Button>
          <Button variant="subtle" size="sm" onClick={onDiscard} disabled={confirming}>
            Discard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
