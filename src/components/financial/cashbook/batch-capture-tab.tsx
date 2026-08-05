"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { BatchEntryGrid, type GridColumn } from "@/components/financial/shared/batch-entry-grid";

/**
 * Pilot Review Round 1, Phase 4 — replaces the previous single-entry-at-
 * a-time Cashbook capture form. "The accountant must be able to capture
 * an entire day's transactions before posting" — unlimited rows, Add/
 * Insert/Duplicate/Delete row, Tab/Enter/Arrow-key navigation, paste
 * straight from Excel, running totals, Save Draft, Post Batch, and
 * row-level validation, all via the same shared `BatchEntryGrid` the
 * Opening Balances Chart-of-Accounts grid uses — this is that "reusable
 * Batch Entry framework for future modules" the directive asked for.
 *
 * Save Draft creates one real Cashbook Batch (`createCashbookBatch`) the
 * first time it's clicked, then captures every valid row against it
 * through the existing `captureCashbookReceipt`/`captureCashbookPayment`
 * endpoints (looped client-side — each row is still a real, individually
 * validated transaction; no new bulk-write path was needed since these
 * are always new rows, never an upsert-against-existing-drafts problem
 * the way the Opening Balances grid has). Post Batch calls the existing
 * `approveAndPostBatch` — the same one Posting Engine every other
 * module posts through.
 *
 * Transfers are deliberately NOT gridded — a transfer is inherently a
 * single two-leg action between two specific accounts, not a bulk-list
 * item, so it stays a small standalone form beneath the grid.
 */
type CashbookRowType = "Receipt" | "Payment";

type CashbookGridRow = {
  key: string;
  type: CashbookRowType;
  bankAccountId: number;
  transactionDate: string;
  glAccount: string;
  description: string;
  reference: string;
  amount: number;
};

