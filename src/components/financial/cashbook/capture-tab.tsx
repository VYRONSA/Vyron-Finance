"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { BatchCaptureTab } from "./batch-capture-tab";
import type { BankTransactionRecord } from "@/server/accounting/types";

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
    <div className="flex flex-col gap-6">
      <BatchCaptureTab companyId={companyId} bankAccounts={bankAccounts} previewMode={previewMode} />
      <div>
        <p className="mb-3 text-sm font-semibold text-vf-ink">Individual entries</p>
        {actionable.length === 0 ? (
          <EmptyState title="No Cashbook entries yet." description="Capture rows above, or paste an entire day's transactions from Excel." />
        ) : (
          <div className="flex flex-col gap-2">
            {actionable.map((e) => (
              <EntryRow key={e.id} companyId={companyId} entry={e} previewMode={previewMode} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
