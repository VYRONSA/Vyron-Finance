# VYRON FINANCE — Enterprise Architecture

RC2 Phase 12 deliverable. This is the permanent technical reference for how the system is put together — see `ARCHITECTURE.md` for the original design-system and marketing-site notes, `MIGRATION_ROADMAP.md` for the module-by-module build history, and the other 9 documents in this set for security, database, operations, and API detail.

## System shape

```
Browser
  │
  ▼
Next.js App Router (Vercel-deployed, Node.js runtime)
  ├─ Pages (Server Components — fetch data server-side, no client round-trip for initial render)
  ├─ API Routes (src/app/api/**/route.ts — 236 routes)
  └─ proxy.ts (optimistic auth gate on page navigation; authoritative check still happens per-route)
  │
  ▼
Service layer (src/server/services/*.ts — business logic, validation, orchestration)
  │
  ▼
Repository layer (src/server/repositories/*.ts — the only layer that imports the Supabase client)
  │
  ▼
Supabase (Postgres 17-class managed instance)
  ├─ PostgREST — the Data API every repository call goes through
  ├─ GoTrue — Auth (email/password, magic links, admin API)
  ├─ Storage — one private bucket (`documents`), company-scoped via path prefix
  └─ Row Level Security — the real authorization boundary, not a backstop
```

Every layer boundary is enforced by convention, not just documentation: `grep` for `@supabase` imports outside `src/lib/supabase/` and `src/server/repositories/` turns up nothing — the API layer never talks to the database directly, matching the platform's own "Browser → API → Services → Business Logic → Database" mandate from its foundational instruction.

## Tenancy model

**Organisation → Company → everything else.** An Organisation is the accounting-firm-or-business entity; it can own multiple Companies (the accounting-firm-with-many-clients model). Every business record — customers, invoices, journals, documents — belongs to exactly one Company via a `company_id` column.

Two independent membership concepts exist and are both real:
- **`organisation_members`** — the outer RLS gate. `user_can_access_company()` (as of migration `0036`, see `SECURITY_ARCHITECTURE.md`) checks this table for a REAL per-company or platform-scope grant, not raw organisation membership, closing a critical cross-tenant leak found during RC1 Phase 7.6 live certification.
- **`user_role_assignments`** — the fine-grained RBAC layer (see `PERMISSION_MODEL.md`). A user can hold different roles in different companies with zero cross-tenant inheritance.

## The 22 delivered modules

Company Management, Bank Accounts, Import Centre, Transaction Explorer, Supplier Reconciliation, General Ledger, Customer Management, Supplier Management, Sales Platform, Purchasing Platform, Inventory Platform, Banking Automation, Automation Platform, VAT Intelligence, Financial Reporting & Executive Intelligence, Auditor Workspace, Fixed Assets, AI Executive Copilot, Financial Statements & Disclosure Engine, Matching Platform (+ Phase 3 completion), Document Platform, Communication Platform. Full build history and evidence citations for each: `MIGRATION_ROADMAP.md`.

## Shared engines — the "no duplicated business logic" discipline

Verified structurally during RC2 Phase 4, not assumed:

- **One Permission Engine** (`permission-service.ts::requirePermission`/`requireApproval`) — the single implementation every one of 236 API routes imports; no module reimplements authorization.
- **One Posting Engine** (`posting-engine-service.ts::postApprovedJournals`) — the only code path that ever writes to `gl_transactions`. 13 services (Sales, Purchasing, Cashbook, Assets, Inventory, VAT, Recurring Templates, ...) all *build* journal drafts through their own domain logic, then delegate the actual Approved→Posted step to this one function. Confirmed via a full-codebase search for direct `gl_transactions` writes — only the posting engine and its own repository touch that table.
- **11 shared summary functions** (`build*DashboardSummary` in `src/server/services/*-summary-service.ts`) — 8 of them are each called from exactly 2 pages (the Executive Dashboard and that module's own dedicated workspace), guaranteeing the two views can never show different numbers for the same underlying data.

## Performance architecture — what RC2 Phase 1/2/3/5 found and fixed

Live-measured against a real Supabase backend (not estimated):

- The Executive Dashboard previously ran ~12-13 sequential data-fetching barriers per page load even though almost none of them depended on each other's results. Consolidated to 3 genuinely-dependent barriers; server response time dropped from 5.8-6.6s to 3.2-3.9s at baseline data volume (a real, measured ~45-50% reduction).
- A systematic index audit found 13 tables (out of 119) where `company_id` — the column every repository query filters on — was not a leading index column. Fixed (migration `0037`); proven via `EXPLAIN ANALYZE` at realistic multi-tenant scale (50,000 rows, 10% selectivity) to cut query execution time from 4.28ms to 1.53ms and buffer reads from 667 to 73.
- Load-testing at ~250,000 synthetic rows surfaced a genuine scalability defect: the shared banking-automation summary engine (used by 3 pages) computed an all-time automation-rate ratio by pulling a company's *entire* transaction history through an export-oriented, keyset-paginated path. Classified a Launch Blocker by the Product Review Board and fixed (migrations `0039`-`0043`) — replaced with server-side aggregate/RPC queries throughout, verified at 1,000,000 rows (4x the original test scale) with zero regressions. Full before/after evidence: `MIGRATION_ROADMAP.md`'s "Launch Blocker — Banking Automation Summary Engine, resolved" section.

## Where to look next

| Question | Document |
|---|---|
| How is a request authorized end to end? | `SECURITY_ARCHITECTURE.md` |
| What can each role actually do? | `PERMISSION_MODEL.md` |
| What does the schema look like, and why? | `DATABASE_ARCHITECTURE.md` |
| How do I stand up a new environment? | `DEPLOYMENT_GUIDE.md` |
| What happens if something breaks? | `DISASTER_RECOVERY.md`, `OPERATIONS_MANUAL.md` |
| What does route X actually require? | `API_REFERENCE.md` |
| How does billing/licensing/subscriptions work? | `BILLING_ARCHITECTURE.md`, `LICENSING_ENGINE.md`, `FEATURE_FLAGS.md`, `STRIPE_PROVIDER.md`, `COMMERCIAL_OPERATIONS.md` |
| How do I add a 23rd module? | `EXTENSION_GUIDE.md` |
| How does a change go from commit to production? | `RELEASE_PROCESS.md` |
