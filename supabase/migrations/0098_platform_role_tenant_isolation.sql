-- P0 security remediation — platform roles no longer imply tenant access.
--
-- Before (0031, 0036): ANY platform-scope role assignment (company_id is
-- null) — platform_super_administrator, platform_administrator, partner,
-- support_technician alike — made:
--   * user_can_access_company(<any company>) true, which gates 87
--     tenant tables' RLS policies (84 of them FOR ALL: read AND write), and
--   * user_has_permission(<any company>, key) true for every key the
--     platform role holds (ManageUsers, RunReports, ...),
-- in every tenant. Platform administration implied unrestricted
-- cross-tenant accounting access, read and write, including through the
-- public Supabase API.
--
-- After:
--   * user_can_access_company(company)       — company-scoped assignments ONLY.
--   * user_has_permission(company, key)      — company-scoped roles ONLY for a
--                                               real company; for company NULL
--                                               (platform-level checks, e.g.
--                                               0032's platform events/alerts)
--                                               it is the platform permission.
--   * user_has_platform_permission(key)      — NEW: a platform-scope role's
--                                               explicit grant.
--   * Cross-tenant accounting access exists only through the explicit,
--     READ-ONLY 'CrossTenantRead' platform permission: one SELECT policy per
--     tenant table below. No role is granted it by this migration.
--   * Billing/licensing platform policies (0046–0050) require the explicit
--     'ManageBilling' platform permission instead of any platform role
--     (so partner/support_technician no longer reach billing either).
--
-- Organisation owners and every company-scoped user keep exactly the access
-- they had: the company-scoped branch of both functions is unchanged.
-- Production has 0 platform-scope assignments, so no current user's access
-- changes. Touches no accounting data (functions and policies only).
-- Re-runnable: create-or-replace functions; drop-if-exists before every policy.

create or replace function user_has_platform_permission(target_permission_key text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with recursive role_chain as (
    select pr.id, pr.parent_role_id
    from permission_roles pr
    join user_role_assignments ura on ura.role_id = pr.id
    where ura.user_id = auth.uid()
      and ura.company_id is null
      and pr.company_id is null
    union
    select parent.id, parent.parent_role_id
    from permission_roles parent
    join role_chain rc on parent.id = rc.parent_role_id
  )
  select exists (
    select 1
    from role_permissions rp
    join role_chain rc on rc.id = rp.role_id
    where rp.permission_key = target_permission_key
  );
$$;

-- RLS policies call this as the signed-in (or anonymous) user, so it must be
-- executable by those roles whatever the project's default privileges are.
-- It only ever reports on the caller's own grants.
grant execute on function user_has_platform_permission(text) to anon, authenticated, service_role;

create or replace function user_can_access_company(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from user_role_assignments ura
    where ura.user_id = auth.uid()
      and ura.company_id = target_company_id
  );
$$;

create or replace function user_has_permission(target_company_id uuid, target_permission_key text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select case
    when target_company_id is null then user_has_platform_permission(target_permission_key)
    else exists (
      with recursive role_chain as (
        select pr.id, pr.parent_role_id
        from permission_roles pr
        join user_role_assignments ura on ura.role_id = pr.id
        where ura.user_id = auth.uid()
          and ura.company_id = target_company_id
        union
        select parent.id, parent.parent_role_id
        from permission_roles parent
        join role_chain rc on parent.id = rc.parent_role_id
      )
      select 1
      from role_permissions rp
      join role_chain rc on rc.id = rp.role_id
      where rp.permission_key = target_permission_key
    )
  end;
$$;

-- ---------------------------------------------------------------------
-- Explicit, READ-ONLY cross-tenant access ('CrossTenantRead').
-- Granted to no role here; SELECT only, so it can never write tenant data.
-- ---------------------------------------------------------------------
drop policy if exists "platform cross-tenant read" on ae_allocation_history;
create policy "platform cross-tenant read" on ae_allocation_history for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on ae_bank_accounts;
create policy "platform cross-tenant read" on ae_bank_accounts for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on ae_bank_transactions;
create policy "platform cross-tenant read" on ae_bank_transactions for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on ae_import_batches;
create policy "platform cross-tenant read" on ae_import_batches for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on ae_imported_bills;
create policy "platform cross-tenant read" on ae_imported_bills for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on ae_journals;
create policy "platform cross-tenant read" on ae_journals for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on ae_match_history;
create policy "platform cross-tenant read" on ae_match_history for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on ae_purchase_bill_lines;
create policy "platform cross-tenant read" on ae_purchase_bill_lines for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on ae_suppliers;
create policy "platform cross-tenant read" on ae_suppliers for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on ae_transaction_review_history;
create policy "platform cross-tenant read" on ae_transaction_review_history for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on ae_work_items;
create policy "platform cross-tenant read" on ae_work_items for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on asset_classes;
create policy "platform cross-tenant read" on asset_classes for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on asset_findings;
create policy "platform cross-tenant read" on asset_findings for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on asset_lifecycle_events;
create policy "platform cross-tenant read" on asset_lifecycle_events for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on audit_areas;
create policy "platform cross-tenant read" on audit_areas for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on audit_engagements;
create policy "platform cross-tenant read" on audit_engagements for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on audit_findings;
create policy "platform cross-tenant read" on audit_findings for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on audit_programme_steps;
create policy "platform cross-tenant read" on audit_programme_steps for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on audit_queries;
create policy "platform cross-tenant read" on audit_queries for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on audit_risk_register;
create policy "platform cross-tenant read" on audit_risk_register for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on audit_team_assignments;
create policy "platform cross-tenant read" on audit_team_assignments for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on audit_working_papers;
create policy "platform cross-tenant read" on audit_working_papers for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on automation_audit_log;
create policy "platform cross-tenant read" on automation_audit_log for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on automation_task_runs;
create policy "platform cross-tenant read" on automation_task_runs for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on automation_tasks;
create policy "platform cross-tenant read" on automation_tasks for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on bank_reconciliations;
create policy "platform cross-tenant read" on bank_reconciliations for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on bank_transaction_splits;
create policy "platform cross-tenant read" on bank_transaction_splits for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on banking_exceptions;
create policy "platform cross-tenant read" on banking_exceptions for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on banking_rule_applications;
create policy "platform cross-tenant read" on banking_rule_applications for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on banking_rules;
create policy "platform cross-tenant read" on banking_rules for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on branches;
create policy "platform cross-tenant read" on branches for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on budgets;
create policy "platform cross-tenant read" on budgets for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on cashbook_batches;
create policy "platform cross-tenant read" on cashbook_batches for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on chart_of_accounts;
create policy "platform cross-tenant read" on chart_of_accounts for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on communications;
create policy "platform cross-tenant read" on communications for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on company_currencies;
create policy "platform cross-tenant read" on company_currencies for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on company_feature_overrides;
create policy "platform cross-tenant read" on company_feature_overrides for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on copilot_briefings;
create policy "platform cross-tenant read" on copilot_briefings for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on copilot_narratives;
create policy "platform cross-tenant read" on copilot_narratives for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on copilot_scenarios;
create policy "platform cross-tenant read" on copilot_scenarios for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on cost_centres;
create policy "platform cross-tenant read" on cost_centres for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on customer_receipts;
create policy "platform cross-tenant read" on customer_receipts for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on customers;
create policy "platform cross-tenant read" on customers for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on deliveries;
create policy "platform cross-tenant read" on deliveries for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on departments;
create policy "platform cross-tenant read" on departments for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on depreciation_runs;
create policy "platform cross-tenant read" on depreciation_runs for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on disclosure_notes;
create policy "platform cross-tenant read" on disclosure_notes for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on executive_alerts;
create policy "platform cross-tenant read" on executive_alerts for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on financial_years;
create policy "platform cross-tenant read" on financial_years for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on fixed_assets;
create policy "platform cross-tenant read" on fixed_assets for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on generated_documents;
create policy "platform cross-tenant read" on generated_documents for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on gl_transactions;
create policy "platform cross-tenant read" on gl_transactions for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on goods_received_notes;
create policy "platform cross-tenant read" on goods_received_notes for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on integration_connections;
create policy "platform cross-tenant read" on integration_connections for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on inventory_transactions;
create policy "platform cross-tenant read" on inventory_transactions for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on matching_overrides;
create policy "platform cross-tenant read" on matching_overrides for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on merchant_merges;
create policy "platform cross-tenant read" on merchant_merges for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on merchants;
create policy "platform cross-tenant read" on merchants for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on notifications;
create policy "platform cross-tenant read" on notifications for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on opening_balance_entries;
create policy "platform cross-tenant read" on opening_balance_entries for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on party_merges;
create policy "platform cross-tenant read" on party_merges for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on posting_batches;
create policy "platform cross-tenant read" on posting_batches for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on posting_rules;
create policy "platform cross-tenant read" on posting_rules for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on projects;
create policy "platform cross-tenant read" on projects for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on purchase_orders;
create policy "platform cross-tenant read" on purchase_orders for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on purchase_requisitions;
create policy "platform cross-tenant read" on purchase_requisitions for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on recurring_templates;
create policy "platform cross-tenant read" on recurring_templates for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on report_definitions;
create policy "platform cross-tenant read" on report_definitions for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on reporting_packages;
create policy "platform cross-tenant read" on reporting_packages for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on sales_invoices;
create policy "platform cross-tenant read" on sales_invoices for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on sales_orders;
create policy "platform cross-tenant read" on sales_orders for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on sales_quotations;
create policy "platform cross-tenant read" on sales_quotations for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on stock_cost_layers;
create policy "platform cross-tenant read" on stock_cost_layers for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on stock_items;
create policy "platform cross-tenant read" on stock_items for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on stock_takes;
create policy "platform cross-tenant read" on stock_takes for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on subscription_companies;
create policy "platform cross-tenant read" on subscription_companies for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on supplier_payments;
create policy "platform cross-tenant read" on supplier_payments for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on usage_events;
create policy "platform cross-tenant read" on usage_events for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on usage_period_counters;
create policy "platform cross-tenant read" on usage_period_counters for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on vat_adjustments;
create policy "platform cross-tenant read" on vat_adjustments for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on vat_exceptions;
create policy "platform cross-tenant read" on vat_exceptions for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on vat_payments;
create policy "platform cross-tenant read" on vat_payments for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on vat_returns;
create policy "platform cross-tenant read" on vat_returns for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on vat_treatments;
create policy "platform cross-tenant read" on vat_treatments for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on warehouses;
create policy "platform cross-tenant read" on warehouses for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on workflow_definitions;
create policy "platform cross-tenant read" on workflow_definitions for select using (user_has_platform_permission('CrossTenantRead'));
drop policy if exists "platform cross-tenant read" on workflow_instances;
create policy "platform cross-tenant read" on workflow_instances for select using (user_has_platform_permission('CrossTenantRead'));

-- ---------------------------------------------------------------------
-- Billing / licensing platform policies: explicit ManageBilling only.
-- (Replaces "exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)".)
-- ---------------------------------------------------------------------
drop policy if exists "org members can read their billing account" on billing_accounts;
create policy "org members can read their billing account" on billing_accounts for select using (
  exists (select 1 from organisation_members om where om.organisation_id = billing_accounts.organisation_id and om.user_id = auth.uid())
  or user_has_platform_permission('ManageBilling')
);

drop policy if exists "org members can write their billing account" on billing_accounts;
create policy "org members can write their billing account" on billing_accounts for all using (
  exists (select 1 from organisation_members om where om.organisation_id = billing_accounts.organisation_id and om.user_id = auth.uid())
  or user_has_platform_permission('ManageBilling')
);

drop policy if exists "members can read their subscription's status history" on subscription_status_history;
create policy "members can read their subscription's status history" on subscription_status_history for select using (
  exists (select 1 from subscriptions s
          join subscription_companies sc on sc.subscription_id = s.id
          where s.id = subscription_status_history.subscription_id and user_can_access_company(sc.company_id))
  or user_has_platform_permission('ManageBilling')
);

drop policy if exists "members can insert their subscription's status history" on subscription_status_history;
create policy "members can insert their subscription's status history" on subscription_status_history for insert with check (
  exists (select 1 from subscriptions s
          join subscription_companies sc on sc.subscription_id = s.id
          where s.id = subscription_status_history.subscription_id and user_can_access_company(sc.company_id))
  or user_has_platform_permission('ManageBilling')
);

drop policy if exists "platform-scope roles can write feature overrides" on company_feature_overrides;
create policy "platform-scope roles can write feature overrides" on company_feature_overrides for all using (
  user_has_platform_permission('ManageBilling')
);

drop policy if exists "org members can access their invoices" on invoices;
create policy "org members can access their invoices" on invoices for all using (
  exists (select 1 from billing_accounts ba join organisation_members om on om.organisation_id = ba.organisation_id
          where ba.id = invoices.billing_account_id and om.user_id = auth.uid())
  or user_has_platform_permission('ManageBilling')
);

drop policy if exists "org members can access their invoice lines" on invoice_lines;
create policy "org members can access their invoice lines" on invoice_lines for all using (
  exists (select 1 from invoices i join billing_accounts ba on ba.id = i.billing_account_id join organisation_members om on om.organisation_id = ba.organisation_id
          where i.id = invoice_lines.invoice_id and om.user_id = auth.uid())
  or user_has_platform_permission('ManageBilling')
);

drop policy if exists "org members can access their payments" on payments;
create policy "org members can access their payments" on payments for all using (
  exists (select 1 from billing_accounts ba join organisation_members om on om.organisation_id = ba.organisation_id
          where ba.id = payments.billing_account_id and om.user_id = auth.uid())
  or user_has_platform_permission('ManageBilling')
);

drop policy if exists "org members can access their refunds" on refunds;
create policy "org members can access their refunds" on refunds for all using (
  exists (select 1 from payments p join billing_accounts ba on ba.id = p.billing_account_id join organisation_members om on om.organisation_id = ba.organisation_id
          where p.id = refunds.payment_id and om.user_id = auth.uid())
  or user_has_platform_permission('ManageBilling')
);

drop policy if exists "org members can access their billing credits" on billing_credits;
create policy "org members can access their billing credits" on billing_credits for all using (
  exists (select 1 from billing_accounts ba join organisation_members om on om.organisation_id = ba.organisation_id
          where ba.id = billing_credits.billing_account_id and om.user_id = auth.uid())
  or user_has_platform_permission('ManageBilling')
);

drop policy if exists "platform-scope roles can read provider connection status" on billing_provider_connections;
create policy "platform-scope roles can read provider connection status" on billing_provider_connections for select using (
  user_has_platform_permission('ManageBilling')
);

drop policy if exists "platform-scope roles can read webhook events" on billing_webhook_events;
create policy "platform-scope roles can read webhook events" on billing_webhook_events for select using (
  user_has_platform_permission('ManageBilling')
);

drop policy if exists "platform-scope roles can access billing support notes" on billing_support_notes;
create policy "platform-scope roles can access billing support notes" on billing_support_notes for all using (
  user_has_platform_permission('ManageBilling')
);

