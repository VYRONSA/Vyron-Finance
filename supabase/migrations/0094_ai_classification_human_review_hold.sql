-- =====================================================================
-- Human-review hold — automatic classification must never touch a
-- transaction a person is holding for review.
-- =====================================================================
--
-- THE DEFECT THIS CLOSES
--
-- During the Metanoia Hospitality / New Handcrafted Food Products
-- migration, 141 imported transactions were deliberately left
-- Unprocessed so an accountant could classify them. While that review
-- was in progress, the `AiClassificationSweep` automation task went on
-- classifying them in batches of 20 — 40 rows were auto-assigned to a
-- Credit Card liability account before the task was paused. Nothing in
-- the system expressed "a human is dealing with this, leave it alone",
-- so nothing stopped it.
--
-- Pausing the automation task was the emergency measure. This is the
-- actual fix: a first-class hold that automatic classification is
-- required to respect, enforced where the write happens rather than in
-- the UI that requests it.
--
-- WHAT COUNTS AS HELD FOR HUMAN REVIEW
--
--   review_hold = true        an explicit, deliberate hold placed by a
--                             person (this migration's new column)
--   review_status is not null a person has already recorded a review
--                             decision (Approved/Rejected/Ignored) —
--                             the AI must not overwrite their judgement
--   required_action is not null
--                             the system has flagged that this
--                             transaction needs human attention (e.g.
--                             "Review — possible duplicate payment")
--
-- The three are deliberately OR'd: a hold can precede any classification
-- (an Unprocessed row awaiting review) or follow one (a classified row
-- pulled back for scrutiny), and both must be protected. Measured before
-- shipping: `required_action` and `review_status` are null on all 1,105
-- Northwood and all 621 Metanoia rows, so adding them to the guard
-- changes no existing behaviour for either company — it only makes the
-- rule complete.
--
-- WHAT THIS DOES NOT DO
--
-- It does not clear, downgrade or reinterpret any review state — a hold
-- is additive and is released only by a person. It does not touch the
-- allocation fields, and it deliberately keeps four different things
-- separate, which the defect had begun to blur:
--
--   gl_account            the SOURCE's own account (Xero's Related
--                         Account) — evidence, never written by VYRON
--   suggested_gl_account  VYRON's allocation
--   allocation_method     how that allocation arose ('Future AI' for an
--                         AI suggestion, a rule, or a manual override)
--   review_status /       the human decision, and the human hold, which
--   review_hold           now outrank any automatic suggestion
--
-- `review_hold` defaults to false, so this migration places no existing
-- transaction on hold. Holding rows is a deliberate act, not a side
-- effect of deploying the guard.

alter table ae_bank_transactions
  add column review_hold boolean not null default false,
  add column review_hold_reason text not null default '',
  add column review_hold_by text,
  add column review_hold_at timestamptz;

-- The sweep's candidate query filters on exactly these columns
-- alongside the allocation state it already indexed.
create index ae_bank_transactions_review_hold_idx
  on ae_bank_transactions (company_id, review_hold)
  where review_hold = true;

-- ---------------------------------------------------------------------
-- The authoritative write guard.
--
-- `fn_apply_ai_classification` is the ONE place any AI classification is
-- persisted (migrations 0081/0082/0083/0087). Adding the hold to its
-- claim's WHERE clause is what makes the guarantee real: a held
-- transaction cannot be classified even if a caller's own eligibility
-- check is stale, wrong, or bypassed entirely — the same
-- conditional-claim discipline `journal_id is null` (0082) already uses
-- to protect posted transactions.
--
-- The signature is byte-for-byte the 8-argument one migration 0087 left
-- in place, deliberately: Postgres treats a different parameter COUNT as
-- a distinct function, so adding a parameter here would create a second
-- overload rather than replace the existing function — exactly the
-- ambiguous-overload hazard migration 0084 had to clean up. Only the
-- three hold conditions are added to the WHERE clause, and they only
-- ever narrow what can be claimed.
-- ---------------------------------------------------------------------
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
      -- Human review outranks any automatic suggestion.
      and review_hold = false
      and review_status is null
      and required_action is null
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
    p_explanation || ' (VYRON AI, model: ' || p_model_used || ')',
    false,
    p_performed_by
  );

  return jsonb_build_object('claimed', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Placing and releasing a hold — the only two writes to these columns,
-- so a hold can never be set or cleared as an incidental side effect of
-- some other update. Releasing is deliberately a separate call that
-- records who released it: the review state is never cleared to make an
-- automation succeed.
-- ---------------------------------------------------------------------
create or replace function fn_set_review_hold(
  p_company_id uuid,
  p_transaction_ids bigint[],
  p_hold boolean,
  p_reason text,
  p_performed_by text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ids bigint[];
begin
  with changed as (
    update ae_bank_transactions
      set review_hold = p_hold,
          review_hold_reason = case when p_hold then coalesce(p_reason, '') else '' end,
          review_hold_by = case when p_hold then p_performed_by else null end,
          review_hold_at = case when p_hold then now() else null end
      where company_id = p_company_id
        and id = any(p_transaction_ids)
        and review_hold is distinct from p_hold
      returning id
  )
  select coalesce(array_agg(id), '{}'::bigint[]) into v_ids from changed;

  return jsonb_build_object('changedIds', to_jsonb(v_ids), 'changedCount', coalesce(array_length(v_ids, 1), 0));
end;
$$;
