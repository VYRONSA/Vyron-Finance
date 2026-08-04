import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconShieldCheck } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { BillingConsoleTabs } from "@/components/platform/billing/billing-console-tabs";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { requirePlatformPermission } from "@/server/services/permission-service";
import { getCompany } from "@/server/services/company-service";
import { listPlans, listPlanPrices, getPlanById } from "@/server/billing-platform/engine/billing-engine";
import * as subscriptionRepo from "@/server/billing-platform/repositories/subscription-repository";
import * as invoiceRepo from "@/server/billing-platform/repositories/invoice-repository";
import * as paymentRepo from "@/server/billing-platform/repositories/payment-repository";
import * as billingEventRepo from "@/server/billing-platform/repositories/billing-event-repository";
import * as supportNoteRepo from "@/server/billing-platform/repositories/support-note-repository";
import { listWebhookEvents } from "@/server/billing-platform/repositories/webhook-event-repository";
import { getProviderConnection } from "@/server/billing-platform/repositories/billing-provider-connection-repository";
import { computeCommercialReportingSnapshot, type SubscriptionWithPrice } from "@/server/billing-platform/engine/commercial-reporting-engine";
import {
  MOCK_BILLING_EVENTS, MOCK_BILLING_PLANS, MOCK_CREDITS, MOCK_INVOICES, MOCK_PAYMENTS, MOCK_SUBSCRIPTION,
} from "@/lib/mock/billing-data";
import { MOCK_COMPANY } from "@/lib/mock/financial-data";
import type { Subscription } from "@/server/billing-platform/types";

export const metadata: Metadata = {
  title: "Internal Billing Console — VYRON FINANCE",
};

export type ConsoleSubscriptionRow = {
  subscription: Subscription;
  companyNames: string[];
  planName: string;
};

export default async function InternalBillingConsolePage() {
  const previewMode = !isSupabaseConfigured();

  if (previewMode) {
    const rows: ConsoleSubscriptionRow[] = [{ subscription: MOCK_SUBSCRIPTION, companyNames: [MOCK_COMPANY.name], planName: MOCK_BILLING_PLANS[0].name }];
    const withPrices: SubscriptionWithPrice[] = [{ subscription: MOCK_SUBSCRIPTION, unitAmount: 0 }];
    const reporting = computeCommercialReportingSnapshot(withPrices, MOCK_INVOICES, MOCK_PAYMENTS);
    return (
      <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
        <ConsoleHero />
        <Suspense fallback={<ConsoleTabsFallback />}>
          <BillingConsoleTabs
            subscriptionRows={rows}
            invoices={MOCK_INVOICES}
            payments={MOCK_PAYMENTS}
            credits={MOCK_CREDITS}
            webhookEvents={[]}
            providerConnection={null}
            reporting={reporting}
            supportNotes={[]}
            billingEvents={MOCK_BILLING_EVENTS}
            previewMode
          />
        </Suspense>
      </div>
    );
  }

  const access = await requirePlatformPermission("ManageBilling");
  if (!access.ok) {
    return (
      <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
        <ConsoleHero />
        <Card>
          <CardContent className="p-8">
            <EmptyState icon={<IconShieldCheck className="h-5 w-5" />} title="Access restricted" description="The Internal Billing Console requires a platform-scope role with the ManageBilling permission." />
          </CardContent>
        </Card>
      </div>
    );
  }

  const [allSubscriptions, allPlans, providerConnection, webhookEvents, supportNotes, billingEvents] = await Promise.all([
    subscriptionRepo.listAllSubscriptions(),
    listPlans(),
    getProviderConnection("stripe"),
    listWebhookEvents(),
    supportNoteRepo.listAllSupportNotes(),
    billingEventRepo.listAllBillingEvents(),
  ]);

  const allPrices = (await Promise.all(allPlans.map((p) => listPlanPrices(p.id)))).flat();

  const subscriptionRows: ConsoleSubscriptionRow[] = await Promise.all(
    allSubscriptions.map(async (subscription) => {
      const [links, plan] = await Promise.all([subscriptionRepo.listCompaniesForSubscription(subscription.id), getPlanById(subscription.planId)]);
      const companies = await Promise.all(links.map((l) => getCompany(l.companyId)));
      return { subscription, companyNames: companies.filter((c) => c !== null).map((c) => c.name), planName: plan?.name ?? "—" };
    }),
  );

  const subscriptionsWithPrices: SubscriptionWithPrice[] = allSubscriptions.map((subscription) => {
    const price = allPrices.find((p) => p.planId === subscription.planId && p.billingCycle === subscription.billingCycle);
    return { subscription, unitAmount: price?.unitAmount ?? null };
  });

  const billingAccountIds = [...new Set(allSubscriptions.map((s) => s.billingAccountId))];
  const [invoicesByAccount, paymentsByAccount, creditsByAccount] = await Promise.all([
    Promise.all(billingAccountIds.map((id) => invoiceRepo.listInvoicesForBillingAccount(id))),
    Promise.all(billingAccountIds.map((id) => paymentRepo.listPaymentsForBillingAccount(id))),
    Promise.all(billingAccountIds.map((id) => paymentRepo.listCreditsForBillingAccount(id))),
  ]);
  const invoices = invoicesByAccount.flat();
  const payments = paymentsByAccount.flat();
  const credits = creditsByAccount.flat();

  const reporting = computeCommercialReportingSnapshot(subscriptionsWithPrices, invoices, payments);

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
      <ConsoleHero />
      <Suspense fallback={<ConsoleTabsFallback />}>
        <BillingConsoleTabs
          subscriptionRows={subscriptionRows}
          invoices={invoices}
          payments={payments}
          credits={credits}
          webhookEvents={webhookEvents}
          providerConnection={providerConnection}
          reporting={reporting}
          supportNotes={supportNotes}
          billingEvents={billingEvents}
          previewMode={false}
        />
      </Suspense>
    </div>
  );
}

function ConsoleTabsFallback() {
  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-vf-paper-border px-4 pt-3">
        {["Subscriptions", "Payments & Invoices", "Webhooks & Provider Health", "Revenue Intelligence", "Support & Audit"].map((tab) => (
          <span key={tab} className="rounded-t-lg px-3.5 py-2 text-sm font-medium text-vf-ink-faint">
            {tab}
          </span>
        ))}
      </div>
      <CardContent className="flex flex-col gap-3 p-6">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}

function ConsoleHero() {
  return (
    <Card tone="hero" className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
        style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
      />
      <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Internal — VYRON staff only</span>
          <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Billing Operations</h1>
          <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
            Every subscription, payment, and billing event across the platform — one view, no fabricated figures.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
