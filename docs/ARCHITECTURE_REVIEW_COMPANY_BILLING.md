# Architecture Review — Company Creation and Billing Dependency

Product Review Board Final Architecture Review, pre-Version-1.0-freeze. **This document is a recommendation only. No implementation has been changed as a result of it**, per the Board's explicit instruction to review before acting.

## Objective

Determine whether Billing should remain a hard, synchronous dependency of Company Creation.

## The two architectures under evaluation

**Current (implemented today)**:
```
Create Company → Create Billing → Company Complete
```
One HTTP request (`POST /api/companies` → `company-service.ts::createCompany`) performs company creation, RBAC seeding, and billing-subscription creation (`subscribeCompanyToPlan`) as one sequential chain. If any step fails, the whole request fails.

**Proposed**:
```
Create Company → Company Operational → Billing Activation
```
Company creation and RBAC seeding complete and return success immediately. Billing activation is attempted immediately afterward but is a separate, trackable, retryable step whose failure does not fail company creation.

## This is not a hypothetical comparison — the current architecture's failure mode was directly observed this session

While verifying the pre-launch administrator account, `createCompany()` was called three times against the live database (once directly, twice retried after the first attempt returned a 500). All three attempts:

1. Created a real `companies` row.
2. Successfully seeded the Chart of Accounts, VAT treatments, and all 15 RBAC roles.
3. Successfully assigned `company_owner` to the requesting user.
4. Successfully granted `ManageBilling`.
5. **Failed** at the final step, `subscribeCompanyToPlan`, because the Billing Platform's tables (`subscription_plans`, `subscription_companies`, etc.) don't exist yet in this database (migrations `0045`-`0054` not applied — a pre-existing, disclosed external dependency, not a code defect).

The result: **three duplicate, fully-RBAC'd, ownerless-of-billing companies**, because each 500 response gave no indication that steps 1–4 had already succeeded, and the API has no idempotency check preventing a retry from creating a second company. This is precisely the failure mode already flagged, in the abstract, by `docs/DEFECT_REGISTER.md` D-032 ("non-atomic multi-step billing writes... a company created with no billing subscription at all") — this session supplies the first live confirmation that the predicted failure actually occurs, and that its blast radius includes duplicate company creation on retry, not just an inconsistent single company.

## Evaluation against each consideration