let rowKeySeq = 0;
function nextRowKey(): string {
  rowKeySeq += 1;
  return `row-${rowKeySeq}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyRow(): CashbookGridRow {
  return { key: nextRowKey(), type: "Receipt", bankAccountId: 0, transactionDate: todayIso(), glAccount: "", description: "", reference: "", amount: 0 };
}

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BatchCaptureTab({
  companyId,
  bankAccounts,
  previewMode,
}: {
  companyId: string;
  bankAccounts: { id: number; accountName: string }[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<CashbookGridRow[]>([emptyRow()]);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [batchNumber, setBatchNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [transferFrom, setTransferFrom] = useState(bankAccounts[0]?.id ?? 0);
  const [transferTo, setTransferTo] = useState(bankAccounts[1]?.id ?? bankAccounts[0]?.id ?? 0);
  const [transferDate, setTransferDate] = useState(todayIso());
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDescription, setTransferDescription] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const receiptsTotal = rows.filter((r) => r.type === "Receipt").reduce((s, r) => s + r.amount, 0);
  const paymentsTotal = rows.filter((r) => r.type === "Payment").reduce((s, r) => s + r.amount, 0);

  function validateRow(row: CashbookGridRow): string | null {
    if (!row.bankAccountId && !row.description && !row.amount) return null; // untouched blank row
    if (!row.bankAccountId) return "Bank account required";
    if (!row.transactionDate) return "Date required";
    if (!row.glAccount.trim()) return "GL account required";
    if (!row.description.trim()) return "Description required";
    if (!row.amount || row.amount <= 0) return "Amount must be greater than zero";
    return null;
  }

  const columns = useMemo<GridColumn<CashbookGridRow>[]>(
    () => [
      { key: "type", label: "Type", type: "select", width: "w-28", options: [{ value: "Receipt", label: "Receipt" }, { value: "Payment", label: "Payment" }] },
      { key: "bankAccountId", label: "Bank Account", type: "select", width: "w-44", options: bankAccounts.map((a) => ({ value: String(a.id), label: a.accountName })) },
      { key: "transactionDate", label: "Date", type: "date", width: "w-36" },
      { key: "glAccount", label: "GL Account", type: "text", width: "w-28", placeholder: "e.g. 4000" },
      { key: "description", label: "Description", type: "text" },
      { key: "reference", label: "Reference", type: "text", width: "w-32" },
      { key: "amount", label: "Amount", type: "number", align: "right", width: "w-32" },
    ],
    [bankAccounts],
  );

  function updateRows(next: unknown[]) {
    setRows(
      (next as CashbookGridRow[]).map((row) => ({
        ...row,
        bankAccountId: typeof row.bankAccountId === "string" ? Number(row.bankAccountId) : row.bankAccountId,
      })),
    );
  }

  async function ensureBatch(): Promise<number> {
    if (batchId) return batchId;
    const res = await fetch(`/api/companies/${companyId}/cashbook/batches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchDate: todayIso(), batchType: "Mixed", notes: "Captured via Batch Entry grid." }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `Could not create batch (${res.status})`);
    setBatchId(json.batch.id);
    setBatchNumber(json.batch.batchNumber);
    return json.batch.id;
  }

  async function handleSaveDraft() {
    setError(null);
    setNotice(null);
    const validRows = rows.filter((r) => r.bankAccountId && r.transactionDate && r.glAccount.trim() && r.description.trim() && r.amount > 0);
    if (validRows.length === 0) {
      setError("No complete rows to save yet.");
      return;
    }

    setLoading(true);
    try {
      const targetBatchId = await ensureBatch();
      let created = 0;
      const failures: string[] = [];
      for (const row of validRows) {
        const endpoint = row.type === "Receipt" ? "receipts" : "payments";
        const res = await fetch(`/api/companies/${companyId}/cashbook/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bankAccountId: row.bankAccountId, transactionDate: row.transactionDate, amount: row.amount,
            glAccount: row.glAccount.trim(), reference: row.reference.trim(), description: row.description.trim(),
            cashbookBatchId: targetBatchId,
          }),
        });
        if (res.ok) created++;
        else {
          const json = await res.json().catch(() => ({}));
          failures.push(`${row.description || "row"}: ${json.error ?? res.status}`);
        }
      }

      setRows(validRows.length === rows.length ? [emptyRow()] : rows.filter((r) => !validRows.includes(r)));
      setNotice(`Saved ${created} of ${validRows.length} rows to batch${batchNumber ? ` ${batchNumber}` : ""}.${failures.length ? ` ${failures.length} failed — see below.` : ""}`);
      if (failures.length) setError(failures.join("; "));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach the API.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePostBatch() {
    if (!batchId) return;
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/cashbook/batches/${batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve-post" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      setNotice(`Batch ${json.batch.batchNumber} posted.`);
      setBatchId(null);
      setBatchNumber(null);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleTransfer(event: React.FormEvent) {
    event.preventDefault();
    setTransferError(null);
    if (transferFrom === transferTo) return setTransferError("Source and destination accounts must be different.");
    const amount = Number(transferAmount);
    if (!amount || amount <= 0) return setTransferError("Amount must be greater than zero.");
    if (!transferDescription.trim()) return setTransferError("Description is required.");

    setTransferLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/cashbook/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromBankAccountId: transferFrom, toBankAccountId: transferTo, transactionDate: transferDate, amount, description: transferDescription.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setTransferError(json.error ?? `Request failed (${res.status})`);
        return;
      }
      setTransferAmount("");
      setTransferDescription("");
      router.refresh();
    } finally {
      setTransferLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-vf-ink-faint uppercase">Receipts (this session)</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-vf-ink">{money(receiptsTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-vf-ink-faint uppercase">Payments (this session)</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-vf-ink">{money(paymentsTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-vf-ink-faint uppercase">Batch</p>
            <p className="mt-1 text-2xl font-semibold text-vf-ink">{batchNumber ?? "Not yet saved"}</p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-vf-danger/25 bg-vf-danger/8 px-3.5 py-2.5 text-sm text-vf-danger">
          {error}
        </p>
      )}
      {notice && <p className="rounded-lg border border-vf-success/25 bg-vf-success/8 px-3.5 py-2.5 text-sm text-[#1f6e4b]">{notice}</p>}

      <BatchEntryGrid
        columns={columns}
        rows={rows}
        onRowsChange={updateRows}
        createEmptyRow={emptyRow}
        getRowId={(row) => row.key}
        validateRow={validateRow}
        disabled={previewMode || loading}
        emptyLabel="Add a row, or paste an entire day's transactions directly from Excel."
      />

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={previewMode || loading} onClick={handleSaveDraft}>
          Save Draft
        </Button>
        <Button type="button" variant="primary" size="sm" disabled={previewMode || loading || !batchId} onClick={handlePostBatch}>
          Post Batch
        </Button>
        <p className="text-xs text-vf-ink-faint">Save at any point and keep adding rows — Post Batch becomes available once a batch has been saved.</p>
      </div>

      <Card>
        <CardContent className="p-6">
          <p className="mb-4 text-sm font-semibold text-vf-ink">Transfer between accounts</p>
          <form onSubmit={handleTransfer} className="flex flex-wrap items-end gap-3">
            <Field label="From" htmlFor="cb-transfer-from">
              <select id="cb-transfer-from" value={transferFrom} onChange={(e) => setTransferFrom(Number(e.target.value))} className="min-w-[180px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.accountName}</option>
                ))}
              </select>
            </Field>
            <Field label="To" htmlFor="cb-transfer-to">
              <select id="cb-transfer-to" value={transferTo} onChange={(e) => setTransferTo(Number(e.target.value))} className="min-w-[180px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.accountName}</option>
                ))}
              </select>
            </Field>
            <Field label="Date" htmlFor="cb-transfer-date">
              <Input id="cb-transfer-date" type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} className="w-40" />
            </Field>
            <Field label="Amount" htmlFor="cb-transfer-amount">
              <Input id="cb-transfer-amount" type="number" step="0.01" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} className="w-32" />
            </Field>
            <Field label="Description" htmlFor="cb-transfer-description">
              <Input id="cb-transfer-description" value={transferDescription} onChange={(e) => setTransferDescription(e.target.value)} className="min-w-[220px]" />
            </Field>
            <Button type="submit" variant="outline" size="sm" disabled={previewMode || transferLoading}>
              Transfer
            </Button>
          </form>
          {transferError && <p className="mt-2 text-sm text-vf-danger">{transferError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
