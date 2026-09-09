-- Platform Foundation: the minimal Organisation -> Company tenancy layer
-- every later module (starting with Supplier Reconciliation) depends on.
-- Part 5 of the SaaS Platform Foundation instruction specifies the full
-- hierarchy Platform -> Organisation -> Company -> Financial Year ->
-- Transactions -> Merchant Rules -> Reports; this migration establishes
-- only the first two levels plus membership, since that's what Row Level
-- Security on every company-scoped table below needs to exist first.
-- Financial Year is intentionally deferred to whichever module first
-- needs period-based scoping.

create extension if not exists "pgcrypto";

create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table organisation_members (
  organisation_id uuid not null references organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

create table companies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  name text not null,
  industry text not null default '',
  status text not null default 'onboarding' check (status in ('active', 'needs-attention', 'onboarding')),
  created_at timestamptz not null default now()
);

create index companies_organisation_id_idx on companies (organisation_id);

alter table organisations enable row level security;
alter table organisation_members enable row level security;
alter table companies enable row level security;

-- Membership is the root of every RLS check below: a user can read/write
-- an organisation (and everything under it) only if they have a row here.
create policy "members can view their organisation"
  on organisations for select
  using (id in (select organisation_id from organisation_members where user_id = auth.uid()));

create policy "members can view their own membership rows"
  on organisation_members for select
  using (user_id = auth.uid());

create policy "members can view companies in their organisation"
  on companies for select
  using (organisation_id in (select organisation_id from organisation_members where user_id = auth.uid()));

create policy "admins can manage companies in their organisation"
  on companies for all
  using (organisation_id in (
    select organisation_id from organisation_members
    where user_id = auth.uid() and role in ('owner', 'admin')
  ));

-- Reused by every company-scoped table in later migrations (Supplier
-- Reconciliation and beyond): true iff the current user belongs to the
-- organisation that owns the given company.
create function user_can_access_company(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from companies c
    join organisation_members m on m.organisation_id = c.organisation_id
    where c.id = target_company_id and m.user_id = auth.uid()
  );
$$;
