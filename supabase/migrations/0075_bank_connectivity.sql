-- ---------------------------------------------------------------------
-- Phase 16 — Direct Bank Connectivity Foundation.
--
-- Adds ONLY what the audit in src/server/bank-connectivity/FINDINGS.md
-- confirmed doesn't already exist: connection/consent/token state for a
-- direct bank API (FNB first), and a sync-run log. It deliberately does
-- NOT touch `ae_bank_accounts`/`ae_bank_transactions` — those, and the
-- entire import/dedup/rules/matching/reconciliation pipeline, are reused
-- completely unchanged (see FINDINGS.md §§1-6). A `bank_connection_accounts`
-- row LINKS a provider account to an existing (or newly created)
-- `ae_bank_accounts` row rather than replacing it.
--
-- `bank_oauth_states` protects the OAuth authorization-code flow against
-- CSRF/session-fixation: a single-use, short-lived, cryptographically
-- random token minted right before redirecting the user to FNB, and
-- verified byte-for-byte when FNB redirects back. It is looked up by its
-- own random value BEFORE the requesting user's company is known (that's
-- the whole point — the callback recovers companyId FROM this row), so
-- company-scoped RLS (`user_can_access_company`) cannot apply here the
-- way it does everywhere else in this schema; unguessability (32
-- crypto-random bytes) + single-use consumption + the callback route's
-- own explicit `requirePermission(companyId, ...)` re-check right after
-- reading it are the real controls. RLS is still enabled, restricted to
-- the `authenticated` role (never `anon`), which is what every route
-- that touches this table already requires via `requireSession()`.
-- ---------------------------------------------------------------------

-- `bank_connection_id` is added by an `alter table` further down (once
-- `bank_connections` exists) rather than a forward reference here.
create table bank_oauth_states (
  state text primary key,
  company_id uuid not null references companies (id) on delete cascade,
  provider text not null check (provider in ('FNB')),
  redirect_after text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

alter table bank_oauth_states enable row level security;
create policy "authenticated users can access oauth state rows" on bank_oauth_states
  for all to authenticated using (true) with check (true);

-- One row per authorized bank connection (one OAuth grant, which may
-- cover several accounts). Token columns store the OUTPUT of
-- src/server/bank-connectivity/token-encryption.ts's AES-256-GCM
-- envelope — never plaintext. `environment` distinguishes VYRON's own
-- deployment context; FNB's public API documentation does not mention a
-- sandbox/test environment (confirmed in FINDINGS.md §14), so this is
-- NOT a claim that FNB provides one — 'development' here only means
-- "this connection was created against VYRON's own dev/staging
-- deployment," not a bank-provided test mode.
create table bank_connections (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  provider text not null check (provider in ('FNB')),
  environment text not null default 'production' check (environment in ('development', 'production')),
  status text not null default 'PendingAuthorization' check (status in ('PendingAuthorization', 'Connected', 'Disconnected', 'Error')),
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  -- Whatever scope string the provider's token response actually
  -- returns — never a hand-authored guess at scope names (FINDINGS.md
  -- §14: OAuth scope names are not published).
  granted_scope text,
  last_health_check_at timestamptz,
  last_health_check_status text check (last_health_check_status in ('Ok', 'Error')),
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disconnected_at timestamptz
);

create index bank_connections_company_id_idx on bank_connections (company_id);

alter table bank_connections enable row level security;
create policy "members can access their company's bank connections" on bank_connections
  for all using (user_can_access_company(company_id));

-- Links a state token to the specific pending connection it was minted
-- for, so the callback can recover BOTH company_id and the exact
-- bank_connections row to authorize without any "most recent pending
-- connection" guesswork.
alter table bank_oauth_states add column bank_connection_id bigint references bank_connections (id) on delete cascade;

-- One row per FNB account the customer explicitly selected/consented to
-- during onboarding (Part 6's "customer selects/links accounts" step),
-- linked to the EXISTING `ae_bank_accounts` row that receives its
-- transactions. `provider_account_id` is FNB's own account identifier —
-- never VYRON's account number — so sync requests can address the
-- correct upstream account without re-deriving it.
create table bank_connection_accounts (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  bank_connection_id bigint not null references bank_connections (id) on delete cascade,
  bank_account_id bigint not null references ae_bank_accounts (id) on delete cascade,
  provider_account_id text not null,
  masked_account_number text not null default '',
  account_holder_name text not null default '',
  currency text not null default 'ZAR',
  status text not null default 'Active' check (status in ('Active', 'Disconnected')),
  -- The sync cursor. Advanced ONLY by a successful bank_sync_runs row
  -- (Part 7 #10 / Part 13's "failed sync does not move the cursor") —
  -- never optimistically.
  last_synced_through date,
  last_sync_status text check (last_sync_status in ('Success', 'Failed', 'PartialFailure')),
  last_sync_at timestamptz,
  last_transaction_received_at timestamptz,
  created_at timestamptz not null default now(),
  unique (bank_connection_id, provider_account_id)
);

create index bank_connection_accounts_company_id_idx on bank_connection_accounts (company_id);
create index bank_connection_accounts_bank_connection_id_idx on bank_connection_accounts (bank_connection_id);
create index bank_connection_accounts_bank_account_id_idx on bank_connection_accounts (bank_account_id);

alter table bank_connection_accounts enable row level security;
create policy "members can access their company's bank connection accounts" on bank_connection_accounts
  for all using (user_can_access_company(company_id));

-- Historical log of every sync attempt (initial and incremental) —
-- distinct from the cursor columns above, which only ever reflect the
-- LATEST successful state. Part 13 requires proving "failed sync does
-- not move the cursor," which is exactly why these are two different
-- places: this table can safely record a Failed run without that run
-- ever touching bank_connection_accounts.last_synced_through.
create table bank_sync_runs (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  bank_connection_account_id bigint not null references bank_connection_accounts (id) on delete cascade,
  sync_type text not null check (sync_type in ('Initial', 'Incremental')),
  status text not null check (status in ('Running', 'Success', 'Failed', 'PartialFailure')),
  range_start date not null,
  range_end date not null,
  transactions_fetched integer not null default 0,
  transactions_imported integer not null default 0,
  transactions_duplicate integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index bank_sync_runs_company_id_idx on bank_sync_runs (company_id);
create index bank_sync_runs_bank_connection_account_id_idx on bank_sync_runs (bank_connection_account_id);

alter table bank_sync_runs enable row level security;
create policy "members can access their company's bank sync runs" on bank_sync_runs
  for all using (user_can_access_company(company_id));

-- Reuses the EXISTING Automation Scheduler (src/server/services/scheduler-service.ts)
-- for recurring sync — the exact same precedent 0052 already used to add
-- 'SubscriptionLifecycleSweep'. No second scheduling mechanism.
alter table automation_tasks drop constraint automation_tasks_task_type_check;
alter table automation_tasks add constraint automation_tasks_task_type_check
  check (task_type in ('RecurringTemplate', 'RuleEngineRun', 'ReportRefresh', 'CommunicationQueue', 'Custom', 'SubscriptionLifecycleSweep', 'BankSync'));
