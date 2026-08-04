# VYRON FINANCE — Operations Manual

RC2 Phase 12 deliverable. Day-to-day operational procedures for a running installation.

## Monitoring

**Built in**: the Operations Centre (`/platform/operations`) surfaces `system_events` (PermissionDenied/LoginFailed/AccountLocked/SessionExpired/ApiAuthFailure) and `operations_alerts`, computed live from tables the application already writes — automation task runs, workflow instances, notifications, communications, the audit trail, matching overrides, GL transactions, VAT returns, reporting packages. No separate monitoring agent is required for application-level events.

**Not built in, genuine gaps disclosed rather than hidden**:
- No external uptime monitoring (is the application itself reachable) — recommend a standard third-party uptime checker (Vercel's own, or Better Stack/UptimeRobot/similar) pointed at a real page, not just the root domain.
- No APM/tracing (per-request latency breakdown in production) — the timing evidence in this certification was gathered via `curl`'s own timing fields against a local dev server, not a production APM tool. A production deployment would benefit from Vercel's own Web Analytics/Speed Insights or a dedicated APM if per-request server-side tracing is required.
- No scheduler "dead man's switch" — if the cron trigger invoking `run-due-tasks` itself stops firing (as opposed to an individual task failing, which *is* handled — see below), nothing currently detects the silence.

## Logging coverage

Every permission denial is logged as a `system_events` row (`recordSystemEvent`, called from `permission-service.ts::forbidden()` on every rejected `requirePermission`/`requireApproval` call) — fire-and-forget, so a logging failure never blocks the actual authorization decision. Every role/permission change is logged to `permission_audit_log` via a `security definer` RPC (the only write path — client-side direct writes are blocked by RLS). Every automation run is logged to `automation_audit_log`, same RPC-only pattern.

**Not logged**: successful (non-denied) API calls have no structured access log beyond what Vercel's own platform-level request logs capture. Consider this if compliance requirements need a full access-log trail beyond authorization denials.

## Alert coverage

`operations_alerts` fires automatically on: automation task exhausting its retries (critical), and whatever else already calls `createAlert()` across the automation/matching/banking engines. Platform-level alerts (`company_id is null`) are read/write-restricted to `AuditAccess`-holding platform roles as of migration `0032` — closing a gap where any authenticated user could previously fabricate or tamper with platform-wide alerts.

## Backup readiness

See `DISASTER_RECOVERY.md` and `DEPLOYMENT_GUIDE.md` §12. Summary: Supabase's own automatic daily backups (retention depends on plan tier — verify for your actual project), migration files as schema backup, no built-in Storage bucket backup (a disclosed gap).

## The Scheduler — operational detail

`scheduler-service.ts::runDueTasks(companyId, nowIso)`:

1. Syncs recurring-template-generated tasks.
2. Fetches all currently-due tasks for the company (`listDueTasks`).
3. Processes them **sequentially** (a `for` loop, not `Promise.all`) — each task's success/failure is independent; one slow task delays the ones after it in the same run, but a crash in one task doesn't abort the others (each is wrapped in its own try/catch).
4. On success: `retryCount` resets to 0, next run scheduled per the task's normal cadence.
5. On failure: `retryCount` increments; if under `maxRetries`, the next attempt is scheduled 5 minutes later (not the normal cadence) — a real, if simple, backoff. Once `maxRetries` is exhausted, falls back to normal cadence (so a permanently-broken task doesn't retry forever in a tight loop) **and** raises both a critical notification and a critical Operations Centre alert — real dead-letter handling, not a silent drop.

**Known gap, disclosed**: no explicit concurrent-run claim/lock (e.g. `SELECT ... FOR UPDATE SKIP LOCKED`). If the invoking cron platform ever fired two overlapping `run-due-tasks` invocations for the same company, both could fetch the same due-task list and attempt to run the same task twice. In practice this relies on the invoking cron platform's own non-overlap guarantee (standard for Vercel Cron and most schedulers) rather than a database-level guard. A more defensive design would add an atomic claim step; not implemented in this pass given no evidence of an actual overlap occurring, consistent with "optimise/fix where evidence supports it."

**Entry point**: `POST /api/automation/run-due-tasks`, gated by a shared secret header (not a user session — there is no user in a cron invocation), the one deliberately-exempt route in the entire 236-route API surface's permission-coverage audit.

## Queues

This application does not use a dedicated message-queue product (SQS, Redis, etc.) — "queues" are database tables processed by the scheduler above (automation tasks) or by direct synchronous service calls (communication sending, notification creation). There is no separate queue infrastructure to operate, monitor, or scale independently of the database and the scheduler's own cron cadence.

## Routine operational tasks

- **Adding a Supabase Storage/DB capacity tier change**: no application-side action needed; Supabase manages this transparently.
- **Rotating credentials**: see `DISASTER_RECOVERY.md` failure mode 3.
- **Running a new migration**: `DEPLOYMENT_GUIDE.md` §3, plus `RELEASE_PROCESS.md` for the discipline around writing one.
- **Investigating a permission denial a user reports**: query `system_events` for `event_type = 'PermissionDenied'` filtered by `actor`/`company_id`/time range — every denial includes the specific `permissionKey` that was missing in its `metadata`.
- **Investigating a stuck automation task**: query `automation_task_runs` for the task, check `retryCount` against `maxRetries`, check `automation_audit_log` for the actual error captured at failure time.
