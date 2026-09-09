# VYRON FINANCE — Production Deployment Guide

RC2 Phase 12 deliverable (originally produced as RC1 Phase 7.6's Phase I; updated with RC2's additional migration and correct current counts). Every step below was actually performed against a real Supabase project — this is not a theoretical guide assembled from documentation, it is a record of what genuinely worked, including the exact errors hit along the way. Follow it in order; a new installation needs no step beyond what's written here.

---

## 1. Supabase project creation

1. Create a Supabase account and a new project at supabase.com (or via the Vercel Marketplace — see §9).
2. Note the **Project Reference** (the subdomain in your project URL, e.g. `vrdiysfgeozidnejbruv`) and choose a strong **database password** at creation time — write it down now. Supabase does not show it again; you'll reset it via Project Settings → Database if lost.
3. Wait for provisioning to finish (a few minutes).

## 2. Environment variables

From **Project Settings → API**, copy three values:

| Variable | Where to find it | Used for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | "Project URL" — the **base** URL, e.g. `https://<ref>.supabase.co`. **Not** the `/rest/v1/` REST endpoint some dashboard views display — strip that suffix if present. | Every client/server Supabase call |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | "Publishable key" (`sb_publishable_...`) or legacy "anon" key | Browser + normal server requests (RLS-enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | "Secret key" (`sb_secret_...`) or legacy "service_role" key | **Server-only.** Powers the Invite User workflow and `/setup` first-run bootstrap (both call the Auth Admin API, which requires it). Never exposed to the browser — no `NEXT_PUBLIC_` prefix, never imported from a Client Component. Optional if you don't need Invite User or `/setup` in a given environment, but both silently no-op (clean 501 responses, not crashes) without it. |

Copy `.env.local.example` to `.env.local` in the project root and fill in all three. `.env.local` is gitignored — never commit it.

**No placeholders, no missing values** — verified live: `.env.local` populated with real values, then confirmed reachable via `curl` against the Auth health endpoint (`GET /auth/v1/health`) and the Storage bucket-list endpoint before proceeding to migrations.

## 3. Migration deployment

Requires the Supabase CLI (no separate install needed — `npx supabase` works) and the **database connection string**, a *different* credential from the three above:

**Dashboard → Connect (button near the top of the project page) → Connection string tab → URI → Session pooler.** Use the **session pooler**, not the transaction pooler and not the legacy direct `db.<ref>.supabase.co` host — newer Supabase projects don't expose that host at all (confirmed live: it doesn't resolve via DNS). The session-pooler string looks like:

```
postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
```

From the project root:

```bash
npx supabase init          # one-time — creates supabase/config.toml; safe to re-run, does not touch supabase/migrations/
npx supabase db push --db-url "postgresql://postgres.<ref>:[PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres" --include-all
```

All 37 migrations apply in order (`0001` → `0037`), tracked in a `supabase_migrations.schema_migrations` table the CLI manages — safe to re-run `db push` any time; already-applied migrations are skipped automatically. Ignore the `Warning: failed to cache migrations catalog... Docker` message — that's a local dev-cache feature requiring Docker Desktop, unrelated to whether migrations actually applied; check the JSON summary line (`"message":"Finished supabase db push."`) instead.

### Verifying the deployment

No Docker or `psql` needed — everything below uses `curl` against the REST/Storage APIs with your `SUPABASE_SERVICE_ROLE_KEY`:

```bash
# Table count — expect 119
curl -s "https://<ref>.supabase.co/rest/v1/" \
  -H "apikey: <service-role-key>" -H "Authorization: Bearer <service-role-key>" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(Object.keys(JSON.parse(d).definitions).length))"

# Platform roles seeded — expect 4 rows
curl -s "https://<ref>.supabase.co/rest/v1/permission_roles?company_id=is.null&select=role_key,name" \
  -H "apikey: <service-role-key>" -H "Authorization: Bearer <service-role-key>"

# Storage bucket exists — expect one "documents" bucket, public:false
curl -s "https://<ref>.supabase.co/storage/v1/bucket" \
  -H "apikey: <service-role-key>" -H "Authorization: Bearer <service-role-key>"

# RLS is actually enforced, not just enabled — query any real table with the
# ANON key and no session; expect an empty array, HTTP 200 (not an error,
# not real data)
curl -s "https://<ref>.supabase.co/rest/v1/companies?select=*" \
  -H "apikey: <anon-key>" -H "Authorization: Bearer <anon-key>"
```

