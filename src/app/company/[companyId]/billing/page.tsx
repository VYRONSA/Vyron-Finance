import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BillingTabs } from "@/components/financial/billing/billing-tabs";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCompany } from "@/server/services/company-service";
import {
  getSubscriptionForCompany, getBillingAccountByOrganisation, getPlanById, listPlans, listPlanPrices,
  listInvoicesForBillingAccount, listPaymentsForBillingAccount, listCreditsForBillingAccount, listBillingEvents, listStatusHistory,
} from "@/server/billing-platform/engine/billing-engine";
import { getEntitlements } from "@/server/billing-platform/engine/licensing-engine";
import { getFullUsageSnapshot } from "@/server/billing-platform/engine/usage-metering-engine";
import { getCompanyLifecycleState } from "@/server/billing-platform/engine/company-lifecycle-engine";
import {
  MOCK_BILLING_ACCOUNT, MOCK_BILLING_EVENTS, MOCK_BILLING_PLANS, MOCK_BILLING_PLAN_PRICES, MOCK_COMPANY_LIFECYCLE_STATE,
  MOCK_CREDITS, MOCK_ENTITLEMENTS, MOCK_INVOICES, MOCK_PAYMENTS, MOCK_SUBSCRIPTION, MOCK_USAGE_SNAPSHOT,
} from "@/lib/mock/billing-data";
import { MOCK_COMPANIES_FULL } from "@/lib/mock/company-management-data";
import type { SubscriptionPlanPrice } from "@/server/billing-platform/types";

export const metadata: Metadata = {
  title: "Billing — VYRON FINANCE",
};

export default async function BillingPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const company = previewMode ? MOCK_COMPANIES_FULL.find((c) => c.id === companyId) : await getCompany(companyId);
  if (!company) notFound();

  if (previewMode) {
    return (
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
        <BillingHero companyName={company.name} />
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-vf-md" />}>
          <BillingTabs
            companyId={companyId}
            subscription={MOCK_SUBSCRIPTION}
            plan={MOCK_BILLING_PLANS[0]}
            allPlans={MOCK_BILLING_PLANS}
            allPrices={MOCK_BILLING_PLAN_PRICES}
            lifecycleState={MOCK_COMPANY_LIFECYCLE_STATE}
            entitlements={MOCK_ENTITLEMENTS}
            usage={MOCK_USAGE_SNAPSHOT}
            billingAccount={MOCK_BILLING_ACCOUNT}
            invoices={MOCK_INVOICES}
            payments={MOCK_PAYMENTS}
            credits={MOCK_CREDITS}
            events={MOCK_BILLING_EVENTS}
            previewMode
          />
        </Suspense>
      </div>
    );
  }

  const subscription = await getSubscriptionForCompany(companyId);
  if (!subscription) {
    return (
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
        <BillingHero companyName={company.name} />
        <Card>
          <CardContent className="p-8 text-sm text-vf-ink-soft">
            This company has no billing subscription yet — that shouldn&apos;t happen for a company created through the normal onboarding flow. Contact support.
          </CardContent>
        </Card>
      </div>
    );
  }

  const [plan, allPlans, lifecycleState, entitlements, usage, billingAccount, statusHistory] = await Promise.all([
    getPlanById(subscription.planId),
    listPlans(),
    getCompanyLifecycleState(companyId),
    getEntitlements(companyId),
    getFullUsageSnapshot(companyId),
    getBillingAccountByOrganisation(company.organisationId),
    listStatusHistory(subscription.id),
  ]);

  const allPrices: SubscriptionPlanPrice[] = (await Promise.all(allPlans.map((p) => listPlanPrices(p.id)))).flat();

  const [invoices, payments, credits, events] = billingAccount
    ? await Promise.all([
        listInvoicesForBillingAccount(billingAccount.id),
        listPaymentsForBillingAccount(billingAccount.id),
        listCreditsForBillingAccount(billingAccount.id),
        listBillingEvents(companyId),
      ])
    : [[], [], [], []];

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <BillingHero companyName={company.name} />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-vf-md" />}>
        <BillingTabs
          companyId={companyId}
          subscription={subscription}
          plan={plan}
          allPlans={allPlans}
          allPrices={allPrices}
          lifecycleState={lifecycleState}
          entitlements={entitlements}
          usage={usage}
          billingAccount={billingAccount}
          invoices={invoices}
          payments={payments}
          credits={credits}
          events={events}
          statusHistory={statusHistory}
          previewMode={false}
        />
      </Suspense>
    </div>
  );
}

function BillingHero({ companyName }: { companyName: string }) {
  return (
    <Card tone="hero" className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
        style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
      />
      <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Commercial Billing Platform</span>
          <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Billing</h1>
          <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
            Your plan, usage, invoices, and payment history for {companyName} — one Billing Engine, no admin intervention needed for self-service changes.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
