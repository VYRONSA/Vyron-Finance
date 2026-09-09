# VYRON FINANCE — Database Architecture

RC2 Phase 12 deliverable. Live-verified counts as of migration `0037` (37 migrations total).

## Headline counts (queried directly from the live schema, not estimated)

| Object | Count |
|---|---|
| Tables | 119 |
| Primary keys | 119 (every table has one — 1:1) |
| Foreign keys | 245 |
| Unique constraints | 47 |
| Check constraints | 1,176 |
| Indexes | 335 (+13 added in migration `0037`) |
| RLS policies | 153 |
| Triggers | 0 |
| Views | 0 |
| Functions (RPCs) | 14 |
| Migrations | 37 |

**No triggers, no views — deliberately.** Every business rule lives in the TypeScript service layer or in one of the 14 `security definer` RPC functions, never in a trigger a future developer could miss. Every read goes through PostgREST against base tables directly (or a handful of aggregate RPCs like `fn_trial_balance`), never a view — keeping the "what query actually ran" always traceable to a single repository function.

## Naming conventions

- Tables from the original ported accounting engine keep an `ae_` prefix (`ae_journals`, `ae_bank_transactions`, `ae_suppliers`) — a historical artifact of the legacy-engine port, not a current convention; everything built since RC1 Phase 1 uses unprefixed names.
- Every company-scoped table has a `company_id uuid not null references companies(id)` column, indexed (as of migration `0037`, on every one of the 119 tables that has the column).
- Every status-like column uses a `check (status in (...))` constraint rather than a separate lookup/enum table — accounts for the large check-constraint count (1,176) and keeps valid states self-documenting in the schema itself.

## RLS — the real authorization boundary

Every one of the 119 tables has RLS enabled (verified via `pg_class.relrowsecurity`, not assumed). The dominant pattern, used by ~117 of 119 tables:

```sql
create policy "..." on <table> for <op> using (user_can_access_company(company_id));
```

`user_can_access_company(target_company_id)` (defined in `0001_platform_foundation.sql`, rewritten in `0036_tenant_isolation_fix.sql`) is the single function this entire boundary depends on:

```sql
create or replace function user_can_access_company(target_company_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id = target_company_id)
  or exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null);
$$;
```

Two tables (`companies`, `organisations`/`organisation_members`) have their own independent, org-membership-based policies rather than routing through this function — a deliberate, disclosed exception (see `SECURITY_ARCHITECTURE.md` for why fixing `companies`' own SELECT policy risks breaking company creation's own `INSERT ... RETURNING`).

## The 14 RPC functions

| Function | Purpose |
|---|---|
| `user_can_access_company` | The RLS tenant-isolation boundary (above) |
| `user_has_permission` | Fine-grained per-permission-key check, walks the role inheritance chain |
| `bootstrap_organisation` | Atomic first-organisation-and-membership creation (fixes the `INSERT...RETURNING` visibility trap — see `DISASTER_RECOVERY.md`'s incident log) |
| `assign_company_role` | Atomic role assignment + organisation-membership backfill |
| `seed_company_rbac_defaults` | Seeds a new company's 15 system roles |
| `seed_company_defaults` | Seeds a new company's chart of accounts, VAT treatments, posting rules |
| `seed_company_communication_defaults` | Seeds a new company's communication templates |
| `record_permission_audit_entry` | The only write path for `permission_audit_log` |
| `record_automation_audit_entry` | The only write path for `automation_audit_log` |
| `update_document_scan_status` | Document virus-scan status callback |
| `document_permission_module` | Maps a document's entity type to its governing permission module |
| `fn_trial_balance` | Aggregate trial balance computation (server-side, not row-pulled) |
| `fn_account_balance_before` | Opening-balance aggregate for account activity views |
| `fn_transaction_explorer_summary` | Aggregate summary for the Transaction Explorer grid |

The last 3 are the pattern every full-history "pull all rows and reduce in JavaScript" call *should* follow (see `ENTERPRISE_ARCHITECTURE.md`'s Phase 3 finding on the banking-summary engine, which doesn't yet).

## Index strategy

- Every foreign key was audited for a supporting index; 96 raw candidates were found, but only 13 — the `company_id` columns, proven by the universal repository query pattern to be filtered on directly — were added (migration `0037`), following "optimise where evidence supports it, not premptively."
- `gl_transactions` carries a 3-column composite `(company_id, account_id, posting_date)` — a real, considered composite supporting the General Ledger's own account-activity query shape, not a generic single-column index.
- Every unique constraint used for idempotent upserts (`user_role_assignments(user_id, company_id, role_id)`, `sales_invoices(company_id, invoice_number)`, etc.) doubles as its own index — no separate index needed.

## Migration discipline

37 migrations, strictly forward-only — no `down` migration has ever existed in this codebase's history. Once a migration has run against a real database, its file content is never edited; a bug found in an already-applied migration gets a new, corrective migration instead (see `0034`→`0035` in the migration history — `0034` shipped with a real Postgres 42702 bug, caught on the next live call, fixed by `0035` rather than rewriting `0034`). See `RELEASE_PROCESS.md` for the full discipline.
