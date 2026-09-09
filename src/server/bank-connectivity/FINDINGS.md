# Phase 16 — Direct Bank Connectivity: Findings

Audit performed BEFORE any bank-connectivity code was written, per the phase brief's own
Part 1 mandate. Every claim below is either a direct citation of existing code/migrations,
or an explicit citation of FNB's own official documentation (fetched live). Nothing here is
invented — where something could not be confirmed, that is stated explicitly.

## 1. Existing bank account architecture

- **Table**: `ae_bank_accounts` (`supabase/migrations/0003_bank_accounts.sql`). Columns:
  `id`, `company_id`, `account_number`, `account_name`, `bank_name`, `account_type`,
  `branch`, `currency` (default `'ZAR'`), `status` (`Active`/`Archived` — `Inactive` was
  dropped by `0066_bank_account_status_drop_inactive.sql`), `opening_balance`,
  `current_balance`, `last_reconciliation_date`, `notes`, `created_at`. Unique on
  `(company_id, account_number)`. RLS via `user_can_access_company(company_id)`.
- **No provider/connection/external-account columns exist on this table today.** The only
  generic "connection" table in the codebase is `integration_connections`
  (`0012`, widened by `0044_vyron_core_integration_connection.sql`), used exclusively for
  internal VYRON↔VYRON platform links (`VYRON_COST`, `VYRON_CORE`) — not applicable to a
  bank API and not reused directly, though its "idempotent ensure-a-connection-row" pattern
  is a reasonable precedent for shape.
- **Repository**: `src/server/repositories/bank-account-repository.ts` —
  `listBankAccounts`, `getBankAccount`, `findBankAccountByNumber`, `createBankAccount`,
  `updateBankAccount`, `getOrCreateBankAccountByNumber` (find-or-insert by raw account
  number, used by the import pipeline), `getBankAccountStats`,
  `listRecentTransactionsForAccount`.
- **Service**: `src/server/services/bank-account-service.ts` — validation, CRUD,
  `maskAccountNumber` (already exists — reused by Part 9's Connected Banks UI rather than
  reimplemented).

## 2. Existing transaction ingestion path

- **Table**: `ae_bank_transactions` (`0002_supplier_reconciliation.sql`, extended by many
  later migrations). Relevant columns: `company_id`, `transaction_date`, `reference`,
  `description`, `beneficiary`, `debit`, `credit`, `balance`, `bank_account` (text, the raw
  account number as printed on the statement), `bank_account_id` (FK → `ae_bank_accounts`),
  `vat`, `gl_account`, `notes`, `import_batch` (text, joins to `ae_import_batches.batch_id`
  — not an FK), `source_filename`, `allocation_status`, `allocation_type`/`allocation_notes`
  (added by `0062_transaction_allocation_workspace.sql`, a prior phase).
- **Entry point**: `src/server/services/import-service.ts`. Two paths:
  - `importBankStatement()` — single-shot CSV/XLSX/OFX/QIF, dispatched via
    `resolveBankStatementAdapter(filename)` (`src/server/import-centre/bank-statement-adapter-registry.ts`).
  - `previewPdfBankStatement()` / `confirmPdfBankStatementImport()` — PDF review-then-commit,
    dispatched via `resolvePdfBankAdapter(extractedText)` (content-marker based; FNB's own
    letterhead markers — `"FIRST NATIONAL BANK"` / `"FNB.CO.ZA"` — already route to a real,
    existing `fnb-pdf` adapter, `src/server/import-centre/parsers/fnb-bank-statement-parser.ts`).
  - Both paths funnel through the private `commitBankTransactions()` helper in
    `import-service.ts`, which calls `bankAccountRepo.getOrCreateBankAccountByNumber()` per
    row, then `importRepo.ingestBankTransactionIdempotent()`
    (`src/server/repositories/import-repository.ts`) to insert.
  - Both paths insert one `ae_import_batches` row (`importRepo.insertImportBatch`,
    `import_type` constrained to `'bills' | 'bank_transactions'` — no schema change needed
    for a bank-feed sync, since it produces the exact same kind of row).
  - Both paths call `applyRulesToTransactions()` (`rule-processing-service.ts`) against only
    the newly-created transaction ids once committed — this is what triggers Banking Rules
    and (via the same pass) Banking Exceptions.
- **Normalised row shape parsers must produce**: `ParsedBankTransaction`
  (`src/server/import-centre/types.ts`) — `transactionDate`, `reference`, `description`,
  `beneficiary`, `debit`, `credit`, `balance`, `bankAccount` (raw account number),
  `vat`, `glAccount`, `notes`, `sourceFilename`, `importBatch`, `rowNumber`. This is the
  exact shape the FNB provider's mapper must produce — no new ingestion shape is introduced.

