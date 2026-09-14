import type { Metadata } from "next";
import type { ComponentType } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatLongDate } from "@/lib/format";
import {
  IconAlertTriangle,
  IconArchive,
  IconBank,
  IconBarChart,
  IconBell,
  IconBuilding,
  IconCalendar,
  IconClock,
  IconFileText,
  IconImport,
  IconRefresh,
  IconShieldCheck,
  IconSparkles,
  IconTarget,
  IconUsers,
} from "@/components/ui/icons";
import { MOCK_ACTIVITY, MOCK_NOTIFICATIONS } from "@/lib/mock/platform-data";
import { MOCK_COMPANIES_FULL } from "@/lib/mock/company-management-data";
import { MOCK_SUBSCRIPTION as MOCK_BILLING_SUBSCRIPTION, MOCK_BILLING_PLANS } from "@/lib/mock/billing-data";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCurrentUserId, getCurrentUserEmail } from "@/server/auth/require-session";
import { listCompaniesForUser } from "@/server/services/company-service";
import { getSubscriptionForCompany, getPlanById, listBillingEventsForCompanies } from "@/server/billing-platform/engine/billing-engine";
import { getCompanyLifecycleState } from "@/server/billing-platform/engine/company-lifecycle-engine";
import { getFullUsageSnapshot } from "@/server/billing-platform/engine/usage-metering-engine";
import { listNotificationsForCompanies } from "@/server/services/notification-service";
import { listBankConnectionAccounts } from "@/server/bank-connectivity/bank-connectivity-service";
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

