import type { Metadata } from "next";
import type { ComponentType } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatLongDate } from "@/lib/format";
import {
  IconAlertTriangle,
  IconBank,
  IconBuilding,
  IconClock,
  IconRefresh,
  IconShieldCheck,
  IconSparkles,
  IconTarget,
} from "@/components/ui/icons";
import {
  PIconBuildingColumns,
  PIconChevronRight,
  PIconDatabase,
  PIconDownload,
  PIconInvoice,
  PIconOffice,
  PIconSliders,
  PIconUserPlus,
  PIconUsers,
} from "@/components/ui/precisia-icons";
import { CompanyTable, type CompanyRow } from "@/components/platform/company-table";
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
  title: "Platform Workspace — PRECISIA",
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

const NOTIFICATION_CLASS: Record<"good" | "warn" | "info" | "danger" | "muted", string> = {
  good: "bg-[#25d380]/15 text-[#5ee6a5]",
  warn: "bg-[#f5a524]/15 text-[#f7c16a]",
  info: "bg-[#2f9bff]/15 text-[#8cc8ff]",
  danger: "bg-[#f0474f]/15 text-[#ff9aa0]",
  muted: "bg-white/8 text-[#b4c1d6]",
};

export default async function PlatformOverviewPage() {
  const previewMode = !isSupabaseConfigured();
  const companies = previewMode ? MOCK_COMPANIES_FULL : await listCompaniesForUser(await getCurrentUserId());
  const onboardingCompanies = companies.filter((c) => c.status === "onboarding").length;
  const userEmail = previewMode ? "preview@precisia.app" : await getCurrentUserEmail();

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
  // PRECISIA rebrand — the layout below reproduces the approved
  // "Precisia Platform Workspace" reference (hero banner, Quick Actions,
  // Workspace Health, My Companies), followed by this page's existing
  // sections restyled into the same dark surface language.
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
    { title: "Create Company", description: "Set up a new company or client workspace", icon: PIconOffice, href: "/platform/new-company" },
    {
      title: "Import Opening Balances",
      description: "Bring in a starting trial balance for a company",
      icon: PIconInvoice,
      href: primaryCompany ? `/company/${primaryCompany.id}/opening-balances` : undefined,
    },
    {
      title: "Import Bank Statement",
      description: "Upload a CSV, OFX, QIF or PDF statement",
      icon: PIconDownload,
      href: primaryCompany ? `/company/${primaryCompany.id}/import-centre` : undefined,
    },
    {
      title: "Invite User",
      description: primaryCompany ? `Grant a colleague access to ${primaryCompany.name}.` : "Create a company first, then invite your team.",
      icon: PIconUsers,
      href: primaryCompany ? `/company/${primaryCompany.id}/settings?tab=roles-permissions` : undefined,
    },
    {
      title: "Connect Bank",
      description: "Add and manage the accounts you reconcile against.",
      icon: PIconBuildingColumns,
      href: primaryCompany ? `/company/${primaryCompany.id}/bank-accounts` : undefined,
    },
    {
      title: "View AI Assistant",
      description: "Ask Copilot about any company's numbers.",
      icon: PIconSliders,
      href: primaryCompany ? `/company/${primaryCompany.id}/copilot` : undefined,
    },
  ];

  // "Pending Imports" and "Storage Used" still have no real metric wired
  // up anywhere in the platform — shown honestly as "—" rather than a
  // fabricated number, matching this codebase's own "honesty over
  // fabrication" standard (see ARCHITECTURE.md). "Connected Banks" (Phase
  // 25K) is the real, live count of Active FNB Direct Bank Connectivity
  // accounts computed above. "Active users" is the real seat count.
  const workspaceStatusValue = companies.length === 0 ? "—" : onboardingCompanies > 0 ? String(onboardingCompanies) : String(companies.length);
  const workspaceStatusTitle = companies.length === 0 ? "Getting Started" : onboardingCompanies > 0 ? "Onboarding" : "All Active";
  const HEALTH_METRICS: { label: string; value: string; caption?: string; icon: ComponentType<{ className?: string }>; stacked?: boolean }[] = [
    { label: "Companies", value: String(companies.length), icon: PIconOffice, stacked: true },
    { label: "Active users", value: String(seatsUsed), icon: PIconUsers, stacked: true },
    { label: "Connected Banks", value: String(connectedBankAccountCount), caption: connectedBankAccountCount > 0 ? "Active FNB feeds" : "Last sync: No data", icon: PIconBuildingColumns },
    { label: "Pending imports", value: "—", caption: "Coming soon", icon: PIconDownload },
    { label: "Storage Used", value: "—", caption: "Coming soon", icon: PIconDatabase },
  ];

  // Three of these are genuinely derived from the real counts already on
  // this page (unread notifications, onboarding companies, whether a
  // company exists at all). The fourth is a general platform tip, not a
  // claim about this workspace's actual bank connections.
  const AI_INSIGHTS: { tone: "good" | "warn" | "info"; icon: ComponentType<{ className?: string }>; title: string; description: string }[] = [
    notifications.length === 0
      ? { tone: "good", icon: IconShieldCheck, title: "No financial risks detected", description: "Every company you manage has a clean notification queue right now." }
      : { tone: "warn", icon: IconAlertTriangle, title: `${notifications.length} item${notifications.length === 1 ? "" : "s"} need attention`, description: "Unread notifications are waiting across your companies — see below." },
    companies.length === 0
      ? { tone: "info", icon: IconTarget, title: "Your workspace is ready", description: "Create your first company to start putting PRECISIA to work." }
      : { tone: "good", icon: IconBuilding, title: "Your workspace is active", description: `${companies.length} compan${companies.length === 1 ? "y is" : "ies are"} under management.` },
    onboardingCompanies === 0
      ? { tone: "good", icon: IconClock, title: "No overdue onboarding tasks", description: "Every company you manage has completed its initial setup." }
      : { tone: "warn", icon: IconClock, title: `${onboardingCompanies} compan${onboardingCompanies === 1 ? "y" : "ies"} mid-onboarding`, description: "Finish setup on these companies to unlock full reporting." },
    { tone: "info", icon: IconBank, title: "Bank connections recommended", description: "Companies with connected bank accounts recover their books fastest." },
  ];

  const companyRows: CompanyRow[] = companies.map((company) => ({
    id: company.id,
    name: company.name,
    industry: company.industry || null,
    statusLabel: STATUS_LABEL[company.status],
    statusTone: STATUS_TONE[company.status],
    registrationNumber: company.registrationNumber || null,
    baseCurrencyCode: company.baseCurrencyCode,
  }));

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 font-sans">
      {/* Hero banner */}
      <section className="pc-panel pc-panel-glow relative overflow-hidden rounded-[16px] bg-[#041630]">
        {/* The reference's glowing city/chart photograph is not available
            as a standalone image, so none is shown; only a lighting wash in
            the reference's blues sits behind the copy. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(420px 260px at 66% 30%, rgba(80,160,255,0.28), transparent 70%), radial-gradient(900px 300px at 75% 120%, rgba(22,90,190,0.4), transparent 70%)",
          }}
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-[#031a36] via-[#031a36]/75 to-transparent" />
        <div className="relative flex flex-col gap-6 p-6 lg:flex-row lg:items-start lg:justify-between lg:px-7 lg:py-6">
          <div>
            <p className="flex items-center gap-2.5 text-[0.8rem] font-semibold tracking-[0.12em] text-[#8cc8ff] uppercase">
              <span aria-hidden className="h-4 w-[3px] rounded-full bg-[#2f9bff]" />
              {formattedDate}
            </p>
            <h1 className="pc-heading mt-2.5 text-[1.9rem] leading-tight font-bold text-white sm:text-[2.35rem]">
              {greeting}, <span className="text-[#2f9bff]">{firstName}</span>
            </h1>
            <p className="mt-1.5 text-[1.02rem] text-[#dbe4f1]">Your financial intelligence platform is ready.</p>

            {/* Status chips — all real values already computed above. */}
            <div className="mt-6 flex flex-wrap gap-2.5">
              {[
                { label: "Companies", value: String(companies.length) },
                { label: "Users", value: String(seatsUsed) },
                { label: "Workspace Status", value: workspaceStatusLabel },
                { label: "Subscription", value: planSummaryLabel },
              ].map((chip) => (
                <span key={chip.label} className="flex items-center rounded-full border border-[#3e6fa8]/70 bg-[#041a36]/70 text-[0.8rem]">
                  <span className="px-3.5 py-1.5 text-[#dbe4f1]">{chip.label}</span>
                  <span className="border-l border-[#3e6fa8]/70 px-3.5 py-1.5 font-semibold text-white">{chip.value}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-col items-start gap-6 lg:items-end">
            <div className="flex max-w-full flex-wrap gap-3">
              {/* Finding #134/#135 (RC-6/E13) — the label names the actual
                  target company explicitly. */}
              {primaryCompany ? (
                <Link
                  href={`/company/${primaryCompany.id}/settings?tab=roles-permissions`}
                  title={companies.length > 1 ? `Invites a user to ${primaryCompany.name} — open a specific company's Settings to invite to another` : undefined}
                  className="pc-btn pc-btn-outline h-11 max-w-full px-5 text-[0.8rem]"
                >
                  <PIconUserPlus className="h-5 w-5" />
                  Invite User to {primaryCompany.name}
                </Link>
              ) : (
                <span className="pc-btn pc-btn-outline h-11 px-5 text-[0.8rem] opacity-55" aria-disabled="true" title="Create a company first">
                  <PIconUserPlus className="h-5 w-5" />
                  Invite User
                </span>
              )}
              <Link href="/platform/new-company" className="pc-btn pc-btn-outline h-11 px-5 text-[0.8rem]">
                <PIconOffice className="h-5 w-5" />
                Create Company
              </Link>
            </div>
            <p className="hidden border-l border-[#9fb0c6]/50 pl-5 text-[0.72rem] leading-[2.2] tracking-[0.24em] text-[#c9d4e3] uppercase lg:block">
              Accurate Data.
              <br />
              Clearer Insights.
              <br />
              Stronger Businesses.
            </p>
          </div>
        </div>
      </section>

      {/* Quick Actions */}
      <section>
        <h2 className="pc-heading mb-3 text-[1rem] font-semibold text-white">Quick Actions</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            const body = (
              <div className="pc-panel flex h-full items-center gap-4 px-4 py-3.5 transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-[#3a92ff]/60">
                <span className="pc-icon-tile h-[52px] w-[52px] shrink-0">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9rem] font-semibold text-white">{action.title}</span>
                  <span className="mt-0.5 block text-[0.76rem] leading-snug text-[#c2cedd]">{action.description}</span>
                </span>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/8 text-white">
                  <PIconChevronRight className="h-4.5 w-4.5" />
                </span>
              </div>
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
      </section>

      {/* Workspace Health */}
      <section className="pc-panel pc-panel-glow relative overflow-hidden rounded-[16px] bg-gradient-to-r from-[#062646] via-[#082a4c] to-[#06294d] px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="pc-heading text-[1.05rem] font-semibold text-white">Workspace Health</h2>
            <p className="mt-1 text-[0.84rem] text-[#c2cedd]">A snapshot of your platform, updated live where the data exists today.</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
          {HEALTH_METRICS.map((metric, i) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className={cn("flex flex-col gap-3 px-2 xl:px-6", i > 0 && "xl:border-l xl:border-white/12")}>
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#3a92ff]/50 bg-[#0b3566] text-[#8cc8ff]">
                  <Icon className="h-5 w-5" />
                </span>
                {metric.stacked ? (
                  <div>
                    <p className="font-sans text-[1.85rem] leading-none font-semibold text-[#1cbbf6]">{metric.value}</p>
                    <p className="mt-1.5 text-[0.9rem] text-[#e6ecf5]">{metric.label}</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <p className="font-sans text-[1.85rem] leading-none font-semibold text-[#1cbbf6]">{metric.value}</p>
                    <div>
                      <p className="text-[0.86rem] text-[#e6ecf5]">{metric.label}</p>
                      {metric.caption && <p className="mt-0.5 text-[0.72rem] text-[#9fb0c6]">{metric.caption}</p>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex flex-col gap-3 px-2 xl:border-l xl:border-white/12 xl:px-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#3a92ff]/50 bg-[#0b3566] text-[#8cc8ff]">
              <IconShieldCheck className="h-5 w-5" />
            </span>
            <div className="flex items-center gap-4">
              <p className="font-sans text-[1.85rem] leading-none font-semibold text-[#1cbbf6]">{workspaceStatusValue}</p>
              <div>
                <p className="text-[1.05rem] font-semibold text-[#2f9bff]">{workspaceStatusTitle}</p>
                <p className="text-[0.84rem] text-[#e6ecf5]">Workspace Status</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* My Companies */}
      <section id="companies" className="pc-panel rounded-[16px] px-5 py-4">
        <h2 className="pc-heading text-[1.05rem] font-semibold text-white">My Companies</h2>
        <p className="mt-1 text-[0.84rem] text-[#c2cedd]">Every company and client you have access to.</p>
        <div className="mt-4">
          {companies.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-[#29405c] px-6 py-10 text-center">
              <PIconOffice className="h-6 w-6 text-[#3f9bff]" />
              <p className="font-semibold text-white">No companies yet</p>
              <p className="text-sm text-[#c2cedd]">Create your first company to start recovering and managing its books.</p>
              <Link href="/platform/new-company" className="pc-btn pc-btn-primary mt-2 h-10 px-5">Create Company</Link>
            </div>
          ) : (
            <CompanyTable companies={companyRows} />
          )}
        </div>
      </section>

      {/* Recent Activity + Notifications */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="pc-panel rounded-[16px] p-6">
          <h2 className="pc-heading text-[1.05rem] font-semibold text-white">Recent Activity</h2>
          <p className="mt-1 text-[0.84rem] text-[#c2cedd]">Billing events across every company in your workspace.</p>
          <div className="mt-5">
            {recentActivity.length === 0 ? (
              <div className="flex flex-col items-start gap-2 text-sm text-[#c2cedd]">
                <p className="font-semibold text-white">No activity yet</p>
                <p>Subscription changes, payments, and other billing events will show up here as they happen.</p>
                {primaryCompany && (
                  <Link href={`/company/${primaryCompany.id}/billing`} className="pc-btn pc-btn-outline mt-2 h-9 px-4 text-xs">View Billing</Link>
                )}
              </div>
            ) : (
              <ol className="relative flex flex-col gap-5 border-l border-white/12 pl-5">
                {recentActivity.map((item) => (
                  <li key={item.id} className="relative">
                    <span className="absolute top-1 -left-[1.65rem] h-2.5 w-2.5 rounded-full border-2 border-[#081926] bg-[#2f9bff]" aria-hidden />
                    <p className="text-sm text-[#c2cedd]">
                      <span className="font-medium text-white">{item.actor}</span> {item.action}{" "}
                      <span className="font-medium text-white">{item.target}</span>
                    </p>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-[#9fb0c6]">
                      <IconClock className="h-3 w-3" />
                      {item.timestamp}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <section className="pc-panel rounded-[16px] p-6">
          <h2 className="pc-heading text-[1.05rem] font-semibold text-white">Notifications</h2>
          <p className="mt-1 text-[0.84rem] text-[#c2cedd]">Unread items across every company that may need your attention.</p>
          <div className="mt-5">
            {notifications.length === 0 ? (
              <div className="text-sm text-[#c2cedd]">
                <p className="font-semibold text-white">You&rsquo;re all caught up</p>
                <p className="mt-1">No unread notifications across any company you have access to.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {notifications.map((note) => (
                  <div key={note.id} className="pc-row flex items-start gap-3 p-3 text-sm">
                    <span className={cn("mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", NOTIFICATION_CLASS[NOTIFICATION_TONE[note.tone]])}>
                      {note.tone === "warn" ? "Alert" : note.tone === "good" ? "Update" : "Info"}
                    </span>
                    <div>
                      <p className="text-[#dbe4f1]">{note.message}</p>
                      <span className="text-xs text-[#9fb0c6]">{note.timestamp}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* AI Insights */}
      <section>
        <h2 className="pc-heading mb-4 flex items-center gap-2 text-[1.05rem] font-semibold text-white">
          <IconSparkles className="h-4 w-4 text-[#2f9bff]" />
          AI Insights
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {AI_INSIGHTS.map((insight) => {
            const Icon = insight.icon;
            return (
              <div key={insight.title} className="pc-panel flex flex-col gap-3 p-5">
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full",
                    insight.tone === "good" ? "bg-[#25d380]/14 text-[#25d380]" : insight.tone === "warn" ? "bg-[#f5a524]/14 text-[#f5a524]" : "bg-[#2f9bff]/14 text-[#2f9bff]",
                  )}
                >
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{insight.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[#c2cedd]">{insight.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div id="subscription" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="pc-panel rounded-[16px] p-6">
          <h2 className="pc-heading text-[1.05rem] font-semibold text-white">Subscription &amp; Billing</h2>
          <p className="mt-1 text-[0.84rem] text-[#c2cedd]">{planSummaryLabel}{primaryCompany ? ` · manage under any company's Billing tab` : ""}</p>
          <p className="mt-4 text-sm text-[#dbe4f1]">{seatsUsed} seat{seatsUsed === 1 ? "" : "s"} in use across {companies.length} compan{companies.length === 1 ? "y" : "ies"}.</p>
          {primaryCompany && (
            <Link href={`/company/${primaryCompany.id}/billing`} className="pc-btn pc-btn-outline mt-4 h-10 px-5">
              Manage Billing
            </Link>
          )}
        </section>

        <section className="pc-panel rounded-[16px] p-6">
          <h2 className="pc-heading text-[1.05rem] font-semibold text-white">Licences</h2>
          <p className="mt-1 text-[0.84rem] text-[#c2cedd]">One real subscription lookup per company.</p>
          <div className="mt-4">
            {licences.length === 0 ? (
              <p className="text-sm text-[#c2cedd]">Add a company to see its subscription and licence status here.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {licences.map((licence) => (
                  <div key={licence.id} className="flex items-center justify-between text-sm">
                    <span className="text-white">{licence.company}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[#9fb0c6]">{licence.tier}</span>
                      <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", NOTIFICATION_CLASS[licence.status ? LIFECYCLE_BADGE_TONE[licence.status] : "muted"])}>
                        {licence.status ?? "No subscription"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Profile & Support */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section id="profile" className="pc-panel rounded-[16px] p-6">
          <h2 className="pc-heading text-[1.05rem] font-semibold text-white">Profile &amp; Platform Settings</h2>
          <p className="mt-1 text-[0.84rem] text-[#c2cedd]">Your account, security, and workspace preferences.</p>
          <Link href="/platform/account" className="pc-btn pc-btn-outline mt-4 h-10 px-5">Change Password</Link>
        </section>

        <section id="support" className="pc-panel rounded-[16px] p-6">
          <h2 className="pc-heading text-[1.05rem] font-semibold text-white">Support</h2>
          {/* No direct support channel is configured yet, so no contact
              button is shown — a control that does nothing would mislead. */}
          <p className="mt-1 text-[0.84rem] text-[#c2cedd]">A direct support channel is not configured in this workspace yet.</p>
        </section>
      </div>

      {/* Footer Status */}
      <p className="flex items-center gap-2 border-t border-white/10 pt-4 text-xs text-[#9fb0c6]">
        <IconRefresh className="h-3 w-3" />
        {companies.length} companies · {planSummaryLabel} · {seatsUsed} seat{seatsUsed === 1 ? "" : "s"} in use
      </p>
    </div>
  );
}
