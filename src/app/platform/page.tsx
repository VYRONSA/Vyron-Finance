import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { MOCK_ACTIVITY, MOCK_NOTIFICATIONS } from "@/lib/mock/platform-data";
import { MOCK_COMPANIES_FULL } from "@/lib/mock/company-management-data";
import { MOCK_SUBSCRIPTION as MOCK_BILLING_SUBSCRIPTION, MOCK_BILLING_PLANS } from "@/lib/mock/billing-data";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCurrentUserId } from "@/server/auth/require-session";
import { listCompaniesForUser } from "@/server/services/company-service";
import { getSubscriptionForCompany, getPlanById, listBillingEvents } from "@/server/billing-platform/engine/billing-engine";
import { getCompanyLifecycleState } from "@/server/billing-platform/engine/company-lifecycle-engine";
import { getFullUsageSnapshot } from "@/server/billing-platform/engine/usage-metering-engine";
import { listNotifications } from "@/server/services/notification-service";
import type { CompanyStatus } from "@/server/company-management/types";
import type { CompanyLifecycleState } from "@/server/billing-platform/types";

const LIFECYCLE_BADGE_TONE: Record<CompanyLifecycleState, "good" | "warn" | "info" | "danger" | "muted"> = {
  Trial: "info", Active: "good", PastDue: "warn", GracePeriod: "warn", Suspended: "danger", Cancelled: "muted", Expired: "muted", Archived: "muted",
};

type CompanyLicence = { id: string; company: string; tier: string; status: CompanyLifecycleState | null };

