# VYRON FINANCE — SaaS Platform Architecture

This document describes the architecture of the Next.js SaaS application in
`web/`, built per the Product Review Board's "SaaS Platform Foundation"
instruction. It does **not** describe the CustomTkinter desktop application
(`finance_recovery_tool/`), which is now reference-implementation-only.

## Stack

- **Next.js 16 (App Router, Turbopack)**, TypeScript, React 19
- **Tailwind CSS v4** — CSS-first config (`@theme inline` in `globals.css`,
  no `tailwind.config.js`)
- **Supabase** — auth (`@supabase/ssr`) now; Postgres for application data
  once the schema exists (see Known Gaps)
- One codebase, fully responsive — no separate mobile app

## The four experiences

| Experience | Route(s) | Status |
|---|---|---|
| Public Website | `(marketing)` route group — `/`, `/pricing` | Home + Pricing built; several sections from the approved marketing artifact (Interactive Workflow, Live Product Preview, Financial Intelligence, Comparison, Trust bar, FAQ, Platform Vision) not yet ported |
| Authentication | `(auth)` route group (`/login`, `/forgot-password`, `/reset-password`) + `/auth/confirm`, `/setup`, `/platform/account` | Full workflow implemented — login (with Remember Me), forgot/reset password, change password, sign out, Invite User (Admin API), first-run Platform Super Administrator bootstrap; UI and Supabase Auth calls fully wired, blocked on real project credentials for live verification (see Known Gaps) |
| Platform Workspace | `/platform` | Shell + all specified panels (My Companies, Active Clients, Recent Activity, Notifications, Subscription & Licences, Profile, Support) built on mock data |
| Financial Workspace | `/company/[companyId]/*` | Shell + **Dashboard** (mock data, the frozen design reference) + **Supplier Reconciliation** + **Bank Accounts** (both full Repository/Service/API/UI stacks, real Supabase schema + RLS, unit + component tested). Remaining modules are nav placeholders — see MIGRATION_ROADMAP.md |

## Design system — Enterprise Design System (current, frozen)

Superseded the original emerald/gold/paper-grey system per the Product
Review Board's "Enterprise Design System Rollout" instruction. One fixed
identity, not a togglable light/dark theme: dark executive framing (canvas,
nav, hero sections) with bright white "paper" operational surfaces
(tables, forms, reports) floating on top of it — both present on the same
screen simultaneously, everywhere in the app and on the marketing site.

Tokens live in `src/app/globals.css`, layered onto Tailwind v4 via
`@theme inline` (`bg-vf-canvas`, `bg-vf-charcoal`, `text-vf-red-400`,
`bg-vf-paper`, `text-vf-ink`, etc. become real utility classes):

- **Canvas** (`vf-canvas` / `vf-canvas-raised`) — near-black page
  background and nav/header bars.
- **Executive red** (`vf-red-300` through `vf-red-900`) — hero gradients
  (`from-vf-red-500 to-vf-red-700` for buttons, `to-vf-red-900` for hero
  cards), priority indicators, focus rings. The platform's one accent hue.
- **Paper** (`vf-paper` / `vf-paper-alt` / `vf-paper-border`) — white
  operational surfaces; `vf-ink*` is the text triad used only on paper.
- **On-dark** (`vf-on-dark*` / `vf-dark-border*`) — the text/border triad
  used only on canvas/charcoal/hero surfaces. Paper and dark text tokens
  are never mixed on the same background.
- Semantic (`vf-success`/`vf-warning`/`vf-danger`/`vf-info`/`vf-purple`/
  `vf-orange`) — for status badges and report charts; kept separate from
  the brand red so "danger" and "brand accent" can still be told apart in
  code even though they currently share a hue.
- `.vf-glass` — the one reusable "premium glass" treatment
  (`backdrop-filter: blur`), applied deliberately to the two places the
  PRB calls out (sticky nav over a dark hero, workspace header bars) and
  nowhere else, so it reads as a considered accent rather than a default.

**Card hierarchy** (`Card` component, `tone` prop) is the platform's
structural language, used identically everywhere:
- `tone="hero"` — Level 1, deep red gradient, large executive moments (one
  per page, typically the first thing under the header).
- `tone="dark"` — Level 2, charcoal, for statistic/KPI tiles.
- `tone="paper"` (default) — Level 3, white, for tables/forms/reports/lists
  — the actual working surface.

