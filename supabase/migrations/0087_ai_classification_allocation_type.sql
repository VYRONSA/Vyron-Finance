-- Phase 26J — Production AI Allocation Forensic Investigation.
--
-- ROOT CAUSE of "Automation Dashboard reports the sweep succeeded, real
-- AI allocations exist in the database, but Transaction Explorer still
-- shows Allocated 0 / blank Account Code for them": `fn_apply_ai_classification`
-- (migrations 0081/0082/0083) was authored before `allocation_type`
-- existed (added later by migration 0062, the Transaction Explorer
-- Redesign's G/C/S row-type discriminator) and was never updated to set
-- it. `allocation_status`/`suggested_gl_account`/`confidence` were
-- always written correctly — the classification itself was never
-- broken — but `transaction-grid.tsx::initialEdit()` derives the row's
-- displayed Type from `allocationType` first (falling back only to
-- matched supplier/customer, never to "does this row have a
-- suggestedGlAccount"), so every AI-allocated row rendered with a blank
-- Account Code/Description cell despite a real, correct
-- suggested_gl_account sitting underneath it. Confirmed live: EVERY row
-- with allocation_method = 'Future AI' in production has
-- allocation_type IS NULL.
--
-- Widens the function to also set allocation_type = 'G' — the only
-- classification this RPC ever produces (a General Ledger suggestion,
-- never a Customer/Supplier match) — and backfills every EXISTING row
-- this function already wrote before this fix existed. This is a pure
-- display-correctness backfill of already-decided data (same
-- "migration does its own backfill" convention as migration 0062's own
-- allocation_type backfill and migration 0086's chart-expansion
-- backfill) — it does not change allocation_status, confidence,
-- suggested_gl_account, or any other accounting-relevant field, and
-- touches only rows this exact function itself already claimed.
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
        allocation_type = 'G',
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

-- Backfill: every row this function already wrote before this fix
-- existed is stuck displaying blank in Transaction Explorer despite
-- having a real, correct suggested_gl_account. Scoped narrowly to
-- exactly the rows this function's own write signature produces
-- (allocation_method = 'Future AI', a real suggested_gl_account, no
-- allocation_type yet) — never touches a Rule/Match/manual-override row.
update ae_bank_transactions
set allocation_type = 'G'
where allocation_method = 'Future AI'
  and suggested_gl_account is not null
  and allocation_type is null;
