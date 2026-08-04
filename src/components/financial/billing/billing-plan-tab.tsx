"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconArrowDown, IconArrowUp, IconRefresh } from "@/components/ui/icons";
import type { PlanKey, Subscription, SubscriptionPlan, SubscriptionPlanPrice } from "@/server/billing-platform/types";

function money(amount: number, currencyCode: string): string {
  const symbol = currencyCode === "ZAR" ? "R" : `${currencyCode} `;
  return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BillingPlanTab({
  companyId,
  subscription,
  plan,
  allPlans,
  allPrices,
  previewMode,
}: {
  companyId: string;
  subscription: Subscription;
  plan: SubscriptionPlan | null;
  allPlans: SubscriptionPlan[];
  allPrices: SubscriptionPlanPrice[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [pendingPlanKey, setPendingPlanKey] = useState<PlanKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const purchasablePlans = allPlans.filter((p) => p.planKey !== "free_trial" && p.planKey !== "partner" && p.planKey !== "internal");
  const currentPrice = allPrices.find((p) => p.planId === plan?.id && p.billingCycle === subscription.billingCycle);

  async function callAction(path: string, body?: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/billing/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const responseBody = await res.json().catch(() => ({}));
        setError(responseBody.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
      setPendingPlanKey(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-vf-paper-border p-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Current plan</div>
          <div className="mt-1 text-lg font-medium text-vf-ink">
            {plan?.name ?? "—"} {currentPrice && <span className="font-normal text-vf-ink-faint">— {money(currentPrice.unitAmount, currentPrice.currencyCode)}/{subscription.billingCycle}</span>}
          </div>
          {subscription.cancelAtPeriodEnd && (
            <Badge tone="warn" className="mt-2">Cancels on {subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : "period end"}</Badge>
          )}
        </div>
        <div className="flex gap-2">
          {subscription.cancelAtPeriodEnd ? (
            <Button variant="subtle" size="sm" onClick={() => callAction("resume")} disabled={loading || previewMode} title={previewMode ? "Available once a production Supabase project is connected" : undefined}>
              <IconRefresh className="h-3.5 w-3.5" /> {loading ? "Resuming…" : "Resume"}
            </Button>
          ) : (
            <Button variant="subtle" size="sm" onClick={() => callAction("cancel", { cancelImmediately: false })} disabled={loading || previewMode || subscription.status === "cancelled"} title={previewMode ? "Available once a production Supabase project is connected" : undefined}>
              {loading ? "Cancelling…" : "Cancel Plan"}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-vf-red-600">{error}</p>}

      <div>
        <h3 className="text-sm font-semibold text-vf-ink">Upgrade or downgrade</h3>
        <p className="mt-1 text-xs text-vf-ink-faint">
          Moving to any priced plan needs a connected payment provider — until then, changes are shown here but blocked with a clear reason rather than silently granted.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {purchasablePlans.map((p) => {
            const price = allPrices.find((pr) => pr.planId === p.id && pr.billingCycle === "monthly") ?? allPrices.find((pr) => pr.planId === p.id);
            const isCurrent = p.id === plan?.id;
            const isUpgrade = price && currentPrice ? price.unitAmount > currentPrice.unitAmount : false;
            return (
              <Card key={p.id} className={isCurrent ? "border-vf-red-500" : undefined}>
                <CardContent className="flex flex-col gap-3 p-4">
                  <div>
                    <div className="text-sm font-medium text-vf-ink">{p.name}</div>
                    {price && <div className="text-xs text-vf-ink-faint">{money(price.unitAmount, price.currencyCode)}/{price.billingCycle}</div>}
                  </div>
                  {isCurrent ? (
                    <Badge tone="info">Current plan</Badge>
                  ) : (
                    <Button
                      variant="subtle"
                      size="sm"
                      disabled={loading || previewMode}
                      title={previewMode ? "Available once a production Supabase project is connected" : "Requires a connected payment provider"}
                      onClick={() => {
                        setPendingPlanKey(p.planKey);
                        callAction("change-plan", { newPlanKey: p.planKey, newBillingCycle: price?.billingCycle ?? "monthly" });
                      }}
                    >
                      {isUpgrade ? <IconArrowUp className="h-3.5 w-3.5" /> : <IconArrowDown className="h-3.5 w-3.5" />}
                      {loading && pendingPlanKey === p.planKey ? "Applying…" : isUpgrade ? "Upgrade" : "Downgrade"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
