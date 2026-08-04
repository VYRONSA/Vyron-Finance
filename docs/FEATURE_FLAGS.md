# VYRON FINANCE — Feature Flags

"Every premium capability should be controlled through one feature system... No page should hardcode 'Enterprise only'." Source: `src/server/billing-platform/engine/feature-flag-engine.ts`. See `docs/BILLING_ARCHITECTURE.md` for how this fits into the rest of the Billing Platform.

## The 10 feature keys

`ai_copilot`, `auditor_workspace`, `automation`, `fixed_assets`, `inventory`, `manufacturing_integration`, `advanced_reporting`, `document_platform`, `communication_platform`, `operations_centre` — seeded in `feature_flags` (migration `0045`), granted per plan via `subscription_plan_features`. Free Trial and Enterprise/Partner/Internal get every feature (full evaluation, full platform respectively); Starter gets the accounting core only (`inventory`/`document_platform`); Professional gets everything except `manufacturing_integration`. Seeded as data, not a switch statement — adding a feature to a plan is a database row, never a code change.

## The contract every module calls

```ts
hasFeature(companyId, featureKey): Promise<boolean>
listEnabledFeatures(companyId): Promise<FeatureKey[]>
```

Resolution order — plan default, then an optional per-company override:

```ts
resolveFeatureFlag(planDefault: boolean, override: boolean | undefined): boolean {
  return override ?? planDefault;
}
```

This is the entire resolution rule, pure and exhaustively unit-tested (`feature-flag-engine.test.ts`) in both directions — an override can grant a feature the plan doesn't include, or withhold one it does. Overrides live in `company_feature_overrides` (migration `0047`), a per-company exception a platform-scope operator sets via the Internal Billing Console (`FeatureEnabled`/`FeatureDisabled` are two of the Billing Event Bus's 13 named event types, ready for exactly this — see "Disclosed gap" below).

## Worked example — wiring a new gate

Adopting `hasFeature` into a route is a one-line, mechanically consistent change, mirroring how `requirePermission()` is already composed everywhere in this codebase:

```ts
const check = await requirePermission(companyId, "AccessAICopilot");
if (!check.ok) return check.response;
if (!(await hasFeature(companyId, "ai_copilot"))) {
  return NextResponse.json({ error: "AI Executive Copilot is not included in your current plan." }, { status: 403 });
}
```

This is the real, live wiring in `copilot/ask/route.ts` today — the permission check answers "is this user allowed to use this capability," the feature check answers "does this company's plan include it," and they are deliberately two separate questions, checked in that order, never conflated into one.

## Real vs. not-yet-wired

`hasFeature`/`listEnabledFeatures` are real and correct for every one of the 10 keys today. Only `ai_copilot` and `automation` have a real call site currently gating a route/action (`copilot/ask/route.ts`, `scheduler-service.ts::runDueTasks`) — the other 8 keys are fully computable (`listEnabledFeatures` returns them correctly, and the Customer Portal's Overview/Plan tabs would reflect them) but have no other module wired to check them yet, since those modules' own routes weren't touched in this pass. Adding a gate to any of them is the exact one-line pattern shown above.

## Disclosed gap — no write UI for overrides yet

`company_feature_overrides` has real schema and is read correctly by `hasFeature`, but no route/UI exists yet to create one — the Internal Billing Console's "Manual Overrides" capability (named in the Product Review Board's Sub-Phase 6 directive) is not built in this pass. A real, scoped next step, not a fabricated form with nowhere to send its data — same discipline as the Customer Portal's read-only Billing Contact tab (see `docs/COMMERCIAL_OPERATIONS.md`).
