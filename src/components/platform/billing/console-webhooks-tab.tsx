import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { IconRefresh } from "@/components/ui/icons";
import type { BillingProviderConnection, BillingWebhookEvent, BillingWebhookEventStatus } from "@/server/billing-platform/types";

const STATUS_TONE: Record<BillingWebhookEventStatus, "good" | "warn" | "info" | "danger" | "muted"> = {
  received: "info", processed: "good", failed: "danger", ignored: "muted", duplicate: "muted",
};

export function ConsoleWebhooksTab({ events, providerConnection }: { events: BillingWebhookEvent[]; providerConnection: BillingProviderConnection | null }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h3 className="text-sm font-semibold text-vf-ink">Provider health</h3>
        <div className="mt-3 flex items-center justify-between rounded-xl border border-vf-paper-border p-4">
          <div>
            <div className="text-sm font-medium text-vf-ink">Stripe</div>
            <div className="mt-0.5 text-xs text-vf-ink-faint">
              {providerConnection?.lastVerifiedAt ? `Last verified ${new Date(providerConnection.lastVerifiedAt).toLocaleString()}` : "Never verified"}
            </div>
          </div>
          <Badge tone={providerConnection?.status === "Connected" ? "good" : providerConnection?.status === "Error" ? "danger" : "muted"}>
            {providerConnection?.status ?? "Not Connected"}
          </Badge>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-vf-ink">Webhook events</h3>
        {events.length === 0 ? (
          <EmptyState icon={<IconRefresh className="h-5 w-5" />} title="No webhook events yet" description="Every Stripe webhook delivery — received, processed, failed, or a detected duplicate — is logged here for idempotency and replay-protection." className="mt-2" />
        ) : (
          <Table className="mt-3">
            <TableHead><TableRow><TableHeadCell>Received</TableHeadCell><TableHeadCell>Type</TableHeadCell><TableHeadCell>Status</TableHeadCell><TableHeadCell>Signature Verified</TableHeadCell><TableHeadCell>Retries</TableHeadCell></TableRow></TableHead>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{new Date(e.receivedAt).toLocaleString()}</TableCell>
                  <TableCell>{e.eventType}</TableCell>
                  <TableCell><Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge></TableCell>
                  <TableCell>{e.signatureVerified ? "Yes" : "No"}</TableCell>
                  <TableCell>{e.retryCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
