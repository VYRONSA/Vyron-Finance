# VYRON FINANCE — Disaster Recovery

RC2 Phase 12 deliverable. Procedures for every failure mode considered, cross-referenced to `DEPLOYMENT_GUIDE.md` and `OPERATIONS_MANUAL.md`.

## Incident log — real defects this platform's own certification history found and fixed

Kept here deliberately: a disaster-recovery document is only as good as the honesty of what's actually gone wrong before. These are not hypothetical scenarios — every one below was a real, reproduced defect against a live database.

| Defect | Blast radius | Found during | Fixed by |
|---|---|---|---|
| Fixed Assets migration referenced a nonexistent table name (`suppliers` vs `ae_suppliers`) | Blocked *every* fresh installation from ever completing migrations | RC1 Phase 7.6, first-ever live migration run | Migration `0018` corrected |
| Organisation bootstrap failed on every brand-new user's first company | Blocked first-time onboarding entirely | RC1 Phase 7.6 | Migration `0033` — atomic RPC |
| Invited/assigned users silently locked out of their own company | Broke the entire Invite User + role-assignment feature for any non-owner user | RC1 Phase 7.6 | Migrations `0034`/`0035` |
| **Critical**: cross-tenant data leak via organisation-wide RLS | Any organisation member could read a sibling company's real business data | RC1 Phase 7.6 | Migration `0036` |
| Uncaught error on foreign/nonexistent record ID | 500 instead of 404 on cross-tenant write attempts (data was never actually exposed — only the error response was wrong) | RC1 Phase 7.6 | `customer-service.ts` `NotFoundError` fix |
| 13 tables missing an index on their most-filtered column | Query cost scales linearly with table size instead of near-flat | RC2 Phase 2 | Migration `0037` |

None of these were caught by unit tests or Preview Mode — all six required a real database with real RLS to surface. **The operational lesson**: any future defect of this class will also only be caught by testing against a live backend, not by expanding mock-data coverage.

## Failure mode 1 — total Supabase project loss

1. Create a new Supabase project (`DEPLOYMENT_GUIDE.md` §1).
2. If the old project is recoverable via Supabase's own backup system: restore from the most recent backup (Dashboard → Database → Backups).
3. If not recoverable: run `supabase db push --include-all` against the empty new project (§3) to reconstruct the exact schema from the 37 migration files — this guide's own deployment process doubles as the schema-recovery procedure.
4. Restore data from your own off-platform backup copy (see `OPERATIONS_MANUAL.md`'s backup section) if Supabase's own retention window has already lapsed.
5. Update every deployment's environment variables to the new project's URL/keys (§2) and redeploy.

## Failure mode 2 — total hosting (Vercel) loss

The application has no Vercel-specific coupling beyond deployment convenience — no `vercel.json`/`vercel.ts`, no Vercel-only APIs in the runtime code. Redeploy to any Node.js-capable host (a fresh Vercel project, or an alternative platform) pointed at the same 3 environment variables. The database is entirely independent of where the application runs.

## Failure mode 3 — credential compromise

| Credential | Action | Urgency |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Rotate via Dashboard → Project Settings → API | Low — RLS is the real boundary; a leaked anon key alone cannot bypass it |
| `SUPABASE_SERVICE_ROLE_KEY` | Rotate immediately, same location; update every deployment's env vars the moment it's suspected | **Critical** — bypasses RLS entirely |
| Database password (used only for `supabase db push`, never by the running app) | Reset via Dashboard → Project Settings → Database | Medium — enables direct DDL access |
| A specific user's account | Force sign-out via Admin API (`auth.admin.signOut`), then a normal password reset | Low-Medium |

## Failure mode 4 — database corruption or bad migration

1. **Never** attempt to fix by editing the migration file that already ran (see `RELEASE_PROCESS.md`'s discipline) — write a corrective forward migration.
2. If a migration is mid-flight and failed partway: `supabase db push` is safe to re-run — the CLI tracks which migrations already applied and resumes from the failure point, exactly as happened live during this platform's own migration deployment (migration 18 of 32 failed, was fixed, and the same `db push` command resumed cleanly from 18 through 32).
3. For actual data corruption (not schema): restore from a Supabase backup to a *new* project, verify the data there, then either promote it or selectively copy the affected tables back.

## Failure mode 5 — Storage (documents) loss

Supabase Storage is S3-backed with its own durability guarantees, independent of database backups. If an off-platform sync job is in place (recommended, not built into this application — see `DEPLOYMENT_GUIDE.md` §12), restore from that copy. Without one, Storage loss is not currently recoverable by this application alone — a genuine gap, disclosed rather than hidden, and a candidate for a future operational addition.

## Failure mode 6 — queue/scheduler stuck or failing

See `OPERATIONS_MANUAL.md`'s scheduler section for the retry/backoff/dead-letter behavior already built in (a task retries every 5 minutes until its `maxRetries` is exhausted, then falls back to normal cadence and raises a critical Operations Centre alert — verified by direct code read, not assumed). If the scheduler itself stops running entirely (the invoking cron trigger fails, not an individual task), no automatic recovery exists — a genuine gap: `run-due-tasks` has no self-monitoring for "has this not run when it should have," disclosed here as a recommended operational addition (an external uptime/cron-monitoring check, e.g. a dead man's switch pattern).

## Recovery time expectations (not measured against a real disaster, stated as reasoning from the components involved)

- Application redeploy (code-only issue): seconds (Vercel Instant Rollback).
- Schema reconstruction from migrations on a fresh project: minutes (37 migrations applied sequentially — the exact process in `DEPLOYMENT_GUIDE.md` §3, empirically timed during this certification at well under 5 minutes for the full set).
- Full data restore from a Supabase backup: depends on database size and Supabase's own restore process — not independently measurable from this environment; consult Supabase's own SLA documentation for your plan tier.
