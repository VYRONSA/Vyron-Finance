/**
 * The Licensing Engine — owns Max Users/Companies/Storage/Documents/AI
 * Usage/Automation/API Calls/Integrations and Feature Entitlements.
 * `getEntitlements()`/`checkUsageLimit()` are the two functions every
 * other module calls; nothing outside `billing-platform/` reads
 * `subscription_plan_entitlements`/`usage_period_counters`/an entity's
 * owning table for licensing purposes directly.
 */

import * as licensingRepo from "../repositories/licensing-repository";
import { getUsageSnapshot } from "./usage-metering-engine";
import type { Entitlements, LimitKey, UsageLimitCheck, UsageMetricKey } from "../types";

/** Which real usage source each limit key is checked against.
 * `max_integrations` has none — VYRON COST/CORE `integration_connections`
 * rows exist for every company regardless of plan (an honest "Not
 * Connected" status, not a purchased seat), so there is no real "in use"
 * count to check yet; revisit once a genuine per-integration activation
 * concept exists. */
const LIMIT_KEY_TO_USAGE_METRIC: Partial<Record<LimitKey, UsageMetricKey>> = {
  max_users: "users",
  max_companies: "companies",
  max_storage_mb: "storage_mb",
  max_documents: "documents",
  max_ai_requests_monthly: "ai_requests",
  max_automation_runs_monthly: "automation_runs",
  max_api_calls_monthly: "api_requests",
};

/** Pure — the actual limit-check arithmetic, independently unit-tested.
 * `limitValue === null` is unlimited (a real, deliberate grant); a
 * missing/undefined limit is treated as `0` by the caller (deny by
 * default — see `entitlementsFromRows`), never silently unlimited. */
export function evaluateUsageLimit(limitValue: number | null, currentUsage: number, additionalQuantity: number): UsageLimitCheck {
  if (limitValue === null) return { allowed: true, limit: null, used: currentUsage };
  const projected = currentUsage + additionalQuantity;
  if (projected > limitValue) {
    return { allowed: false, limit: limitValue, used: currentUsage, reason: `This would use ${projected} of your plan's limit of ${limitValue}.` };
  }
  return { allowed: true, limit: limitValue, used: currentUsage };
}

export async function getEntitlements(companyId: string): Promise<Entitlements> {
  const entitlements = await licensingRepo.getEntitlementsForCompany(companyId);
  if (entitlements) return entitlements;
  // No governing subscription at all — deny-by-default, every limit 0,
  // never treated as unlimited.
  const zeroed = Object.fromEntries((["max_users", "max_companies", "max_storage_mb", "max_documents", "max_ai_requests_monthly", "max_automation_runs_monthly", "max_api_calls_monthly", "max_integrations"] as LimitKey[]).map((k) => [k, 0]));
  return { planKey: "free_trial", limits: zeroed as Entitlements["limits"] };
}

/** `additionalQuantity` defaults to 1 (the common "would this one more
 * action push us over?" case — inviting a user, running one automation,
 * making one AI request). Reads current usage through the one Usage
 * Engine (`usage-metering-engine.ts::getUsageSnapshot`) — this file
 * never queries `usage_period_counters`/an entity table itself.
 * `max_integrations` has no metric (see `LIMIT_KEY_TO_USAGE_METRIC`'s
 * own comment) and is evaluated against `0` usage — i.e. `allowed`
 * reflects only whether the plan grants any integrations at all, not a
 * real "how many in use" count yet. */
export async function checkUsageLimit(companyId: string, limitKey: LimitKey, additionalQuantity = 1): Promise<UsageLimitCheck> {
  const entitlements = await getEntitlements(companyId);
  const limitValue = entitlements.limits[limitKey];
  const metricKey = LIMIT_KEY_TO_USAGE_METRIC[limitKey];
  if (!metricKey) return evaluateUsageLimit(limitValue, 0, 0);

  const currentUsage = await getUsageSnapshot(companyId, metricKey);
  return evaluateUsageLimit(limitValue, currentUsage, additionalQuantity);
}
