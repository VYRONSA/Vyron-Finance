"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { CASHBOOK_BATCH_TYPES, type CashbookBatch, type CashbookBatchType } from "@/server/banking/types";

const STATUS_TONE: Record<string, "muted" | "info" | "good"> = { Draft: "muted", Approved: "info", Posted: "good" };

function BatchCard({ companyId, batch, previewMode }: { companyId: string; batch: CashbookBatch; previewMode: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function approveAndPost() {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/cashbook/batches/${batch.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve-post" }) });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-vf-md border border-vf-paper-border p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-vf-ink-faint">{batch.batchNumber}</span>
          <Badge tone="info">{batch.batchType}</Badge>
          <Badge tone={STATUS_TONE[batch.status]}>{batch.status}</Badge>
        </div>
        <p className="mt-1 text-sm text-vf-ink">{batch.batchDate}{batch.notes ? ` — ${batch.notes}` : ""}</p>
      </div>
      {batch.status !== "Posted" && (
        <Button variant="primary" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={approveAndPost}>
          {loading ? "Posting…" : "Approve & Post Batch"}
        </Button>
      )}
    </div>
  );
}

export function BatchesTab({ companyId, batches, previewMode }: { companyId: string; batches: CashbookBatch[]; previewMode: boolean }) {
  const router = useRouter();
  const [batchDate, setBatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [batchType, setBatchType] = useState<CashbookBatchType>("Mixed");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function create() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/cashbook/batches`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchDate, batchType, notes }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setNotes("");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <p className="text-xs text-vf-ink-faint">Group Cashbook entries into a batch for one Approve &amp; Post action across all of them. Assign a new capture to a batch via its Cashbook Batch ID.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="cb-batch-date" className="mb-1 block text-xs font-medium text-vf-ink-faint">Batch Date</label>
              <Input id="cb-batch-date" type="date" value={batchDate} onChange={(e) => setBatchDate(e.target.value)} className="w-40" />
            </div>
            <div>
              <label htmlFor="cb-batch-type" className="mb-1 block text-xs font-medium text-vf-ink-faint">Type</label>
              <select id="cb-batch-type" value={batchType} onChange={(e) => setBatchType(e.target.value as CashbookBatchType)} className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
                {CASHBOOK_BATCH_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="cb-batch-notes" className="mb-1 block text-xs font-medium text-vf-ink-faint">Notes</label>
              <Input id="cb-batch-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button variant="primary" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={create}>
              New Batch
            </Button>
          </div>
          {error && <p className="text-sm text-vf-danger">{error}</p>}
        </CardContent>
      </Card>

      {batches.length === 0 ? (
        <EmptyState title="No Cashbook batches yet." description="Create one above to group entries for a single Approve & Post action." />
      ) : (
        <div className="flex flex-col gap-3">
          {batches.map((b) => (
            <BatchCard key={b.id} companyId={companyId} batch={b} previewMode={previewMode} />
          ))}
        </div>
      )}
    </div>
  );
}