// Phase 4 — Executive Command Centre. Pure presentation helpers only —
// no new data source, just friendlier framing of what the page already
// fetches (or, for the greeting, the current server time).
function greetingForHour(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function friendlyFirstName(email: string | null): string {
  if (!email) return "there";
  const local = email.split("@")[0] ?? "";
  const first = local.split(/[._-]/)[0] ?? local;
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "there";
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
  const userEmail = previewMode ? "preview@vyron.finance" : await getCurrentUserEmail();

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

  // Phase 25K — "Connected Banks" used to be a permanent "Coming soon"
  // placeholder claiming no real metric existed; FNB Direct Bank
  // Connectivity (`bank-connectivity/`) is real and live, so this is a
  // genuine stale claim now, not an honest limitation. Same per-company
  // Promise.all + defensive per-company catch already established for
  // `seatsUsed` immediately above — one query per company, never taking
  // down the whole page if one company's bank-connectivity data errors.
  const connectedBankAccountCount = previewMode
    ? 0
    : (
        await Promise.all(
          companies.map(async (c) => {
            try {
              const accounts = await listBankConnectionAccounts(c.id);
              return accounts.filter((a) => a.status === "Active").length;
            } catch {
              return 0;
            }
          }),
        )
      ).reduce((sum, n) => sum + n, 0);

  // Real, cross-company data — retired the unconditionally-fabricated
  // MOCK_ACTIVITY/MOCK_NOTIFICATIONS that used to render even with a
  // real database connected (see docs/DEFECT_REGISTER.md D-030). Scoped
  // honestly: "Recent Activity" surfaces real Billing Event Bus events
  // (the one real cross-company activity source that exists today, not
  // a claim of covering every module) and "Notifications" surfaces real
  // unread Notification Centre entries across every company the user
  // can access.
  //
  // Finding #133/#134/#138 (RC-6) — both panels only ever display the
  // global top 5 most recent items, so a per-company fan-out (N round
  // trips, each over-fetching, then re-sorted/sliced in JS) was pure
  // waste. One `IN (...)` query per panel replaces it. `licences`/
  // `seatsUsed` above stay per-company: each is derived from engine
  // logic (subscription lookup + plan + lifecycle state; a full usage
  // snapshot), not a raw list query, so batching them would mean
  // rewriting those engines' internals rather than the query shape —
  // out of proportion here, and `Promise.all` already runs them
  // concurrently rather than blocking sequentially.
  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
  const companyIds = companies.map((c) => c.id);
  const recentActivity = previewMode
    ? MOCK_ACTIVITY
    : await listBillingEventsForCompanies(companyIds, 5)
        .then((events) =>
          events.map((event) => ({
            id: `${event.id}`,
            actor: "Billing",
            action: BILLING_EVENT_LABELS[event.eventType] ?? event.eventType,
            target: (event.companyId && companyNameById.get(event.companyId)) || "—",
            timestamp: timeAgo(event.occurredAt),
          })),
        )
        .catch(() => []);

  const notifications = previewMode
    ? MOCK_NOTIFICATIONS
    : await listNotificationsForCompanies(companyIds, true, 5)
        .then((items) =>
          items.map((notification) => ({
            id: `${notification.id}`,
            tone: notification.severity === "critical" ? ("warn" as const) : notification.severity === "warning" ? ("warn" as const) : ("info" as const),
            message: `${notification.title} (${companyNameById.get(notification.companyId) ?? "—"})`,
            timestamp: timeAgo(notification.createdAt),
          })),
        )
        .catch(() => []);

  // Phase 4 — everything below this line is presentation only, derived
  // entirely from the real values already computed above. Nothing here
  // adds a query, changes a route, or touches auth/permissions.
  const now = new Date();
  const greeting = greetingForHour(now.getHours());
  const firstName = friendlyFirstName(userEmail);
  const formattedDate = formatLongDate(now);
  const workspaceStatusLabel = companies.length === 0 ? "Getting Started" : onboardingCompanies > 0 ? `${onboardingCompanies} Onboarding` : "All Active";
  const primaryCompany = companies[0];

  const QUICK_ACTIONS: {
    title: string;
    description: string;
    icon: ComponentType<{ className?: string }>;
    href: string | undefined;
  }[] = [
    { title: "Create Company", description: "Set up a new company or client workspace.", icon: IconBuilding, href: "/platform/new-company" },
    {
      title: "Import Opening Balances",
      description: "Bring in a starting trial balance for a company.",
      icon: IconFileText,
      href: primaryCompany ? `/company/${primaryCompany.id}/opening-balances` : undefined,
    },
    {
      title: "Import Bank Statement",
      description: "Upload a CSV, OFX, QIF, or PDF statement.",
      icon: IconImport,
      href: primaryCompany ? `/company/${primaryCompany.id}/import-centre` : undefined,
    },
    {
      title: "Invite User",
      description: primaryCompany ? `Grant a colleague access to ${primaryCompany.name}.` : "Create a company first, then invite your team.",
      icon: IconUsers,
      href: primaryCompany ? `/company/${primaryCompany.id}/settings?tab=roles-permissions` : undefined,
    },
    {
      title: "Connect Bank",
      description: "Add and manage the accounts you reconcile against.",
      icon: IconBank,
      href: primaryCompany ? `/company/${primaryCompany.id}/bank-accounts` : undefined,
    },
    {
      title: "View AI Assistant",
      description: "Ask Copilot about any company's numbers.",
      icon: IconSparkles,
      href: primaryCompany ? `/company/${primaryCompany.id}/copilot` : undefined,
    },
  ];

  // "Pending Imports" and "Storage Used" still have no real metric wired
  // up anywhere in the platform — shown honestly as "Coming soon" rather
  // than a fabricated number, matching this codebase's own "honesty over
  // fabrication" standard (see ARCHITECTURE.md). "Connected Banks" (Phase
  // 25K) is no longer one of these — it's now the real, live count of
  // Active FNB Direct Bank Connectivity accounts computed above.
  // Everything else on this panel is the same real, already-computed
  // data used elsewhere on this page.
  const HEALTH_METRICS: { label: string; value: string; caption?: string; icon: ComponentType<{ className?: string }> }[] = [
    { label: "Companies", value: String(companies.length), icon: IconBuilding },
    { label: "Clients", value: String(activeCompanies), caption: "Active status", icon: IconUsers },
    { label: "Connected Banks", value: String(connectedBankAccountCount), caption: "Active FNB feeds", icon: IconBank },
    { label: "Pending Imports", value: "—", caption: "Coming soon", icon: IconImport },
    { label: "Storage Used", value: "—", caption: "Coming soon", icon: IconArchive },
    { label: "Workspace Status", value: workspaceStatusLabel, icon: IconShieldCheck },
  ];

  // Three of these are genuinely derived from the real counts already on
  // this page (unread notifications, onboarding companies, whether a
  // company exists at all). The fourth is a general platform tip, not a
  // claim about this workspace's actual bank connections — there's no
  // real bank-connection tracking to derive it from yet.
  const AI_INSIGHTS: { tone: "good" | "warn" | "info"; icon: ComponentType<{ className?: string }>; title: string; description: string }[] = [
    notifications.length === 0
      ? { tone: "good", icon: IconShieldCheck, title: "No financial risks detected", description: "Every company you manage has a clean notification queue right now." }
      : { tone: "warn", icon: IconAlertTriangle, title: `${notifications.length} item${notifications.length === 1 ? "" : "s"} need attention`, description: "Unread notifications are waiting across your companies — see below." },
    companies.length === 0
      ? { tone: "info", icon: IconTarget, title: "Your workspace is ready", description: "Create your first company to start putting VYRON FINANCE to work." }
      : { tone: "good", icon: IconBuilding, title: "Your workspace is active", description: `${companies.length} compan${companies.length === 1 ? "y is" : "ies are"} under management.` },
    onboardingCompanies === 0
      ? { tone: "good", icon: IconClock, title: "No overdue onboarding tasks", description: "Every company you manage has completed its initial setup." }
      : { tone: "warn", icon: IconClock, title: `${onboardingCompanies} compan${onboardingCompanies === 1 ? "y" : "ies"} mid-onboarding`, description: "Finish setup on these companies to unlock full reporting." },
    { tone: "info", icon: IconBank, title: "Bank connections recommended", description: "Companies with connected bank accounts recover their books fastest." },
  ];

  return (
    <div className="flex w-full flex-col gap-10">
      {/* Executive Hero */}
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-col gap-8 p-8 lg:p-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
                <IconCalendar className="h-3.5 w-3.5" />
                {formattedDate}
              </span>
              <h1 className="mt-3 text-3xl font-medium text-vf-on-dark sm:text-4xl">
                {greeting}, {firstName}
              </h1>
              <p className="mt-2 max-w-[52ch] text-sm text-vf-on-dark-soft sm:text-base">
                Your financial intelligence platform is ready.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {/* Finding #134/#135 (RC-6/E13) — this used to always link to
                  companies[0]'s Settings with no indication which company
                  that was, ambiguous the moment a user has more than one.
                  The label now names the actual target explicitly. */}
              {primaryCompany ? (
                <Button
                  href={`/company/${primaryCompany.id}/settings?tab=roles-permissions`}
                  variant="ghostDark"
                  title={companies.length > 1 ? `Invites a user to ${primaryCompany.name} — open a specific company's Settings to invite to another` : undefined}
                >
                  Invite User to {primaryCompany.name}
                </Button>
              ) : (
                <Button variant="ghostDark" disabled title="Create a company first">Invite User</Button>
              )}
              <Button href="/platform/new-company" variant="ghostDark">Create Company</Button>
            </div>
          </div>

          {/* Status chips — Companies / Users / Workspace Status /
              Subscription, all real values already computed above.
              "Users" and "Seats" are the same real metric in this
              platform's data model (a seat is a user), so rather than
              show one figure twice under two labels, they're shown once. */}
          <div className="flex flex-wrap gap-2.5">
            {[
              { label: "Companies", value: String(companies.length) },
              { label: "Users", value: String(seatsUsed) },
              { label: "Workspace Status", value: workspaceStatusLabel },
              { label: "Subscription", value: planSummaryLabel },
            ].map((chip) => (
              <span
                key={chip.label}
                className="flex items-center gap-2 rounded-full border border-white/14 bg-white/6 px-3.5 py-1.5 text-xs font-medium text-vf-on-dark"
              >
                <span className="text-vf-on-dark-faint">{chip.label}</span>
                <span className="h-1 w-1 rounded-full bg-white/30" aria-hidden />
                {chip.value}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div>
        <h2 className="mb-4 text-sm font-semibold tracking-[-0.01em] text-vf-on-dark">Quick Actions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            const body = (
              <Card className="h-full">
                <CardContent className="flex h-full flex-col gap-4 p-5">
                  <span className="flex h-11 w-11 items-center justify-center rounded-vf-sm bg-vf-red-500/10 text-vf-red-600">
                    <Icon className="h-5.5 w-5.5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-vf-ink">{action.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-vf-ink-faint">{action.description}</p>
                  </div>
                </CardContent>
              </Card>
            );
            return action.href ? (
              <Link key={action.title} href={action.href} className="block">
                {body}
              </Link>
            ) : (
              <div key={action.title} className="cursor-not-allowed opacity-55" title="Create a company first">
                {body}
              </div>
            );
          })}
        </div>
      </div>

      {/* Workspace Health */}
      <Card tone="dark">
        <CardHeader>
          <CardTitle className="text-vf-on-dark">Workspace Health</CardTitle>
          <CardDescription className="text-vf-on-dark-faint">A snapshot of your platform, updated live where the data exists today.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
            {HEALTH_METRICS.map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.label} className="flex flex-col gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-vf-on-dark">
                    <Icon className="h-4 w-4" />
                  </span>
                  <StatTile tone="dark" value={metric.value} label={metric.label} />
                  {metric.caption && <span className="-mt-2 text-[0.65rem] text-vf-on-dark-faint/70">{metric.caption}</span>}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

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
            <EmptyState
              icon={<IconBuilding className="h-5 w-5" />}
              title="No companies yet"
              description="Create your first company to start recovering and managing its books."
              action={<Button href="/platform/new-company" variant="subtle" size="sm">Create Company</Button>}
            />
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

      {/* Recent Activity + Notifications */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Billing events across every company in your workspace.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {recentActivity.length === 0 ? (
              <EmptyState
                icon={<IconBarChart className="h-5 w-5" />}
                title="No activity yet"
                description="Subscription changes, payments, and other billing events will show up here as they happen."
                action={primaryCompany ? <Button href={`/company/${primaryCompany.id}/billing`} variant="subtle" size="sm">View Billing</Button> : undefined}
              />
            ) : (
              <ol className="relative flex flex-col gap-5 border-l border-vf-paper-border pl-5">
                {recentActivity.map((item) => (
                  <li key={item.id} className="relative">
                    <span className="absolute top-1 -left-[1.65rem] flex h-2.5 w-2.5 items-center justify-center rounded-full border-2 border-vf-paper bg-vf-red-500" aria-hidden />
                    <p className="text-sm text-vf-ink-soft">
                      <span className="font-medium text-vf-ink">{item.actor}</span> {item.action}{" "}
                      <span className="font-medium text-vf-ink">{item.target}</span>
                    </p>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-vf-ink-faint">
                      <IconClock className="h-3 w-3" />
                      {item.timestamp}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Unread items across every company that may need your attention.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {notifications.length === 0 ? (
              <EmptyState
                icon={<IconBell className="h-5 w-5" />}
                title="You're all caught up"
                description="No unread notifications across any company you have access to."
              />
            ) : (
              <div className="flex flex-col gap-3">
                {notifications.map((note) => (
                  <div key={note.id} className="flex items-start gap-3 rounded-vf-sm border border-vf-paper-border p-3 text-sm">
                    <Badge tone={NOTIFICATION_TONE[note.tone]} className="mt-0.5 shrink-0">
                      {note.tone === "warn" ? "Alert" : note.tone === "good" ? "Update" : "Info"}
                    </Badge>
                    <div>
                      <p className="text-vf-ink-soft">{note.message}</p>
                      <span className="text-xs text-vf-ink-faint">{note.timestamp}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Insights */}
      <div>
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-[-0.01em] text-vf-on-dark">
          <IconSparkles className="h-4 w-4 text-vf-red-300" />
          AI Insights
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AI_INSIGHTS.map((insight) => {
            const Icon = insight.icon;
            return (
              <Card key={insight.title}>
                <CardContent className="flex flex-col gap-3 p-5">
                  <span
                    className={
                      insight.tone === "good"
                        ? "flex h-9 w-9 items-center justify-center rounded-full bg-vf-success/12 text-vf-success"
                        : insight.tone === "warn"
                          ? "flex h-9 w-9 items-center justify-center rounded-full bg-vf-warning/14 text-[#93601f]"
                          : "flex h-9 w-9 items-center justify-center rounded-full bg-vf-info/12 text-vf-info"
                    }
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-vf-ink">{insight.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-vf-ink-faint">{insight.description}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div id="subscription" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Subscription &amp; Billing</CardTitle>
            <CardDescription>{planSummaryLabel}{primaryCompany ? ` · manage under any company's Billing tab` : ""}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-vf-ink-soft">{seatsUsed} seat{seatsUsed === 1 ? "" : "s"} in use across {companies.length} company{companies.length === 1 ? "" : "companies"}.</p>
            {primaryCompany && (
              <Button href={`/company/${primaryCompany.id}/billing`} variant="subtle" size="sm" className="mt-4">
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
          <CardContent className="pt-0">
            {licences.length === 0 ? (
              <EmptyState
                icon={<IconBuilding className="h-5 w-5" />}
                title="No companies yet"
                description="Add a company to see its subscription and licence status here."
                action={<Button href="/platform/new-company" variant="subtle" size="sm">Create Company</Button>}
              />
            ) : (
              <div className="flex flex-col gap-2.5">
                {licences.map((licence) => (
                  <div key={licence.id} className="flex items-center justify-between text-sm">
                    <span className="text-vf-ink">{licence.company}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-vf-ink-faint">{licence.tier}</span>
                      {licence.status ? <Badge tone={LIFECYCLE_BADGE_TONE[licence.status]}>{licence.status}</Badge> : <Badge tone="muted">No subscription</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Profile & Support */}
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
      <p className="flex items-center gap-2 border-t border-vf-dark-border pt-4 text-xs text-vf-on-dark-faint">
        <IconRefresh className="h-3 w-3" />
        {companies.length} companies · {planSummaryLabel} · {seatsUsed} seat{seatsUsed === 1 ? "" : "s"} in use
      </p>
    </div>
  );
}
