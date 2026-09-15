-- P0 security remediation — platform bootstrap hardening.
--
-- Before: `POST /api/setup/bootstrap` (unauthenticated) checked "does a
-- platform_super_administrator assignment exist?" and then, as a separate
-- step, created an already-confirmed account and inserted the assignment.
-- The check and the write were not atomic, and nothing in the database
-- recorded that bootstrap had happened. The route itself is now off by
-- default and secret-gated (see `src/app/api/setup/bootstrap/route.ts`);
-- this migration makes the database side atomic and one-shot.
--
-- Lifecycle. Bootstrap INVITES the configured owner address: Supabase
-- sends the invitation and the invitee sets their own password from the
-- link, so no bootstrap caller ever chooses or knows the administrator's
-- password. Bootstrap is COMPLETE only once that invited administrator has
-- verified the address — once a platform_super_administrator exists whose
-- email is confirmed. Until then it is "pending verification": the one
-- pending invitation can be re-sent (same account) or moved to a corrected
-- address (the previous, never-verified account loses the role). Once
-- complete, every further attempt is refused and changes nothing.
--
--  1. `platform_bootstrap_state` — a one-row table (single-value primary
--     key): at most one bootstrap is ever recorded.
--  2. `complete_platform_bootstrap(user, email)` — the ONLY way a platform
--     administrator is assigned. One transaction, serialised by a
--     transaction-scoped advisory lock. It only accepts a fresh invitation:
--     an account that is not yet verified, has no password and has never
--     signed in, whose email is the one requested. So an account created
--     any other way — for example one pre-registered on the owner's address
--     by someone else, with a password they know — can never become
--     platform administrator. An exception rolls the whole call back.
--  3. All three functions are executable by the service role ONLY — the
--     public Supabase API (anon, authenticated) cannot call them, and no
--     API role can read or write the state table directly.
--  4. `system_events` gains the `PlatformBootstrapAttempt` event type, the
--     existing security-event mechanism every attempt is recorded through.
--
-- Touches no accounting data. Re-runnable: every object is created with
-- if-not-exists / create-or-replace / drop-if-exists.

create table if not exists platform_bootstrap_state (
  singleton boolean primary key default true check (singleton),
  invited_at timestamptz not null default now(),
  last_invited_at timestamptz not null default now(),
  platform_admin_user_id uuid not null references auth.users (id) on delete restrict,
  platform_admin_email text not null
);

alter table platform_bootstrap_state enable row level security;
-- Deliberately no policies and no table privileges for any API role: only
-- the security-definer functions below read or write this table.
revoke all on table platform_bootstrap_state from public, anon, authenticated, service_role;

-- Complete = a platform super administrator exists who has verified their email.
create or replace function platform_bootstrap_completed()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from user_role_assignments ura
    join permission_roles pr on pr.id = ura.role_id
    join auth.users u on u.id = ura.user_id
    where ura.company_id is null
      and pr.company_id is null
      and pr.role_key = 'platform_super_administrator'
      and u.email_confirmed_at is not null
  );
$$;

-- 'not_started' | 'pending_verification' | 'completed'
create or replace function platform_bootstrap_status()
returns text
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select case
    when platform_bootstrap_completed() then 'completed'
    when exists (select 1 from platform_bootstrap_state) then 'pending_verification'
    else 'not_started'
  end;
$$;

-- Returns {"outcome": "invited" | "reissued" | "rebound" | "already_completed"}
-- plus "previous_user_id" for "rebound".
drop function if exists complete_platform_bootstrap(uuid, text);
create function complete_platform_bootstrap(target_user_id uuid, target_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  super_admin_role_id bigint;
  account auth.users%rowtype;
  current_state platform_bootstrap_state%rowtype;
begin
  -- Serialise every bootstrap attempt: a concurrent caller waits here
  -- until the first transaction commits or rolls back, then sees its result.
  perform pg_advisory_xact_lock(hashtext('vyron.platform_bootstrap'));

  if platform_bootstrap_completed() then
    return jsonb_build_object('outcome', 'already_completed');
  end if;

  select id into super_admin_role_id
  from permission_roles
  where company_id is null and role_key = 'platform_super_administrator';
  if super_admin_role_id is null then
    raise exception 'The platform_super_administrator role is not seeded.';
  end if;

  select * into account from auth.users u where u.id = target_user_id;
  if not found then
    raise exception 'Unknown user.';
  end if;
  if account.email_confirmed_at is not null
     or coalesce(account.encrypted_password, '') <> ''
     or account.last_sign_in_at is not null then
    raise exception 'bootstrap_account_not_eligible: only a fresh invitation (not verified, no password, never signed in) can become the platform administrator.';
  end if;
  if lower(trim(coalesce(account.email, ''))) <> lower(trim(coalesce(target_email, ''))) then
    raise exception 'bootstrap_account_not_eligible: the account email does not match the bootstrap email.';
  end if;

  -- Every UPDATE below names the single row explicitly: Supabase's API
  -- connections load `safeupdate`, which rejects an UPDATE without WHERE.
  select * into current_state from platform_bootstrap_state for update;
  if found then
    if current_state.platform_admin_user_id = target_user_id then
      update platform_bootstrap_state set last_invited_at = now() where singleton;
      return jsonb_build_object('outcome', 'reissued');
    end if;
    -- The pending administrator never verified (a verified one returns
    -- 'already_completed' above), so the bootstrap moves to this account.
    delete from user_role_assignments
    where user_id = current_state.platform_admin_user_id and company_id is null and role_id = super_admin_role_id;
    update platform_bootstrap_state
    set platform_admin_user_id = target_user_id, platform_admin_email = lower(trim(target_email)), invited_at = now(), last_invited_at = now()
    where singleton;
    insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
    values (target_user_id, null, super_admin_role_id, 'First-run setup');
    return jsonb_build_object('outcome', 'rebound', 'previous_user_id', current_state.platform_admin_user_id);
  end if;

  insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
  values (target_user_id, null, super_admin_role_id, 'First-run setup');
  insert into platform_bootstrap_state (platform_admin_user_id, platform_admin_email)
  values (target_user_id, lower(trim(target_email)));
  return jsonb_build_object('outcome', 'invited');
end;
$$;

revoke execute on function platform_bootstrap_completed() from public, anon, authenticated;
revoke execute on function platform_bootstrap_status() from public, anon, authenticated;
revoke execute on function complete_platform_bootstrap(uuid, text) from public, anon, authenticated;
grant execute on function platform_bootstrap_completed() to service_role;
grant execute on function platform_bootstrap_status() to service_role;
grant execute on function complete_platform_bootstrap(uuid, text) to service_role;

-- Security events: record every bootstrap attempt through the existing
-- Operations Centre mechanism (0030).
alter table system_events drop constraint if exists system_events_event_type_check;
alter table system_events add constraint system_events_event_type_check
  check (event_type in ('PermissionDenied', 'LoginFailed', 'AccountLocked', 'SessionExpired', 'ApiAuthFailure', 'PlatformBootstrapAttempt'));

-- Rate limiting reads recent bootstrap attempts on every request.
create index if not exists system_events_platform_bootstrap_idx on system_events (created_at) where event_type = 'PlatformBootstrapAttempt';
