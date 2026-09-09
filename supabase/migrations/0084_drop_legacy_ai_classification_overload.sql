-- Phase 26D — cleanup. Migration 0083 added `p_target_status text default
-- 'Suggested'` to `fn_apply_ai_classification`. Because Postgres treats a
-- different parameter COUNT as a distinct function identity even when the
-- new parameter has a default, `create or replace function` did not
-- replace the original 7-argument function from migration 0082 — it
-- created a second overload alongside it (confirmed in production via
-- `pg_proc` inspection: two rows for `fn_apply_ai_classification`, oids
-- for the 7-arg and 8-arg signatures).
--
-- The 7-argument overload is now dead code — every caller in this
-- repository (`transaction-explorer-repository.ts::applyAiClassification`)
-- always supplies all 8 named parameters, so PostgREST always resolves to
-- the 8-argument version today. But leaving the old overload in place is a
-- latent hazard: any future caller that supplies only the original 7
-- parameters would hit PostgREST's ambiguous-overload error (both
-- signatures accept exactly 7 named arguments, since the 8th has a
-- default), instead of a clean call.
--
-- This migration removes ONLY that exact 7-argument signature. The
-- 8-argument function (and its logic, its RLS-respecting `security
-- invoker`, and every table/row it touches) is untouched — this is a
-- function-catalog change only, no table, no data, no company-scoped
-- content.
drop function if exists fn_apply_ai_classification(
  uuid,   -- p_company_id
  bigint, -- p_transaction_id
  text,   -- p_suggested_gl_account
  numeric,-- p_confidence
  text,   -- p_explanation
  text,   -- p_model_used
  text    -- p_performed_by
);
