import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { IconShieldCheck } from "@/components/ui/icons";
import type { BillingEvent, SubscriptionStatusHistoryEntry } from "@/server/billing-platform/types";

const EVENT_LABELS: Record<string, string> = {
  SubscriptionCreated: "Subscription created", SubscriptionChanged: "Subscription changed", SubscriptionCancelled: "Subscription cancelled",
  TrialStarted: "Trial started", TrialExpired: "Trial expired", PaymentReceived: "Payment received", PaymentFailed: "Payment failed",
  RefundIssued: "Refund issued", CreditApplied: "Credit applied", InvoiceGenerated: "Invoice generated", SeatIncreased: "Seat added",
  FeatureEnabled: "Feature enabled", FeatureDisabled: "Feature disabled",
};

/** Every event here comes straight from `billing_events` — the Billing
 * Event Bus's own durable log (see `billing-event-bus.ts`), the same
 * table the Audit Trail requirement reads from. Nothing on this tab is
 * a second, UI-only history. */
export function BillingAuditTab({ events, statusHistory }: { events: BillingEvent[]; statusHistory: SubscriptionStatusHistoryEntry[] }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h3 className="text-sm font-semibold text-vf-ink">Billing events</h3>
        {events.length === 0 ? (
          <EmptyState icon={<IconShieldCheck className="h-5 w-5" />} title="No billing events yet" description="Every significant billing action (subscription changes, payments, refunds) is logged here as it happens." className="mt-2" />
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

      <div>
        <h3 className="text-sm font-semibold text-vf-ink">Subscription status history</h3>
        {statusHistory.length === 0 ? (
          <EmptyState title="No status changes yet" description="Every subscription status transition (trial, active, past due, suspended, ...) is recorded here." className="mt-2" />
        ) : (
          <Table className="mt-3">
            <TableHead><TableRow><TableHeadCell>When</TableHeadCell><TableHeadCell>From</TableHeadCell><TableHeadCell>To</TableHeadCell><TableHeadCell>Reason</TableHeadCell></TableRow></TableHead>
            <TableBody>
              {statusHistory.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{new Date(h.occurredAt).toLocaleString()}</TableCell>
                  <TableCell>{h.fromStatus ?? "—"}</TableCell>
                  <TableCell>{h.toStatus}</TableCell>
                  <TableCell className="text-vf-ink-faint">{h.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
