/**
 * The Subscription Lifecycle Sweep — "the Scheduler must own expiry.
 * Never rely on login-time checks." Runs once per company per day as
 * a `SubscriptionLifecycleSweep` `automation_tasks` row, processed by
 * the existing Automation Scheduler (`scheduler-service.ts::runTask`) —
 * no separate cron mechanism, matching the exact precedent
 * `CommunicationQueue` already established (migration `0028`).
 *
 * Everything this sweep does was already legal per
 * `subscription-lifecycle-engine.ts`'s own transition table before this
 * file existed (`trial -> expired`, `grace_period -> suspended`) — this
 * is purely the "who calls `transitionSubscription` when nobody is
 * looking" piece, not new state-machine logic.
 *
 * Publishes to the Billing Event Bus instead of calling
 * `createNotification` directly — `transitionSubscription` itself
 * already publishes a generic `SubscriptionChanged` for every
 * transition (see that file); this sweep additionally publishes the
 * more specific `TrialExpired` when that's the real reason, so a
 * subscriber can react to "a trial expired" without having to parse a
 * generic payload. The one exception: the trial-ending-soon WARNING is
 * not one of the Billing Event Bus's 13 named event types (it's a
 * reminder, not a state transition or a significant billing action), so
 * it stays a direct `createNotification` call — same boundary this
 * codebase already draws for other one-off notices (e.g.
 * `scheduler-service.ts`'s `AutomationFailure` notification).
 */

import * as subscriptionRepo from "../repositories/subscription-repository";
import { transitionSubscription } from "./subscription-lifecycle-engine";
import { publishBillingEvent } from "../events/billing-event-bus";
import { createNotification } from "@/server/services/notification-service";
import type { Subscription } from "../types";

/** A real, disclosed business decision (like `TRIAL_LENGTH_DAYS`) —
 * flagged for confirmation in `BILLING_ARCHITECTURE.md`, not silently
 * assumed. */
export const TRIAL_WARNING_DAYS_BEFORE_EXPIRY = 3;

export type LifecycleSweepOutcome =
  | { status: "NoSubscription" }
  | { status: "NoActionNeeded"; state: Subscription["status"] }
  | { status: "TrialWarningIssued" }
  | { status: "Transitioned"; from: Subscription["status"]; to: Subscription["status"] };

/** Pure — is `nowIso` within the warning window before `trialEndsAt`,
 * and has a warning not already been sent for this trial. Independently
 * unit-tested since it's the one piece of real decision logic in an
 * otherwise I/O-heavy sweep. */
export function shouldIssueTrialWarning(trialEndsAt: string, nowIso: string, trialWarningSentAt: string | null): boolean {
  if (trialWarningSentAt) return false;
  const msRemaining = Date.parse(trialEndsAt) - Date.parse(nowIso);
  if (msRemaining <= 0) return false; // already expired — the expiry branch handles this, not a warning
  return msRemaining <= TRIAL_WARNING_DAYS_BEFORE_EXPIRY * 86_400_000;
}

async function processCompanySubscription(companyId: string, subscription: Subscription, nowIso: string, performedBy: string): Promise<LifecycleSweepOutcome> {
  if (subscription.status === "trial" && subscription.trialEndsAt) {
    if (subscription.trialEndsAt <= nowIso) {
      await transitionSubscription(subscription.id, "expired", "Trial period ended without conversion to a paid plan.", performedBy);
      await publishBillingEvent(companyId, "TrialExpired", { subscriptionId: subscription.id }, nowIso);
      return { status: "Transitioned", from: "trial", to: "expired" };
    }
    if (shouldIssueTrialWarning(subscription.trialEndsAt, nowIso, subscription.trialWarningSentAt)) {
      await subscriptionRepo.markTrialWarningSent(subscription.id, nowIso);
      await createNotification(companyId, {
        notificationType: "BillingAlert",
        title: "Your free trial is ending soon",
        message: `Your VYRON FINANCE free trial ends on ${subscription.trialEndsAt.slice(0, 10)}. Choose a plan to avoid any interruption.`,
        severity: "warning",
        relatedType: "Subscription",
      });
      return { status: "TrialWarningIssued" };
    }
  }

  if (subscription.status === "grace_period" && subscription.gracePeriodEndsAt && subscription.gracePeriodEndsAt <= nowIso) {
    await transitionSubscription(subscription.id, "suspended", "Grace period ended without payment recovery.", performedBy);
    return { status: "Transitioned", from: "grace_period", to: "suspended" };
  }

  return { status: "NoActionNeeded", state: subscription.status };
}

/** The one entry point `scheduler-service.ts`'s `SubscriptionLifecycleSweep`
 * task branch calls. Never throws over "nothing to do" — a company with
 * no subscription yet (shouldn't happen post-`subscribeCompanyToPlan`,
 * but never assumed) is reported, not treated as an error. */
export async function runSubscriptionLifecycleSweep(companyId: string, nowIso: string, performedBy: string): Promise<LifecycleSweepOutcome> {
  const subscription = await subscriptionRepo.getSubscriptionForCompany(companyId);
  if (!subscription) return { status: "NoSubscription" };
  return processCompanySubscription(companyId, subscription, nowIso, performedBy);
}
