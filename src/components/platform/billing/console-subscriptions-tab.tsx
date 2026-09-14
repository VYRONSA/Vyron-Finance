import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import { IconBanknote } from "@/components/ui/icons";
import { useSearchAndSort, SortableHeadCell } from "@/components/financial/matching/sortable-document-table";
import type { ConsoleSubscriptionRow } from "@/app/platform/billing/page";
import type { SubscriptionStatus } from "@/server/billing-platform/types";
import { formatDate } from "@/lib/format";

const STATUS_TONE: Record<SubscriptionStatus, "good" | "warn" | "info" | "danger" | "muted"> = {
  trial: "info", active: "good", past_due: "warn", grace_period: "warn", suspended: "danger", cancelled: "muted", expired: "muted", archived: "muted",
};

// Finding #182 (RC-16/E13) — flattened once here so the shared
// useSearchAndSort/SortableHeadCell pair (RC-6, #030's own fix) can
// sort directly by field, the same as every other list screen in the
// app; `ConsoleSubscriptionRow`'s own nested subscription/plan shape
// isn't itself sortable-by-key.
type SortableRow = {
  id: string;
  companies: string;
  plan: string;
  cycle: string;
  status: SubscriptionStatus;
  trialEndsAt: string;
  provider: string;
};

export function ConsoleSubscriptionsTab({ rows }: { rows: ConsoleSubscriptionRow[] }) {
  const sortableRows: SortableRow[] = rows.map((row) => ({
    id: row.subscription.id,
    companies: row.companyNames.join(", ") || "—",
    plan: row.planName,
    cycle: row.subscription.billingCycle,
    status: row.subscription.status,
    trialEndsAt: row.subscription.trialEndsAt ?? "",
    provider: row.subscription.provider,
  }));
  const { search, setSearch, sort, toggleSort, result } = useSearchAndSort(
    sortableRows,
    (r) => `${r.companies} ${r.plan} ${r.provider}`,
    "companies",
  );

  if (rows.length === 0) {
    return <EmptyState icon={<IconBanknote className="h-5 w-5" />} title="No subscriptions yet" description="Every company's subscription — trial, active, or otherwise — appears here as soon as one exists." />;
  }

  const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.subscription.status] = (acc[r.subscription.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          {Object.entries(byStatus).map(([status, count]) => (
            <Badge key={status} tone={STATUS_TONE[status as SubscriptionStatus]}>{count} {status}</Badge>
          ))}
        </div>
        <Input className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search companies, plan, provider…" aria-label="Search subscriptions" />
      </div>
      <Table>
        <TableHead>
          <TableRow>
            <SortableHeadCell field="companies" sort={sort} onSort={toggleSort}>Companies</SortableHeadCell>
            <SortableHeadCell field="plan" sort={sort} onSort={toggleSort}>Plan</SortableHeadCell>
            <SortableHeadCell field="cycle" sort={sort} onSort={toggleSort}>Cycle</SortableHeadCell>
            <SortableHeadCell field="status" sort={sort} onSort={toggleSort}>Status</SortableHeadCell>
            <SortableHeadCell field="trialEndsAt" sort={sort} onSort={toggleSort}>Trial Ends</SortableHeadCell>
            <SortableHeadCell field="provider" sort={sort} onSort={toggleSort}>Provider</SortableHeadCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {result.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium text-vf-ink">{row.companies}</TableCell>
              <TableCell>{row.plan}</TableCell>
              <TableCell className="capitalize">{row.cycle}</TableCell>
              <TableCell><Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge></TableCell>
              <TableCell>{row.trialEndsAt ? formatDate(row.trialEndsAt) : "—"}</TableCell>
              <TableCell className="capitalize">{row.provider}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
