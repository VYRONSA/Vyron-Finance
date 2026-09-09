/**
 * The Billing Event Bus — Product Review Board Required Improvement:
 * "every significant billing action must publish a business event...
 * The Communication Platform, Notification Centre, Operations Centre,
 * Audit Trail, and future VYRON products must all consume these
 * events. Never couple modules directly to Billing."
 *
 * Two layers, both real:
 * 1. **Durable log** — every `publishBillingEvent()` call inserts into
 *    `billing_events` (migration `0053`) first, unconditionally. This
 *    IS the Audit Trail consumer: a permanent, queryable record of
 *    every billing action, independent of whether any in-process
 *    subscriber ever ran or is even registered yet.
 * 2. **In-process dispatch** — every registered subscriber
 *    (`subscribeBillingEvent`) is then invoked synchronously, each
 *    wrapped in its own try/catch so one subscriber's failure can never
 *    break another's, or the publisher's own calling code — the same
 *    "never let a side-effect break the real operation" discipline
 *    `scheduler-service.ts` already applies to Operations Centre
 *    alerting.
 *
 * Why not a real message queue: this codebase has no persistent
 * process and no message-broker dependency anywhere (confirmed by
 * `package.json`) — a Vercel serverless function's subscriber registry
 * only lives for one invocation, so an in-process bus with a durable
 * log underneath is the honest, real architecture available today, not
 * a fabricated "queue" that doesn't actually decouple anything.
 * `billing_events` itself is what a genuine future queue (Vercel
 * Queues, or any other) would read from to fan out asynchronously —
 * the durable log is designed to be that source of truth already.
 *
 * Why lazy-loaded subscriber registration: subscriber modules
 * (`subscribers.ts`) call `subscribeBillingEvent()` at import time
 * (a side effect), but they also need to import THIS file to get that
 * function — a static top-level import here would be circular. Instead
 * `publishBillingEvent()` dynamically imports `./subscribers` exactly
 * once per process (guarded below), which both breaks the cycle and
 * means publishing an event with zero subscribers registered yet still
 * always finds them, deterministically, before dispatch — never a
 * race with "did the app register its handlers yet."
 */

import * as billingEventRepo from "../repositories/billing-event-repository";
import type { BillingEvent, BillingEventType } from "../types";

export type BillingEventHandler = (event: BillingEvent) => Promise<void> | void;

const subscribers = new Map<BillingEventType | "*", BillingEventHandler[]>();
let subscribersModuleLoaded = false;

export function subscribeBillingEvent(eventType: BillingEventType | "*", handler: BillingEventHandler): void {
  const existing = subscribers.get(eventType) ?? [];
  existing.push(handler);
  subscribers.set(eventType, existing);
}

/** Test-only escape hatch — production code never needs to unregister a
 * subscriber, but a test suite that calls `publishBillingEvent` many
 * times needs to reset between cases. */
export function _resetBillingEventSubscribersForTests(): void {
  subscribers.clear();
  subscribersModuleLoaded = false;
}

export async function publishBillingEvent(companyId: string | null, eventType: BillingEventType, payload: Record<string, unknown>, occurredAtIso: string = new Date().toISOString()): Promise<BillingEvent> {
  if (!subscribersModuleLoaded) {
    await import("./subscribers");
    subscribersModuleLoaded = true;
  }

  const event = await billingEventRepo.insertBillingEvent(companyId, eventType, payload, occurredAtIso);

  const handlers = [...(subscribers.get(eventType) ?? []), ...(subscribers.get("*") ?? [])];
  for (const handler of handlers) {
    try {
      await handler(event);
    } catch {
      // A subscriber's own failure (e.g. Communication Platform being
      // unavailable) must never roll back the billing action that
      // published this event, or block other subscribers from running.
    }
  }

  return event;
}