const BILLING_EVENT_LABELS: Record<string, string> = {
  SubscriptionCreated: "started a new subscription in", SubscriptionChanged: "had a subscription change in", SubscriptionCancelled: "cancelled a subscription in",
  TrialStarted: "started a free trial in", TrialExpired: "had a trial expire in", PaymentReceived: "made a payment in", PaymentFailed: "had a payment fail in",
  RefundIssued: "received a refund in", CreditApplied: "had a credit applied in", InvoiceGenerated: "generated an invoice in", SeatIncreased: "added a user in",
  FeatureEnabled: "had a feature enabled in", FeatureDisabled: "had a feature disabled in",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export const metadata: Metadata = {
  title: "Platform Workspace — VYRON FINANCE",
};

const STATUS_LABEL: Record<CompanyStatus, string> = {
  active: "Active",
  "needs-attention": "Needs Attention",
  onboarding: "Onboarding",
};

const STATUS_TONE: Record<CompanyStatus, "good" | "warn" | "info"> = {
  active: "good",
  "needs-attention": "warn",
  onboarding: "info",
};

const NOTIFICATION_TONE = { good: "good", warn: "warn", info: "info" } as const;

export default async function PlatformOverviewPage() {
  const previewMode = !isSupabaseConfigured();
  const companies = previewMode ? MOCK_COMPANIES_FULL : await listCompaniesForUser(await getCurrentUserId());
  const activeCompanies = companies.filter((c) => c.status === "active").length;
  const onboardingCompanies = companies.filter((c) => c.status === "onboarding").length;

  // Real per-company billing lookups — retired MOCK_SUBSCRIPTION's
  // single fabricated plan/seats figure in favour of each company's own
  // real governing subscription (see billing-platform/). A user's
  // companies can span more than one subscription (different
  // organisations), so "seats used" below is a real sum across all of
  // them, not one shared number.
  // Each per-company lookup below is wrapped defensively: the Billing
  // Platform tables are a separate migration set from the core schema
  // (see docs/LAUNCH_CHECKLIST.md), so one company's billing data being
  // unavailable must never take down the whole Platform Overview for
  // every other company the user can see.
  const licences: CompanyLicence[] = previewMode
    ? MOCK_BILLING_SUBSCRIPTION
      ? [{ id: MOCK_BILLING_SUBSCRIPTION.id, company: MOCK_COMPANIES_FULL[0]?.name ?? "—", tier: MOCK_BILLING_PLANS[0].name, status: "Trial" }]
      : []
    : await Promise.all(
        companies.map(async (company): Promise<CompanyLicence> => {
          try {
            const subscription = await getSubscriptionForCompany(company.id);
            if (!subscription) return { id: company.id, company: company.name, tier: "—", status: null };
            const [plan, lifecycleState] = await Promise.all([getPlanById(subscription.planId), getCompanyLifecycleState(company.id)]);
            return { id: company.id, company: company.name, tier: plan?.name ?? "—", status: lifecycleState };
          } catch {
            return { id: company.id, company: company.name, tier: "—", status: null };
          }
        }),
      );

  const seatsUsed = previewMode
    ? 4
    : (
        await Promise.all(
          companies.map(async (c) => {
            try {
              return await getFullUsageSnapshot(c.id);
            } catch {
              return null;
            }
          }),
        )
      ).reduce((sum, u) => sum + (u?.users ?? 0), 0);
  const distinctPlanNames = new Set(licences.map((l) => l.tier).filter((t) => t !== "—"));
  const planSummaryLabel = distinctPlanNames.size === 0 ? "No plan" : distinctPlanNames.size === 1 ? [...distinctPlanNames][0] : "Multiple plans";

  // Real, cross-company data — retired the unconditionally-fabricated
  // MOCK_ACTIVITY/MOCK_NOTIFICATIONS that used to render even with a
  // real database connected (see docs/DEFECT_REGISTER.md D-030). Scoped
  // honestly: "Recent Activity" surfaces real Billing Event Bus events
  // (the one real cross-company activity source that exists today, not
  // a claim of covering every module) and "Notifications" surfaces real
  // unread Notification Centre entries across every company the user
  // can access.
  const recentActivity = previewMode
    ? MOCK_ACTIVITY
    : (
        await Promise.all(
          companies.map(async (company) => {
            try {
              return (await listBillingEvents(company.id, 5)).map((e) => ({ event: e, companyName: company.name }));
            } catch {
              return [];
            }
          }),
        )
      )
        .flat()
        .sort((a, b) => (a.event.occurredAt < b.event.occurredAt ? 1 : -1))
        .slice(0, 5)
        .map(({ event, companyName }) => ({
          id: `${event.id}`,
          actor: "Billing",
          action: BILLING_EVENT_LABELS[event.eventType] ?? event.eventType,
          target: companyName,
          timestamp: timeAgo(event.occurredAt),
        }));

  const notifications = previewMode
    ? MOCK_NOTIFICATIONS
    : (
        await Promise.all(
          companies.map(async (company) => (await listNotifications(company.id, true, 5)).map((n) => ({ notification: n, companyName: company.name }))),
        )
      )
        .flat()
        .sort((a, b) => (a.notification.createdAt < b.notification.createdAt ? 1 : -1))
        .slice(0, 5)
        .map(({ notification, companyName }) => ({
          id: `${notification.id}`,
          tone: notification.severity === "critical" ? ("warn" as const) : notification.severity === "warning" ? ("warn" as const) : ("info" as const),
          message: `${notification.title} (${companyName})`,
          timestamp: timeAgo(notification.createdAt),
        }));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10">
      {/* Executive Hero */}
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
              Platform Workspace
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Welcome back</h1>
            <p className="mt-1.5 text-sm text-vf-on-dark-soft">
              Here&rsquo;s what&rsquo;s happening across your companies.
            </p>
          </div>
          <div className="flex gap-3">
            {companies[0] ? (
              <Button href={`/company/${companies[0].id}/settings`} variant="ghostDark">Invite User</Button>
            ) : (
              <Button variant="ghostDark" disabled title="Create a company first">Invite User</Button>
            )}
            <Button href="/platform/new-company" variant="ghostDark">Create Company</Button>
          </div>
        </CardContent>
      </Card>

      {/* Statistics — Level 2 dark cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card tone="dark">
          <CardContent className="p-5">
            <StatTile tone="dark" value={String(companies.length)} label="My Companies" />
          </CardContent>
        </Card>
        <Card tone="dark">
          <CardContent className="p-5">
            <StatTile tone="dark" value={String(activeCompanies)} label="Active Clients" />
          </CardContent>
        </Card>
        <Card tone="dark">
          <CardContent className="p-5">
            <StatTile tone="dark" value={String(onboardingCompanies)} label="Onboarding" />
          </CardContent>
        </Card>
        <Card tone="dark">
          <CardContent className="p-5">
            <StatTile tone="dark" value={String(seatsUsed)} label="Seats Used" />
          </CardContent>
        </Card>
      </div>

      {/* Primary Workspace */}
      <Card id="companies">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>My Companies</CardTitle>
            <CardDescription>Every company and client you have access to.</CardDescription>
          </div>
          <Button href="/platform/new-company" variant="outline" size="sm">Create Company</Button>
        </CardHeader>
        <CardContent className="pt-0">
          {companies.length === 0 ? (
            <p className="py-8 text-center text-sm text-vf-ink-faint">
              No companies yet — <Link href="/platform/new-company" className="text-vf-red-600 underline">create your first one</Link>.
            </p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeadCell>Company</TableHeadCell>
                  <TableHeadCell>Industry</TableHeadCell>
                  <TableHeadCell>Status</TableHeadCell>
                  <TableHeadCell>Registration No.</TableHeadCell>
                  <TableHeadCell>Base Currency</TableHeadCell>
                  <TableHeadCell className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHeadCell>
                </tr>
              </TableHead>
              <TableBody>
                {companies.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell className="font-medium text-vf-ink">{company.name}</TableCell>
                    <TableCell>{company.industry || "—"}</TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[company.status]}>{STATUS_LABEL[company.status]}</Badge>
                    </TableCell>
                    <TableCell>{company.registrationNumber || "—"}</TableCell>
                    <TableCell className="font-mono">{company.baseCurrencyCode}</TableCell>
                    <TableCell className="text-right">
                      <Button href={`/company/${company.id}/dashboard`} variant="subtle" size="sm">
                        Open →
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Secondary Workspace */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Billing Activity</CardTitle>
            <CardDescription>Billing events across every company in your workspace.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            {recentActivity.length === 0 ? (
              <p className="py-4 text-center text-sm text-vf-ink-faint">No billing activity yet.</p>
            ) : (
              recentActivity.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-4 text-sm">
                  <p className="text-vf-ink-soft">
                    <span className="font-medium text-vf-ink">{item.actor}</span> {item.action}{" "}
                    <span className="font-medium text-vf-ink">{item.target}</span>
                  </p>
                  <span className="shrink-0 text-xs text-vf-ink-faint">{item.timestamp}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Unread items across every company that may need your attention.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {notifications.length === 0 ? (
              <p className="py-4 text-center text-sm text-vf-ink-faint">No unread notifications.</p>
            ) : (
              notifications.map((note) => (
                <div key={note.id} className="flex items-start gap-3 text-sm">
                  <Badge tone={NOTIFICATION_TONE[note.tone]} className="mt-0.5 shrink-0">
                    {note.tone === "warn" ? "Alert" : note.tone === "good" ? "Update" : "Info"}
                  </Badge>
                  <div>
                    <p className="text-vf-ink-soft">{note.message}</p>
                    <span className="text-xs text-vf-ink-faint">{note.timestamp}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div id="subscription" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Subscription &amp; Billing</CardTitle>
            <CardDescription>{planSummaryLabel}{companies[0] ? ` · manage under any company's Billing tab` : ""}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-vf-ink-soft">{seatsUsed} seat{seatsUsed === 1 ? "" : "s"} in use across {companies.length} company{companies.length === 1 ? "" : "companies"}.</p>
            {companies[0] && (
              <Button href={`/company/${companies[0].id}/billing`} variant="subtle" size="sm" className="mt-4">
                Manage Billing
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Licences</CardTitle>
            <CardDescription>One real subscription lookup per company.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5 pt-0">
            {licences.length === 0 ? (
              <p className="text-sm text-vf-ink-faint">No companies yet.</p>
            ) : (
              licences.map((licence) => (
                <div key={licence.id} className="flex items-center justify-between text-sm">
                  <span className="text-vf-ink">{licence.company}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-vf-ink-faint">{licence.tier}</span>
                    {licence.status ? <Badge tone={LIFECYCLE_BADGE_TONE[licence.status]}>{licence.status}</Badge> : <Badge tone="muted">No subscription</Badge>}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card id="profile">
          <CardHeader>
            <CardTitle>Profile &amp; Platform Settings</CardTitle>
            <CardDescription>Your account, security, and workspace preferences.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button href="/platform/account" variant="subtle" size="sm">Change Password</Button>
          </CardContent>
        </Card>

        <Card id="support">
          <CardHeader>
            <CardTitle>Support</CardTitle>
            <CardDescription>Reach the VYRON FINANCE team directly.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button variant="subtle" size="sm" disabled title="A direct support contact channel is not configured yet — an honest 'not available' rather than a dead button.">
              Contact Support
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Footer Status */}
      <p className="border-t border-vf-dark-border pt-4 text-xs text-vf-on-dark-faint">
        {companies.length} companies · {planSummaryLabel} · {seatsUsed} seat{seatsUsed === 1 ? "" : "s"} in use
      </p>
    </div>
  );
}
