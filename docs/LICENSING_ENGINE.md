# VYRON FINANCE — Licensing Engine

The Licensing Engine owns Max Users/Companies/Storage/Documents/AI Usage/Automation/API Calls/Integrations and Feature Entitlements — "everything reads from this engine." Source: `src/server/billing-platform/engine/licensing-engine.ts` + `usage-metering-engine.ts`. See `docs/BILLING_ARCHITECTURE.md` for how this fits into the rest of the Billing Platform.

## The contract every module calls

```ts
getEntitlements(companyId): Promise<Entitlements>
checkUsageLimit(companyId, limitKey, additionalQuantity = 1): Promise<UsageLimitCheck>
```

`UsageLimitCheck = { allowed: boolean; limit: number | null; used: number; reason?: string }`. `limit === null` is a real, deliberate "unlimited" grant (the same convention `role_approval_limits.max_amount = null` already established in `0025_rbac_platform.sql`) — a *missing* limit row is `0` (deny-by-default), never confused with unlimited. `checkUsageLimit`'s pure core, `evaluateUsageLimit(limitValue, currentUsage, additionalQuantity)`, is exhaustively unit-tested (`licensing-engine.test.ts`).

## The 8 limit keys

`max_users`, `max_companies`, `max_storage_mb`, `max_documents`, `max_ai_requests_monthly`, `max_automation_runs_monthly`, `max_api_calls_monthly`, `max_integrations` — seeded per plan in `subscription_plan_entitlements` (migration `0045`), never hardcoded.

`max_integrations` has no real usage source today — VYRON COST/CORE `integration_connections` rows exist for every company regardless of plan (an honest "Not Connected" status, not a purchased seat — see Phase 4's own VYRON platform integration architecture), so there's no real "in use" count to check against yet. `checkUsageLimit` for this key evaluates against `0` usage, meaning it only ever reflects whether the plan grants any integrations at all.

## The Usage Engine — one engine, two real mechanisms

"There must only be one Usage Engine. Every module reports usage through it. Nothing calculates usage independently." `usage-metering-engine.ts` is that one engine: `recordUsageEvent(companyId, metricKey, quantity?, metadata?)` and `getUsageSnapshot(companyId, metricKey)` are the only two functions any other module calls. Internally it dispatches to one of two real mechanisms, decided per key, never mixed:

### Live-counted (`LiveCountedUsageKey`)

`companies`, `users`, `customers`, `suppliers`, `inventory_items`, `assets`, `documents`, `storage_mb`. A real `count(*)`/`sum()` against the metric's own owning table on every read (`subscription_companies`, `user_role_assignments`, `customers`, `ae_suppliers`, `stock_items`, `fixed_assets`, `documents`) — **never stored, never incremented**. This is the direct consequence of a corrective migration (`0051`) found during the Sub-Phase 4 module-by-module usage audit: `active_users`/`storage_mb`/`documents` were originally modeled as metered counters, but each already has a real, authoritative owning table — an incrementing counter can only ever drift from it (e.g. a deleted document would leave `storage_mb` too high forever, since nothing decrements it). This is the same "aggregate query beats a manually-maintained counter" lesson this codebase already learned the hard way fixing the banking-automation Launch Blocker (migrations `0039`-`0043`) — applied here proactively, not after a second incident. `storage_mb` uses a dedicated `security definer` aggregate function, `fn_company_storage_bytes()`, since PostgREST can't express a raw `SUM` directly — one `user_can_access_company()` check, mirroring `fn_banking_automation_summary`.

### Metered (`MeteredUsageKey`)

`communications`, `automation_runs`, `ai_requests`, `api_requests`, `bank_imports`, `reports_generated`, `forecasts`, `financial_statements`, `scheduled_jobs`. Written via `fn_record_usage_event()` (migration `0047`), a `security definer` RPC that atomically inserts a detail row into `usage_events` (for reporting/debugging) and upserts the current month's counter in `usage_period_counters` (the *only* table `getUsageSnapshot` reads for these keys — `usage_events` is never on the hot path of a limit check).

**Disclosed gaps**: `api_requests` has no real call site yet — this platform has no versioned public API distinct from its own internal Next.js routes, so instrumenting it today would mean counting internal page traffic, which isn't what a plan limit means. `scheduled_jobs` functionally overlaps `automation_runs` in this codebase's architecture (there is exactly one Scheduler — "a job ran" and "an automation ran" are the same event), so the key exists in the schema but isn't separately incremented, to avoid a fabricated parallel counter for something that isn't a distinct occurrence here.

## Real usage recording, wired at genuine mutation points

| Metric | Where | Why there, not elsewhere |
|---|---|---|
| `ai_requests` | `copilot/ask/route.ts`, on a successful answer | The one real AI-request action today |
| `automation_runs` | `scheduler-service.ts`, after each successfully-run task (excluding `SubscriptionLifecycleSweep` itself) | Counting the sweep against its own company's limit would be a lockout trap — see below |
| `bank_imports` | `import-service.ts::importBankStatement`, once per completed batch | A batch, not a row, is the real unit of customer work |
| `reports_generated` | `reporting-package-service.ts::generateReportingPackage` | A discrete "generate" action — deliberately NOT the live statement getters (`getIncomeStatement` etc.), which a page re-fetches on every view/refresh and would over-count |
| `communications` | `communication-service.ts::processCommunicationQueue`, once per successful send | Delivered messages, not queued/failed attempts |

## Subscription Enforcement — the 4 named examples, live

1. **Seat limit reached → Invite User returns the correct error.** `users/invite/route.ts` calls `checkUsageLimit(companyId, "max_users")` before inviting; `403` with the real reason on denial.
2. **Storage exceeded → Document upload blocked.** `document-service.ts::uploadDocument` calls `checkUsageLimit(companyId, "max_storage_mb", fileSizeInMb)` before any write; a new `UsageLimitExceededError` maps to `403`.
3. **Automation limit exceeded → Automation disabled.** `scheduler-service.ts::runDueTasks` checks `hasFeature(companyId, "automation")` and `checkUsageLimit(companyId, "max_automation_runs_monthly", 0)` once per run and **defers** (not fails) every due task except the company's own `SubscriptionLifecycleSweep`. That task is deliberately exempt: a company already over its limit must still be able to run the one task that could lift its own suspension — gating that too would be a lockout with no way out.
4. **AI usage exceeded → Copilot unavailable.** `copilot/ask/route.ts` checks `checkUsageLimit(companyId, "max_ai_requests_monthly")` alongside the existing `hasFeature` gate.

## A known limitation, disclosed rather than hidden

`checkUsageLimit`'s `max_users` check (and the live-counted checks generally) are scoped per **company**, not per subscription. A Professional/Enterprise subscription can span several companies (`subscription_companies`), and conceptually "Max Users" should mean users across every company on that subscription, not one company's own count. Today each company is checked independently. This is a real, disclosed simplification, not a silent bug — noted here for the eventual fix.
