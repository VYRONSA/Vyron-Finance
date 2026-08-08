"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BatchEntryGrid, type GridColumn } from "@/components/financial/shared/batch-entry-grid";
import { ImportOutcomeSummary } from "@/components/financial/import-centre/import-outcome-summary";
import type { BankStatementMetadata, ImportExceptionRecord, ParsedBankTransaction } from "@/server/import-centre/types";
import type { StatementValidationResult } from "@/server/import-centre/pdf-statement-validation";
import type { FnbCreditCardReconciliationCheck } from "@/server/import-centre/parsers/fnb-credit-card-statement-parser";
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
  expectedTransactionCount: number | null;
  reconciliationExplanation: FnbCreditCardReconciliationCheck | null;
};

function formatMoney(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function MetadataField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-vf-ink-faint">{label}</span>
      <span className="text-sm font-medium text-vf-ink">{value}</span>
    </div>
  );
}

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
 * of any extracted values before posting." FNB has a real,
 * implemented-but-unvalidated parser (see
 * `bank-statement-adapter-registry.ts`); every other named bank still
 * honestly extracts zero transactions pending a real sample statement —
 * either way this renders the statement header, every extracted
 * transaction (editable), and every validation result. */
export function PdfImportReviewPanel({ companyId, preview, onDiscard }: { companyId: string; preview: PdfStatementPreview; onDiscard: () => void }) {
  const router = useRouter();
  const [transactions, setTransactions] = useState<ParsedBankTransaction[]>(preview.transactions);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedOutcome, setConfirmedOutcome] = useState<{ importedCount: number; duplicateCount: number; rulesAutoAllocated: number } | null>(null);

  const { balanceReconciliation, runningBalanceIssues, transactionCount, invalidValueIssues } = preview.validation;

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
          expectedTransactionCount: preview.expectedTransactionCount,
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
      <ImportOutcomeSummary
        companyId={companyId}
        batchId={preview.batchId}
        importedCount={confirmedOutcome.importedCount}
        duplicateCount={confirmedOutcome.duplicateCount}
        rulesAllocatedCount={confirmedOutcome.rulesAutoAllocated}
        exceptionCount={preview.exceptions.length}
        onImportAnother={onDiscard}
        onFinish={onDiscard}
      />
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
        <div className="grid grid-cols-2 gap-3 rounded-vf-md border border-vf-paper-border bg-vf-paper-alt p-3 sm:grid-cols-3">
          <MetadataField label="Account Holder" value={preview.metadata.accountHolder ?? "Not extracted"} />
          <MetadataField label="Account Number" value={preview.metadata.accountNumber ?? "Not extracted"} />
          <MetadataField
            label="Statement Period"
            value={preview.metadata.statementPeriodStart && preview.metadata.statementPeriodEnd ? `${preview.metadata.statementPeriodStart} to ${preview.metadata.statementPeriodEnd}` : "Not extracted"}
          />
          <MetadataField label="Opening Balance" value={formatMoney(preview.metadata.openingBalance)} />
          <MetadataField label="Closing Balance" value={formatMoney(preview.metadata.closingBalance)} />
          <MetadataField label="Statement Number" value={preview.metadata.statementNumber ?? "Not extracted"} />
          <MetadataField label="Credit Limit" value={formatMoney(preview.metadata.creditLimit)} />
          <MetadataField label="Available Balance" value={formatMoney(preview.metadata.availableBalance)} />
          <MetadataField label="Interest" value={preview.metadata.interestSummary ?? "Not extracted"} />
          <MetadataField label="VAT" value={formatMoney(preview.metadata.vat)} />
          <MetadataField label="Fees" value={formatMoney(preview.metadata.fees)} />
        </div>

        <div className="flex flex-wrap gap-2">
          {balanceReconciliation.reconciles === false && preview.reconciliationExplanation?.explainedByUnnettedCardholderCredit && (
            <Badge tone="warn">
              Balances differ by {formatMoney(preview.metadata.availableBalance)} — matches this statement&rsquo;s own segregated Credit Balance (one cardholder&rsquo;s credit isn&rsquo;t netted into Amount Owing), not a missing transaction
            </Badge>
          )}
          {balanceReconciliation.reconciles === false && !preview.reconciliationExplanation?.explainedByUnnettedCardholderCredit && (
            <Badge tone="danger">
              Opening + transactions ≠ closing balance (off by {balanceReconciliation.delta?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
            </Badge>
          )}
          {balanceReconciliation.reconciles === true && <Badge tone="good">Balances reconcile</Badge>}
          {balanceReconciliation.reconciles === null && <Badge tone="muted">Balance reconciliation unavailable — opening/closing balance not extracted</Badge>}
          {runningBalanceIssues.length > 0 && <Badge tone="danger">{runningBalanceIssues.length} row(s) with a running-balance mismatch</Badge>}
          {transactionCount.reconciles === false && (
            <Badge tone="danger">
              Possible missing transactions — statement reports {transactionCount.expectedCount}, {transactionCount.actualCount} extracted
            </Badge>
          )}
          {transactionCount.reconciles === true && <Badge tone="good">Transaction count matches the statement&rsquo;s own total</Badge>}
          {invalidValueIssues.length > 0 && <Badge tone="danger">{invalidValueIssues.length} row(s) with an invalid value</Badge>}
          {preview.duplicateOfBatch && (
            <Badge tone="warn">Possible duplicate — a statement for this account and period was already imported ({preview.duplicateOfBatch.batchId})</Badge>
          )}
        </div>

        {(runningBalanceIssues.length > 0 || invalidValueIssues.length > 0) && (
          <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-vf-md border border-vf-danger/30 bg-vf-danger/5 p-3 text-xs text-vf-danger">
            {runningBalanceIssues.map((issue) => (
              <li key={`balance-${issue.rowNumber}`}>
                Row {issue.rowNumber}: running balance should be {formatMoney(issue.expectedBalance)}, statement shows {formatMoney(issue.statedBalance)}
              </li>
            ))}
            {invalidValueIssues.map((issue) => (
              <li key={`value-${issue.rowNumber}`}>
                Row {issue.rowNumber}: {issue.reason}
              </li>
            ))}
          </ul>
        )}

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
