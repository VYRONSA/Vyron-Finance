-- Commercial Billing Platform — Sub-Phase 0, part 4 of 6. Invoices,
-- payments, refunds, and credits — all keyed off `billing_account_id`
-- (organisation-level; an invoice covers a subscription regardless of
-- which company within the org it's for). `provider`/`provider_*_id`
-- columns are nullable until Sub-Phase 8; unique partial indexes make
-- webhook-driven upserts idempotent by construction, same pattern as
-- `subscriptions.provider_subscription_id` in 0046.

create table invoices (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references billing_accounts (id) on delete cascade,
  subscription_id uuid references subscriptions (id) on delete set null,
  invoice_number text not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'paid', 'void', 'uncollectible')),
  currency_code text not null references currencies (code),
  subtotal numeric(14, 2) not null default 0,
  tax_amount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  amount_paid numeric(14, 2) not null default 0,
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  provider text not null default 'manual' check (provider in ('stripe', 'manual', 'migrated')),
  provider_invoice_id text,
  created_at timestamptz not null default now(),
  unique (billing_account_id, invoice_number)
);
create index invoices_billing_account_id_idx on invoices (billing_account_id);
create unique index invoices_provider_invoice_id_idx on invoices (provider, provider_invoice_id) where provider_invoice_id is not null;

create table invoice_lines (
  id bigint generated always as identity primary key,
  invoice_id uuid not null references invoices (id) on delete cascade,
  description text not null,
  quantity numeric(14, 4) not null default 1,
  unit_amount numeric(14, 2) not null,
  amount numeric(14, 2) not null,
  line_order int not null default 0
);
create index invoice_lines_invoice_id_idx on invoice_lines (invoice_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references billing_accounts (id) on delete cascade,
  invoice_id uuid references invoices (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded')),
  amount numeric(14, 2) not null,
  currency_code text not null references currencies (code),
  failure_reason text,
  provider text not null default 'manual' check (provider in ('stripe', 'manual', 'migrated')),
  provider_payment_id text,
  created_at timestamptz not null default now()
);
create index payments_billing_account_id_idx on payments (billing_account_id);
create unique index payments_provider_payment_id_idx on payments (provider, provider_payment_id) where provider_payment_id is not null;

create table refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments (id) on delete cascade,
  amount numeric(14, 2) not null,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  provider text not null default 'manual' check (provider in ('stripe', 'manual', 'migrated')),
  provider_refund_id text,
  performed_by text not null,
  created_at timestamptz not null default now()
);
create index refunds_payment_id_idx on refunds (payment_id);

create table billing_credits (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references billing_accounts (id) on delete cascade,
  amount numeric(14, 2) not null,
  currency_code text not null references currencies (code),
  reason text not null default '',
  applied_to_invoice_id uuid references invoices (id) on delete set null,
  performed_by text not null,
  created_at timestamptz not null default now()
);
create index billing_credits_billing_account_id_idx on billing_credits (billing_account_id);

alter table invoices enable row level security;
alter table invoice_lines enable row level security;
alter table payments enable row level security;
alter table refunds enable row level security;
alter table billing_credits enable row level security;

-- Read: org members (self-service Customer Portal — "View Invoices",
-- "View Payments") or platform-scope (Internal Console). Write: no
-- policy for invoices/payments/refunds/credits — these are produced by
-- the Billing Engine's own orchestration (subscribe/renew/webhook), not
-- typed directly by a user, so they follow the `currencies`-style
-- "read-open, write-closed to the client" shape; the engine writes them
-- via the session client only where the acting user already owns the
-- underlying `billing_account`/`subscription` (covered by the same
-- read policy, reused for insert via `for all`), and via
-- `createAdminClient()` for the webhook/cron paths that have no session.
create policy "org members can access their invoices" on invoices for all using (
  exists (select 1 from billing_accounts ba join organisation_members om on om.organisation_id = ba.organisation_id
          where ba.id = invoices.billing_account_id and om.user_id = auth.uid())
  or exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)
);
create policy "org members can access their invoice lines" on invoice_lines for all using (
  exists (select 1 from invoices i join billing_accounts ba on ba.id = i.billing_account_id join organisation_members om on om.organisation_id = ba.organisation_id
          where i.id = invoice_lines.invoice_id and om.user_id = auth.uid())
  or exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)
);
create policy "org members can access their payments" on payments for all using (
  exists (select 1 from billing_accounts ba join organisation_members om on om.organisation_id = ba.organisation_id
          where ba.id = payments.billing_account_id and om.user_id = auth.uid())
  or exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)
);
create policy "org members can access their refunds" on refunds for all using (
  exists (select 1 from payments p join billing_accounts ba on ba.id = p.billing_account_id join organisation_members om on om.organisation_id = ba.organisation_id
          where p.id = refunds.payment_id and om.user_id = auth.uid())
  or exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)
);
create policy "org members can access their billing credits" on billing_credits for all using (
  exists (select 1 from billing_accounts ba join organisation_members om on om.organisation_id = ba.organisation_id
          where ba.id = billing_credits.billing_account_id and om.user_id = auth.uid())
  or exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)
);
