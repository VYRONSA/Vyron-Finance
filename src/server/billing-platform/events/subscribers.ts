/**
 * The Billing Event Bus's real subscribers — "The Communication
 * Platform, Notification Centre, Operations Centre, Audit Trail, and
 * future VYRON products must all consume these events. Never couple
 * modules directly to Billing." This file is the ONE place that
 * translates a `BillingEvent` into a Notification Centre entry or an
 * Operations Centre alert; emitting code in `billing-platform/engine/`
 * only ever calls `publishBillingEvent()`, never `createNotification`/
 * `createAlert` directly (the Audit Trail consumer needs no code here
 * at all — every event already lands in `billing_events`, the durable
 * log, before any subscriber runs — see `billing-event-bus.ts`).
 *
 * Registered by side effect on import — `billing-event-bus.ts` dynamic-
 * imports this module exactly once per process before the first
 * dispatch (see that file's own docstring for why).
 */

import { subscribeBillingEvent } from "./billing-event-bus";
import { createNotification } from "@/server/services/notification-service";
import { createAlert } from "@/server/services/operations-service";
import type { BillingEvent, BillingEventType } from "../types";
import type { NotificationSeverity } from "@/server/automation/types";

type NotificationContent = { title: string; message: string; severity: NotificationSeverity };

/** Pure — independently unit-tested. Returns `null` for an event type
 * this subscriber deliberately has nothing to say to the customer about
 * (none today; kept as an explicit possibility rather than assuming
 * every future event type needs a notification). */
export function describeBillingEventForNotification(eventType: BillingEventType, payload: Record<string, unknown>): NotificationContent | null {
  switch (eventType) {
    case "TrialStarted":
      return { title: "Your free trial has started", message: "Welcome to VYRON FINANCE — your free trial is now active.", severity: "info" };
    case "TrialExpired":
      return { title: "Your free trial has ended", message: "Your VYRON FINANCE free trial has expired. Choose a plan to keep using the platform.", severity: "critical" };
    case "SubscriptionCreated":
      return { title: "Your subscription is active", message: "Your VYRON FINANCE subscription has started.", severity: "info" };
    case "SubscriptionChanged": {
      const from = typeof payload.fromStatus === "string" ? payload.fromStatus : "unknown";
      const to = typeof payload.toStatus === "string" ? payload.toStatus : "unknown";
      return { title: "Your subscription status changed", message: `Your subscription moved from "${from}" to "${to}".`, severity: to === "suspended" || to === "past_due" ? "critical" : "info" };
    }
    case "SubscriptionCancelled":
      return { title: "Your subscription has been cancelled", message: "Your VYRON FINANCE subscription has been cancelled.", severity: "warning" };
    case "PaymentReceived":
      return { title: "Payment received", message: "Thank you — your payment was received successfully.", severity: "info" };
    case "PaymentFailed":
      return { title: "Payment failed", message: "We couldn't process your last payment. Please update your payment method.", severity: "critical" };
    case "RefundIssued":
      return { title: "Refund issued", message: "A refund has been issued to your payment method.", severity: "info" };
    case "CreditApplied":
      return { title: "Account credit applied", message: "A credit has been applied to your account.", severity: "info" };
    case "InvoiceGenerated":
      return { title: "New invoice available", message: "A new invoice is available in your Billing Portal.", severity: "info" };
    case "SeatIncreased":
      return { title: "A new user was added", message: "A new user has been invited, using one of your plan's available seats.", severity: "info" };
    case "FeatureEnabled":
      return { title: "A feature was enabled", message: "A feature has been enabled for your company.", severity: "info" };
    case "FeatureDisabled":
      return { title: "A feature was disabled", message: "A feature has been disabled for your company.", severity: "warning" };
  }
}

async function notificationSubscriber(event: BillingEvent): Promise<void> {
  if (!event.companyId) return; // platform-wide events have no single company inbox to notify
  const content = describeBillingEventForNotification(event.eventType, event.payload);
  if (!content) return;
  await createNotification(event.companyId, {
    notificationType: "BillingAlert",
    title: content.title,
    message: content.message,
    severity: content.severity,
    relatedType: "BillingEvent",
    relatedId: event.id,
  });
}

/** Operations Centre only hears about events severe enough to warrant a
 * cross-tenant operational signal — mirrors `scheduler-service.ts`'s own
 * "critical" threshold for raising an alert alongside a notification. */
async function operationsAlertSubscriber(event: BillingEvent): Promise<void> {
  if (!event.companyId) return;
  const content = describeBillingEventForNotification(event.eventType, event.payload);
  if (!content || content.severity !== "critical") return;
  await createAlert({
    companyId: event.companyId,
    sourceEngine: "Billing Platform",
    severity: "critical",
    title: content.title,
    message: content.message,
  });
}

subscribeBillingEvent("*", notificationSubscriber);
subscribeBillingEvent("*", operationsAlertSubscriber);
