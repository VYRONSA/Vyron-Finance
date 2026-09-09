/**
 * The Usage Engine — "there must only be one Usage Engine. Every module
 * reports usage through it. Nothing calculates usage independently."
 * `recordUsageEvent()` is the ONE function any module calls to report a
 * metered action happened; `getUsageSnapshot()` is the ONE function any
 * module (or the Customer Portal's Usage tab, or Commercial Reporting)
 * calls to read current usage for a metric, whichever of the two real
 * mechanisms (`MeteredUsageKey`/`LiveCountedUsageKey`) that metric uses.
 * No module outside `billing-platform/` ever touches
 * `usage_period_counters`/`usage_events`, or an entity's owning table
 * for usage-reporting purposes, directly.
 */

import * as usageRepo from "../repositories/usage-repository";
import { LIVE_COUNTED_USAGE_KEYS, METERED_USAGE_KEYS, type LiveCountedUsageKey, type MeteredUsageKey, type UsageMetricKey } from "../types";

export function isMeteredUsageKey(key: UsageMetricKey): key is MeteredUsageKey {
  return (METERED_USAGE_KEYS as readonly string[]).includes(key);
}

export function isLiveCountedUsageKey(key: UsageMetricKey): key is LiveCountedUsageKey {
  return (LIVE_COUNTED_USAGE_KEYS as readonly string[]).includes(key);
}

/** Reports one occurrence of a metered event (an AI request, an
 * automation run, a bank import, ...). A no-op for a live-counted key
 * would be silently misleading (nothing would ever read it back), so
 * this throws rather than accepting one — a caller reporting
 * `"documents"` usage, say, has a real bug: it should be relying on the
 * live document count, not trying to increment it. */
export async function recordUsageEvent(companyId: string, metricKey: MeteredUsageKey, quantity = 1, metadata: Record<string, unknown> = {}, occurredAtIso: string = new Date().toISOString()): Promise<void> {
  if (!isMeteredUsageKey(metricKey)) {
    throw new Error(`"${metricKey}" is a live-counted usage key — it is never recorded, only read via getUsageSnapshot().`);
  }
  await usageRepo.recordUsageEvent(companyId, metricKey, quantity, metadata, occurredAtIso);
}

/** Current usage for any metric — dispatches to a live `count`/`sum`
 * for `LiveCountedUsageKey`s, or the current month's metered counter
 * for `MeteredUsageKey`s. The one function `licensing-engine.ts`'s
 * `checkUsageLimit` and the Customer Portal's Usage tab both call. */
export async function getUsageSnapshot(companyId: string, metricKey: UsageMetricKey, nowIso: string = new Date().toISOString()): Promise<number> {
  if (isLiveCountedUsageKey(metricKey)) return usageRepo.getLiveCount(companyId, metricKey);
  return usageRepo.getUsageCounter(companyId, metricKey, `${nowIso.slice(0, 7)}-01`);
}

/** Every metric's current value at once — what a full "Usage" dashboard
 * page needs, in one call rather than one round trip per metric. */
export async function getFullUsageSnapshot(companyId: string, nowIso: string = new Date().toISOString()): Promise<Record<UsageMetricKey, number>> {
  const liveEntries = await Promise.all(LIVE_COUNTED_USAGE_KEYS.map(async (key) => [key, await usageRepo.getLiveCount(companyId, key)] as const));
  const meteredCounters = await usageRepo.listUsageCountersForCompany(companyId, `${nowIso.slice(0, 7)}-01`);
  const meteredEntries = METERED_USAGE_KEYS.map((key) => [key, meteredCounters[key] ?? 0] as const);
  return Object.fromEntries([...liveEntries, ...meteredEntries]) as Record<UsageMetricKey, number>;
}