**Reliability.** The current architecture *looks* atomic to the caller (one request, one pass/fail) but is not atomic in the database (no transaction spans company creation and billing activation, and Postgrest/Supabase's REST layer cannot span one across two logically separate engines). This is the worst combination: the caller is told "all or nothing" while the database silently keeps "most of it." The proposed architecture makes the actual transactional boundary — company creation *is* atomic, billing activation is a separate concern — match what the API tells the caller. Reliability improves because the reported outcome becomes truthful.

**Failure recovery.** Today, recovering from a billing failure means the caller has no way to distinguish "nothing was created, retry the whole thing" from "the company exists, only billing failed" — the demonstrated outcome is silent duplication. Under the proposed architecture, company creation is a single idempotent success; a stalled billing activation is retried on its own (by a scheduler sweep or an explicit retry action), never by re-running company creation.

**Customer onboarding.** Today, any hiccup in a subsystem the customer never sees (Stripe, usage-metering, the billing schema itself) blocks the customer from getting a working company at all. Under the proposed architecture, the customer gets a working company immediately — matching what `docs/CUSTOMER_ONBOARDING_GUIDE.md` already promises ("You don't need to do anything to activate it — it's already running") — while billing activates transparently, normally within the same second.

**Operational resilience.** The original Commercial Billing Platform directive was explicit that Billing should be built as "a standalone platform" with "its own internal service layer," reusable by future VYRON products, and that other modules must never be coupled to it beyond calling its published entry points. A synchronous hard dependency where Billing's failure fails Company Creation is the opposite of that isolation — it makes core company onboarding hostage to a subsystem it's supposed to be decoupled from. The proposed architecture is actually the more faithful implementation of the platform's own founding design intent, not a departure from it.

**Multi-tenant consistency.** This is the strongest argument for keeping billing mandatory, and the proposed architecture does not weaken it — it changes *when* the guarantee is enforced, from "synchronously, or the company doesn't exist" to "within a bounded window, monitored and enforced by an automated sweep, or the company is flagged." The invariant ("every company must have a governing subscription") is preserved; only its enforcement mechanism changes from a blocking check to an eventually-consistent one with a real escalation path. The rest of the codebase already treats "no subscription yet" as a normal, safe state to read (`getSubscriptionForCompany` returning `null` is an ordinary code path throughout `platform/page.tsx`, not an exceptional one) — the data model already tolerates this state; only the write path currently refuses to.

**Commercial requirements.** The business needs every company to end up billed — it does not need that to happen within the same HTTP request. Licensing and feature-flag checks already fail safe (no subscription → no entitlements, per `licensing-engine.ts::evaluateUsageLimit`), so a brief window where a company exists without a subscription is not a revenue-leak risk; it is invisible to the product's own enforcement.

**User experience.** Today: one long blocking wait across every step, an opaque failure if any one of them hiccups, and (demonstrated) no partial credit for what did succeed. Proposed: a fast "your company is ready" response, with billing normally completing transparently a moment later.

## Recommendation

**Adopt the proposed architecture — but as a decoupled, near-synchronous, guaranteed-eventually-consistent flow, not an indefinitely deferred one.** In the normal case (Billing Platform healthy), the user-visible outcome and timing should be identical to today: a fully-billed company, in about the same wall-clock time, since billing activation is still attempted immediately after company creation succeeds — it is simply no longer able to fail the company creation response. The difference only becomes visible when something goes wrong, which is exactly when today's architecture currently fails worst.

This is not a redesign of the Billing Platform itself — no engine, schema, or business rule changes. It is a change to one orchestration function (`createCompany`) and the addition of one scheduled sweep, following a pattern (`automation_tasks` scheduler-owns-expiry) already established twice in this codebase (`CommunicationQueue`, `SubscriptionLifecycleSweep`).

### Migration path

1. Split `company-service.ts::createCompany` into two phases: company creation + RBAC/defaults seeding (as today, steps 1–4), which the API always waits for and returns 201 on success; and a billing-activation call, attempted immediately in the same request but with its failure caught and downgraded to a response flag (e.g. `billingActivationPending: true`) instead of a 500.
2. No new schema is required to represent the pending state — a `companies` row with no matching `subscription_companies` row already means exactly "operational, billing not yet active," and every read path already handles it safely.
3. Add a new `automation_tasks` type, `BillingActivationSweep` (mirroring `SubscriptionLifecycleSweep`'s migration precedent exactly: widen the `task_type` CHECK constraint, one `runTask` dispatch branch, one cadence branch). It finds companies with no `subscription_companies` row older than a short threshold and retries `subscribeCompanyToPlan`, with backoff; past a defined grace period (e.g. 24–48 hours) it raises an `operations_alerts` critical alert instead of retrying forever, so a stuck company is never silently invisible.
4. Update `POST /api/companies`'s response contract and the Customer Portal/Platform Overview UI to show a friendly "Activating your plan…" state when `billingActivationPending` is true — most of the necessary UI already exists, since "no subscription yet" already renders as a real, non-broken state (`tier: "—"`, `status: null`) in `platform/page.tsx` today.
5. Write the migration, but — consistent with this codebase's established discipline — do not apply it until it can be tested against a real database; this pairs naturally with the already-written migration `0054`, which is itself a one-time version of exactly the sweep logic being proposed here as an ongoing job.

### Advantages

- Eliminates the exact duplicate-company defect demonstrated live this session.
- Turns an opaque, all-or-nothing failure into a legible, monitorable, retryable one.
- Removes Company Creation's exposure to Billing Platform outages entirely — a customer can start using the product even if Stripe, or the billing schema, is temporarily unavailable.
- Matches the platform's own founding "standalone service" design intent better than the current implementation does.
- **Practically relevant right now**: this change would make Company Creation work in this exact environment today, before migrations `0045`-`0054` are applied — every company would take the "Operational, billing pending" path immediately and become fully billed the moment the migrations land and the sweep runs, rather than being unable to create a company at all until then.

### Disadvantages

- Adds one new state ("Operational, billing pending") that every relevant surface (Customer Portal, Platform Overview, support tooling) must display honestly rather than silently — some UI work, most of it already halfway done.
- Introduces a genuine, if short and monitored, eventual-consistency window — requires real alerting discipline (the `operations_alerts` escalation) so "temporarily pending" can never quietly become "permanently unbilled."
- One more automated task type to test, monitor, and reason about operationally.

### Impact

Touches `company-service.ts::createCompany`, `POST /api/companies`, one new migration (task-type widening, following the `0052` precedent exactly), `scheduler-service.ts` (one dispatch branch, one cadence branch, mirroring the existing `SubscriptionLifecycleSweep` wiring), and light UI copy changes in the Customer Portal and Platform Overview. It does not touch the accounting core, RLS model, or any other engine.

### Rollout strategy

1. Implement and test against a real database once migrations `0045`-`0054` (and the new sweep migration) can actually be applied — this cannot be verified end-to-end in the current environment, the same disclosed constraint noted throughout `docs/LAUNCH_CHECKLIST.md`.
2. Ship ahead of, not alongside, the Stripe go-live — since that is the point at which a stuck billing activation first becomes commercially meaningful, and the sweep needs to already be proven reliable by then.
3. No customer-facing migration or backfill is needed beyond what `0054` already does for pre-existing companies — new companies simply start using the new flow.
