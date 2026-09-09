/**
 * Repository for `billing_accounts`/`subscriptions`/
 * `subscription_status_history`/`subscription_companies` (migration
 * `0046`). Plain session-scoped client throughout — these tables carry
 * real RLS write policies (see the migration), so a signed-in,
 * authorized user's own request can write here directly; only the
 * webhook/cron paths (Sub-Phases 4/8) need `createAdminClient()`.
 */

import { createClient } from "@/lib/supabase/server";
import {
  billingAccountFromRow, subscriptionFromRow, subscriptionStatusHistoryFromRow, subscriptionCompanyFromRow,
  type BillingAccountRow, type SubscriptionRow, type SubscriptionStatusHistoryRow, type SubscriptionCompanyRow,
} from "../mappers";
import type { BillingAccount, Subscription, SubscriptionStatusHistoryEntry, SubscriptionCompanyLink, SubscriptionStatus } from "../types";

export async function getBillingAccountByOrganisation(organisationId: string): Promise<BillingAccount | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("billing_accounts").select("*").eq("organisation_id", organisationId).maybeSingle<BillingAccountRow>();
  if (error) throw error;
  return data ? billingAccountFromRow(data) : null;
}

export async function createBillingAccount(input: {
  organisationId: string; billingEmail: string; billingContactName?: string; defaultCurrencyCode: string;
}): Promise<BillingAccount> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("billing_accounts")
    .insert({
      organisation_id: input.organisationId,
      billing_email: input.billingEmail,
      billing_contact_name: input.billingContactName ?? "",
      default_currency_code: input.defaultCurrencyCode,
    })
    .select("*")
    .single<BillingAccountRow>();
  if (error) throw error;
  return billingAccountFromRow(data);
}

export async function getSubscriptionForCompany(companyId: string): Promise<Subscription | null> {
  const supabase = await createClient();
  const { data: link, error: linkError } = await supabase
    .from("subscription_companies")
    .select("subscription_id")
    .eq("company_id", companyId)
    .maybeSingle<{ subscription_id: string }>();
  if (linkError) throw linkError;
  if (!link) return null;

  const { data, error } = await supabase.from("subscriptions").select("*").eq("id", link.subscription_id).maybeSingle<SubscriptionRow>();
  if (error) throw error;
  return data ? subscriptionFromRow(data) : null;
}

/** Platform-wide — every subscription, regardless of company/org.
 * Relies entirely on RLS (the platform-scope branch already present on
 * `subscriptions`'s select policy, migration `0046`) to restrict this
 * to callers who actually hold a platform-scope role; the application
 * layer's own gate is `requirePlatformPermission("ManageBilling")` in
 * the Internal Billing Console's route/page. */
export async function listAllSubscriptions(): Promise<Subscription[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("subscriptions").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as SubscriptionRow[];
  return rows.map(subscriptionFromRow);
}

export async function getSubscription(subscriptionId: string): Promise<Subscription | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("subscriptions").select("*").eq("id", subscriptionId).maybeSingle<SubscriptionRow>();
  if (error) throw error;
  return data ? subscriptionFromRow(data) : null;
}

export async function listCompaniesForSubscription(subscriptionId: string): Promise<SubscriptionCompanyLink[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("subscription_companies").select("*").eq("subscription_id", subscriptionId);
  if (error) throw error;
  const rows = (data ?? []) as SubscriptionCompanyRow[];
  return rows.map(subscriptionCompanyFromRow);
}

export type NewSubscription = {
  billingAccountId: string;
  planId: number;
  billingCycle: Subscription["billingCycle"];
  currencyCode: string;
  status: SubscriptionStatus;
  trialEndsAt?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  provider: Subscription["provider"];
  providerSubscriptionId?: string | null;
};

export async function createSubscription(input: NewSubscription): Promise<Subscription> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .insert({
      billing_account_id: input.billingAccountId,
      plan_id: input.planId,
      billing_cycle: input.billingCycle,
      currency_code: input.currencyCode,
      status: input.status,
      trial_ends_at: input.trialEndsAt ?? null,
      current_period_start: input.currentPeriodStart ?? null,
      current_period_end: input.currentPeriodEnd ?? null,
      provider: input.provider,
      provider_subscription_id: input.providerSubscriptionId ?? null,
    })
    .select("*")
    .single<SubscriptionRow>();
  if (error) throw error;
  return subscriptionFromRow(data);
}

export async function updateSubscriptionStatus(subscriptionId: string, patch: Partial<{
  status: SubscriptionStatus; gracePeriodEndsAt: string | null; cancelAtPeriodEnd: boolean; cancelledAt: string | null;
  currentPeriodStart: string | null; currentPeriodEnd: string | null; planId: number; billingCycle: Subscription["billingCycle"];
}>): Promise<Subscription> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .update({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.gracePeriodEndsAt !== undefined ? { grace_period_ends_at: patch.gracePeriodEndsAt } : {}),
      ...(patch.cancelAtPeriodEnd !== undefined ? { cancel_at_period_end: patch.cancelAtPeriodEnd } : {}),
      ...(patch.cancelledAt !== undefined ? { cancelled_at: patch.cancelledAt } : {}),
      ...(patch.currentPeriodStart !== undefined ? { current_period_start: patch.currentPeriodStart } : {}),
      ...(patch.currentPeriodEnd !== undefined ? { current_period_end: patch.currentPeriodEnd } : {}),
      ...(patch.planId !== undefined ? { plan_id: patch.planId } : {}),
      ...(patch.billingCycle !== undefined ? { billing_cycle: patch.billingCycle } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId)
    .select("*")
    .single<SubscriptionRow>();
  if (error) throw error;
  return subscriptionFromRow(data);
}

export async function markTrialWarningSent(subscriptionId: string, sentAtIso: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("subscriptions").update({ trial_warning_sent_at: sentAtIso }).eq("id", subscriptionId);
  if (error) throw error;
}

export async function recordStatusTransition(input: {
  subscriptionId: string; fromStatus: SubscriptionStatus | null; toStatus: SubscriptionStatus; reason: string; performedBy: string;
}): Promise<SubscriptionStatusHistoryEntry> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscription_status_history")
    .insert({ subscription_id: input.subscriptionId, from_status: input.fromStatus, to_status: input.toStatus, reason: input.reason, performed_by: input.performedBy })
    .select("*")
    .single<SubscriptionStatusHistoryRow>();
  if (error) throw error;
  return subscriptionStatusHistoryFromRow(data);
}

export async function listStatusHistory(subscriptionId: string): Promise<SubscriptionStatusHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("subscription_status_history").select("*").eq("subscription_id", subscriptionId).order("occurred_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as SubscriptionStatusHistoryRow[];
  return rows.map(subscriptionStatusHistoryFromRow);
}

export async function linkCompanyToSubscription(subscriptionId: string, companyId: string): Promise<SubscriptionCompanyLink> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscription_companies")
    .insert({ subscription_id: subscriptionId, company_id: companyId })
    .select("*")
    .single<SubscriptionCompanyRow>();
  if (error) throw error;
  return subscriptionCompanyFromRow(data);
}
