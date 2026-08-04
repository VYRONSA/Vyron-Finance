"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { ConsoleSubscriptionsTab } from "./console-subscriptions-tab";
import { ConsolePaymentsTab } from "./console-payments-tab";
import { ConsoleWebhooksTab } from "./console-webhooks-tab";
import { ConsoleRevenueTab } from "./console-revenue-tab";
import { ConsoleSupportAuditTab } from "./console-support-audit-tab";
import type { ConsoleSubscriptionRow } from "@/app/platform/billing/page";
import type { CommercialReportingSnapshot } from "@/server/billing-platform/engine/commercial-reporting-engine";
import type { BillingCredit, BillingEvent, BillingProviderConnection, BillingSupportNote, BillingWebhookEvent, Invoice, Payment } from "@/server/billing-platform/types";

const TABS = ["Subscriptions", "Payments & Invoices", "Webhooks & Provider Health", "Revenue Intelligence", "Support & Audit"] as const;
type Tab = (typeof TABS)[number];

function tabFromSlug(slug: string | null): Tab {
  const found = TABS.find((t) => t.toLowerCase().replace(/[^a-z]+/g, "-") === slug);
  return found ?? "Subscriptions";
}

export function BillingConsoleTabs({
  subscriptionRows,
  invoices,
  payments,
  credits,
  webhookEvents,
  providerConnection,
  reporting,
  supportNotes,
  billingEvents,
  previewMode,
}: {
  subscriptionRows: ConsoleSubscriptionRow[];
  invoices: Invoice[];
  payments: Payment[];
  credits: BillingCredit[];
  webhookEvents: BillingWebhookEvent[];
  providerConnection: BillingProviderConnection | null;
  reporting: CommercialReportingSnapshot;
  supportNotes: BillingSupportNote[];
  billingEvents: BillingEvent[];
  previewMode: boolean;
}) {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => tabFromSlug(searchParams.get("tab")));

  // One real option per billing account (deduped — a subscription can
  // cover several companies sharing one account), labeled by every
  // company name on that account, so staff pick an explicit, real
  // target instead of one silently guessed for them.
  const billingAccountOptions = Array.from(
    new Map(subscriptionRows.map((row) => [row.subscription.billingAccountId, row.companyNames.join(", ") || row.subscription.billingAccountId])),
  ).map(([billingAccountId, label]) => ({ billingAccountId, label }));

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
        {activeTab === "Subscriptions" && <ConsoleSubscriptionsTab rows={subscriptionRows} />}
        {activeTab === "Payments & Invoices" && <ConsolePaymentsTab invoices={invoices} payments={payments} credits={credits} />}
        {activeTab === "Webhooks & Provider Health" && <ConsoleWebhooksTab events={webhookEvents} providerConnection={providerConnection} />}
        {activeTab === "Revenue Intelligence" && <ConsoleRevenueTab reporting={reporting} />}
        {activeTab === "Support & Audit" && <ConsoleSupportAuditTab notes={supportNotes} events={billingEvents} billingAccountOptions={billingAccountOptions} previewMode={previewMode} />}
      </CardContent>
    </Card>
  );
}
