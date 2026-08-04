# VYRON FINANCE — Billing Architecture

Commercial Billing, Licensing & Subscription Platform (Phase 1 of the Product Review Board's commercial-launch directive). Source of truth: `src/server/billing-platform/` and `supabase/migrations/0045`-`0053`. Full build history, evidence, and disclosed gaps are in `docs/MIGRATION_ROADMAP.md`'s "Commercial Billing, Licensing & Subscription Platform" section — this document is the architectural reference, that one is the changelog.

## One Billing Engine — what that means structurally

"There must only ever be one Billing Engine. No billing logic may exist inside Customers/Companies/Authentication/Licensing/User Management." Concretely: `src/server/billing-platform/` is a standalone directory, sibling to `src/server/permissions/` (not inside `src/server/services/`) — the same precedent a cross-cutting engine already established in this codebase. Every module outside `billing-platform/` may only call its named engine functions (`hasFeature`, `checkUsageLimit`, `getCompanyLifecycleState`, `subscribeCompanyToPlan`, `cancelSubscription`, `resumeSubscription`, `changeSubscriptionPlan`, `recordUsageEvent`, `getUsageSnapshot`, `publishBillingEvent`) — nothing outside `billing-platform/repositories/` ever queries `subscriptions`/`invoices`/`usage_period_counters`/etc. directly. This is checkable the same way `posting-engine-service.ts`'s "no other module writes to `gl_transactions` directly" invariant is checkable: grep for the table name outside `billing-platform/`.

The five engines, each a separate file under `src/server/billing-platform/engine/`, each independently importable (a caller pulls in only what it needs — `feature-flag-engine.ts` doesn't need to import `billing-engine.ts`):

| Engine | File | Owns |
|---|---|---|
| Billing Engine | `billing-engine.ts` | Subscribe (trial), Cancel, Resume, Change Plan, proration math |
| Subscription Lifecycle Engine | `subscription-lifecycle-engine.ts` | The 8-state machine, the one function that ever writes `subscriptions.status` |
| Company Lifecycle Engine | `company-lifecycle-engine.ts` | Deriving a company's billing state (read-only) |
| Licensing Engine | `licensing-engine.ts` | Entitlements, usage-limit checks |
| Feature Flag Engine | `feature-flag-engine.ts` | Plan-default + per-company feature overrides |
| Usage Engine | `usage-metering-engine.ts` | The one place any module reports or reads usage |

Plus `lifecycle-sweep-engine.ts` (Scheduler-driven expiry) and `commercial-reporting-engine.ts` (pure revenue calculations), and `events/billing-event-bus.ts` + `events/subscribers.ts` (the Billing Event Bus).

## Schema shape

`billing_accounts` (one per `organisation_id`) → `subscriptions` (the lifecycle target) → `subscription_companies` (join table). This join is deliberate: it's what makes "Max Companies" a real relationship and makes a company's billing lifecycle state a **derived read**, never a stored/duplicated column — `companies.status` (migration `0006`, the pre-existing onboarding-progress enum) is completely untouched. A subscription can cover more than one company (a Professional/Enterprise plan); every engine function that needs to notify or publish an event fans out to every linked company via `subscription-repository.ts::listCompaniesForSubscription`.

The plan catalog (`subscription_plans`/`subscription_plan_prices`/`subscription_plan_entitlements`/`subscription_plan_features`, migration `0045`) is platform-wide, not tenant data — read-open to any authenticated user, write-closed to the client (the same shape as the pre-existing `currencies` table). **Every price and limit is a seeded row, never a TypeScript constant** — this is the literal mechanism behind "never hardcode prices."

Six plan tiers exactly as named by the directive: Free Trial, Starter, Professional, Enterprise, Partner, Internal. **Known, disclosed gap**: the pre-existing marketing pricing page (`src/app/(marketing)/pricing/page.tsx`) has a 4-tier ladder (Starter/Professional/Business/Enterprise) with no "Business" equivalent in this catalog — left untouched since Marketing Website (Phase 8) is out of scope for this work.

## The subscription lifecycle — 8 states, and one interpretation flagged for confirmation

`Trial`, `Active`, `Past Due`, `Grace Period`, `Suspended`, `Cancelled`, `Expired`, `Archived` (`SubscriptionStatus`, `types.ts`). The directive's own wording presents these as one descending chain; read literally that forbids recovery (`Past Due` → `Active` once payment succeeds), which directly contradicts the same directive's own "Payment Failure Handling... Retry... Grace Period" requirements. `subscription-lifecycle-engine.ts` treats the list as a **severity ordering, not a one-way sequence** — the real allowed-transitions table:

```
trial        -> active, cancelled, expired
active       -> past_due, cancelled
past_due     -> active, grace_period, cancelled
grace_period -> active, suspended, cancelled
suspended    -> active, cancelled
cancelled    -> archived
expired      -> active, archived
archived     -> (terminal)
```

`canTransition(from, to)` is the one pure function this table lives in — exhaustively unit-tested (`subscription-lifecycle-engine.test.ts`), including a full sweep confirming every status has a defined (possibly empty) transition list. `transitionSubscription()` is the **one** function that ever writes `subscriptions.status` — it writes the row, an audit entry to `subscription_status_history`, and publishes to the Billing Event Bus, all three in the same call, so nothing that changes a subscription's status can forget to do any of them.

### Company Lifecycle — the directive's `Subscribed`/`Reactivated`, as events not states

The directive's Company Lifecycle names `Trial → Subscribed → Active → Past Due → Suspended → Reactivated → Cancelled`. `Subscribed` and `Reactivated` have no steady-state equivalent — a company doesn't sit in "Subscribed" indefinitely, it's the *moment* a trial converts, or the *moment* a suspension lifts. `company-lifecycle-engine.ts::getCompanyLifecycleState()` only ever returns one of 8 steady states (a 1:1 PascalCase mapping of `SubscriptionStatus`); the two transitional names are modeled as one-time **events** — logged to `subscription_status_history` and published to the Billing Event Bus at the moment they happen, never returned as a resting value. This interpretation is stated here explicitly, not silently assumed.

## Trial provisioning — zero Stripe dependency, by design

`billing-engine.ts::subscribeCompanyToPlan()` supports exactly one path today: `plan_key = 'free_trial'`. It never calls a payment provider — a trial subscription is a purely local row (`status='trial'`, `provider='manual'`). Wired into `company-service.ts::createCompany` immediately after RBAC seeding: **every new company automatically starts a real trial**, satisfying "a customer must never create a production company without passing through the Billing Platform first" from the moment a company is created, with zero dependency on Stripe being connected. `TRIAL_LENGTH_DAYS = 14` and `TRIAL_WARNING_DAYS_BEFORE_EXPIRY = 3` (`lifecycle-sweep-engine.ts`) are real, disclosed business-decision defaults — not directive-specified values — flagged here for confirmation.

## Trial expiry — the Scheduler owns it, never a login-time check

Per the directive's own explicit instruction. `SubscriptionLifecycleSweep` is a new `automation_tasks` task type (migration `0052`, the exact precedent already used for `CommunicationQueue` — widening the CHECK constraint, no second scheduling mechanism). `scheduler-service.ts::syncSubscriptionLifecycleTask()` self-heals one task per company (mirrors the existing `syncRecurringTemplateTasks` pattern); `runTask()`'s new branch calls `lifecycle-sweep-engine.ts::runSubscriptionLifecycleSweep()`, daily cadence. That function: expires an overdue trial (`trial → expired`), issues a one-time "ending soon" warning inside the configured window (tracked via `subscriptions.trial_warning_sent_at` so it never repeats), and moves an overdue grace period to suspended (`grace_period → suspended`). Every transition's audit trail is `subscription_status_history` — real from the moment `transitionSubscription()` runs, no separate logging needed.

## Payment-provider integrity guard

`billing-engine.ts::changeSubscriptionPlan()` (Upgrade and Downgrade are the same operation — the direction is a UI label from comparing prices, not a distinct code path) refuses to move a subscription to/from any priced plan unless `subscription.provider === "stripe"`, throwing `ProviderRequiredError`. This is not a placeholder limitation — granting paid-plan entitlements with no payment ever collected would be a real business-integrity hole, so it is refused outright, matching this codebase's own established "no module may invent success" principle (`integration-service.ts`'s honest "Not Connected" status is the same discipline). `cancelSubscription`/`resumeSubscription` never require a provider — cancellation and pre-period-end resume are always safe to run locally.

## Write-path model

User-initiated billing actions (Subscribe/Cancel/Resume/Change Plan) go through the **normal session-scoped Supabase client**, gated by `requirePermission(companyId, "ManageBilling")` first, with real RLS INSERT/UPDATE policies (`user_can_access_company()`/org-membership/platform-scope) — the identical shape every other table in this codebase uses. `createAdminClient()` is reserved strictly for genuinely session-less paths: the Stripe webhook route and the cron-triggered lifecycle sweep (today, the lifecycle sweep still runs via the manual "Run Scheduler Now" trigger, which has a real session — see `docs/MIGRATION_ROADMAP.md`'s disclosed note on `run-due-tasks/route.ts`'s own unattended-execution gap). This is a narrow, disclosed extension of `admin.ts`'s documented scope, not a general bypass of the app's own permission checks.

## Where to look next

- `docs/LICENSING_ENGINE.md` — entitlements, usage limits, the live-counted/metered split.
- `docs/FEATURE_FLAGS.md` — the 10 feature keys and override resolution.
- `docs/STRIPE_PROVIDER.md` — the provider interface and what Sub-Phase 8 still needs.
- `docs/COMMERCIAL_OPERATIONS.md` — the Internal Billing Console and the Billing Event Bus.
