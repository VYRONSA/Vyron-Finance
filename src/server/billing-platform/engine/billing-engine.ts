/**
 * The Billing Engine — "there must only ever be one Billing Engine. No
 * billing logic may exist inside Customers/Companies/Authentication/
 * Licensing/User Management. Everything consumes the Billing Engine."
 *
 * Built so far (Sub-Phases 3-5, no Stripe dependency): `subscribeCompanyToPlan`
 * for the `free_trial` path only, `cancelSubscription`/`resumeSubscription`
 * (never require a provider — safe to run locally regardless of
 * connection status), `changeSubscriptionPlan` (Upgrade/Downgrade are
 * the same operation; moving to/from any priced plan requires a
 * connected provider — see `ProviderRequiredError`), and
 * `calculateProration` (pure, provider-independent). `recordPaymentFailure`/
 * `processWebhookEvent`/`importSubscription` are NOT built yet — Sub-Phase
 * 8 (provider-backed paths) work, added when their real callers exist
 * rather than stubbed ahead of need.
 *
 * `subscribeCompanyToPlan` deliberately never calls a `BillingProvider`
 * for `free_trial` — a trial subscription is a purely local row
 * (`status='trial'`, `provider='manual'`). This is what makes "a
 * company can enter a trial" buildable and testable with zero Stripe
 * dependency; only a *paid*-plan subscribe/upgrade will ever reach the
 * provider (Sub-Phase 8).
 */

import * as planRepo from "../repositories/plan-repository";
import * as subscriptionRepo from "../repositories/subscription-repository";
import * as invoiceRepo from "../repositories/invoice-repository";
import * as paymentRepo from "../repositories/payment-repository";
import * as billingEventRepo from "../repositories/billing-event-repository";
import { publishBillingEvent } from "../events/billing-event-bus";
import { transitionSubscription } from "./subscription-lifecycle-engine";
import type { BillingCycle, PlanKey, Subscription } from "../types";

// Read-only re-exports — no additional logic beyond the repository call,
// same convention `scheduler-service.ts` already uses for
// `listAutomationTasks`/`getAutomationTask`. Kept here (not scattered
// across page/route code importing repositories directly) so
// `billing-engine.ts` + its sibling engines remain the only public
// surface the rest of the app ever imports from.
export const getSubscriptionForCompany = subscriptionRepo.getSubscriptionForCompany;
export const getBillingAccountByOrganisation = subscriptionRepo.getBillingAccountByOrganisation;
export const listStatusHistory = subscriptionRepo.listStatusHistory;
export const listPlans = planRepo.listPlans;
export const listPlanPrices = planRepo.listPlanPrices;
export const getPlanById = planRepo.getPlanById;
export const listInvoicesForBillingAccount = invoiceRepo.listInvoicesForBillingAccount;
export const listPaymentsForBillingAccount = paymentRepo.listPaymentsForBillingAccount;
export const listCreditsForBillingAccount = paymentRepo.listCreditsForBillingAccount;
export const listBillingEvents = billingEventRepo.listBillingEvents;

/** A real, disclosed business decision made in the absence of a stated
 * directive value — flagged in `BILLING_ARCHITECTURE.md` for
 * confirmation, not silently assumed to be correct forever. */
