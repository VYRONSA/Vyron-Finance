/**
 * Resolves which features a company's plan grants, plus any per-company
 * override (`company_feature_overrides`, migration `0047`) — the data
 * `feature-flag-engine.ts::hasFeature` needs.
 */

import { createClient } from "@/lib/supabase/server";
import { companyFeatureOverrideFromRow, type CompanyFeatureOverrideRow, type SubscriptionPlanFeatureRow, type FeatureFlagRow, type SubscriptionRow } from "../mappers";
import type { CompanyFeatureOverride, FeatureKey } from "../types";

/** Every feature key this company's plan grants `is_enabled = true`
 * for. Returns an empty set (deny-by-default) if the company has no
 * governing subscription yet. */
export async function listPlanGrantedFeatureKeysForCompany(companyId: string): Promise<Set<FeatureKey>> {
  const supabase = await createClient();

  const { data: link, error: linkError } = await supabase
    .from("subscription_companies")
    .select("subscription_id")
    .eq("company_id", companyId)
    .maybeSingle<{ subscription_id: string }>();
  if (linkError) throw linkError;
  if (!link) return new Set();

  const { data: subscription, error: subError } = await supabase
    .from("subscriptions")
    .select("plan_id")
    .eq("id", link.subscription_id)
    .maybeSingle<Pick<SubscriptionRow, "plan_id">>();
  if (subError) throw subError;
  if (!subscription) return new Set();

  const { data: grants, error: grantsError } = await supabase
    .from("subscription_plan_features")
    .select("feature_id, is_enabled")
    .eq("plan_id", subscription.plan_id)
    .eq("is_enabled", true);
  if (grantsError) throw grantsError;
  const grantRows = (grants ?? []) as Pick<SubscriptionPlanFeatureRow, "feature_id" | "is_enabled">[];
  if (grantRows.length === 0) return new Set();

  const { data: features, error: featuresError } = await supabase
    .from("feature_flags")
    .select("*")
    .in("id", grantRows.map((g) => g.feature_id));
  if (featuresError) throw featuresError;
  const featureRows = (features ?? []) as FeatureFlagRow[];
  return new Set(featureRows.map((f) => f.feature_key as FeatureKey));
}

export async function listFeatureOverridesForCompany(companyId: string): Promise<CompanyFeatureOverride[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("company_feature_overrides").select("*").eq("company_id", companyId);
  if (error) throw error;
  const rows = (data ?? []) as CompanyFeatureOverrideRow[];
  return rows.map(companyFeatureOverrideFromRow);
}

/** Overrides keyed by `FeatureKey` rather than `feature_id` — what
 * `feature-flag-engine.ts::hasFeature` actually consumes (`override ??
 * planDefault` per key), sparing every caller from re-joining
 * `feature_flags` themselves. */
export async function getFeatureOverrideMapForCompany(companyId: string): Promise<Partial<Record<FeatureKey, boolean>>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("company_feature_overrides").select("feature_id, is_enabled").eq("company_id", companyId);
  if (error) throw error;
  const rows = (data ?? []) as Pick<CompanyFeatureOverrideRow, "feature_id" | "is_enabled">[];
  if (rows.length === 0) return {};

  const { data: features, error: featuresError } = await supabase.from("feature_flags").select("*").in("id", rows.map((r) => r.feature_id));
  if (featuresError) throw featuresError;
  const featureRows = (features ?? []) as FeatureFlagRow[];
  const keyById = new Map(featureRows.map((f) => [f.id, f.feature_key as FeatureKey]));

  const result: Partial<Record<FeatureKey, boolean>> = {};
  for (const row of rows) {
    const key = keyById.get(row.feature_id);
    if (key) result[key] = row.is_enabled;
  }
  return result;
}
