/**
 * The Subscription Lifecycle Engine — the 8-state machine (Trial,
 * Active, Past Due, Grace Period, Suspended, Cancelled, Expired,
 * Archived) named by the Product Review Board's directive. Every
 * transition in this codebase's billing platform goes through
 * `transitionSubscription()`, which calls the pure, exhaustively
 * unit-tested `canTransition()` first — never a raw status UPDATE
 * anywhere else in `billing-platform/`.
 *
 * The directive presents the 8 states as one descending chain (Trial ->
 * Active -> Past Due -> Grace Period -> Suspended -> Cancelled ->
 * Expired -> Archived); read literally that would forbid recovery
 * (Past Due -> Active once payment succeeds again), which the
 * directive's own "Payment Failure Handling... Retry... Grace Period"
 * requirements clearly need. This engine treats that list as a
 * severity ordering, not a one-way sequence, and allows the real
 * recovery paths a billing system needs — documented explicitly here,
 * not silently assumed, and again in `BILLING_ARCHITECTURE.md`.
 */

import * as subscriptionRepo from "../repositories/subscription-repository";
import { publishBillingEvent } from "../events/billing-event-bus";
import type { SubscriptionStatus } from "../types";

const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  trial: ["active", "cancelled", "expired"],
  active: ["past_due", "cancelled"],
  past_due: ["active", "grace_period", "cancelled"],
  grace_period: ["active", "suspended", "cancelled"],
  suspended: ["active", "cancelled"],
  cancelled: ["archived"],
  expired: ["active", "archived"],
  archived: [],
};

/** Pure — the one place a transition is judged legal or not. */
export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {}

/** The one function that ever changes `subscriptions.status` — writes
 * the new status and an audit row in the same call, then publishes to
 * the Billing Event Bus (`SubscriptionChanged` always; additionally
 * `SubscriptionCancelled` when `to === "cancelled"`), once per company
 * the subscription actually covers — a Professional/Enterprise
 * subscription can span several companies (`subscription_companies`),
 * each with its own Notification Centre inbox. Throws
 * `IllegalTransitionError` rather than silently no-op'ing or forcing
 * the transition through, matching this codebase's established
 * "reject and report, never fabricate" discipline. */
export async function transitionSubscription(subscriptionId: string, to: SubscriptionStatus, reason: string, performedBy: string): Promise<void> {
  const subscription = await subscriptionRepo.getSubscription(subscriptionId);
  if (!subscription) throw new Error(`Subscription ${subscriptionId} not found.`);

  if (!canTransition(subscription.status, to)) {
    throw new IllegalTransitionError(`Cannot transition subscription ${subscriptionId} from "${subscription.status}" to "${to}".`);
  }

  const fromStatus = subscription.status;
  const nowIso = new Date().toISOString();
  await subscriptionRepo.updateSubscriptionStatus(subscriptionId, {
    status: to,
    cancelledAt: to === "cancelled" ? nowIso : undefined,
  });
  await subscriptionRepo.recordStatusTransition({ subscriptionId, fromStatus, toStatus: to, reason, performedBy });

  const links = await subscriptionRepo.listCompaniesForSubscription(subscriptionId);
  for (const link of links) {
    await publishBillingEvent(link.companyId, "SubscriptionChanged", { subscriptionId, fromStatus, toStatus: to, reason }, nowIso);
    if (to === "cancelled") {
      await publishBillingEvent(link.companyId, "SubscriptionCancelled", { subscriptionId, fromStatus, reason }, nowIso);
    }
  }
}
