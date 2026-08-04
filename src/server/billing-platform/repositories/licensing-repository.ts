/**
 * Resolves a company's governing plan for entitlement purposes — the
 * join `company -> subscription_companies -> subscriptions ->
 * subscription_plan_entitlements` that `licensing-engine.ts` needs,
 * kept in one place so no caller re-derives it independently.
 */

import { createClient } from "@/lib/supabase/server";
import { entitlementsFromRows, type SubscriptionPlanEntitlementRow, type SubscriptionRow, type SubscriptionPlanRow } from "../mappers";
import type { Entitlements, PlanKey } from "../types";

/** Returns `null` if the company has no governing subscription at all
 * (shouldn't happen post-trial-creation, but a repository never assumes
 * a row exists — see `evaluateUsageLimit`'s deny-by-default handling of
 * this case in the engine). */
export async function getEntitlementsForCompany(companyId: string): Promise<Entitlements | null> {
  const supabase = await createClient();

  const { data: link, error: linkError } = await supabase
    .from("subscription_companies")
    .select("subscription_id")
    .eq("company_id", companyId)
    .maybeSingle<{ subscription_id: string }>();
  if (linkError) throw linkError;
  if (!link) return null;

  const { data: subscription, error: subError } = await supabase
    .from("subscriptions")
    .select("plan_id")
    .eq("id", link.subscription_id)
    .maybeSingle<Pick<SubscriptionRow, "plan_id">>();
  if (subError) throw subError;
  if (!subscription) return null;

  const { data: plan, error: planError } = await supabase
    .from("subscription_plans")
    .select("plan_key")
    .eq("id", subscription.plan_id)
    .maybeSingle<Pick<SubscriptionPlanRow, "plan_key">>();
  if (planError) throw planError;
  if (!plan) return null;

  const { data: entitlementRows, error: entError } = await supabase
    .from("subscription_plan_entitlements")
    .select("*")
    .eq("plan_id", subscription.plan_id);
  if (entError) throw entError;

  return entitlementsFromRows(plan.plan_key as PlanKey, (entitlementRows ?? []) as SubscriptionPlanEntitlementRow[]);
}
