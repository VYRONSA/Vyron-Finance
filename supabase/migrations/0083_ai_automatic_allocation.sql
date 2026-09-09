-- Phase 26A — Automatic AI Allocation for genuinely High-confidence
-- classifications (>=85, VYRON's own deterministic threshold —
-- `confidenceLevelFor()` in transaction-classification/types.ts — never
-- the model's own opinion of what "high" means).
--
-- `fn_apply_ai_classification` (migrations 0081/0082) always wrote
-- `allocation_status = 'Suggested'`, regardless of confidence — AI could
-- only ever suggest, never actually allocate. Both `'Allocated'`
-- (`ae_bank_transactions.allocation_status`'s CHECK constraint) and
-- `'Future AI'` (`allocation_method`'s CHECK constraint) were ALREADY
-- valid, pre-existing values since migration 0002 — no table/column/
-- constraint change is required, only widening this function to accept
-- which of the two statuses to write. The eligibility WHERE clause is
-- otherwise byte-for-byte the same guard already proven safe for the
-- Suggested case: a transaction is claimable only when Rules, Matching,
-- and any manual action have ALL left it completely untouched. This is
-- precisely what makes an automatic 'Allocated' write safe here: it
-- reuses the exact same atomic claim, on the exact same narrow
-- eligibility, that already protects the Suggested path — the ONLY
-- thing that changes is which literal status value the winning claim
-- writes.
--
-- One tightening alongside the widening: the existing WHERE clause never
-- explicitly checked `is_manual_override = false`, unlike its sibling
-- `applyRuleActions` (transaction-explorer-repository.ts), which already
-- does. In practice a transaction reaching a real manual override should
-- already fail `allocation_status = 'Unallocated'` too (a human override
-- almost always changes status alongside the flag) — but this closes the
-- gap explicitly rather than relying on that being true everywhere,
-- matching this codebase's own defense-in-depth convention. This applies
-- to BOTH the Suggested and Allocated paths equally; it only ever makes
-- the guard stricter, never looser.
create or replace function fn_apply_ai_classification(
  p_company_id uuid,
  p_transaction_id bigint,
  p_suggested_gl_account text,
  p_confidence numeric,
  p_explanation text,
  p_model_used text,
  p_performed_by text,
  p_target_status text default 'Suggested'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claimed_id bigint;
begin
  if p_target_status not in ('Suggested', 'Allocated') then
    raise exception 'fn_apply_ai_classification: p_target_status must be ''Suggested'' or ''Allocated'', got %', p_target_status;
  end if;

  update ae_bank_transactions
    set suggested_gl_account = p_suggested_gl_account,
        allocation_status = p_target_status,
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
      and is_manual_override = false
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
    p_target_status,
    p_suggested_gl_account,
    p_confidence,
    'Future AI',
    case when p_target_status = 'Allocated'
      then 'AI automatic allocation — High confidence (' || round(p_confidence) || '%) — ' || p_explanation || ' (VYRON AI, model: ' || p_model_used || ')'
      else p_explanation || ' (VYRON AI, model: ' || p_model_used || ')'
    end,
    false,
    p_performed_by
  );

  return jsonb_build_object('claimed', true);
end;
$$;
