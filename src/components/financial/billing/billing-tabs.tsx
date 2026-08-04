"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { IconClock, IconShieldCheck } from "@/components/ui/icons";
import { BillingPlanTab } from "./billing-plan-tab";
import { BillingUsageTab } from "./billing-usage-tab";
import { BillingInvoicesTab } from "./billing-invoices-tab";
import { BillingContactTab } from "./billing-contact-tab";
import { BillingAuditTab } from "./billing-audit-tab";
import type {
  BillingAccount, BillingCredit, BillingEvent, CompanyLifecycleState, Entitlements, Invoice, Payment,
  Subscription, SubscriptionPlan, SubscriptionPlanPrice, SubscriptionStatusHistoryEntry, UsageMetricKey,
} from "@/server/billing-platform/types";

const TABS = ["Overview", "Plan", "Usage", "Invoices & Payments", "Billing Contact", "Audit History"] as const;
type Tab = (typeof TABS)[number];

function tabFromSlug(slug: string | null): Tab {
  const found = TABS.find((t) => t.toLowerCase().replace(/[^a-z]+/g, "-") === slug);
  return found ?? "Overview";
}

const LIFECYCLE_TONE: Record<CompanyLifecycleState, "good" | "warn" | "info" | "danger" | "muted"> = {
  Trial: "info", Active: "good", PastDue: "warn", GracePeriod: "warn", Suspended: "danger", Cancelled: "muted", Expired: "muted", Archived: "muted",
};

function daysUntil(isoDate: string): number {
  return Math.max(0, Math.ceil((Date.parse(isoDate) - Date.now()) / 86_400_000));
}

export function BillingTabs({
  companyId,
  subscription,
  plan,
  allPlans,
  allPrices,
  lifecycleState,
  entitlements,
  usage,
  billingAccount,
  invoices,
  payments,
  credits,
  events,
  statusHistory = [],
  previewMode,
}: {
  companyId: string;
  subscription: Subscription;
  plan: SubscriptionPlan | null;
  allPlans: SubscriptionPlan[];
  allPrices: SubscriptionPlanPrice[];
  lifecycleState: CompanyLifecycleState | null;
  entitlements: Entitlements;
  usage: Record<UsageMetricKey, number>;
  billingAccount: BillingAccount | null;
  invoices: Invoice[];
  payments: Payment[];
  credits: BillingCredit[];
  events: BillingEvent[];
  statusHistory?: SubscriptionStatusHistoryEntry[];
  previewMode: boolean;
}) {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => tabFromSlug(searchParams.get("tab")));

  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-vf-paper-border px-4 pt-3">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            aria-current={activeTab === tab ? "page" : undefined}
            className={cn(
              "rounded-t-lg px-3.5 py-2 text-sm font-medium transition",
              activeTab === tab ? "border-b-2 border-vf-red-600 text-vf-red-600" : "text-vf-ink-faint hover:text-vf-ink-soft",
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      <CardContent className="pt-5">
        {activeTab === "Overview" && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-xl border border-vf-paper-border p-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Status</span>
                  {lifecycleState && <Badge tone={LIFECYCLE_TONE[lifecycleState]}>{lifecycleState}</Badge>}
                </div>
                <div className="mt-2 text-lg font-medium text-vf-ink">{plan?.name ?? "—"}</div>
              </div>
              {subscription.status === "trial" && subscription.trialEndsAt && (
                <div className="rounded-xl border border-vf-paper-border p-4">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">
                    <IconClock className="h-3.5 w-3.5" /> Trial ends in
                  </div>
                  <StatTile value={`${daysUntil(subscription.trialEndsAt)} days`} label={new Date(subscription.trialEndsAt).toLocaleDateString()} className="mt-1" />
                </div>
              )}
              <div className="rounded-xl border border-vf-paper-border p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Companies</div>
                <StatTile value={`${usage.companies ?? 0} / ${entitlements.limits.max_companies ?? "∞"}`} label="on this subscription" className="mt-1" />
              </div>
              <div className="rounded-xl border border-vf-paper-border p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">
                  <IconShieldCheck className="h-3.5 w-3.5" /> Users
                </div>
                <StatTile value={`${usage.users ?? 0} / ${entitlements.limits.max_users ?? "∞"}`} label="active" className="mt-1" />
              </div>
            </div>
            <p className="text-sm text-vf-ink-soft">
              Manage your plan under the <strong>Plan</strong> tab, track limits under <strong>Usage</strong>, and review every invoice and payment
              under <strong>Invoices &amp; Payments</strong>.
            </p>
          </div>
        )}
        {activeTab === "Plan" && (
          <BillingPlanTab companyId={companyId} subscription={subscription} plan={plan} allPlans={allPlans} allPrices={allPrices} previewMode={previewMode} />
        )}
        {activeTab === "Usage" && <BillingUsageTab entitlements={entitlements} usage={usage} />}
        {activeTab === "Invoices & Payments" && <BillingInvoicesTab invoices={invoices} payments={payments} credits={credits} />}
        {activeTab === "Billing Contact" && <BillingContactTab billingAccount={billingAccount} />}
        {activeTab === "Audit History" && <BillingAuditTab events={events} statusHistory={statusHistory} />}
      </CardContent>
    </Card>
  );
}
