-- Launch Readiness Programme (LR1) — Critical defect fix (D-018/D-028 in
-- docs/DEFECT_REGISTER.md), found during the Phase 1 Product Audit.
--
-- `subscribeCompanyToPlan` (the Billing Platform's own trial-provisioning
-- path) is only ever called from `createCompany` — no migration backfilled
-- a subscription for companies that already existed before migrations
-- `0045`-`0053` shipped. For any such company, `getEntitlementsForCompany`
-- returns null, `getEntitlements` falls back to deny-by-default zeroed
-- limits, and `hasFeature`/`checkUsageLimit` both return the deny
-- answer — confirmed by code trace to hard-403 the AI Copilot's Ask
-- route and to deny every document upload via `max_storage_mb`, for
-- every real, already-onboarded company the moment this code reaches a
-- database with pre-existing companies. This is a real regression, not
-- a documentation gap, and is fixed here per the Product Review Board's
-- own stated exception for a discovered production defect.
--
-- Fix: backfill a real subscription for every company with no
-- `subscription_companies` row, on the 'enterprise' plan (unlimited
-- entitlements, every feature) — the only honest choice, since these
-- companies had unrestricted access before the Billing Platform existed
-- and downgrading them to a lesser plan without a real product decision
-- would be a second, self-inflicted regression. One `billing_accounts`
-- row per organisation (shared across every company in that org, the
-- same shape `subscribeCompanyToPlan` already uses), one `subscriptions`
-- row per organisation (status 'active', provider 'manual' — no
-- payment was ever collected for this, correctly reflecting reality),
-- linked to every company in that organisation via `subscription_companies`.
--
-- Mirrors the exact backfill-loop pattern already established twice in
-- this codebase's migration history (`0025_rbac_platform.sql`'s
-- `seed_company_rbac_defaults` backfill, `0050`'s `grant_manage_billing_to_company_owner`
-- backfill) — a `do $$ ... for ... loop ... end $$` block, idempotent
-- (skips any company that already has a subscription link).

do $$
declare
  v_company record;
  v_enterprise_plan_id bigint;
  v_billing_account_id uuid;
  v_subscription_id uuid;
begin
  select id into v_enterprise_plan_id from subscription_plans where plan_key = 'enterprise';
  if v_enterprise_plan_id is null then
    raise exception 'enterprise plan not found in subscription_plans — cannot backfill';
  end if;

  for v_company in
    select c.id, c.organisation_id, c.base_currency_code
    from companies c
    where not exists (select 1 from subscription_companies sc where sc.company_id = c.id)
  loop
    -- One billing account per organisation, shared across every company
    -- in it — same shape `getBillingAccountByOrganisation`/`createBillingAccount`
    -- already use for the real trial-provisioning path.
    select id into v_billing_account_id from billing_accounts where organisation_id = v_company.organisation_id;
    if v_billing_account_id is null then
      insert into billing_accounts (organisation_id, billing_email, default_currency_code)
      values (v_company.organisation_id, '', v_company.base_currency_code)
      returning id into v_billing_account_id;
    end if;

    -- One subscription per organisation too (not per company) — a
    -- pre-existing organisation with several companies gets one real
    -- subscription covering all of them, matching how a genuine
    -- Enterprise/Partner subscription already spans multiple companies
    -- via subscription_companies.
    select s.id into v_subscription_id
    from subscriptions s
    join subscription_companies sc on sc.subscription_id = s.id
    join companies c2 on c2.id = sc.company_id
    where c2.organisation_id = v_company.organisation_id
    limit 1;

    if v_subscription_id is null then
      insert into subscriptions (billing_account_id, plan_id, billing_cycle, currency_code, status, provider)
      values (v_billing_account_id, v_enterprise_plan_id, 'monthly', v_company.base_currency_code, 'active', 'manual')
      returning id into v_subscription_id;

      insert into subscription_status_history (subscription_id, from_status, to_status, reason, performed_by)
      values (v_subscription_id, null, 'active', 'Backfilled for a company that existed before the Commercial Billing Platform shipped — preserving full pre-billing access on the Enterprise plan pending a real product decision on legacy-company classification.', 'System (migration 0054)');
    end if;

    insert into subscription_companies (subscription_id, company_id) values (v_subscription_id, v_company.id);
  end loop;
end $$;
