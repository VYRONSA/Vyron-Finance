-- Phase 25K — Final Production-Readiness Audit.
--
-- `fn_apply_ai_classification` (migration 0081) already guards against
-- re-classifying a transaction that's been manually assigned, Rule-
-- matched, or Matching-matched (`suggested_gl_account`/`rule_id`/
-- `matched_supplier_id`/`matched_customer_id`/`matched_merchant_id` all
-- IS NULL) — but it never checked `journal_id`. A transaction can reach
-- `journal_id IS NOT NULL` (posted) while STILL satisfying every one of
-- those other conditions: split transactions post via
-- `buildJournalLinesForSplitTransaction`/`generateJournal`, which never
-- requires `suggested_gl_account` to be set first (unlike the
-- non-split path) — the only thing stopping this today is a
-- CLIENT-SIDE-ONLY gate (`canGenerateJournal` in
-- `transaction-bulk-action-bar.tsx`), not the server. Without this
-- guard, a genuinely posted (already-in-the-GL) transaction could still
-- be picked up by automatic or manual AI classification, writing a
-- `suggested_gl_account`/`allocation_status='Suggested'` and a fabricated
-- `ae_allocation_history` row onto a transaction that's supposed to be
-- immutable — the exact class of "posted transaction protected from
-- recoding" guarantee this codebase already enforces everywhere else
-- (Find & Recode's `bulkRecodeX`, `applyRuleActions`, `linkTransactionToJournal`).
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
      and journal_id is null
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
