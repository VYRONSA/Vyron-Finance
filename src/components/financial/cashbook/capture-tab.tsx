"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmActionRow, useConfirmTarget } from "@/components/ui/confirm-action";
import { BatchCaptureTab } from "./batch-capture-tab";
import { formatMoney } from "@/lib/money";
import { glAccountOptions } from "@/lib/account-picker-options";
import type { BankTransactionRecord } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

const STATUS_TONE: Record<string, "muted" | "info" | "good" | "danger" | "warn"> = {
  Draft: "muted",
  Submitted: "info",
  Approved: "info",
  Posted: "good",
  Cancelled: "danger",
};

function EntryRow({ companyId, entry, currency, chartOfAccounts, previewMode }: { companyId: string; entry: BankTransactionRecord; currency: string; chartOfAccounts: ChartOfAccount[]; previewMode: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const reverseConfirm = useConfirmTarget<true>();
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  // Finding #080 — the only way to correct a Draft/Submitted entry used
  // to be Cancel-and-recapture; this is the direct edit path.
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState(entry.transactionDate ?? "");
  const [editDescription, setEditDescription] = useState(entry.description);
  const [editReference, setEditReference] = useState(entry.reference);
  const [editAmount, setEditAmount] = useState(String(entry.credit > 0 ? entry.credit : entry.debit));
  const [editGlAccount, setEditGlAccount] = useState(entry.glAccount);
  const [editVat, setEditVat] = useState(String(entry.vat ?? 0));
  const [editError, setEditError] = useState<string | null>(null);
  const glOptions = glAccountOptions(chartOfAccounts);

  async function act(action: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/cashbook/${entry.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      if (res.ok) {
        reverseConfirm.cancel();
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  async function saveEdit() {
    setLoading(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/cashbook/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          transactionDate: editDate,
          description: editDescription,
          reference: editReference,
          amount: Number(editAmount) || 0,
          vatAmount: Number(editVat) || 0,
          glAccount: editGlAccount,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setEditError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  const status = entry.captureStatus ?? "Draft";
  const canEdit = status === "Draft" || status === "Submitted";

  if (editing) {
    return (
      <div className="rounded-vf-md border border-vf-paper-border p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label="Date" htmlFor={`edit-date-${entry.id}`}>
            <Input id={`edit-date-${entry.id}`} type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor={`edit-desc-${entry.id}`}>
            <Input id={`edit-desc-${entry.id}`} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
          </Field>
          <Field label="Reference" htmlFor={`edit-ref-${entry.id}`}>
            <Input id={`edit-ref-${entry.id}`} value={editReference} onChange={(e) => setEditReference(e.target.value)} />
          </Field>
          <Field label="Amount" htmlFor={`edit-amount-${entry.id}`}>
            <Input id={`edit-amount-${entry.id}`} type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
          </Field>
          <Field label="VAT" htmlFor={`edit-vat-${entry.id}`}>
            <Input id={`edit-vat-${entry.id}`} type="number" value={editVat} onChange={(e) => setEditVat(e.target.value)} />
          </Field>
          <Field label="GL Account" htmlFor={`edit-gl-${entry.id}`}>
            <Combobox value={editGlAccount || null} options={glOptions} placeholder="1000 — Bank Current Account" aria-label="GL Account" onCommit={(val) => setEditGlAccount(val ?? "")} />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" size="sm" disabled={loading} onClick={saveEdit}>
            {loading ? "Saving…" : "Save"}
          </Button>
          <Button variant="subtle" size="sm" disabled={loading} onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {editError && <span className="text-xs text-vf-danger">{editError}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-vf-md border border-vf-paper-border p-3">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-vf-ink">{entry.description}</p>
          <Badge tone={STATUS_TONE[status] ?? "muted"}>{status}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-vf-ink-faint">
          {entry.transactionDate} · {entry.reference} · {entry.credit > 0 ? `Receipt ${formatMoney(entry.credit, currency)}` : `Payment ${formatMoney(entry.debit, currency)}`}
        </p>
      </div>
      <div className="flex gap-2">
        {canEdit && (
          <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        {status === "Draft" && (
          <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => act("submit")}>
            Submit
          </Button>
        )}
        {status === "Submitted" && (
          <Button variant="primary" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => act("approve-post")}>
            Approve &amp; Post
          </Button>
        )}
        {(status === "Draft" || status === "Submitted") && (
          <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => act("cancel")}>
            Cancel
          </Button>
        )}
        {status === "Posted" &&
          (reverseConfirm.isConfirming(true) ? (
            <ConfirmActionRow
              message="Reverse this entry? This posts a reversing journal and cannot be undone."
              confirmLabel="Confirm Reverse"
              confirmingLabel="Reversing…"
              loading={loading}
              tone="danger"
              onConfirm={() => act("reverse")}
              onCancel={reverseConfirm.cancel}
            />
          ) : (
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => reverseConfirm.request(true)}>
              Reverse
            </Button>
          ))}
      </div>
    </div>
  );
}

export function CaptureTab({ companyId, entries, bankAccounts, chartOfAccounts, previewMode }: { companyId: string; entries: BankTransactionRecord[]; bankAccounts: { id: number; accountName: string; currency: string }[]; chartOfAccounts: ChartOfAccount[]; previewMode: boolean }) {
  const actionable = entries.filter((e) => e.entrySource === "Manual" && (e.captureStatus === "Draft" || e.captureStatus === "Submitted" || e.captureStatus === "Posted"));
  const currencyByAccountId = new Map(bankAccounts.map((a) => [a.id, a.currency]));

  return (
    <div className="flex flex-col gap-6">
      <BatchCaptureTab companyId={companyId} bankAccounts={bankAccounts} chartOfAccounts={chartOfAccounts} previewMode={previewMode} />
      <div>
        <p className="mb-3 text-sm font-semibold text-vf-ink">Individual entries</p>
        {actionable.length === 0 ? (
          <EmptyState title="No Cashbook entries yet." description="Capture rows above, or paste an entire day's transactions from Excel." />
        ) : (
          <div className="flex flex-col gap-2">
            {actionable.map((e) => (
              <EntryRow key={e.id} companyId={companyId} entry={e} currency={(e.bankAccountId !== null && currencyByAccountId.get(e.bankAccountId)) || "ZAR"} chartOfAccounts={chartOfAccounts} previewMode={previewMode} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
