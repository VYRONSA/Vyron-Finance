/**
 * Repository for usage metering. Two distinct query shapes, matching
 * `LiveCountedUsageKey`/`MeteredUsageKey` (`../types.ts`):
 *
 * - **Metered** keys read/write `usage_period_counters`/`usage_events`
 *   (migration `0047`) — all writes go through `fn_record_usage_event`;
 *   neither table has a direct insert/update RLS policy for the
 *   client.
 * - **Live-counted** keys (`companies`/`users`/`customers`/`suppliers`/
 *   `inventory_items`/`assets`/`documents`/`storage_mb`) run a real
 *   `count(*)`/`sum()` against the entity's own owning table on every
 *   read — never stored, never incremented, so they can never drift.
 *   Aggregate-first by construction (a `count`/`sum`, not a row scan) —
 *   the same discipline this session's Launch Blocker fix already
 *   established for banking automation (migrations `0039`-`0043`).
 */

import { createClient } from "@/lib/supabase/server";
import { usagePeriodCounterFromRow, type UsagePeriodCounterRow } from "../mappers";
import type { LiveCountedUsageKey, UsageMetricKey } from "../types";

export async function getUsageCounter(companyId: string, metricKey: UsageMetricKey, periodStart: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("usage_period_counters")
    .select("counter_value")
    .eq("company_id", companyId)
    .eq("metric_key", metricKey)
    .eq("period_start", periodStart)
    .maybeSingle<Pick<UsagePeriodCounterRow, "counter_value">>();
  if (error) throw error;
  return data ? Number(data.counter_value) : 0;
}

export async function listUsageCountersForCompany(companyId: string, periodStart: string): Promise<Record<UsageMetricKey, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("usage_period_counters").select("*").eq("company_id", companyId).eq("period_start", periodStart);
  if (error) throw error;
  const rows = (data ?? []) as UsagePeriodCounterRow[];
  const result = {} as Record<UsageMetricKey, number>;
  for (const row of rows.map(usagePeriodCounterFromRow)) result[row.metricKey] = row.counterValue;
  return result;
}

export async function recordUsageEvent(companyId: string, metricKey: UsageMetricKey, quantity: number, metadata: Record<string, unknown>, occurredAtIso: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_record_usage_event", {
    p_company_id: companyId, p_metric_key: metricKey, p_quantity: quantity, p_metadata: metadata, p_occurred_at: occurredAtIso,
  });
  if (error) throw error;
}

/** One real `count(*)`/`sum()` per key against its actual owning table
 * — `companies`/`users` need a join through the company's governing
 * subscription (a subscription can cover several companies), the rest
 * are a plain company-scoped count/sum. RLS (`user_can_access_company()`
 * on every table involved) already scopes every one of these correctly
 * for the calling user; no separate access check needed here. */
export async function getLiveCount(companyId: string, key: LiveCountedUsageKey): Promise<number> {
  const supabase = await createClient();

  switch (key) {
    case "companies": {
      const { data: link, error: linkError } = await supabase.from("subscription_companies").select("subscription_id").eq("company_id", companyId).maybeSingle<{ subscription_id: string }>();
      if (linkError) throw linkError;
      if (!link) return 0;
      const { count, error } = await supabase.from("subscription_companies").select("*", { count: "exact", head: true }).eq("subscription_id", link.subscription_id);
      if (error) throw error;
      return count ?? 0;
    }
    case "users": {
      const { data, error } = await supabase.from("user_role_assignments").select("user_id").eq("company_id", companyId);
      if (error) throw error;
      return new Set((data ?? []).map((r: { user_id: string }) => r.user_id)).size;
    }
    case "customers": {
      const { count, error } = await supabase.from("customers").select("*", { count: "exact", head: true }).eq("company_id", companyId);
      if (error) throw error;
      return count ?? 0;
    }
    case "suppliers": {
      const { count, error } = await supabase.from("ae_suppliers").select("*", { count: "exact", head: true }).eq("company_id", companyId);
      if (error) throw error;
      return count ?? 0;
    }
    case "inventory_items": {
      const { count, error } = await supabase.from("stock_items").select("*", { count: "exact", head: true }).eq("company_id", companyId);
      if (error) throw error;
      return count ?? 0;
    }
    case "assets": {
      const { count, error } = await supabase.from("fixed_assets").select("*", { count: "exact", head: true }).eq("company_id", companyId);
      if (error) throw error;
      return count ?? 0;
    }
    case "documents": {
      const { count, error } = await supabase.from("documents").select("*", { count: "exact", head: true }).eq("company_id", companyId).eq("is_current", true);
      if (error) throw error;
      return count ?? 0;
    }
    case "storage_mb": {
      const { data, error } = await supabase.rpc("fn_company_storage_bytes", { p_company_id: companyId });
      if (error) throw error;
      return Math.ceil(Number(data ?? 0) / (1024 * 1024));
    }
  }
}