All checks above were run against the real project during certification and returned exactly the expected values (119 tables, 4 platform roles, 1 storage bucket, empty-not-error RLS response).

## 4. Storage buckets & storage policies

**Created automatically by migration `0027_document_platform.sql`** — no manual bucket creation needed. One bucket, `documents`, private (`public: false`), with 3 storage policies (select/insert/delete) scoped by the `{company_id}/...` path prefix via `user_can_access_company()`. Confirmed live: bucket exists with the correct visibility immediately after `db push`, before any application code ever runs.

## 5. Seed data

Two tiers, both automatic:

- **Platform-level** (4 platform roles, their permission grants) — seeded directly by migrations `0025` and `0031`. Exists the moment migrations finish; nothing to trigger.
- **Company-level** (15 company roles, chart of accounts, VAT treatments, posting rules) — seeded by `seedCompanyRbacDefaults()`/`seedCompanyDefaults()`, called automatically every time a company is created (via the app, not a migration step). Verified live: creating one company produced 15 roles, 26 chart-of-accounts entries, 6 VAT treatments, 25 posting rules with zero manual intervention.

## 6. Bootstrap administrator creation

Deploy the app (§8) pointed at the migrated project, then visit **`/setup`**. It self-detects an empty installation (zero `platform_super_administrator` assignments) and shows a real signup form; submitting creates both the Supabase Auth user (`email_confirm: true`, so no email round-trip is needed to log in immediately) and the platform-scope role assignment in one step, using `SUPABASE_SERVICE_ROLE_KEY` under the hood. The page and its API route (`/api/setup/bootstrap`) both re-check independently on every request — once an administrator exists, `/setup` shows "Already set up" and the API returns `409` for any further attempt, regardless of who calls it. Verified live end-to-end, including the self-lock.

## 7. First company setup

Log in as the bootstrap administrator and go to **Platform Workspace → Create Company** (or `POST /api/companies`). The creating user is automatically assigned **Company Owner** for that company in the same request via the `bootstrap_organisation` RPC (first company) or the normal company-creation flow (subsequent companies) — verified live: `user_role_assignments` contained the Company Owner row immediately after the `201` response, with no separate step. An organisation can hold many companies (the accounting-firm-with-multiple-clients model) — the same one code path handles company #1 and company #20 identically.

## 8. SMTP configuration

Supabase ships a built-in email sender for Auth emails (password reset, invite) with a **low default rate limit** intended for development only — confirmed live: the third email send in quick succession returned `"email rate limit exceeded"` (a clean `400` from the app, not a crash).

For production volume: **Dashboard → Authentication → Emails → SMTP Settings** — enable "Custom SMTP" and supply a real provider (SendGrid, Postmark, AWS SES, or similar) with its host/port/username/password/sender address. No application code change is required.

