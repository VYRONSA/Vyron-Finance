-- Phase 21B — Inbound Bank Statement Email: identity foundation only.
-- No inbound processing exists yet (no webhook, no parser, no import
-- trigger) — this migration only gives each company a stable, unique
-- identifier a future inbound-email pipeline can resolve back to a
-- companyId. See docs/PHASE_21A_INSPECTION (chat report) for the full
-- architecture; Phase 21C+ will build the actual receiving pipeline on
-- top of this table, reusing the existing Import Centre engine
-- unchanged.
--
-- Deliberately a dedicated table, not new columns on `companies` —
-- matching this repo's own established pattern for a company-scoped,
-- security-relevant extension (see 0076_company_branding.sql). The full
-- email address is NOT stored — it is always constructed from
-- `stable_identifier` + the app's configured inbound domain
-- (`VYRON_BANK_IMPORT_EMAIL_DOMAIN`), so a future domain change never
-- requires a data migration or risks a stored address going stale.

create table company_bank_statement_email (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  stable_identifier text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Operational timestamps — nullable, no default. null means "never
  -- happened yet", not "unknown" — set only once a future inbound
  -- pipeline actually receives/imports/fails a statement.
  last_received_at timestamptz,
  last_successful_import_at timestamptz,
  last_failure_at timestamptz,
  constraint company_bank_statement_email_company_id_key unique (company_id),
  constraint company_bank_statement_email_stable_identifier_key unique (stable_identifier)
);

create index company_bank_statement_email_company_id_idx on company_bank_statement_email (company_id);

alter table company_bank_statement_email enable row level security;

-- Read is plain company access (same as viewing any other Settings
-- data) — the address is not a secret, and lazily materializing the row
-- on first view (see the service layer) is a read-shaped operation, not
-- a business mutation, so it uses the same check as the SELECT policy.
create policy "read company bank statement email with company access" on company_bank_statement_email for select
  using (user_can_access_company(company_id));
create policy "create company bank statement email with company access" on company_bank_statement_email for insert with check (
  user_can_access_company(company_id)
);

-- Update/delete are reserved for a future explicit change (e.g.
-- regenerating the identifier) — gated by the stricter Settings:Edit
-- permission, the same permission that already protects every other
-- Company Settings write. No code path calls these yet in Phase 21B.
create policy "update company bank statement email with Settings Edit permission" on company_bank_statement_email for update using (
  user_has_permission(company_id, 'Settings:Edit')
);
create policy "delete company bank statement email with Settings Edit permission" on company_bank_statement_email for delete using (
  user_has_permission(company_id, 'Settings:Edit')
);
