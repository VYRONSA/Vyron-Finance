# VYRON FINANCE — Extension Guide

RC2 Phase 12 deliverable. How to add a 23rd module following the same pattern the other 22 already use — verified against real, shipped code, not a theoretical template.

## The layering, in build order

1. **Migration** (`supabase/migrations/00NN_module_name.sql`) — tables, RLS policies (`user_can_access_company(company_id)` for every read/write policy, no exceptions), indexes on `company_id` and any column the repository will filter by directly (see `DATABASE_ARCHITECTURE.md`'s index strategy — don't index every foreign key, only columns with a real, evidenced query pattern).
2. **Repository** (`src/server/repositories/<module>-repository.ts`) — the *only* layer allowed to import `@/lib/supabase/server`. Every list function gets a `.limit()` cap (10,000 is this codebase's established default) and deterministic `.order()` — unbounded queries were a real, disclosed finding fixed across ~40 functions in RC1 Phase 7.
3. **Service** (`src/server/services/<module>-service.ts`) — validation, business rules, orchestration. Throws `ValidationError`/`NotFoundError` (module-local classes, matching the established convention — not a shared exception hierarchy). If the module posts to the General Ledger, it *builds* a journal draft here and calls `postApprovedJournals` from `posting-engine-service.ts` for the actual posting step — never writes to `gl_transactions` directly (see `ENTERPRISE_ARCHITECTURE.md`'s "one posting engine" section).
4. **API routes** (`src/app/api/companies/[companyId]/<module>/**/route.ts`) — follow `API_REFERENCE.md`'s two shapes exactly. Pick permission keys from the existing catalog (`PERMISSION_MODEL.md`) — a new module reuses one of the 12 existing `PermissionModule` values if it's a variant of an existing domain, or requires a genuinely new module name (a real schema/type change, not just a string) if it's truly novel.
5. **UI** (`src/app/company/[companyId]/<module>/page.tsx` + components) — reuse existing `Card`/`Table`/`Button`/`Badge`/`EmptyState` components; no new visual pattern without an explicit design decision. Wire the sidebar nav item in `workspace-shell.tsx`.
6. **If the module needs a Dashboard tile**: write a `build<Module>DashboardSummary` pure function in a `<module>-summary-service.ts`, call it from *both* the Dashboard page and the module's own workspace page — never compute the same number two different ways (this is the actual mechanism behind "never diverge," not a policy statement — see `ENTERPRISE_ARCHITECTURE.md`).

## Testing

- Repository functions: no direct unit tests in this codebase's convention (they're thin Supabase-query wrappers; correctness is proven by RLS/integration behavior, not unit mocks).
- Service functions: full unit test coverage expected, matching every existing `*-service.test.ts` — validation rules, business logic branches, and (if the module builds journal lines) exhaustive line-building tests matching `journal-service.test.ts`'s own rigor.
- Components: `jest-axe` accessibility check on every new page (27 of 42 existing pages already have this — extend the ratio, don't let it slip).
- Security regression: if the new module introduces a new permission key or a new cross-tenant-sensitive query pattern, add a case to `security-regression.test.ts`.

## What NOT to do

- Don't add a new `requirePermission`-equivalent function — there is exactly one, `permission-service.ts`.
- Don't add a new posting path — there is exactly one, `posting-engine-service.ts::postApprovedJournals`.
- Don't add a raw `.select()` without a `.limit()` on any function that could return more than a handful of rows.
- Don't skip the RLS policy "just for this one table" — all 119 existing tables have it, with zero exceptions found in RC2's own audit.
- Don't invent a new error-class hierarchy — match the existing per-service `ValidationError`/`NotFoundError` pattern.
- Don't build a second `organisation_members`-style membership table — company access is `user_role_assignments`, full stop (see `SECURITY_ARCHITECTURE.md`'s tenant-isolation section for exactly why a second, disconnected membership concept caused this platform's most serious defect).

## Verification before calling a new module done

`npx tsc --noEmit`, `npx eslint .`, `npx vitest run` — all three clean, matching every module's own completion report throughout this platform's build history. Then a live curl sweep of the new routes (Preview Mode 501s if no Supabase project is configured; real 200s/403s once one is) before claiming the module complete — the discipline this platform's own RC1/RC2 certification history proved is the only way to catch what unit tests structurally cannot (RLS interaction bugs, cross-tenant leaks, migration ordering issues).
