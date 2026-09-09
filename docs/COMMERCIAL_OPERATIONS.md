# VYRON FINANCE — Commercial Operations

The Internal Billing Console and the Billing Event Bus. Source: `src/app/platform/billing/page.tsx`, `src/components/platform/billing/`, `src/server/billing-platform/events/`. See `docs/BILLING_ARCHITECTURE.md` for the platform's overall shape.

## Access — `ManageBilling`, platform-scope

The Internal Billing Console is VYRON-staff-only, gated by a new `requirePlatformPermission("ManageBilling")` (`permission-service.ts`) — checks the signed-in user's `company_id is null` role assignment(s) directly via one query (`permission-repository.ts::listPlatformRoleAssignmentsForUser`), rather than looping every company the way Operations Centre's own current access model does (`/platform/operations`, built before this pass — noted here as a real, disclosed improvement, deliberately not retrofitted onto that already-shipped module in this work).

`ManageBilling` (the permission catalog's 136th key — see `docs/PERMISSION_MODEL.md`) is granted to Platform Super Administrator, Platform Administrator (both platform-scope, migration `0050`), and to every company's own Company Owner role (via a standalone `grant_manage_billing_to_company_owner()` RPC, not by editing the large `seed_company_rbac_defaults()` function — the same "don't re-paste a function this codebase has never safely re-pasted before" reasoning migration `0028` already established).

Anyone without the permission sees an honest "Access restricted" message — never a bare 404, never a silent redirect.

## The five tabs — every one backed by real, platform-wide data

| Tab | What it shows | Real data source |
|---|---|---|
| Subscriptions | Every company's subscription, status breakdown, plan, cycle, trial end date, provider | `subscription-repository.ts::listAllSubscriptions()` (RLS platform-scope branch) |
| Payments & Invoices | Every invoice/payment/credit across every billing account | Reuses the Customer Portal's own `BillingInvoicesTab` component verbatim — same real data, no second implementation |
| Webhooks & Provider Health | `billing_provider_connections` status (honestly "Not Connected" pre-Stripe), every `billing_webhook_events` row | `billing-provider-connection-repository.ts`, `webhook-event-repository.ts::listWebhookEvents()` |
| Revenue Intelligence | MRR/ARR/ARPC/Outstanding Revenue/Failed Payments (real) + Trial Conversion/Churn/LTV/Growth (honestly `NotAvailable`) | `commercial-reporting-engine.ts::computeCommercialReportingSnapshot()` — see below |
| Support & Audit | A real add-note form (`POST /api/platform/billing/support-notes`) + the full platform-wide `billing_events` log | `support-note-repository.ts::listAllSupportNotes()`, `billing-event-repository.ts::listAllBillingEvents()` |

**Disclosed gap**: no "Manual Overrides" tab yet — `company_feature_overrides` has real schema and is read correctly by `hasFeature`, but no write UI exists to create one. See `docs/FEATURE_FLAGS.md`.

## Revenue Intelligence — "no fabricated values," enforced structurally

"Display: MRR, ARR, Churn, Expansion Revenue, Downgrades, Trial Conversion, Average Revenue Per Customer, Lifetime Value, Failed Payments, Outstanding Revenue, Subscription Growth. No fabricated values. If insufficient data exists, clearly show 'No production data yet.'"

`computeCommercialReportingSnapshot()` is pure and returns every metric tagged `{ value, quality: "Live" | "NotAvailable", note? }`. The UI component (`ConsoleRevenueTab`) renders purely off that tag — it makes no judgment call of its own about what counts as "enough data," so there is no code path anywhere that can silently substitute a fabricated number.

**Real and computed today** — including a real `0` when that's genuinely the current state, never confused with "no data":
- **MRR** — every `active` (not trial, not cancelled) subscription's price, normalized to a monthly-equivalent across billing cycles (`annual / 12`, `quarterly / 3`), summed.
- **ARR** — `MRR × 12`.
- **Average Revenue Per Customer** — `MRR / active subscription count`.
- **Outstanding Revenue** — sum of `(total - amountPaid)` across every `open` invoice.
- **Failed Payments** — a real count of `payments.status = 'failed'`.
- Active/trial subscription counts.

**Honestly `NotAvailable`, each with a stated reason** — Trial Conversion Rate, Churn Rate, Lifetime Value, Subscription Growth. Each needs period-over-period historical snapshots (e.g. "how many trials ended last month, and how many of those converted") that this platform does not compute yet. Marking these `0%` would have been the exact fabrication the directive explicitly forbade — a real future enhancement, not a silently-skipped requirement. Expansion Revenue and Downgrades (also named in the directive) are not yet separately broken out — folded into this same disclosed gap, since both also need historical period comparison.

## The Billing Event Bus — Required Improvement

"Create one internal Billing Event Bus. Every significant billing action must publish a business event... Never couple modules directly to Billing."

### Two layers

1. **Durable log** — `publishBillingEvent()` (`events/billing-event-bus.ts`) always inserts into `billing_events` (migration `0053`) first, unconditionally. This **is** the Audit Trail consumer: a permanent, queryable record of every billing action, independent of whether any in-process subscriber ever ran.
2. **In-process dispatch** — every registered subscriber is then invoked synchronously, each isolated in its own `try`/`catch` so one subscriber's failure (e.g. the Communication Platform being unavailable) can never roll back the billing action that published the event, or block another subscriber.

Why not a real message queue: this codebase has no message-broker dependency anywhere and no persistent process (Vercel serverless) — a subscriber registry only lives for one function invocation. `billing_events` is designed to be exactly what a genuine future queue (Vercel Queues, or any other) would read from to fan out asynchronously; nothing here is a fabricated decoupling dressed up as a real one.

### The 13-event catalog

`SubscriptionCreated`, `SubscriptionChanged`, `SubscriptionCancelled`, `TrialStarted`, `TrialExpired`, `PaymentReceived`, `PaymentFailed`, `RefundIssued`, `CreditApplied`, `InvoiceGenerated`, `SeatIncreased`, `FeatureEnabled`, `FeatureDisabled` (`BillingEventType`, CHECK-constrained on `billing_events.event_type`).

### The one subscriber file

`events/subscribers.ts` — the ONE place a `BillingEvent` becomes a `createNotification`/`createAlert` call. `billing-platform/engine/` files never call `createNotification`/`createAlert` directly (with one narrow, disclosed exception: the trial-ending-soon *warning* in `lifecycle-sweep-engine.ts`, which stays a direct notification since it's a reminder, not a state transition or one of the 13 named events — matching the boundary this codebase already draws for other one-off notices like `scheduler-service.ts`'s own `AutomationFailure` notification).

`describeBillingEventForNotification(eventType, payload)` (pure, exhaustively unit-tested over all 13 event types) maps an event to a title/message/severity; a second subscriber, `operationsAlertSubscriber`, additionally raises a real Operations Centre alert for every `critical`-severity event, mirroring `scheduler-service.ts`'s own existing "notify + alert together on the severe cases" pattern.

Registered by side effect on import, lazy-loaded exactly once per process via a dynamic `import("./subscribers")` inside `publishBillingEvent()` — this breaks what would otherwise be a circular import (subscribers need `subscribeBillingEvent` from the bus; the bus can't statically import subscribers back), and guarantees subscribers are registered deterministically before the first dispatch, never a race.

### Real emitters today

`transitionSubscription()` (the one function that ever changes `subscriptions.status`) publishes `SubscriptionChanged` for every transition, plus `SubscriptionCancelled` when relevant, once per company the subscription covers. `subscribeCompanyToPlan()` publishes `TrialStarted`. The invite route publishes `SeatIncreased`. `lifecycle-sweep-engine.ts` publishes `TrialExpired`. `cancelSubscription`/`resumeSubscription`/`changeSubscriptionPlan` each publish `SubscriptionCancelled`/`SubscriptionChanged` as appropriate.

`PaymentReceived`/`PaymentFailed`/`RefundIssued`/`CreditApplied`/`InvoiceGenerated`/`FeatureEnabled`/`FeatureDisabled` are defined in the catalog with real subscriber content ready, but have no real caller yet — Sub-Phase 8 (Stripe webhooks) and the still-unbuilt feature-override write path (see `docs/FEATURE_FLAGS.md`) will be their first real emitters, not stubbed ahead of need.