**One additional required step, regardless of SMTP provider**: **Dashboard → Authentication → Email Templates** — every template using `{{ .ConfirmationURL }}` (Password Reset, Invite, Confirm signup) must be changed to link to this app's own `/auth/confirm` route instead of Supabase's default hosted redirect:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=/reset-password
```

Without this, `/auth/confirm` never receives a request and password-reset/invite-accept links won't complete. This is the one piece that must be configured per-project since it's a Supabase project setting, not something a migration or code change can set.

## 9. Vercel deployment

1. Push the repository to a Git provider Vercel can connect to (GitHub/GitLab/Bitbucket).
2. In Vercel: **New Project → Import** the repository. Framework auto-detects as Next.js — no `vercel.json` exists or is needed for a standard deployment.
3. Add the same 3 environment variables from §2 under **Project Settings → Environment Variables**, scoped to Production (and Preview, if you want preview deployments to hit the same or a separate Supabase project — a separate project is safer for Preview so test data never touches production).
4. Deploy. `next build` runs `tsc`/bundles server + client code; no build-time database connection is required (migrations are a separate, one-time step per §3, not part of the build).
5. On every future push to the deployment branch, Vercel rebuilds and redeploys automatically — new migrations still need `supabase db push` run separately (Vercel does not run SQL migrations for you).

## 10. Domain configuration

**Vercel:** Project Settings → Domains → add your domain, follow the DNS records Vercel shows (a CNAME or A record at your DNS provider).

**Supabase:** Project Settings → Auth → URL Configuration — set **Site URL** to your real production domain (e.g. `https://app.vyronfinance.com`) and add it to **Redirect URLs**. This is what `resetPasswordForEmail`'s `redirectTo` and `inviteUserByEmail`'s `redirectTo` are validated against — a production domain not added here will silently break password-reset/invite links even with SMTP correctly configured.

## 11. Operational recommendation from RC2 load testing

**Dashboard → Settings → API → Max Rows** (PostgREST's per-request row cap, confirmed live at 1,000 on a default project) directly bounds how many round trips any batched export-style query needs — e.g. the banking-automation summary engine used by the Dashboard, Automation Dashboard, and Matching pages currently needs one round trip per 1,000 transactions to compute an all-time ratio. Raising this setting is a zero-code, immediate mitigation for that specific finding (see `ENTERPRISE_ARCHITECTURE.md`'s Phase 3 section) — not a substitute for the recommended database-side aggregate rewrite, but a safe interim step.

## 12. Backup strategy