## 3. Existing deduplication mechanism

A real Postgres **unique constraint**, not application-level hashing:
`ae_bank_transactions_natural_key` unique on
`(company_id, bank_account, transaction_date, reference, debit, credit, description)`
(`0004_import_centre.sql`). `ingestBankTransactionIdempotent()` inserts optimistically and,
on a unique-violation, re-selects the same tuple and returns `{ created: false }` — the
caller (batch commit) counts it as a duplicate rather than erroring. **This is reused
unchanged.** Since FNB's Transaction History API returns each transaction's own bank-issued
transaction ID, the FNB mapper puts that ID into `ParsedBankTransaction.reference` — giving
every synced row a real, stable, bank-issued value in exactly the field the existing natural
key already dedupes on, which is a stronger dedup signal than several existing CSV parsers
get from a statement that prints no reference at all.

## 4. Company/bank-account linkage

Every `ae_bank_transactions` row carries a direct `company_id` and a `bank_account_id`
resolved once per distinct account number and cached for the batch
(`resolveBankAccountId` closure inside `commitBankTransactions`). For the FNB flow this
resolution is even simpler: the user explicitly links a specific FNB account to a specific
existing (or newly created) `ae_bank_accounts` row during the "select accounts" onboarding
step (Part 6), so the sync service already knows `bank_account_id` up front and never needs
the by-number lookup/auto-create path import files use.

## 5. Transaction Explorer's data access

`src/app/company/[companyId]/transactions/page.tsx` →
`src/server/services/transaction-explorer-service.ts` (wrapping
`src/server/repositories/transaction-explorer-repository.ts`). Fetch:
`listTransactions()` → `queryTransactions()` (cursor-paginated). Update one row:
`allocateRow()` (sets `allocation_type`/`allocation_notes` plus the matched field) and the
per-field `assignSupplier`/`assignGl`/`assignVat`/`assignMerchant`/`assignCustomer`. Bulk:
`applyBulkReview()` → repo bulk-assign functions plus `applyRule()`/
`applyRulesToRemainingBatchTransactions()`. **None of this needs to change** — a row
inserted by the FNB sync path is indistinguishable, once committed, from a row inserted by
a manual import; Transaction Explorer already reads every row the same way.

## 6. Banking Rules / Matching / Reconciliation / Banking Exceptions

| Subsystem | Service | Table(s) | Trigger |
|---|---|---|---|
| Banking Rules | `banking-rule-service.ts` + `rule-processing-service.ts` | `banking_rules`, `banking_rule_conditions`, `banking_rule_actions`, `banking_rule_versions`, `banking_rule_applications` (`0013`) | Automatic, right after every import commit (`applyRulesToTransactions`), plus user-triggered ad hoc |
| Matching | `matching-queue-service.ts`, `supplier-matching-service.ts`, `customer-matching-service.ts` | `ae_match_history`, `matching_overrides`, `bank_transaction_splits`, `merchant_merges`, `party_merges` (`0023`) | Mostly user-triggered from the Matching Centre; some signal produced during rule evaluation |
| Reconciliation | `bank-reconciliation-service.ts` | `bank_reconciliations` (`0022`) | User-triggered only (`startReconciliation`/`autoMatch`/`completeReconciliation`) |
| Banking Exceptions | `banking-exception-service.ts` + `banking-exception-repository.ts` | `banking_exceptions` (`0013`) | Automatic, idempotent (`raiseExceptionIdempotent`), inside the same post-import rule pass |

**Implication**: none of these four subsystems need any code change for direct bank
connectivity — they already run automatically on any newly-created transaction row,
regardless of source.

## 7. Company/tenant isolation

Two independent layers on every company-scoped table, both real:

- **DB (RLS)**: every table checked (`ae_bank_accounts`, `integration_connections`,
  `billing_provider_connections`, …) has `enable row level security` plus a policy using
  the shared `user_can_access_company(company_id)` helper. A dedicated hardening pass
  exists: `0036_tenant_isolation_fix.sql`, `0037_missing_company_id_indexes.sql`.
- **App (repository)**: every repository query still explicitly filters
  `.eq("company_id", companyId)` even though RLS also enforces it — defense in depth,
  documented directly in `bank-account-repository.ts`'s own header.

Both layers apply automatically to any new bank-connectivity table that follows the same
`company_id uuid references companies(id)` + RLS-policy pattern — reused unchanged.

## 8. Permission model

