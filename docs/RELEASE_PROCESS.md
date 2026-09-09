# VYRON FINANCE — Release Process

RC2 Phase 12 deliverable. How a change goes from commit to production, and the discipline that's kept this codebase's migration history honest through 37 migrations and multiple live-certification passes.

## Migration discipline — the single most important rule in this document

**Once a migration has run against a real (non-empty-local) database, its file content is never edited.** A bug found in an already-applied migration gets a new, corrective migration instead.

This is not a stylistic preference — it's the difference between a reproducible deployment history and a database that silently diverges from what its own migration files claim. Real precedent from this codebase: migration `0034` shipped with a genuine Postgres bug (a `returns table(...)` function with an ambiguous-column error, caught on its very first live call). It was **not** edited — `0035` was written as a `drop function` + corrected `create function`, and `0034`'s file still reads exactly as it did when it first ran. A fresh installation applies both in order and ends up at the identical correct state as the live database that took the two-step path.

The one exception, also with real precedent: a migration that has *never* run against any real database yet (caught in local development, before the first `db push`) can be edited in place — see `0025`'s own in-file comment documenting exactly this distinction for a security fix caught before first deployment.

## Standard change flow

1. **Code change** — repository → service → API → UI, per `EXTENSION_GUIDE.md`'s layering.
2. **Verification gate**, every time, no exceptions: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` — all clean. This has been the actual, enforced bar for every one of the 22 shipped modules and every certification phase in this platform's history, not a suggestion.
3. **Migration** (if schema changed) — written, then pushed to a real project with `supabase db push`, then independently verified (query the actual resulting schema — table exists, RLS enabled, policy text correct — never assume a migration "probably worked" because it returned success).
4. **Live smoke test** (if the change touches an API route or a page) — a real `curl` sweep, authenticated, against a live backend where possible; Preview Mode 501-verification where not.
5. **Documentation** — `MIGRATION_ROADMAP.md` gets the module/phase's own section with evidence citations; any of the other 9 documents in this set that the change affects gets updated in the same change, not deferred.

## Testing gates in detail

| Gate | Tool | What it catches |
|---|---|---|
| Type safety | `tsc --noEmit` | Every type error, including the ones this platform's own history shows matter (e.g. a service function's return type silently changing) |
| Lint | `eslint .` | Unused vars, hook rules, the two long-standing pre-existing warnings this codebase has carried since early in its history (documented, not silently ignored — `transaction-grid.tsx`'s React Compiler warning, `sales-invoice-repository.ts`'s unused import) |
| Unit/component | `vitest run` | Business logic correctness, accessibility (`jest-axe`), permission-engine regression |
| Live/integration | `curl` against a real Supabase project | Everything unit tests structurally cannot — RLS interaction, real migration behavior, real auth token exchange. This platform's own history proves this gate is not redundant with the others: 6 real defects (see `DISASTER_RECOVERY.md`'s incident log) were caught *only* here, with 1094+ passing unit tests and clean `tsc`/`eslint` at the same time. |

## Rollback

See `DEPLOYMENT_GUIDE.md` §13 and `DISASTER_RECOVERY.md`. Application code: Vercel Instant Rollback. Schema: forward-only corrective migrations, never a file edit.

## Versioning

This codebase does not currently use semantic version tags — releases are tracked by the RC (Release Candidate) phase structure itself (RC1 Phases 1-7.6, RC2 Phases 1-12), documented in `MIGRATION_ROADMAP.md`. A future formal version-tagging scheme (e.g. tying a Vercel deployment to a specific migration-count + git-tag pair) is a reasonable addition once the platform moves beyond the certification phases into ongoing maintenance — not built as of this document's writing.

## Who signs off

Per this platform's own established process: every phase's completion is reported with evidence (exact totals, not percentages; every claimed fix independently re-verified after applying it), and the Product Review Board — not the implementer — makes the go/no-go call on each phase, based on that evidence. This document doesn't change that; it documents the mechanics the evidence is gathered *with*.