Supabase Postgres projects include automatic daily backups on paid plans (retention varies by plan tier — check **Dashboard → Database → Backups** for your project's actual retention window).

- **Point-in-time recovery (PITR)** is available as a paid add-on for projects needing sub-daily recovery granularity.
- **Storage bucket** (`documents`) is not covered by database backups — it's separate object storage (S3-backed). For an additional off-platform copy, a scheduled job using the Storage API to sync objects to a separate bucket/provider is the standard pattern (not built into this app — a genuine infrastructure addition if required).
- Migration files themselves (`supabase/migrations/`) are the schema's own backup — a fresh project + `db push` reconstructs the exact schema from empty, as this guide itself proves.

## 13. Rollback procedure

- **Application code**: Vercel keeps every deployment; "Instant Rollback" (Project → Deployments → select a prior deployment → Promote to Production) reverts application code in seconds with zero downtime.
- **Database migrations**: forward-only, no `down` migrations exist. A bug in an already-applied migration gets a new, corrective migration (see `0034`→`0035` in the migration history) — never edit an already-applied migration file's content for a live project.
- **Data**: restore from a Supabase backup (Dashboard → Database → Backups → Restore) for a full point-in-time database rollback — destructive, whole-database, a last resort.

## 14. Disaster recovery

See `DISASTER_RECOVERY.md` for the full procedure set.

## 15. Production checklist

- [ ] All 3 environment variables set in the hosting platform, no placeholders (§2)
- [ ] All 37 migrations applied — `npx supabase db push --include-all --dry-run` reports "Remote database is up to date" (§3)
- [ ] Verification queries from §3 all return expected values
- [ ] Custom SMTP configured, Email Templates updated to point at `/auth/confirm` (§8)
- [ ] Supabase Auth URL Configuration's Site URL + Redirect URLs match the real production domain (§10)
- [ ] Max Rows raised from the 1,000-row default for production data volume (§11)
- [ ] `/setup` visited once, first Platform Super Administrator created, page now shows "Already set up" on reload
- [ ] First company created, Company Owner assignment confirmed
- [ ] A real login, logout, forgot-password, and reset-password cycle completed manually against the production URL (not just Preview Mode)
- [ ] Backup retention window confirmed for the actual plan tier in use (§12)
- [ ] Domain DNS propagated and HTTPS certificate issued (Vercel handles this automatically once DNS is correct)

## 16. Environment Recovery

This section exists because of a real incident, not a hypothetical one: provisioning the Stripe Marketplace integration (`vercel integration add stripe`) automatically ran `vercel env pull`, which overwrote `.env.local` to match exactly what was registered on the Vercel project at the time — Stripe's four variables only. The three Supabase variables had only ever existed locally, never registered on the Vercel project, so the pull silently dropped them and broke the local dev server. Recorded here in full, per this guide's own standing rule of documenting the exact errors actually hit.

### Required environment variables

| Variable | Source | Registered on Vercel? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project Settings → API (§2) | Verify with `vercel env ls` — was **not** registered at the time of the incident above |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Project Settings → API (§2) | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Project Settings → API (§2) | Same |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_MCP_KEY` | Provisioned automatically by `vercel integration add stripe` | Yes — registered across Production, Preview, and Development the moment the integration is added |

Any variable that exists only in a local `.env.local` and not in the Vercel project's own Environment Variables list will be **removed** the next time something runs `vercel env pull` — this is Vercel's intended behaviour (the pull syncs local to match the project), not a bug, which is exactly why every variable the application needs must be registered on the Vercel project itself, not just present locally.

### Safe backup procedure

Never run `vercel env pull` (or any Marketplace `vercel integration add` command, which runs it automatically) without backing up first:

```
npm run env:backup   # or: npm run env:pull, which backs up first automatically
```

`scripts/backup-env.sh` copies `.env.local` to `.env-backups/.env.local.<timestamp>` before anything touches the working file, and refuses to silently overwrite an existing backup with the same timestamp. `.env-backups/` is covered by the repository's existing `.env*` gitignore pattern — verified with `git check-ignore` — so backups, like `.env.local` itself, are never committed.

### Restoring `.env.local`

1. If a recent backup exists in `.env-backups/`, restore from it: `cp .env-backups/.env.local.<timestamp> .env.local`.
2. If no backup exists (as in the incident above, since the safeguard didn't exist yet when it happened), retrieve each missing value from its real source (Supabase Project Settings → API for the three Supabase variables) and **merge** them into the current `.env.local` — append the missing lines, never replace the whole file, so variables that are already correct (e.g. Stripe's, freshly pulled) aren't lost in the other direction.
3. Never paste secret values into a chat conversation with an AI assistant, including this one — add them directly to `.env.local` in your own editor/terminal, then confirm they're restored.

### Vercel environment synchronization

After restoring `.env.local` locally, register any variable that was missing from the Vercel project so this failure mode cannot recur:

```
vercel env ls                                    # confirm what's actually registered
vercel env add NEXT_PUBLIC_SUPABASE_URL           # repeat per missing variable, per environment
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
```
`vercel env add` prompts for the value and which environments (Production/Preview/Development) it applies to — it does not require pasting the value as a command-line argument, so it never needs to appear in a terminal history or an AI assistant's tool output either.

### Common recovery steps, in order

1. `npm run env:backup` before touching anything further.
2. Restore/merge `.env.local` per the procedure above.
3. `vercel env ls` — confirm every required variable is registered on the Vercel project, not just present locally.
4. Restart the local dev server (`npm run dev`) so it picks up the corrected `.env.local`.
5. Verify: the app loads, login succeeds, a Supabase-backed page returns real data (not a Preview Mode banner), and any provider added since (e.g. Stripe) still resolves correctly — the same verification this guide's Production Checklist (§15) already expects before any deployment.

---

*Every numbered step in this guide, and the exact commands/curl calls shown, were performed against a real Supabase project during RC1 Phase 7.6 and RC2 live certification — not reconstructed from documentation after the fact.*