`src/server/permissions/types.ts`: `PermissionKey = ModulePermissionKey | GlobalPermission`,
where `ModulePermissionKey = ${PermissionModule}:${ModuleAction}`. `"Banking"` is already a
`PermissionModule`, and `MODULE_ACTIONS` includes `View`/`Create`/`Edit`/`Delete`/etc. — so
`"Banking:View"`, `"Banking:Create"`, `"Banking:Edit"` already exist as real, seeded
permission keys. **No new `PermissionKey` is introduced** — bank-connectivity routes reuse
these exactly, the same way every other Banking-module route already does, via
`requirePermission(companyId, "Banking:Edit")` etc. (`src/server/services/permission-service.ts`).

## 9. Encryption / secret-handling utilities

**Confirmed: nothing exists.** An exhaustive grep for `encrypt`, `decrypt`, `crypto`, `AES`,
`createCipheriv` under `src/` returned zero matches. A grep for `encrypted`/`vault`/`secrets`
across all 74 `supabase/migrations/*.sql` files also returned zero matches. There is no
encrypted-secrets table and no crypto utility module anywhere in this codebase. Existing
secrets (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`) are read directly from
`process.env` with no DB storage at all.

**Per the brief's own Part 4 instruction ("if it does not exist, STOP before inventing an
insecure storage mechanism and report exactly what is required")**: this phase adds one new,
narrowly-scoped module, `src/server/bank-connectivity/token-encryption.ts`, implementing
AES-256-GCM envelope encryption (Node's built-in `crypto` module, no new dependency) keyed
by a new required server-only secret, `BANK_TOKEN_ENCRYPTION_KEY` (documented in
`.env.local.example`). This is a genuinely new piece of infrastructure — not a reuse of
anything pre-existing — and is called out explicitly in the final report as such.

## 10. Scheduled/background job infrastructure

**No `vercel.json`/`vercel.ts`, no cron files, no `pg_cron` migration exist anywhere.** The
real, working mechanism is a single shared in-app queue:
`src/server/services/scheduler-service.ts` ("the ONE shared queue every scheduled activity
in the platform executes through"), backed by `automation_tasks` rows
(`src/server/repositories/automation-task-repository.ts`, `AutomationTaskType` union in
`src/server/automation/types.ts`). `runDueTasks(companyId, nowIso)` dispatches by
`task.taskType` inside `runTask()`; existing types are `RecurringTemplate`, `RuleEngineRun`,
`ReportRefresh`, `CommunicationQueue`, `Custom`, `SubscriptionLifecycleSweep` — the last one
added by exactly the precedent this phase follows
(`0052_billing_subscription_lifecycle_sweep_task.sql`: widen the `task_type` check
constraint, add one `runTask()` branch, zero new scheduling mechanism).

The module's own docstring is explicit that real unattended execution still needs an
external trigger (Vercel Cron or Supabase `pg_cron`) hitting a cron-secured route — **no such
route/config exists in this repo today**; the manual "Run Scheduler Now" action is the only
currently-working trigger. This phase adds `'BankSync'` as one more `AutomationTaskType` and
one more `runTask()` branch, following the `SubscriptionLifecycleSweep` precedent exactly —
it does not add a cron route (out of scope; same honest boundary the scheduler's own
docstring already draws for every other task type).

## 11. API route conventions

Every mutation route under `src/app/api/companies/[companyId]/**/route.ts` follows the same
shape (e.g. `recurring-templates/[templateId]/generate-now/route.ts`):
1. `const session = await requireSession(); if (!session.ok) return session.response;`
2. `const { companyId } = await params;`
3. `const check = await requirePermission(companyId, "<PermissionKey>"); if (!check.ok) return check.response;`
4. Parse body, call one service function, `try/catch` mapping the service's own
   `ValidationError` to a 400.
5. `NextResponse.json(...)`.

Reused verbatim by every new bank-connectivity route in this phase.

## 12. OAuth / third-party integration precedent

**None exists.** No `/callback` route, no redirect-based third-party auth flow anywhere in
the codebase. Stripe integration is webhook-only (`billing_provider_connections`,
`billing_webhook_events` — idempotency via `unique(provider, provider_event_id)`), not an
OAuth-redirect flow. The authorization-code exchange, callback route, and encrypted token
persistence for FNB are genuinely new — there is no existing code to copy for that part,
only the surrounding conventions (auth/permission gating, RLS-backed tables) to reuse.

## 13. Existing sidebar / Transaction Explorer layout behaviour

`src/components/financial/workspace-shell.tsx` — a single `collapsed` boolean (client
state) controls the one shared `<aside>` sidebar's width (`w-64` normal / `w-[72px]`
collapsed). A `useEffect` already auto-collapses it exactly once, on a genuine client-side
navigation transition INTO `/company/[companyId]/transactions` (guarded by a ref tracking
the previous route, so it doesn't re-fire on every re-render inside the route). Before this
phase, nothing re-expanded it on a sidebar click or re-collapsed it on a return click inside
Transaction Explorer — see Part 11 of this phase for the fix, implemented entirely inside
this one shared file (two new click handlers reusing the same `collapsed` state — no new
shared-state module, no second sidebar).

## 14. FNB API capabilities confirmed from official documentation

> **Phase 17A** — the full, structured CONFIRMED / NOT CONFIRMED / REQUIRED FROM FNB
> audit (including a per-endpoint status table for every URL in `fnb-client.ts`) now
> lives in `src/server/bank-connectivity/providers/fnb/FNB_API_REQUIREMENTS.md`. This
> section is left as originally written below — it remains accurate — but that
> document is the fuller reference going forward, and records that every
> re-verification attempt made in Phase 17A was blocked by FNB's own bot-protection,
> so no new facts were added beyond what's already here.

Fetched live from the exact URL given in the brief:
`https://www.fnb.co.za/integration-channel/catalogue/serviceCatalogue-ZA/services.html?catalogue=serviceCatalogue-ZA&service=Transaction-History&type=API`

- **Customer segments supported**: "business, commercial, corporate and investment
  customers in South Africa."
- **Data retrieved**: transaction lists (transaction ID, value date, booking date,
  transaction details, reference, amount, currency, debit/credit indicator, balances) and
  account balance details for a specified date range on chosen accounts.
- **Authentication**: JWT-signed tokens using a client ID + client secret issued at
  subscription time.
- **Authorization**: OAuth 2.0, authorization-code flow. Two documented connection models:
  *direct connection* (client to API) and *third-party connection* (with explicit consent
  management) — VYRON is a third-party connection.
- **Access tokens**: obtained via an OAuth 2.0 token endpoint using an authorization code or
  a refresh token; tokens have a defined lifespan and support refresh.
- **Data retrieval method**: **polling only** — "Our APIs use polling method, which allows
  you to query the API at regular intervals to check for new data." No push/webhook
  mechanism is documented for this API.
- **Protocol/format**: REST over HTTP, JSON, described against an OpenAPI Specification.
- **Accepted parameters**: selectable account identifiers, a required date range.
- **NOT documented on this page** (and not fabricated here): specific base URLs or endpoint
  paths, OAuth scope names, rate limits, or a sandbox/test environment.
- **Onboarding**: requires either existing Online Banking Enterprise™ user status, or
  completing platform registration — either self-service ("unassisted", via the Integration
  Channel) or "assisted" (via a Digital Profile Manager / Transactional Portfolio Manager /
  Implementation Manager). **No sandbox is mentioned anywhere on this page.**

**FNB Real Time Notifications API — investigated, NOT confirmed.** The brief asked this to
be inspected (not implemented) to see whether it could later reduce/replace polling. The
Integration Channel's general landing page (`/integration-channel/index.html`) and its
catalogue index (`/integration-channel/catalogue/serviceCatalogue-ZA/`) are both protected
by Radware bot-verification and returned only a "verifying your browser" interstitial on
every fetch attempt (multiple retries) — no real content was ever served. A direct guess at
an analogous catalogue URL (`service=Real-Time-Notifications`) also returned only the same
bot-verification screen. A web search surfaced no independent documentation of this specific
API either. **Conclusion: this phase cannot confirm what the Real Time Notifications API
does, its delivery mechanism, or its authentication model — this must be confirmed during
FNB developer onboarding before it is evaluated as a polling optimisation.** It is not
implemented, and its viability is not claimed either way.

## 15. Information still requiring FNB developer onboarding/credentials

> **Phase 17A** — superseded by the fuller "REQUIRED FROM FNB" list (15 items) in
> `src/server/bank-connectivity/providers/fnb/FNB_API_REQUIREMENTS.md`. This list is
> left as originally written below for the record.

- Actual base URL(s)/endpoint paths for the Transaction History API (not published on the
  public catalogue page).
- OAuth 2.0 client ID and client secret (issued at subscription).
- The exact authorization endpoint, token endpoint, and redirect-URI registration process.
- Confirmation of whether any sandbox/test environment exists (not mentioned in the public
  documentation; the brief explicitly says not to assume one).
- OAuth scope names.
- Documented rate limits.
- Full technical detail on the Real Time Notifications API (see §14).

Nothing in this list is fabricated or assumed anywhere in this phase's implementation — see
the final report's "must not be claimed as working" section.
