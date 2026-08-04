# VYRON FINANCE — Security Architecture

RC2 Phase 12 deliverable. Synthesizes RC1 Phases 2/7/7.5/7.6's certification work into one permanent reference. Every claim below was verified live against a real Supabase project, not assumed — see `MIGRATION_ROADMAP.md`'s Phase 7/7.5/7.6 sections for the full evidence trail.

## Defense in depth — two independent layers, always

Every protected operation is checked at two layers that never share code:

1. **Application layer** — `requireSession()` (is there a valid user?) and `requirePermission()`/`requireApproval()` (does this user have this permission in this company, at this amount?).
2. **Database layer (RLS)** — `user_can_access_company()` and `user_has_permission()`, evaluated by Postgres itself on every query, regardless of what the application layer did or didn't check.

A bug in one layer alone has never been sufficient to cause a real breach in this codebase's history — the one confirmed critical cross-tenant leak (below) required a specific interaction between an RLS design choice and a fix to a *different* bug, and was caught precisely because the RLS layer was independently, adversarially tested against real data.

## Authentication

Supabase Auth (GoTrue), asymmetric JWT signing. Full workflow: login, logout, Remember Me (session-vs-persistent cookie via `@supabase/ssr` cookie options), forgot/reset password, change password (re-verifies current password before allowing a change), invite user (Admin API), first-run Platform Super Administrator bootstrap (`/setup`, self-locking), email/token-hash exchange via one shared `/auth/confirm` route. All live-verified end-to-end during RC1 Phase 7.6, including invalid/expired/already-consumed-token rejection.

**Known, disclosed characteristic, not a defect**: `requireSession()` uses `getClaims()`, which verifies JWTs by local signature check (fast, no network round-trip) rather than `getUser()` (network-verified, catches server-side revocation immediately). This means a signed-out session's access token remains cryptographically valid — and therefore still accepted by every API route — until its natural ~1 hour expiry, even though the refresh token is immediately revoked and the browser's own cookie is cleared. This is standard, documented Supabase SDK behavior, not an application bug; switching every route to `getUser()` would add a network round-trip to every request and was judged out of scope for a security *fix* (it's an intentional tradeoff, not a defect) — flagged here as a deliberate architectural decision the Product Review Board should be aware of.

## Authorization — RBAC

19 roles (15 company-scope, 4 platform-scope), 135 permissions (120 module × action combinations + 15 global). Full detail: `PERMISSION_MODEL.md`. Headline evidence: 178 of 180 mutation-capable API handlers require an explicit permission check (the remaining 2 are structurally exempt — company creation itself has no company to scope a check to yet, and the cron scheduler entry point is gated by a shared secret instead of a user session).

## Tenant isolation — the critical finding

The single most significant security finding across this platform's entire certification history: `user_can_access_company()` originally checked organisation-wide membership (`organisation_members`), by original design (`0001_platform_foundation.sql`'s own stated intent — one organisation, many client companies, staff move between them). During RC1 Phase 7.6 live certification, fixing an unrelated bug (invited users being blocked from their own company — `0034`/`0035`) legitimately added a test user to an organisation, which then revealed that organisation membership alone let them read a *sibling* company's real business data via a plain `GET` request — proven with a record deliberately named "CONFIDENTIAL Company A Client," successfully read by a user with zero role in that company.

Fixed in `0036_tenant_isolation_fix.sql`: the function now checks `user_role_assignments` (real, per-company or explicit platform-scope grants) instead of organisation membership. Re-verified: the identical attack now returns an empty result; every legitimate access path (company creation, existing role assignments, platform-role cross-company access) was re-tested and confirmed unaffected.

**One related item deliberately left open, disclosed not hidden**: `companies`' own SELECT policy (a separate, independent policy, not routed through `user_can_access_company()`) still uses organisation-wide membership — meaning an organisation member can see a *sibling* company's name/industry/status (not its business data — every actual data table is protected by the fixed function). Fixing this specific policy was evaluated and deliberately not attempted in the same pass: it hits the exact same `INSERT ... RETURNING`-requires-SELECT-policy trap that caused the original organisation-bootstrap bug (`0033`) — company creation's own `.insert({...}).select("*")` would fail the moment the creator's per-company role doesn't exist yet, which is always true at the instant of creation. Lower severity (metadata, not data) and higher risk to fix hastily.

## Live-attacked and confirmed blocked

Role escalation, permission escalation, foreign-ID cross-company writes, unauthenticated access to every route, invalid/expired/reused auth tokens — all attempted live against the real backend during RC1 Phase 7.6 and RC2, all correctly rejected. One cross-tenant *read* attack succeeded before the fix above; re-attacked after, correctly blocked.

## Document, Communication, and AI security

- **Documents**: one private Storage bucket, path-prefixed by `{company_id}/...`, storage policies independently re-check company access — verified via RC1 Phase 7's full audit.
- **Communications**: `communication_attachments` cross-tenant document-attach gap found and fixed at both layers (app validation + RLS insert policy) in RC1 Phase 7.
- **AI Copilot**: zero findings across the entire traced call graph — every data-fetching call requires a real `companyId`, threaded end-to-end into a `.eq("company_id", ...)` filter, confirmed by a full import-graph trace, not a sample.

## What this environment cannot verify

No browser-automation tool exists in this environment. Every result above is a real HTTP request/response pair or a direct database query, not a screenshot. If literal visual/screenshot evidence is required by policy, that needs either a different tooling environment or a manual verification pass following the test scripts already used (see `MIGRATION_ROADMAP.md`'s Phase 7.6 section for the exact `curl`/RPC sequences).
