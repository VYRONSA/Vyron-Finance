/**
 * Repository for the plan catalog (`subscription_plans`,
 * `subscription_plan_prices`, `subscription_plan_entitlements`,
 * `feature_flags`, `subscription_plan_features` — migration `0045`).
 * Read-only from the client's perspective: the catalog has no
 * insert/update/delete RLS policy (see the migration's own header
 * comment) — catalog writes are a future Internal Console capability,
 * not built in this pass.
 */

import { createClient } from "@/lib/supabase/server";
import {
  subscriptionPlanFromRow, subscriptionPlanPriceFromRow, subscriptionPlanEntitlementFromRow,
  featureFlagFromRow, subscriptionPlanFeatureFromRow,
  type SubscriptionPlanRow, type SubscriptionPlanPriceRow, type SubscriptionPlanEntitlementRow,
  type FeatureFlagRow, type SubscriptionPlanFeatureRow,
} from "../mappers";
import type { SubscriptionPlan, SubscriptionPlanPrice, SubscriptionPlanEntitlement, FeatureFlagDefinition, SubscriptionPlanFeature, PlanKey } from "../types";

export async function listPlans(): Promise<SubscriptionPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("subscription_plans").select("*").eq("is_active", true).order("sort_order");
  if (error) throw error;
  const rows = (data ?? []) as SubscriptionPlanRow[];
  return rows.map(subscriptionPlanFromRow);
}

export async function getPlanByKey(planKey: PlanKey): Promise<SubscriptionPlan | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("subscription_plans").select("*").eq("plan_key", planKey).maybeSingle<SubscriptionPlanRow>();
  if (error) throw error;
  return data ? subscriptionPlanFromRow(data) : null;
}

export async function getPlanById(planId: number): Promise<SubscriptionPlan | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("subscription_plans").select("*").eq("id", planId).maybeSingle<SubscriptionPlanRow>();
  if (error) throw error;
  return data ? subscriptionPlanFromRow(data) : null;
}

export async function listPlanPrices(planId: number): Promise<SubscriptionPlanPrice[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("subscription_plan_prices").select("*").eq("plan_id", planId).eq("is_active", true);
  if (error) throw error;
  const rows = (data ?? []) as SubscriptionPlanPriceRow[];
  return rows.map(subscriptionPlanPriceFromRow);
}

export async function listPlanEntitlements(planId: number): Promise<SubscriptionPlanEntitlement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("subscription_plan_entitlements").select("*").eq("plan_id", planId);
  if (error) throw error;
  const rows = (data ?? []) as SubscriptionPlanEntitlementRow[];
  return rows.map(subscriptionPlanEntitlementFromRow);
}

export async function listFeatureFlags(): Promise<FeatureFlagDefinition[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("feature_flags").select("*");
  if (error) throw error;
  const rows = (data ?? []) as FeatureFlagRow[];
  return rows.map(featureFlagFromRow);
}

export async function listPlanFeatures(planId: number): Promise<SubscriptionPlanFeature[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("subscription_plan_features").select("*").eq("plan_id", planId);
  if (error) throw error;
  const rows = (data ?? []) as SubscriptionPlanFeatureRow[];
  return rows.map(subscriptionPlanFeatureFromRow);
}
