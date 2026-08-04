/**
 * The Feature Flag Engine — "every premium capability controlled
 * through one feature system... no page hardcodes 'Enterprise only'."
 * `hasFeature()` is the one function every gated route/page calls; a
 * company's plan grants a default set, a `company_feature_overrides`
 * row (migration `0047`) — set only by a platform-scope operator via
 * the Internal Billing Console — can flip a single feature on or off
 * for that one company without touching its plan.
 */

import * as planRepo from "../repositories/plan-repository";
import * as featureFlagRepo from "../repositories/feature-flag-repository";
import type { FeatureKey } from "../types";

/** Pure — override wins when present, otherwise the plan's own default.
 * Exhaustively unit-tested independently of Supabase. */
export function resolveFeatureFlag(planDefault: boolean, override: boolean | undefined): boolean {
  return override ?? planDefault;
}

export async function hasFeature(companyId: string, featureKey: FeatureKey): Promise<boolean> {
  const [planGranted, overrides] = await Promise.all([
    featureFlagRepo.listPlanGrantedFeatureKeysForCompany(companyId),
    featureFlagRepo.getFeatureOverrideMapForCompany(companyId),
  ]);
  return resolveFeatureFlag(planGranted.has(featureKey), overrides[featureKey]);
}

export async function listEnabledFeatures(companyId: string): Promise<FeatureKey[]> {
  const [planGranted, overrides] = await Promise.all([
    featureFlagRepo.listPlanGrantedFeatureKeysForCompany(companyId),
    featureFlagRepo.getFeatureOverrideMapForCompany(companyId),
  ]);
  const allKeys = (await planRepo.listFeatureFlags()).map((f) => f.featureKey);
  return allKeys.filter((key) => resolveFeatureFlag(planGranted.has(key), overrides[key]));
}