**Page rhythm**: Header → Executive Hero → Statistics → Primary Workspace
→ Secondary Workspace → Quick Actions → Footer Status, applied
"approximately" (per the PRB's own wording) on Dashboard, Platform
Workspace, and Supplier Reconciliation — the three pages rebuilt against
this system so far (see the Migration Roadmap's per-module status).

Typography (serif display / sans body / mono financial figures) and the
reconciliation-demo animation were kept from the previous system — the PRB
instruction addressed color/surface/card hierarchy, not type or motion —
just re-pointed at the new palette (the pipeline pulse now reads in
executive red instead of antique gold).

Shared components live in `src/components/ui/` (`Button` — 4 variants,
`primary`/`ghostDark` for dark or red surfaces, `subtle` for paper
surfaces, `outline` for dark-canvas secondary actions; `Card`, `Badge`,
`Section`, `StatTile` — `tone` prop for paper/dark context) and are used
identically across all four experiences, per the PRB's "one component
library" instruction. No Modal or Chart component exists yet — none of the
built pages use one; add real ones against real usage when a module
actually needs them, not speculatively.

## Authentication

- `src/proxy.ts` (Next 16's renamed `middleware.ts`) does an **optimistic**
  check on every request to `/platform/*` and `/company/*`: unauthenticated
  requests are redirected to `/login`. Per Next's own guidance this is not
  a full authorization solution.
- Each protected layout (`src/app/platform/layout.tsx`,
  `src/app/company/[companyId]/layout.tsx`) does the **authoritative**
  server-side check via `supabase.auth.getClaims()`.
- Existing business logic does not perform authentication — this is the one
  layer that does, per Part 6 of the PRB instruction.

### Preview Mode

No real Supabase project exists yet in this environment (see Known Gaps).
Rather than either (a) bypass auth unconditionally, or (b) leave the
protected routes permanently unreviewable behind a redirect loop that can
never resolve without live credentials, both the proxy and the protected
layouts check `src/lib/supabase/is-configured.ts`. While
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are unset, the
protected routes render with mock data and a visible "Preview Mode" banner
instead of redirecting. This is not a security bypass: there is nothing to
bypass until a backend exists to protect it. The moment real credentials are
set, this branch stops applying automatically and real auth enforcement
takes over — no code change required.

## API layer (mandatory separation)

Part 10 of the PRB instruction requires: **Browser → API → Services →
Business Logic → Database**, and states "the interface must never
communicate directly with the database."

**Supplier Reconciliation and Bank Accounts now demonstrate the real
pattern**, and every later module should copy it:

    Browser (client component)
      -> fetch("/api/companies/[companyId]/supplier-reconciliation/...")
        -> src/app/api/companies/[companyId]/supplier-reconciliation/**/route.ts
          -> src/server/services/supplier-reconciliation-service.ts
            -> src/server/repositories/supplier-reconciliation-repository.ts
              -> Supabase (`ae_*` tables, RLS-enforced)

The one nuance: **Server Components fetching their own initial data call
the Service layer directly** (`page.tsx` calls `buildDashboardCounts()` — see
`src/server/accounting/reconciliation-reports.ts` — in-process, not over
HTTP to its own API route). This still goes through Service → Repository →
Supabase and never touches `supabase.from(...)` directly from a
component; the PRB's "Browser -> API Route" hop specifically concerns
client-side/browser calls (the "Generate Supplier Allocation Reports"
button, the report viewer's tab switches), which do go through the real
API routes via `fetch()`. Calling Supabase directly from a Server
Component (skipping Service/Repository) would violate the mandate; calling
a Service function directly from a Server Component (skipping only the
self-referential HTTP hop) does not.

Every API route also does its own authoritative session check
(`src/server/auth/require-session.ts`) rather than relying solely on RLS or
on `proxy.ts` — `proxy.ts`'s matcher only covers page navigations under
`/platform` and `/company`, not `/api/**`, so an API route with no check of
its own would be reachable unauthenticated (RLS would still block real
data access, but the response would be a confusing empty result instead of
a clean 401).

Platform Workspace and the Dashboard module still import mock data directly
into Server Components (no repository/service layer exists for them yet) —
that remains a deliberate, temporary scaffold for those two, not a pattern
to copy; Supplier Reconciliation is the reference example now.

## Data architecture

Part 5 specifies the tenancy hierarchy: **Platform → Organisation → Company
→ Financial Year → Transactions → Merchant Rules → Reports**, with every
company isolated. Three migrations exist under `supabase/migrations/`,
ready to run the moment a real Supabase project is connected (see Known
Gaps — nothing has actually been applied to a live database yet, since
none exists):

- `0001_platform_foundation.sql` — `organisations`, `organisation_members`,
  `companies`, plus a `user_can_access_company(uuid)` SQL function every
  later company-scoped table's RLS policy calls. Financial Year is not yet
  modelled — deferred to whichever module first needs period-based
  scoping.
- `0002_supplier_reconciliation.sql` — `ae_suppliers`, `ae_imported_bills`,
  `ae_bank_transactions`, `ae_match_history`, `ae_allocation_history`,
  `ae_work_items`, ported field-for-field from the reference
  implementation's `accounting_engine/models.py` (see
  MIGRATION_ROADMAP.md's "Supplier Reconciliation status in detail" for
  the full mapping and the one deliberately-deferred piece, import
  parsing).
- `0003_bank_accounts.sql` — `ae_bank_accounts`, plus an `alter table` that
  adds the `bank_account_id` foreign key to `ae_bank_transactions` (0002
  didn't include it — Bank Accounts wasn't a module yet when it was
  written). Migrations are allowed to extend earlier ones this way; there
  is no expectation that a table's final shape is fully decided in the
  migration that first creates it.

Every table has RLS enabled with a policy of the same shape: a row is
visible/writable only to a member of the organisation that owns its
`company_id`. History tables (`ae_match_history`, `ae_allocation_history`)
share this policy despite being logically append-only — insert-only
behaviour is enforced by the repository layer, not by RLS, since Postgres
RLS doesn't distinguish "insert-only" from "all" without a separate
`with check` clause a future pass could add if this ever needs tightening.

## Known Gaps

1. **No Supabase project — provisioning is one interactive step away.** A
   real "Supabase" integration exists in the Vercel Marketplace (verified
   via `vercel integration discover supabase`: Postgres + Auth + Storage).
   Provisioning it needs `vercel login`, which is an interactive OAuth flow
   that cannot run headlessly — this is the one step that genuinely needs a
   human. Once logged in, `vercel link` then
   `vercel integration add supabase --yes` completes the rest, followed by
   `vercel env pull` and running every migration in
   `supabase/migrations/` (32 as of RC1 Phase 7.5). `.env.local.example`
   documents the 3 env vars this unblocks — the two `NEXT_PUBLIC_*`
   Supabase vars, plus `SUPABASE_SERVICE_ROLE_KEY` (needed only for
   Invite User and `/setup`'s first-administrator bootstrap, both of
   which call the Supabase Auth Admin API — see
   `src/lib/supabase/admin.ts`). Until then, every `supabase.auth.*` /
   `supabase.from(...)` call fails at the network layer and every
   protected route runs in Preview Mode. One additional one-time
   dashboard step once a project exists: Supabase's Auth Email
   Templates need their `ConfirmationURL` pointed at
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=/reset-password`
   so password-reset and invite-accept emails land on this app's own
   `/auth/confirm` route instead of Supabase's default hosted redirect
   — a Dashboard setting, not a code or database change.
2. **Nine of eleven Financial Workspace modules are unbuilt.** Dashboard
   and Supplier Reconciliation exist; the rest are visible-but-disabled nav
   entries. See MIGRATION_ROADMAP.md for source references and order.
   Supplier Reconciliation itself is schema/engine/API-complete but not yet
   *operationally* complete — it has no way to import real bills/bank
   statements until Module 5 (Imports) exists (see MIGRATION_ROADMAP.md).
3. **Marketing site is a partial port.** Home and Pricing only; several
   approved-artifact sections are not yet in the Next.js app.
4. **`npm audit` reports 12 high-severity findings**, all confirmed to be
   transitive dev-tooling dependencies (eslint's `minimatch` chain; Next's
   bundled `postcss`/`sharp`), not reachable at runtime. `npm audit fix
   --force`'s suggested fix downgrades `next`/`eslint` to unrelated major
   versions and was deliberately not run.
