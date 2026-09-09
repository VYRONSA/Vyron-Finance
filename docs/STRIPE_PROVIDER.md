# VYRON FINANCE — Stripe Provider

Status, as of this writing: **not connected**. `vercel integration add stripe --non-interactive` has been run twice this engagement and both times returned `action_required` — Stripe's Vercel Marketplace terms require the user's own browser-based acceptance at a Vercel-hosted URL, a real legal/contractual action that cannot and will not be performed on the user's behalf via the API shortcut Vercel also offers. Nothing in this document describes code that exists yet; it describes the real, designed extension point everything else in the Billing Platform was deliberately built not to depend on.

## Why the rest of the platform doesn't wait on this

"The Billing Engine must never depend on Stripe" (Product Review Board directive). Concretely: `subscribeCompanyToPlan()` never calls a provider for `free_trial` (a purely local row); `cancelSubscription`/`resumeSubscription` never require one; `changeSubscriptionPlan()` only *requires* one when moving to/from a priced plan, and refuses cleanly (`ProviderRequiredError`, `409`) rather than faking success when one isn't connected. Every other Sub-Phase (0-7: schema, engines, Usage Engine, Scheduler-owned expiry, the Billing Event Bus, the Customer Portal, the Internal Billing Console) is real and independently verified with zero Stripe dependency — see `docs/MIGRATION_ROADMAP.md`.

## The `BillingProvider` interface — the real extension point

```ts
// src/server/billing-platform/providers/billing-provider.ts (not yet created)
export interface BillingProvider {
  readonly providerName: "stripe";
  isConfigured(): boolean;
  createCustomer(input: { billingAccountId: string; email: string; name: string }):
    Promise<{ providerCustomerId: string }>;
  createSubscription(input: { providerCustomerId: string; providerPriceId: string; trialEndsAt: string | null; metadata: Record<string, string> }):
    Promise<{ providerSubscriptionId: string; status: string; currentPeriodStart: string; currentPeriodEnd: string }>;
  updateSubscription(input: { providerSubscriptionId: string; newProviderPriceId?: string; cancelAtPeriodEnd?: boolean; prorationBehavior?: "create_prorations" | "none" }):
    Promise<{ status: string; currentPeriodEnd: string }>;
  cancelSubscription(providerSubscriptionId: string, cancelImmediately: boolean):
    Promise<{ status: string; cancelledAt: string | null }>;
  previewProration(providerSubscriptionId: string, newProviderPriceId: string):
    Promise<{ prorationAmount: number; currency: string }>;
  refundPayment(providerPaymentId: string, amount: number, reason: string):
    Promise<{ providerRefundId: string; status: string }>;
  verifyWebhookSignature(input: { rawBody: string; signatureHeader: string }): NormalizedWebhookEvent; // throws on failure
}
```

`StripeProvider` will implement this with the `stripe` npm package (not yet a dependency — `package.json` has nothing Stripe-related today). Every method opens with an `isConfigured()` guard, reading `process.env.STRIPE_SECRET_KEY` via a new `isStripeConfigured()` in `src/lib/stripe/is-configured.ts` (sibling to the existing `src/lib/supabase/is-configured.ts`/`admin.ts` — same "real if configured, honest Preview Mode otherwise" discipline this codebase already applies to Supabase). `verifyWebhookSignature` uses Stripe's own `constructEvent` — the `billing_webhook_events` table's `unique (provider, provider_event_id)` constraint (migration `0049`, already built) is a second, independent idempotency layer on top, defense in depth.

## Honest connection status, already real today

`billing_provider_connections` (migration `0049`) already exists and is seeded `('stripe', 'Not Connected')` — the Internal Billing Console's "Webhooks & Provider Health" tab already reads and displays this honestly. `getBillingProvider()` (a factory, not yet built) will return a `MockBillingProvider` when Stripe isn't configured, used only by dev/test paths that exercise paid-plan checkout before this Sub-Phase lands — it will never claim a real connection.

## What's still required once terms are accepted

1. `vercel integration add stripe --non-interactive` (retry) to finish provisioning and populate `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`.
2. `src/server/billing-platform/providers/{billing-provider,stripe-provider,mock-provider,index}.ts` — the real implementation.
3. `src/app/api/webhooks/stripe/route.ts` — no session (Stripe calls it directly): reads the raw body, calls `billing-engine.ts::processWebhookEvent` (not yet built — this is its first real caller), always inserts into `billing_webhook_events` first for idempotency, returns success fast per Stripe's own guidance.
4. Populating `subscription_plan_prices.provider_price_id` with real Stripe Price IDs for all 6 plans × applicable cycles (a one-time setup step against the real Stripe account, via dashboard or a setup script).
5. A checkout/card-capture step in the Customer Portal for converting `trial → active` on a priced plan.
6. Live verification: a real test-mode subscription created and a real webhook event observed and processed idempotently end-to-end — the literal "Stripe connected" / "live verification against Stripe succeeds" completion criteria.

No Stripe SDK import may exist anywhere outside `providers/stripe-provider.ts` once built — the same "no billing logic outside `billing-platform/`" boundary this whole platform is built on.
