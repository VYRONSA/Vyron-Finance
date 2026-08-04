"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { IconShieldCheck } from "@/components/ui/icons";
import type { BillingEvent, BillingSupportNote } from "@/server/billing-platform/types";

const EVENT_LABELS: Record<string, string> = {
  SubscriptionCreated: "Subscription created", SubscriptionChanged: "Subscription changed", SubscriptionCancelled: "Subscription cancelled",
  TrialStarted: "Trial started", TrialExpired: "Trial expired", PaymentReceived: "Payment received", PaymentFailed: "Payment failed",
  RefundIssued: "Refund issued", CreditApplied: "Credit applied", InvoiceGenerated: "Invoice generated", SeatIncreased: "Seat added",
  FeatureEnabled: "Feature enabled", FeatureDisabled: "Feature disabled",
};

export type BillingAccountOption = { billingAccountId: string; label: string };

export function ConsoleSupportAuditTab({
  notes,
  events,
  billingAccountOptions,
  previewMode,
}: {
  notes: BillingSupportNote[];
  events: BillingEvent[];
  /** Every real billing account, one per row, so staff explicitly pick
   * which account a note is about — see docs/DEFECT_REGISTER.md D-029:
   * this tab used to write every note against a single fixed account
   * (whichever was first in an unrelated list) regardless of what the
   * operator was actually looking at, silently. */
  billingAccountOptions: BillingAccountOption[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [selectedBillingAccountId, setSelectedBillingAccountId] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAddNote() {
    if (!selectedBillingAccountId || !note.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/billing/support-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingAccountId: selectedBillingAccountId, note: note.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setNote("");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h3 className="text-sm font-semibold text-vf-ink">Support notes</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={selectedBillingAccountId}
            onChange={(e) => setSelectedBillingAccountId(e.target.value)}
            disabled={previewMode || billingAccountOptions.length === 0}
            className="min-h-9 rounded-full border border-vf-paper-border px-4 text-sm text-vf-ink disabled:opacity-50"
          >
            <option value="">{billingAccountOptions.length === 0 ? "No billing accounts yet" : "Select a billing account…"}</option>
            {billingAccountOptions.map((o) => (
              <option key={o.billingAccountId} value={o.billingAccountId}>{o.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={selectedBillingAccountId ? "Add a note about this account…" : "Select an account first"}
            disabled={!selectedBillingAccountId || previewMode}
            className="min-h-9 flex-1 rounded-full border border-vf-paper-border px-4 text-sm text-vf-ink disabled:opacity-50"
          />
          <Button variant="subtle" size="sm" onClick={handleAddNote} disabled={loading || !selectedBillingAccountId || !note.trim() || previewMode} title={previewMode ? "Available once a production Supabase project is connected" : undefined}>
            {loading ? "Adding…" : "Add Note"}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-vf-red-600">{error}</p>}
        {notes.length === 0 ? (
          <EmptyState title="No support notes yet" description="Notes staff add about a customer's billing account appear here." className="mt-4" />
        ) : (
          <Table className="mt-4">
            <TableHead><TableRow><TableHeadCell>When</TableHeadCell><TableHeadCell>Note</TableHeadCell><TableHeadCell>By</TableHeadCell></TableRow></TableHead>
            <TableBody>
              {notes.map((n) => (
                <TableRow key={n.id}>
                  <TableCell>{new Date(n.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{n.note}</TableCell>
                  <TableCell>{n.createdBy}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-vf-ink">Audit trail — every billing event, every company</h3>
        {events.length === 0 ? (
          <EmptyState icon={<IconShieldCheck className="h-5 w-5" />} title="No billing events yet" description="The Billing Event Bus's own durable log — every significant billing action, platform-wide." className="mt-2" />
        ) : (
          <Table className="mt-3">
            <TableHead><TableRow><TableHeadCell>When</TableHeadCell><TableHeadCell>Event</TableHeadCell></TableRow></TableHead>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{new Date(e.occurredAt).toLocaleString()}</TableCell>
                  <TableCell>{EVENT_LABELS[e.eventType] ?? e.eventType}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