export const TRIAL_LENGTH_DAYS = 14;

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(dateIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export type SubscribeCompanyToPlanInput = {
  companyId: string;
  organisationId: string;
  planKey: PlanKey;
  billingCycle: BillingCycle;
  billingEmail: string;
  currencyCode: string;
  performedBy: string;
  nowIso: string;
};

export class UnsupportedPlanError extends Error {}
export class PlanNotFoundError extends Error {}

export async function subscribeCompanyToPlan(input: SubscribeCompanyToPlanInput): Promise<Subscription> {
  if (input.planKey !== "free_trial") {
    throw new UnsupportedPlanError(`subscribeCompanyToPlan only supports "free_trial" until a real payment provider is connected (Sub-Phase 8) — got "${input.planKey}".`);
  }

  const plan = await planRepo.getPlanByKey(input.planKey);
  if (!plan) throw new PlanNotFoundError(`No active plan found for key "${input.planKey}".`);

  let billingAccount = await subscriptionRepo.getBillingAccountByOrganisation(input.organisationId);
  if (!billingAccount) {
    billingAccount = await subscriptionRepo.createBillingAccount({
      organisationId: input.organisationId,
      billingEmail: input.billingEmail,
      defaultCurrencyCode: input.currencyCode,
    });
  }

  const trialEndsAt = addDaysIso(input.nowIso, TRIAL_LENGTH_DAYS);
  const subscription = await subscriptionRepo.createSubscription({
    billingAccountId: billingAccount.id,
    planId: plan.id,
    billingCycle: input.billingCycle,
    currencyCode: input.currencyCode,
    status: "trial",
    trialEndsAt,
    currentPeriodStart: input.nowIso,
    currentPeriodEnd: trialEndsAt,
    provider: "manual",
  });

  await subscriptionRepo.linkCompanyToSubscription(subscription.id, input.companyId);
  await subscriptionRepo.recordStatusTransition({
    subscriptionId: subscription.id,
    fromStatus: null,
    toStatus: "trial",
    reason: "New company created — free trial started.",
    performedBy: input.performedBy,
  });
  await publishBillingEvent(input.companyId, "TrialStarted", { subscriptionId: subscription.id, planKey: input.planKey, trialEndsAt }, input.nowIso);

  return subscription;
}

export class SubscriptionNotFoundError extends Error {}
/** Thrown by `changeSubscriptionPlan` when the target plan/cycle is not
 * free — moving to a paid plan without a connected payment provider
 * would mean granting paid-plan entitlements with no payment ever
 * collected, a real business-integrity hole this engine refuses to
 * open rather than silently allow. Honest, not a placeholder: the
 * Customer Portal shows this as a "connect a payment provider" state
 * (Sub-Phase 8), the same discipline `integration-service.ts` already
 * established for "Not Connected" rather than fabricated success. */
export class ProviderRequiredError extends Error {}

async function getSubscriptionOrThrow(subscriptionId: string): Promise<Subscription> {
  const subscription = await subscriptionRepo.getSubscription(subscriptionId);
  if (!subscription) throw new SubscriptionNotFoundError(`No subscription with id ${subscriptionId}.`);
  return subscription;
}

/** Fans a billing event out to every company the subscription actually
 * covers — same reasoning as `transitionSubscription`'s own fan-out. */
async function publishToLinkedCompanies(subscriptionId: string, eventType: Parameters<typeof publishBillingEvent>[1], payload: Record<string, unknown>): Promise<void> {
  const links = await subscriptionRepo.listCompaniesForSubscription(subscriptionId);
  for (const link of links) await publishBillingEvent(link.companyId, eventType, payload);
}

export type CancelSubscriptionInput = { subscriptionId: string; cancelImmediately: boolean; reason: string; performedBy: string };

/** Cancellation never requires a payment provider — safe to allow
 * locally regardless of connection status. `cancelImmediately: false`
 * (the common self-service path) just flags the subscription to lapse
 * at `current_period_end` without an actual status transition yet (the
 * lifecycle sweep or a future renewal-failure path is what eventually
 * moves it to `cancelled`); `true` transitions right away. */
export async function cancelSubscription(input: CancelSubscriptionInput): Promise<Subscription> {
  const subscription = await getSubscriptionOrThrow(input.subscriptionId);

  if (input.cancelImmediately) {
    await transitionSubscription(input.subscriptionId, "cancelled", input.reason, input.performedBy);
  } else {
    await subscriptionRepo.updateSubscriptionStatus(input.subscriptionId, { cancelAtPeriodEnd: true });
    await subscriptionRepo.recordStatusTransition({ subscriptionId: input.subscriptionId, fromStatus: subscription.status, toStatus: subscription.status, reason: `Scheduled to cancel at period end: ${input.reason}`, performedBy: input.performedBy });
    await publishToLinkedCompanies(input.subscriptionId, "SubscriptionCancelled", { subscriptionId: input.subscriptionId, scheduled: true, reason: input.reason });
  }

  return getSubscriptionOrThrow(input.subscriptionId);
}

/** The mirror of `cancelImmediately: false` — clears
 * `cancel_at_period_end` before the period actually ends. A fully
 * `cancelled`/`suspended` subscription is NOT resumable by this
 * function (see `canTransition`'s own table — `cancelled` only ever
 * moves to `archived`; `suspended -> active` is a real transition but
 * requires payment recovery, a Sub-Phase 8/webhook-driven path, not a
 * bare self-service button with no payment method to charge). */
export async function resumeSubscription(subscriptionId: string, performedBy: string): Promise<Subscription> {
  const subscription = await getSubscriptionOrThrow(subscriptionId);

  if (subscription.cancelAtPeriodEnd) {
    await subscriptionRepo.updateSubscriptionStatus(subscriptionId, { cancelAtPeriodEnd: false });
    await subscriptionRepo.recordStatusTransition({ subscriptionId, fromStatus: subscription.status, toStatus: subscription.status, reason: "Cancellation reversed before period end.", performedBy });
    await publishToLinkedCompanies(subscriptionId, "SubscriptionChanged", { subscriptionId, resumed: true });
    return getSubscriptionOrThrow(subscriptionId);
  }

  if (subscription.status === "suspended") {
    throw new ProviderRequiredError("Reactivating a suspended subscription requires resolving payment through a connected provider.");
  }

  throw new Error(`Subscription ${subscriptionId} has nothing to resume (status: "${subscription.status}", not scheduled to cancel).`);
}

export type ChangeSubscriptionPlanInput = { subscriptionId: string; newPlanKey: PlanKey; newBillingCycle: BillingCycle; performedBy: string };

/** One function for both Upgrade and Downgrade — "upgrade" and
 * "downgrade" are the same real operation (change plan/cycle), the
 * direction is just a UI label derived from comparing prices, not a
 * distinct code path. Moving between two free tiers (e.g. between plans
 * with a `0` price) is allowed locally; moving to/from any priced plan
 * requires `subscription.provider === "stripe"` — see
 * `ProviderRequiredError`. */
export async function changeSubscriptionPlan(input: ChangeSubscriptionPlanInput): Promise<Subscription> {
  const subscription = await getSubscriptionOrThrow(input.subscriptionId);
  const newPlan = await planRepo.getPlanByKey(input.newPlanKey);
  if (!newPlan) throw new PlanNotFoundError(`No active plan found for key "${input.newPlanKey}".`);

  const prices = await planRepo.listPlanPrices(newPlan.id);
  const newPrice = prices.find((p) => p.billingCycle === input.newBillingCycle);
  const isFreeChange = (!newPrice || newPrice.unitAmount === 0) && subscription.provider !== "stripe";

  if (!isFreeChange && subscription.provider !== "stripe") {
    throw new ProviderRequiredError("Changing to a paid plan requires a connected payment provider.");
  }

  await subscriptionRepo.updateSubscriptionStatus(input.subscriptionId, { planId: newPlan.id, billingCycle: input.newBillingCycle });
  await subscriptionRepo.recordStatusTransition({
    subscriptionId: input.subscriptionId,
    fromStatus: subscription.status,
    toStatus: subscription.status,
    reason: `Plan changed to "${newPlan.name}" (${input.newBillingCycle}).`,
    performedBy: input.performedBy,
  });
  await publishToLinkedCompanies(input.subscriptionId, "SubscriptionChanged", { subscriptionId: input.subscriptionId, newPlanKey: input.newPlanKey, newBillingCycle: input.newBillingCycle });

  return getSubscriptionOrThrow(input.subscriptionId);
}

export type ProrationInput = {
  currentPeriodStart: string; // ISO date/datetime
  currentPeriodEnd: string;
  oldUnitAmount: number;
  newUnitAmount: number;
  changeDate: string;
};

export type ProrationResult = {
  daysInPeriod: number;
  daysRemaining: number;
  unusedOldAmount: number;
  proratedNewAmount: number;
  netAmount: number; // positive = charge the customer, negative = credit
};

function wholeDaysBetween(fromIso: string, toIso: string): number {
  const MS_PER_DAY = 86_400_000;
  const from = Date.UTC(new Date(fromIso).getUTCFullYear(), new Date(fromIso).getUTCMonth(), new Date(fromIso).getUTCDate());
  const to = Date.UTC(new Date(toIso).getUTCFullYear(), new Date(toIso).getUTCMonth(), new Date(toIso).getUTCDate());
  return Math.round((to - from) / MS_PER_DAY);
}

/** Pure, day-granular proration — `daysRemaining` counts from
 * `changeDate` (inclusive) to `currentPeriodEnd` (exclusive), i.e. how
 * many full days of service the customer has left in the current
 * billing period at the moment of change. Returns a zeroed result
 * (no proration) if `changeDate` is on/after `currentPeriodEnd`. */
export function calculateProration(input: ProrationInput): ProrationResult {
  const daysInPeriod = wholeDaysBetween(input.currentPeriodStart, input.currentPeriodEnd);
  const daysRemaining = Math.max(0, wholeDaysBetween(input.changeDate, input.currentPeriodEnd));

  if (daysInPeriod <= 0 || daysRemaining === 0) {
    return { daysInPeriod, daysRemaining: 0, unusedOldAmount: 0, proratedNewAmount: 0, netAmount: 0 };
  }

  const dailyOldRate = input.oldUnitAmount / daysInPeriod;
  const dailyNewRate = input.newUnitAmount / daysInPeriod;
  const unusedOldAmount = round2(dailyOldRate * daysRemaining);
  const proratedNewAmount = round2(dailyNewRate * daysRemaining);

  return { daysInPeriod, daysRemaining, unusedOldAmount, proratedNewAmount, netAmount: round2(proratedNewAmount - unusedOldAmount) };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
