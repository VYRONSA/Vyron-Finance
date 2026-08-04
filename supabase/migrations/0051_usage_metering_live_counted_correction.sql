-- Commercial Billing Platform — Sub-Phase 4, Usage Metering &
-- Subscription Enforcement. Corrective migration for
-- `0047_billing_platform_licensing_features_usage.sql`'s
-- `usage_period_counters.metric_key` CHECK constraint, following this
-- project's own established discipline: a migration not yet run against
-- any real database this session is still corrected via a new,
-- sequential migration rather than edited in place, exactly like
-- `0040` followed `0039` and `0042` followed `0041` earlier in this
-- project's history.
--
-- Why the correction: `active_users`, `storage_mb`, and `documents`
-- were originally modeled as event-metered counters. Auditing every ERP
-- module's real usage sources (per the Product Review Board's Sub-Phase
-- 4 directive) found that all three already have a real, authoritative
-- owning table — `user_role_assignments` (distinct users per company),
-- `documents` (`size_bytes`, `is_current` — migration `0027`) — that a
-- live `count(*)`/`sum()` query answers correctly and can never drift
-- from (an incrementing counter would silently overstate usage forever
-- after e.g. a document delete, since nothing would ever decrement it).
-- Reclassified as LIVE-COUNTED (`LiveCountedUsageKey`,
-- `src/server/billing-platform/types.ts`) — queried directly, never
-- written to this table. `scheduled_jobs` is added as a new genuinely
-- event-metered key (the directive's own named "Scheduled Jobs" usage
-- dimension — each Automation Scheduler task run is one event).

alter table usage_period_counters drop constraint usage_period_counters_metric_key_check;
alter table usage_period_counters add constraint usage_period_counters_metric_key_check check (metric_key in (
  'communications', 'automation_runs', 'ai_requests', 'api_requests',
  'bank_imports', 'reports_generated', 'forecasts', 'financial_statements', 'scheduled_jobs'
));

-- The one live-counted aggregate PostgREST's `.select(..., {count})`
-- can't express directly: total current-version document bytes for a
-- company. `security definer` + one explicit `user_can_access_company`
-- check, same pattern as `fn_banking_automation_summary`/
-- `fn_increment_usage_counter` — evaluated once, not per document row.
create function fn_company_storage_bytes(p_company_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_total bigint;
begin
  if not user_can_access_company(p_company_id) then
    raise exception 'not authorized for company %', p_company_id;
  end if;

  select coalesce(sum(size_bytes), 0) into v_total
  from documents
  where company_id = p_company_id and is_current = true;

  return v_total;
end;
$$;
