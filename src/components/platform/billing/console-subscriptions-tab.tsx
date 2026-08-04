import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { IconBanknote } from "@/components/ui/icons";
import type { ConsoleSubscriptionRow } from "@/app/platform/billing/page";
import type { SubscriptionStatus } from "@/server/billing-platform/types";

const STATUS_TONE: Record<SubscriptionStatus, "good" | "warn" | "info" | "danger" | "muted"> = {
  trial: "info", active: "good", past_due: "warn", grace_period: "warn", suspended: "danger", cancelled: "muted", expired: "muted", archived: "muted",
};

export function ConsoleSubscriptionsTab({ rows }: { rows: ConsoleSubscriptionRow[] }) {
  if (rows.length === 0) {
    return <EmptyState icon={<IconBanknote className="h-5 w-5" />} title="No subscriptions yet" description="Every company's subscription — trial, active, or otherwise — appears here as soon as one exists." />;
  }

  const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.subscription.status] = (acc[r.subscription.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3">
        {Object.entries(byStatus).map(([status, count]) => (
          <Badge key={status} tone={STATUS_TONE[status as SubscriptionStatus]}>{count} {status}</Badge>
        ))}
      </div>
      <Table>
        <TableHead>
          <TableRow><TableHeadCell>Companies</TableHeadCell><TableHeadCell>Plan</TableHeadCell><TableHeadCell>Cycle</TableHeadCell><TableHeadCell>Status</TableHeadCell><TableHeadCell>Trial Ends</TableHeadCell><TableHeadCell>Provider</TableHeadCell></TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.subscription.id}>
              <TableCell className="font-medium text-vf-ink">{row.companyNames.join(", ") || "—"}</TableCell>
              <TableCell>{row.planName}</TableCell>
              <TableCell className="capitalize">{row.subscription.billingCycle}</TableCell>
              <TableCell><Badge tone={STATUS_TONE[row.subscription.status]}>{row.subscription.status}</Badge></TableCell>
              <TableCell>{row.subscription.trialEndsAt ? new Date(row.subscription.trialEndsAt).toLocaleDateString() : "—"}</TableCell>
              <TableCell className="capitalize">{row.subscription.provider}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
