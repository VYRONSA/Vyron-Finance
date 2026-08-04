"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import type { BankTransactionRecord } from "@/server/accounting/types";

type EntryType = "Receipt" | "Payment" | "Transfer";
const ENTRY_TYPES: EntryType[] = ["Receipt", "Payment", "Transfer"];

const STATUS_TONE: Record<string, "muted" | "info" | "good" | "danger" | "warn"> = {
  Draft: "muted",
  Submitted: "info",
  Approved: "info",
  Posted: "good",
  Cancelled: "danger",
};

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function CaptureForm({ companyId, bankAccounts, previewMode }: { companyId: string; bankAccounts: { id: number; accountName: string }[]; previewMode: boolean }) {
  const router = useRouter();
  const [entryType, setEntryType] = useState<EntryType>("Receipt");
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? 0);
  const [toBankAccountId, setToBankAccountId] = useState(bankAccounts[1]?.id ?? bankAccounts[0]?.id ?? 0);
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [glAccount, setGlAccount] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function capture() {
    setLoading(true);
    setError(null);
    try {
      const endpoint = entryType === "Receipt" ? "receipts" : entryType === "Payment" ? "payments" : "transfers";
      const body =
        entryType === "Transfer"
          ? { fromBankAccountId: bankAccountId, toBankAccountId, transactionDate, amount: Number(amount), description, reference }
          : { bankAccountId, transactionDate, amount: Number(amount), glAccount, description, reference };
      const res = await fetch(`/api/companies/${companyId}/cashbook/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setAmount("");
      setGlAccount("");
      setDescription("");
      setReference("");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap gap-2">
          {ENTRY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setEntryType(t)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${entryType === t ? "border-vf-red-600 bg-vf-red-500/10 text-vf-red-600" : "border-vf-paper-border text-vf-ink-soft hover:border-vf-red-400"}`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="cb-bank-account" className="mb-1 block text-xs font-medium text-vf-ink-faint">{entryType === "Transfer" ? "From Bank Account" : "Bank Account"}</label>
            <select id="cb-bank-account" value={bankAccountId} onChange={(e) => setBankAccountId(Number(e.target.value))} className="min-w-[200px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountName}
                </option>
              ))}
            </select>
          </div>
          {entryType === "Transfer" && (
            <div>
              <label htmlFor="cb-to-bank-account" className="mb-1 block text-xs font-medium text-vf-ink-faint">To Bank Account</label>
              <select id="cb-to-bank-account" value={toBankAccountId} onChange={(e) => setToBankAccountId(Number(e.target.value))} className="min-w-[200px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountName}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="cb-date" className="mb-1 block text-xs font-medium text-vf-ink-faint">Date</label>
            <Input id="cb-date" type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} className="w-40" />
          </div>
          <div>
            <label htmlFor="cb-amount" className="mb-1 block text-xs font-medium text-vf-ink-faint">Amount</label>
            <Input id="cb-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" />
          </div>
          {entryType !== "Transfer" && (
            <div>
              <label htmlFor="cb-gl-account" className="mb-1 block text-xs font-medium text-vf-ink-faint">GL Account</label>
              <Input id="cb-gl-account" value={glAccount} onChange={(e) => setGlAccount(e.target.value)} placeholder="e.g. 4000" className="w-32" />
            </div>
          )}
          <div>
            <label htmlFor="cb-reference" className="mb-1 block text-xs font-medium text-vf-ink-faint">Reference</label>
            <Input id="cb-reference" value={reference} onChange={(e) => setReference(e.target.value)} className="w-36" />
          </div>
          <div className="flex-1 min-w-[220px]">
            <label htmlFor="cb-description" className="mb-1 block text-xs font-medium text-vf-ink-faint">Description</label>
            <Input id="cb-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <Button variant="primary" size="sm" disabled={previewMode || loading || !amount || !description.trim()} title={disabledTitle} onClick={capture}>
            {loading ? "Capturing…" : `Capture ${entryType}`}
          </Button>
        </div>
        {error && <p className="text-sm text-vf-danger">{error}</p>}
        <p className="text-xs text-vf-ink-faint">
          Every capture starts as a Draft. Submit, then Approve &amp; Post below to send it through the Posting Engine — the same workflow every
          other module in this platform uses.
        </p>
      </CardContent>
    </Card>
  );
}

function EntryRow({ companyId, entry, previewMode }: { companyId: string; entry: BankTransactionRecord; previewMode: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function act(action: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/cashbook/${entry.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  const status = entry.captureStatus ?? "Draft";

  return (
    <div className="flex items-center justify-between gap-2 rounded-vf-md border border-vf-paper-border p-3">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-vf-ink">{entry.description}</p>
          <Badge tone={STATUS_TONE[status] ?? "muted"}>{status}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-vf-ink-faint">
          {entry.transactionDate} · {entry.reference} · {entry.credit > 0 ? `Receipt ${money(entry.credit)}` : `Payment ${money(entry.debit)}`}
        </p>
      </div>
      <div className="flex gap-2">
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
        {status === "Posted" && (
          <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => act("reverse")}>
            Reverse
          </Button>
        )}
      </div>
    </div>
  );
}

export function CaptureTab({ companyId, entries, bankAccounts, previewMode }: { companyId: string; entries: BankTransactionRecord[]; bankAccounts: { id: number; accountName: string }[]; previewMode: boolean }) {
  const actionable = entries.filter((e) => e.entrySource === "Manual" && (e.captureStatus === "Draft" || e.captureStatus === "Submitted" || e.captureStatus === "Posted"));

  return (
    <div className="flex flex-col gap-4">
      <CaptureForm companyId={companyId} bankAccounts={bankAccounts} previewMode={previewMode} />
      {actionable.length === 0 ? (
        <EmptyState title="No Cashbook entries yet." description="Capture a Receipt, Payment, or Transfer above." />
      ) : (
        <div className="flex flex-col gap-2">
          {actionable.map((e) => (
            <EntryRow key={e.id} companyId={companyId} entry={e} previewMode={previewMode} />
          ))}
        </div>
      )}
    </div>
  );
}
