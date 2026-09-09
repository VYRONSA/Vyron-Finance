-- Phase 25I — Production Resilience Audit.
--
-- `transaction-explorer-repository.ts::applyAiClassification` writes
-- `ae_bank_transactions` (the atomic conditional-claim UPDATE that
-- prevents two concurrent classification runs from double-writing) and
-- then `ae_allocation_history` as two separate, non-transactional
-- PostgREST calls. If the UPDATE succeeds but the history INSERT fails
-- (a transient error), the transaction is left genuinely reclassified
-- — `allocation_status = 'Suggested'`, a real `suggested_gl_account` set
-- — but with NO supporting `ae_allocation_history` row (no explanation,
-- confidence, or model-used record) and the caller is told the whole
-- classification "failed", so no usage is recorded either. Because the
-- UPDATE's own WHERE clause requires `allocation_status = 'Unallocated'`,
-- the transaction is now also permanently ineligible for a future retry
-- — it is silently stuck half-classified with zero audit trail.
--
-- This function makes the whole write atomic, exactly the same pattern
-- `fn_post_approved_journals` (migration 0063) already established for
-- the identical class of problem: the conditional UPDATE and the history
-- INSERT happen in one statement, so they succeed or fail together. The
-- WHERE clause is unchanged from the TypeScript version it replaces —
-- still a real conditional claim, so two overlapping classification runs
-- for the same transaction still only ever let one of them through.
create or replace function fn_apply_ai_classification(
  p_company_id uuid,
  p_transaction_id bigint,
  p_suggested_gl_account text,
  p_confidence numeric,
  p_explanation text,
  p_model_used text,
  p_performed_by text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claimed_id bigint;
begin
  update ae_bank_transactions
    set suggested_gl_account = p_suggested_gl_account,
        allocation_status = 'Suggested',
        allocation_method = 'Future AI',
        is_manual_override = false
    where company_id = p_company_id
      and id = p_transaction_id
      and allocation_status = 'Unallocated'
      and suggested_gl_account is null
      and rule_id is null
      and matched_supplier_id is null
      and matched_customer_id is null
      and matched_merchant_id is null
    returning id into v_claimed_id;

  if v_claimed_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  insert into ae_allocation_history (
    company_id, transaction_id, new_status, new_gl_account, confidence,
    allocation_method, allocation_reason, is_manual_override, performed_by
  ) values (
    p_company_id,
    p_transaction_id,
    'Suggested',
    p_suggested_gl_account,
    p_confidence,
    'Future AI',
    p_explanation || ' (VYRON AI, model: ' || p_model_used || ')',
    false,
    p_performed_by
  );

  return jsonb_build_object('claimed', true);
end;
$$;
