/**
 * Derives a company's billing lifecycle state from its one governing
 * subscription — "no ERP module manages company status itself." There
 * is deliberately no company-side status column for this (see migration
 * `0046`'s `subscription_companies` join) — this function is a read,
 * never a write.
 *
 * `Subscribed` and `Reactivated`, the two directive-named states with
 * no steady-state equivalent (a company doesn't sit in "Subscribed"
 * indefinitely — it's the moment trial converts to paid; "Reactivated"
 * is the moment suspension lifts), are one-time transition EVENTS:
 * logged to `subscription_status_history` by
 * `subscription-lifecycle-engine.ts::transitionSubscription` and
 * surfaced as a `BillingAlert` notification at the same moment, not
 * returned by `getCompanyLifecycleState()`, which only ever reports one
 * of the 8 steady states.
 */

import * as subscriptionRepo from "../repositories/subscription-repository";
import type { CompanyLifecycleState, SubscriptionStatus } from "../types";

const STATUS_TO_LIFECYCLE_STATE: Record<SubscriptionStatus, CompanyLifecycleState> = {
  trial: "Trial",
  active: "Active",
  past_due: "PastDue",
  grace_period: "GracePeriod",
  suspended: "Suspended",
  cancelled: "Cancelled",
  expired: "Expired",
  archived: "Archived",
};

/** Pure. */
export function deriveCompanyLifecycleState(status: SubscriptionStatus): CompanyLifecycleState {
  return STATUS_TO_LIFECYCLE_STATE[status];
}

/** Returns `null` if the company has no governing subscription yet —
 * a real, honest "not yet provisioned" state, not defaulted to Trial. */
export async function getCompanyLifecycleState(companyId: string): Promise<CompanyLifecycleState | null> {
  const subscription = await subscriptionRepo.getSubscriptionForCompany(companyId);
  return subscription ? deriveCompanyLifecycleState(subscription.status) : null;
}
