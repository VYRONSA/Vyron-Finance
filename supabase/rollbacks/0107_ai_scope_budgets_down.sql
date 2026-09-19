-- Down script for 0107_ai_scope_budgets.sql.
--
-- Returns the AI usage counter to one provider-wide allowance per company
-- per day, and restores `fn_ai_classification_gate` /
-- `fn_ai_classification_record_attempt` to their 0099 behaviour.
--
-- ORDER MATTERS. Roll back 0108 FIRST: `fn_ai_extraction_record_attempt`
-- calls `fn_ai_release_request`, which this script drops.
--
-- Data note: today's counters are collapsed back to one row per company
-- per day by keeping the classification scope's count and discarding the
-- others, because that is what the single-counter shape means. The
-- emergency-fuse rows are removed. Counters reset daily, so at most one
-- day's throttling accuracy is affected.

delete from ai_provider_daily_usage where scope = '__provider__';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'ai_provider_daily_usage_pkey'
      and conrelid = 'ai_provider_daily_usage'::regclass
      and array_length(conkey, 1) = 3
  ) then
    -- Keep the highest count per (company, day) so the fuse errs toward
    -- protecting the provider rather than under-counting.
    delete from ai_provider_daily_usage a
    using ai_provider_daily_usage b
    where a.company_id = b.company_id and a.usage_day = b.usage_day
      and (a.reserved_requests, a.scope) < (b.reserved_requests, b.scope);

    alter table ai_provider_daily_usage drop constraint ai_provider_daily_usage_pkey;
    alter table ai_provider_daily_usage add primary key (company_id, usage_day);
  end if;
end;
$$;

alter table ai_provider_daily_usage drop column if exists scope;

drop function if exists fn_ai_classification_release_reservation(uuid, text, timestamptz);
drop function if exists fn_ai_reserve_request(uuid, text, timestamptz, integer);
drop function if exists fn_ai_release_request(uuid, text, timestamptz);
drop function if exists fn_ai_resolve_daily_cap(uuid, text);

drop table if exists ai_provider_company_budget_overrides;
drop table if exists ai_provider_scope_budgets;

delete from ai_provider_circuit_state where scope = 'supplier-invoice-extraction';

-- IMPORTANT: `fn_ai_classification_gate` and
-- `fn_ai_classification_record_attempt` must be restored from
-- 0099_ai_classification_safety.sql after this script runs — re-run that
-- migration's sections 6 and 7. They are left in place here rather than
-- reproduced, so there is one source of truth for their 0099 bodies.
