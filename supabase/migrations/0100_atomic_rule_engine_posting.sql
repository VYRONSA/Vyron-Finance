-- =====================================================================
-- 0100 — Atomic Banking Rule posting, existing-journal recovery and
-- double-posting protection.
-- =====================================================================
--
-- WHAT WENT WRONG (production, 2026-09-16, transaction 2151 / JR000264)
--
-- `rule-processing-service.ts::processTransaction` posted a bank
-- transaction in three separate database calls:
--
--   createJournal (Approved)  ->  postApprovedJournals  ->  markTransactionPosted
--
-- The middle call commits the journal, the posting batch and the GL rows
-- (0063). The Vercel cron request was then killed at its 300-second limit
-- before the third call ran, leaving a correct Posted journal whose bank
-- transaction still said `journal_id IS NULL, posted_flag = false`. Three
-- things made that state dangerous rather than merely untidy:
--
--   1. The built-in recovery (look up the journal by source, back-fill the
--      link) sat AFTER `applyRuleActions`, which refuses any row whose
--      `rule_id` is already set — exactly the state a half-finished post
--      leaves. The recovery could never run.
--   2. Bank Posting (`fn_post_bank_transactions`) and Generate Journal
--      treat `posted_flag = false AND journal_id IS NULL` as "not posted",
--      so the same amount could be posted a second time.
--   3. `postApprovedJournals(companyId)` posts EVERY Approved journal in
--      the company, not just the one the rule engine created.
--
-- WHAT THIS MIGRATION DOES
--
--   A. One Banking Rule journal per bank transaction, enforced by a unique
--      partial index (checked against existing data first).
--   B. `fn_recover_rule_engine_journal_link` — links a transaction to its
--      already-Posted, unreversed Banking Rule journal. Writes nothing to
--      journals, lines, batches or the ledger. Audited.
--   C. `fn_post_rule_engine_journal` — claims and posts ONE transaction:
--      the rule's claim, journal, lines, posting batch (dated with the
--      caller's posting date), GL rows and the transaction link in a single
--      transaction. Any failure rolls all of it back. Runs the recovery
--      first, so a retry can never create a second journal.
--   D. `fn_bank_transaction_has_live_rule_engine_journal` and a guarded
--      `fn_post_bank_transactions` — Bank Posting no longer claims a
--      transaction that a Banking Rule journal already covers.
--   E. A BEFORE UPDATE trigger on `ae_bank_transactions` — the backstop
--      for every other write path (Generate Journal's link, anything added
--      later): a transaction whose Banking Rule journal is live cannot be
--      flagged posted or linked to a different journal. It fires on the
--      link write only, so it cannot stop a path that writes the ledger
--      BEFORE linking (Cashbook posting); that path checks first itself.
--   F. `fn_claim_bank_transaction_for_rule` — the ONE definition of "a
--      Banking Rule may take this transaction" and the claim write
--      (classification, allocation history, rule applications). Manual
--      Cashbook entries are never claimable. The posting function claims
--      inside its own transaction, so a failed post leaves the transaction
--      exactly as it was and the next sweep retries it.
--   G. `fn_list_rule_engine_worklist` / `fn_list_rule_engine_recovery_candidates`
--      — keyset-paged worklist (the API's 1,000-row limit no longer hides
--      the older part of it) and a direct list of links to recover.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- No existing row is updated. No amount, debit/credit, GL account,
-- allocation, VAT, reconciliation, journal, line, batch or GL row is
-- touched. Transaction 2151 is NOT repaired here — that is a separate,
-- explicitly approved step (supabase/repairs/).
--
-- LEGACY rule-owned transactions (`rule_id` set, `journal_id` NULL,
-- `posted_flag` false — e.g. Northwood's rows classified before rules
-- posted automatically) are neither marked nor converted, and nothing here
-- makes them postable: the claim requires `rule_id IS NULL`, so the Rule
-- Engine never posts or retries them. They remain for human review. Only a
-- claim made inside `fn_post_rule_engine_journal` is ever retried — and
-- only because its failure rolls the claim back.
--
-- Accounting meaning is unchanged: the journal a Banking Rule posts has
-- the same lines, the same date (the run date, as before), the same
-- source and the same ledger effect as before. What changes is that the
-- writes can no longer be separated.

-- ---------------------------------------------------------------------
-- A. One Banking Rule journal per bank transaction
-- ---------------------------------------------------------------------
--
-- `source_id` is only a bank transaction id for this one source type
-- (0063 `journal_reversal` rows point at journals, 0092
-- `bank_transactions_post` rows carry NULL), so the index is partial on
-- the source type. It covers every status, reversed or not: a reversal
-- does not unlink the transaction (journal-workflow-service.ts), so the
-- rule engine never has a reason to create a second journal for it.

do $$
declare
  v_duplicates int;
begin
  select count(*) into v_duplicates
    from (
      select company_id, source_id
        from ae_journals
        where source_type = 'bank_transaction_rule_engine'
        group by company_id, source_id
        having count(*) > 1
    ) d;
  if v_duplicates > 0 then
    raise exception 'VYRON_0100_DUPLICATE_RULE_ENGINE_JOURNALS: % bank transaction(s) already have more than one Banking Rule journal. Investigate before applying this migration.', v_duplicates;
  end if;
end;
$$;

create unique index if not exists ae_journals_rule_engine_source_key
  on ae_journals (company_id, source_id)
  where source_type = 'bank_transaction_rule_engine';

-- ---------------------------------------------------------------------
-- Shared definition of a "live" Banking Rule journal
-- ---------------------------------------------------------------------
--
-- Live = it has moved, or can still move, the ledger: Posted and not
-- reversed, or still on its way to Posted (Draft/Submitted/Approved).
-- Rejected and Cancelled journals never post; a reversed journal's
-- effect has been cancelled by its reversal.

create or replace function fn_bank_transaction_has_live_rule_engine_journal(p_company_id uuid, p_transaction_id bigint)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from ae_journals j
      where j.company_id = p_company_id
        and j.source_type = 'bank_transaction_rule_engine'
        and j.source_id = p_transaction_id
        and (j.status in ('Draft', 'Submitted', 'Approved') or (j.status = 'Posted' and not j.is_reversed))
  );
$$;

-- ---------------------------------------------------------------------
-- F. The Banking Rule claim
-- ---------------------------------------------------------------------
--
-- Claimable = nobody has decided about this transaction yet: not posted,
-- not taken over by a person, not owned by a rule or the Matching Engine,
-- not on review hold, and either untouched or carrying only an unconfirmed
-- AI suggestion (the Phase 53 precedence). Manual Cashbook entries are
-- approved and posted from the Cashbook, so a rule never takes them.
-- `rule-processing-service.ts::isClaimableByRule` is the in-memory twin.

create or replace function fn_bank_transaction_is_claimable_by_rule(p_txn ae_bank_transactions)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p_txn.journal_id is null
     and p_txn.is_manual_override = false
     and p_txn.rule_id is null
     and p_txn.matched_supplier_id is null
     and p_txn.matched_customer_id is null
     and p_txn.matched_merchant_id is null
     and p_txn.review_hold = false
     and p_txn.entry_source <> 'Manual'
     and ((p_txn.allocation_status = 'Unallocated' and p_txn.suggested_gl_account is null)
          or p_txn.allocation_method = 'Future AI');
$$;

-- p_claim: { ruleId, ruleName, matchedRuleIds, allocationStatus,
--   suggestedGlAccount?, suggestedVatCode?, matchedMerchantId?,
--   matchedSupplierId?, matchedCustomerId? } — a key that is absent leaves
-- that column as it is, exactly like the TypeScript write it replaces.
-- Returns false (writing nothing) when the transaction is not claimable.
create or replace function fn_claim_bank_transaction_for_rule(
  p_company_id uuid,
  p_transaction_id bigint,
  p_claim jsonb,
  p_performed_by text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_updated int;
  v_rule_ids bigint[];
begin
  if p_claim is null or jsonb_typeof(p_claim) <> 'object' then
    raise exception 'VYRON_RULE_CLAIM_INVALID: the claim must be a JSON object.';
  end if;
  if not (p_claim ?| array['matchedMerchantId', 'matchedSupplierId', 'matchedCustomerId', 'suggestedGlAccount', 'suggestedVatCode', 'ruleId', 'allocationStatus']) then
    return true;
  end if;

  select coalesce(array_agg(distinct r::bigint), '{}'::bigint[])
    into v_rule_ids
    from jsonb_array_elements_text(coalesce(p_claim->'matchedRuleIds', '[]'::jsonb)) r;
  if p_claim ? 'ruleId' then
    v_rule_ids := array(select distinct unnest(v_rule_ids || (p_claim->>'ruleId')::bigint));
  end if;
  if exists (
    select 1 from unnest(v_rule_ids) u(rule_id)
    where not exists (select 1 from banking_rules r where r.id = u.rule_id and r.company_id = p_company_id)
  ) then
    raise exception 'VYRON_RULE_CLAIM_RULE_MISMATCH: every rule must belong to company %.', p_company_id;
  end if;

  update ae_bank_transactions t
    set matched_merchant_id = case when p_claim ? 'matchedMerchantId' then (p_claim->>'matchedMerchantId')::bigint else t.matched_merchant_id end,
        matched_supplier_id = case when p_claim ? 'matchedSupplierId' then (p_claim->>'matchedSupplierId')::bigint else t.matched_supplier_id end,
        matched_customer_id = case when p_claim ? 'matchedCustomerId' then (p_claim->>'matchedCustomerId')::bigint else t.matched_customer_id end,
        suggested_gl_account = case when p_claim ? 'suggestedGlAccount' then p_claim->>'suggestedGlAccount' else t.suggested_gl_account end,
        suggested_vat_code = case when p_claim ? 'suggestedVatCode' then p_claim->>'suggestedVatCode' else t.suggested_vat_code end,
        rule_id = case when p_claim ? 'ruleId' then (p_claim->>'ruleId')::bigint else t.rule_id end,
        allocation_status = case when p_claim ? 'allocationStatus' then p_claim->>'allocationStatus' else t.allocation_status end,
        -- Same G/S/C precedence as before: a supplier/customer match wins
        -- over a plain GL suggestion.
        allocation_type = case
          when p_claim ? 'matchedSupplierId' then 'S'
          when p_claim ? 'matchedCustomerId' then 'C'
          when p_claim ? 'suggestedGlAccount' then 'G'
          else t.allocation_type
        end,
        -- A rule taking ownership supersedes an unconfirmed AI guess.
        allocation_method = case when p_claim ? 'ruleId' then null else t.allocation_method end
    where t.company_id = p_company_id
      and t.id = p_transaction_id
      and fn_bank_transaction_is_claimable_by_rule(t);
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  insert into ae_allocation_history (company_id, transaction_id, new_status, is_manual_override, performed_by, allocation_reason)
  values (
    p_company_id,
    p_transaction_id,
    p_claim->>'allocationStatus',
    false,
    coalesce(nullif(p_performed_by, ''), 'System'),
    format('Resolved by rule "%s"', coalesce(nullif(p_claim->>'ruleName', ''), 'Unnamed rule'))
  );

  insert into banking_rule_applications (company_id, rule_id, bank_transaction_id)
  select p_company_id, e.r::bigint, p_transaction_id
    from jsonb_array_elements_text(coalesce(p_claim->'matchedRuleIds', '[]'::jsonb)) with ordinality e(r, ord)
    order by e.ord;

  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- Audit helper
-- ---------------------------------------------------------------------
--
-- `automation_audit_log` is write-protected (0031): company members can
-- only read it. The posting functions below are SECURITY INVOKER (RLS is
-- their tenant boundary, the same as 0063/0092), so they record their
-- audit entry through this narrow SECURITY DEFINER helper. It refuses
-- callers outside the company and refuses to record anything that is not
-- true: the transaction must actually be linked to that company's Banking
-- Rule journal for it.

create or replace function fn_record_rule_engine_link_audit(
  p_company_id uuid,
  p_transaction_id bigint,
  p_journal_id bigint,
  p_performed_by text,
  p_action_type text,
  p_reason text,
  p_changes jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_audit_id bigint;
begin
  -- `role` is the caller's SET ROLE (PostgREST sets it per request; a
  -- SECURITY DEFINER call does not change it): the scheduler runs as
  -- service_role; a direct administrator connection has no SET ROLE at all.
  if not (
    current_setting('role', true) = 'service_role'
    or (coalesce(current_setting('role', true), 'none') = 'none' and session_user in ('postgres', 'supabase_admin'))
    or user_can_access_company(p_company_id)
  ) then
    raise exception 'VYRON_RULE_POST_FORBIDDEN: not a member of this company.';
  end if;

  if p_action_type not in ('RuleEngineJournalLinkRecovered') then
    raise exception 'VYRON_RULE_POST_AUDIT_TYPE: unsupported audit action %.', p_action_type;
  end if;

  if not exists (
    select 1
      from ae_bank_transactions t
      join ae_journals j
        on j.id = t.journal_id
       and j.company_id = t.company_id
       and j.source_type = 'bank_transaction_rule_engine'
       and j.source_id = t.id
      where t.company_id = p_company_id
        and t.id = p_transaction_id
        and t.journal_id = p_journal_id
        and t.posted_flag
  ) then
    raise exception 'VYRON_RULE_POST_AUDIT_MISMATCH: transaction % is not linked to Banking Rule journal %.', p_transaction_id, p_journal_id;
  end if;

  insert into automation_audit_log (company_id, performed_by, action_type, reason, changes, journal_ids, document_type, document_id, is_reversible)
  values (p_company_id, coalesce(nullif(p_performed_by, ''), 'System'), p_action_type, coalesce(p_reason, ''), coalesce(p_changes, '{}'::jsonb), array[p_journal_id], 'BankTransaction', p_transaction_id, true)
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;

-- ---------------------------------------------------------------------
-- B. Recovery: link a transaction to its existing Posted journal
-- ---------------------------------------------------------------------
--
-- Outcomes (jsonb `outcome`):
--   not_found       no such transaction in this company
--   no_journal      no Banking Rule journal exists for it — nothing to do
--   already_linked  the transaction already points at its journal
--   recovered       the link was missing and has now been written
--   blocked         a journal exists but the state is not the one this
--                   function may safely repair; nothing written, `reason`
--                   says why
--
-- Only `journal_id` and `posted_flag` are written — exactly what the
-- interrupted `markTransactionPosted` call would have written.

create or replace function fn_recover_rule_engine_journal_link(
  p_company_id uuid,
  p_transaction_id bigint,
  p_performed_by text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_txn record;
  v_journal record;
  v_line_count int;
  v_gl_count int;
  v_gl_debit numeric(14, 2);
  v_gl_credit numeric(14, 2);
  v_updated int;
  v_reason text;
begin
  -- Locks the transaction for the rest of the caller's transaction, so two
  -- workers on the same row are serialized.
  select id, journal_id, posted_flag, reconciliation_id
    into v_txn
    from ae_bank_transactions
    where company_id = p_company_id and id = p_transaction_id
    for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'transactionId', p_transaction_id);
  end if;

  select id, journal_number, status, is_reversed, posting_batch_id
    into v_journal
    from ae_journals
    where company_id = p_company_id
      and source_type = 'bank_transaction_rule_engine'
      and source_id = p_transaction_id
    for update;
  if not found then
    return jsonb_build_object('outcome', 'no_journal', 'transactionId', p_transaction_id);
  end if;

  if v_txn.journal_id is not distinct from v_journal.id then
    return jsonb_build_object('outcome', 'already_linked', 'transactionId', p_transaction_id,
      'journalId', v_journal.id, 'journalNumber', v_journal.journal_number, 'journalStatus', v_journal.status);
  end if;

  v_reason := case
    when v_journal.status <> 'Posted' then format('Banking Rule journal %s is %s, not Posted.', v_journal.journal_number, v_journal.status)
    when v_journal.is_reversed then format('Banking Rule journal %s has been reversed.', v_journal.journal_number)
    when v_txn.journal_id is not null then format('The transaction is linked to a different journal (%s).', v_txn.journal_id)
    when v_txn.posted_flag then 'The transaction is already flagged posted without a journal link.'
    when v_txn.reconciliation_id is not null then 'The transaction is reconciled.'
    else null
  end;

  if v_reason is null then
    -- The journal must be genuinely in the ledger: every line posted once,
    -- and the GL rows balanced.
    select count(*) into v_line_count from ae_journal_lines where journal_id = v_journal.id;
    select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
      into v_gl_count, v_gl_debit, v_gl_credit
      from gl_transactions
      where company_id = p_company_id and journal_id = v_journal.id;
    if v_line_count = 0 or v_gl_count <> v_line_count or v_gl_debit <> v_gl_credit then
      v_reason := format('Banking Rule journal %s is Posted but its ledger entries are incomplete (%s lines, %s GL rows).', v_journal.journal_number, v_line_count, v_gl_count);
    end if;
  end if;

  if v_reason is not null then
    return jsonb_build_object('outcome', 'blocked', 'transactionId', p_transaction_id,
      'journalId', v_journal.id, 'journalNumber', v_journal.journal_number, 'journalStatus', v_journal.status, 'reason', v_reason);
  end if;

  update ae_bank_transactions
    set journal_id = v_journal.id, posted_flag = true
    where company_id = p_company_id
      and id = p_transaction_id
      and journal_id is null
      and posted_flag = false;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'VYRON_RULE_POST_RECOVERY_CONFLICT: expected to link exactly 1 row, linked %.', v_updated;
  end if;

  perform fn_record_rule_engine_link_audit(
    p_company_id, p_transaction_id, v_journal.id, p_performed_by,
    'RuleEngineJournalLinkRecovered',
    format('Linked bank transaction %s to its existing Posted Banking Rule journal %s. No journal, batch or ledger entry was created or changed.', p_transaction_id, v_journal.journal_number),
    jsonb_build_object(
      'before', jsonb_build_object('journal_id', null, 'posted_flag', false),
      'after', jsonb_build_object('journal_id', v_journal.id, 'posted_flag', true),
      'journalNumber', v_journal.journal_number,
      'postingBatchId', v_journal.posting_batch_id
    )
  );

  return jsonb_build_object('outcome', 'recovered', 'transactionId', p_transaction_id,
    'journalId', v_journal.id, 'journalNumber', v_journal.journal_number, 'journalStatus', v_journal.status);
end;
$$;

-- ---------------------------------------------------------------------
-- C. Atomic post + link for ONE Banking Rule transaction
-- ---------------------------------------------------------------------
--
-- p_journal (built and validated in TypeScript by
-- `journal-service.ts::buildJournalLinesForTransaction`, re-checked here
-- as a backstop):
--   { journalDate, journalType, description, reference,
--     financialYearLabel, financialPeriod,
--     lines: [{ accountCode, debit, credit, description }] }
--
-- p_posted_by    the ledger's `posted_by` (unchanged).
-- p_posting_date the posting batch date — the same run date the caller
--                gives the journal, as the old two-step path did. No
--                database clock is used for any accounting date.
-- p_claim        the rule's classification (see F). It is written in THIS
--                transaction, after validation and before the journal, so
--                a failure leaves the transaction unclaimed and the next
--                sweep simply tries again. It must name the rule and the GL
--                account the journal posts to.
--
-- Outcomes: every outcome of the recovery function above except
-- `no_journal`, plus
--   posted          claim + journal + lines + batch + GL rows + link written
--   already_posted  the transaction is already posted/linked/reconciled
--   not_eligible    a person has taken the transaction over (manual
--                   override or review hold), it is a Manual Cashbook
--                   entry, or something else claimed it first
-- Invalid input (unbalanced, unknown account, wrong amount, no claim)
-- raises, and the whole call — including anything it had written — rolls
-- back.
--
-- The journal is numbered here, under a per-company advisory lock, rather
-- than by the caller's COUNT(*)+1: the same JR/PB format, but it cannot
-- collide with another rule-engine posting, and the unique constraints
-- stay the backstop against every other path.
--
-- L2 (review): the link also stamps `posted_at` and `posting_batch_id`,
-- the same two columns Bank Posting (0092) stamps. They are display and
-- traceability fields (Report Centre audit trail, the Bank Posting
-- message); no balance, report total or eligibility rule reads them.
-- Existing rows are not back-filled.

-- An earlier local draft of this migration had a 4-argument version.
drop function if exists fn_post_rule_engine_journal(uuid, bigint, jsonb, text);

create or replace function fn_post_rule_engine_journal(
  p_company_id uuid,
  p_transaction_id bigint,
  p_journal jsonb,
  p_posted_by text,
  p_posting_date date,
  p_claim jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_recovery jsonb;
  v_txn record;
  v_line jsonb;
  v_line_count int;
  v_total_debit numeric(14, 2);
  v_total_credit numeric(14, 2);
  v_expected numeric(14, 2);
  v_missing_accounts text;
  v_journal_date date;
  v_fy_label text;
  v_fy_period int;
  v_next bigint;
  v_journal_number text;
  v_batch_number text;
  v_batch_id bigint;
  v_journal_id bigint;
  v_gl_count int;
  v_updated int;
  v_posted_by text := coalesce(nullif(p_posted_by, ''), 'System');
begin
  v_recovery := fn_recover_rule_engine_journal_link(p_company_id, p_transaction_id, v_posted_by);
  if v_recovery->>'outcome' <> 'no_journal' then
    return v_recovery;
  end if;

  -- Already locked FOR UPDATE by the recovery call above.
  select id, debit, credit, journal_id, posted_flag, reconciliation_id, is_manual_override, review_hold, entry_source
    into v_txn
    from ae_bank_transactions
    where company_id = p_company_id and id = p_transaction_id;

  if v_txn.journal_id is not null or v_txn.posted_flag or v_txn.reconciliation_id is not null then
    return jsonb_build_object('outcome', 'already_posted', 'transactionId', p_transaction_id, 'journalId', v_txn.journal_id,
      'reason', 'The transaction is already posted, linked to a journal, or reconciled.');
  end if;
  if v_txn.is_manual_override or v_txn.review_hold then
    return jsonb_build_object('outcome', 'not_eligible', 'transactionId', p_transaction_id,
      'reason', 'The transaction was taken over by a person (manual override or review hold) after the rule matched it.');
  end if;
  if v_txn.entry_source = 'Manual' then
    return jsonb_build_object('outcome', 'not_eligible', 'transactionId', p_transaction_id,
      'reason', 'Manual Cashbook entries are approved and posted from the Cashbook, never by a Banking Rule.');
  end if;

  -- Backstop validation. Nothing has been written yet.
  if p_journal is null or jsonb_typeof(p_journal->'lines') <> 'array' or jsonb_array_length(p_journal->'lines') = 0 then
    raise exception 'VYRON_RULE_POST_NO_LINES: journal for transaction % has no lines.', p_transaction_id;
  end if;
  v_journal_date := nullif(p_journal->>'journalDate', '')::date;
  v_fy_label := nullif(p_journal->>'financialYearLabel', '');
  v_fy_period := nullif(p_journal->>'financialPeriod', '')::int;
  if v_journal_date is null or v_fy_label is null or v_fy_period is null then
    raise exception 'VYRON_RULE_POST_NO_PERIOD: journal date and financial period are required.';
  end if;
  if p_posting_date is null then
    raise exception 'VYRON_RULE_POST_NO_PERIOD: a posting date is required.';
  end if;
  if p_claim is null or jsonb_typeof(p_claim) <> 'object'
     or nullif(p_claim->>'ruleId', '') is null
     or nullif(p_claim->>'suggestedGlAccount', '') is null
     or nullif(p_claim->>'allocationStatus', '') is null then
    raise exception 'VYRON_RULE_POST_NO_CLAIM: posting needs the rule''s claim (rule, GL account, allocation status).';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_journal->'lines') r where r->>'accountCode' = p_claim->>'suggestedGlAccount') then
    raise exception 'VYRON_RULE_POST_CLAIM_MISMATCH: the journal does not post to the claimed GL account %.', p_claim->>'suggestedGlAccount';
  end if;

  for v_line in select value from jsonb_array_elements(p_journal->'lines') loop
    if coalesce(v_line->>'accountCode', '') = ''
       or coalesce((v_line->>'debit')::numeric, -1) < 0 or coalesce((v_line->>'credit')::numeric, -1) < 0
       or ((v_line->>'debit')::numeric > 0 and (v_line->>'credit')::numeric > 0) then
      raise exception 'VYRON_RULE_POST_BAD_LINE: invalid journal line %.', v_line;
    end if;
  end loop;

  select count(*), coalesce(round(sum((r->>'debit')::numeric), 2), 0), coalesce(round(sum((r->>'credit')::numeric), 2), 0)
    into v_line_count, v_total_debit, v_total_credit
    from jsonb_array_elements(p_journal->'lines') r;
  if v_total_debit <> v_total_credit or v_total_debit = 0 then
    raise exception 'VYRON_RULE_POST_UNBALANCED: debit % <> credit %.', v_total_debit, v_total_credit;
  end if;
  v_expected := round(greatest(v_txn.debit, v_txn.credit), 2);
  if v_total_debit <> v_expected then
    raise exception 'VYRON_RULE_POST_AMOUNT_MISMATCH: journal total % does not equal transaction amount %.', v_total_debit, v_expected;
  end if;

  select string_agg(distinct r->>'accountCode', ', ')
    into v_missing_accounts
    from jsonb_array_elements(p_journal->'lines') r
    where not exists (
      select 1 from chart_of_accounts c
      where c.company_id = p_company_id and c.account_code = r->>'accountCode'
    );
  if v_missing_accounts is not null then
    raise exception 'VYRON_RULE_POST_NO_ACCOUNT: no Chart of Accounts entry for account code(s): %', v_missing_accounts;
  end if;

  -- The claim, in this transaction (the row is already locked).
  -- The allocation history keeps the sweep's own actor label, as before.
  if not fn_claim_bank_transaction_for_rule(p_company_id, p_transaction_id, p_claim, coalesce(nullif(p_claim->>'performedBy', ''), v_posted_by)) then
    return jsonb_build_object('outcome', 'not_eligible', 'transactionId', p_transaction_id,
      'reason', 'The transaction is no longer open to a Banking Rule (another rule, the Matching Engine or a person has taken it).');
  end if;

  -- Numbering, serialized per company for this path.
  perform pg_advisory_xact_lock(hashtextextended('vyron.rule_engine_posting.' || p_company_id::text, 0));

  select coalesce(max(substring(journal_number from '^JR([0-9]+)$')::bigint), 0) + 1
    into v_next
    from ae_journals
    where company_id = p_company_id and journal_number ~ '^JR[0-9]+$';
  v_journal_number := 'JR' || case when length(v_next::text) >= 6 then v_next::text else lpad(v_next::text, 6, '0') end;

  select coalesce(max(substring(batch_number from '^PB([0-9]+)$')::bigint), 0) + 1
    into v_next
    from posting_batches
    where company_id = p_company_id and batch_number ~ '^PB[0-9]+$';
  v_batch_number := 'PB' || case when length(v_next::text) >= 6 then v_next::text else lpad(v_next::text, 6, '0') end;

  insert into posting_batches (company_id, batch_number, posting_date, journal_count, transaction_count, posted_by)
  values (p_company_id, v_batch_number, p_posting_date, 1, v_line_count, v_posted_by)
  returning id into v_batch_id;

  insert into ae_journals (
    company_id, journal_number, journal_date, journal_type, description, reference,
    source_type, source_id, status, total_debit, total_credit, posted_at, posting_batch_id
  )
  values (
    p_company_id,
    v_journal_number,
    v_journal_date,
    coalesce(nullif(p_journal->>'journalType', ''), 'Bank Transaction Automation'),
    coalesce(p_journal->>'description', ''),
    coalesce(p_journal->>'reference', ''),
    'bank_transaction_rule_engine',
    p_transaction_id,
    'Posted',
    v_total_debit,
    v_total_credit,
    now(),
    v_batch_id
  )
  returning id into v_journal_id;

  insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order)
  select
    v_journal_id,
    t.r->>'accountCode',
    (t.r->>'debit')::numeric,
    (t.r->>'credit')::numeric,
    coalesce(t.r->>'description', ''),
    (t.ord - 1)::int
  from jsonb_array_elements(p_journal->'lines') with ordinality t(r, ord);

  -- Same row shape `posting-engine-service.ts::buildGlTransactionRowsForJournal`
  -- produced for these journals: posting date = journal date, the line's
  -- own description falling back to the journal's.
  insert into gl_transactions (
    company_id, journal_id, journal_line_id, account_id, posting_date, reference, description,
    debit, credit, financial_year_label, financial_period, posted_by
  )
  select
    p_company_id,
    v_journal_id,
    jl.id,
    c.id,
    v_journal_date,
    coalesce(p_journal->>'reference', ''),
    case when jl.description <> '' then jl.description else coalesce(p_journal->>'description', '') end,
    jl.debit,
    jl.credit,
    v_fy_label,
    v_fy_period,
    v_posted_by
  from ae_journal_lines jl
  join chart_of_accounts c on c.company_id = p_company_id and c.account_code = jl.account_code
  where jl.journal_id = v_journal_id;
  get diagnostics v_gl_count = row_count;
  if v_gl_count <> v_line_count then
    raise exception 'VYRON_RULE_POST_LEDGER_MISMATCH: % lines but % GL rows.', v_line_count, v_gl_count;
  end if;

  update ae_bank_transactions
    set journal_id = v_journal_id, posted_flag = true, posted_at = now(), posting_batch_id = v_batch_id
    where company_id = p_company_id
      and id = p_transaction_id
      and journal_id is null
      and posted_flag = false;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'VYRON_RULE_POST_LINK_CONFLICT: expected to link exactly 1 transaction, linked %.', v_updated;
  end if;

  return jsonb_build_object(
    'outcome', 'posted',
    'transactionId', p_transaction_id,
    'journalId', v_journal_id,
    'journalNumber', v_journal_number,
    'journalStatus', 'Posted',
    'batchId', v_batch_id,
    'batchNumber', v_batch_number
  );
end;
$$;

-- ---------------------------------------------------------------------
-- D. Bank Posting: never claim a transaction a Banking Rule journal covers
-- ---------------------------------------------------------------------
--
-- Identical to 0092's definition except for one added claim condition,
-- marked below. A covered transaction is simply not claimed, so it is
-- reported back as not posted by this call — the rest of the batch posts.

create or replace function fn_post_bank_transactions(
  p_company_id uuid,
  p_transaction_ids bigint[],
  p_journals jsonb,
  p_batch_number text,
  p_posting_date date,
  p_posted_by text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claimed bigint[];
  v_claimed_count int;
  v_batch_id bigint;
  v_batch_row record;
  v_journal jsonb;
  v_journal_id bigint;
  v_journal_txn_ids bigint[];
  v_journal_claimed_ids bigint[];
  v_total_debit numeric(14, 2);
  v_total_credit numeric(14, 2);
  v_missing_accounts text;
  v_journals_out jsonb := '[]'::jsonb;
  v_gl_line_count int := 0;
  v_journal_count int := 0;
begin
  -- Claim. `posted_flag = false and journal_id is null` is the whole
  -- double-post guard: an already-posted transaction, or one already
  -- attached to another journal, is simply not claimed and is reported
  -- back to the caller as unchanged.
  with claimed as (
    update ae_bank_transactions
      set posted_flag = true, posted_at = now()
      where company_id = p_company_id
        and id = any(p_transaction_ids)
        and posted_flag = false
        and journal_id is null
        -- 0100: a live Banking Rule journal already carries this
        -- transaction into the ledger; its missing link is recovered by the
        -- rule engine, never by posting the amount again.
        and not fn_bank_transaction_has_live_rule_engine_journal(p_company_id, ae_bank_transactions.id)
      returning id
  )
  select coalesce(array_agg(id), '{}'::bigint[]) into v_claimed from claimed;

  v_claimed_count := coalesce(array_length(v_claimed, 1), 0);
  if v_claimed_count = 0 then
    return jsonb_build_object('batch', null, 'journals', '[]'::jsonb, 'claimedTransactionIds', '[]'::jsonb);
  end if;

  insert into posting_batches (company_id, batch_number, posting_date, journal_count, transaction_count, posted_by)
  values (p_company_id, p_batch_number, p_posting_date, 0, 0, p_posted_by)
  returning id into v_batch_id;

  for v_journal in select value from jsonb_array_elements(p_journals) loop
    select coalesce(array_agg(t.txn_id::bigint), '{}'::bigint[])
      into v_journal_txn_ids
      from jsonb_array_elements_text(v_journal->'transactionIds') as t(txn_id);

    select coalesce(array_agg(u.txn_id), '{}'::bigint[])
      into v_journal_claimed_ids
      from unnest(v_journal_txn_ids) as u(txn_id)
      where u.txn_id = any(v_claimed);

    -- Every transaction this journal covered was claimed by a concurrent
    -- run: nothing left to post, so no empty journal is created.
    if coalesce(array_length(v_journal_claimed_ids, 1), 0) = 0 then
      continue;
    end if;

    select string_agg(distinct l.account_code, ', ')
      into v_missing_accounts
      from jsonb_array_elements(v_journal->'lines') r
      cross join lateral (select r->>'accountCode' as account_code, (r->>'transactionId')::bigint as tid) l
      where l.tid = any(v_journal_claimed_ids)
        and not exists (
          select 1 from chart_of_accounts c
          where c.company_id = p_company_id and c.account_code = l.account_code
        );
    if v_missing_accounts is not null then
      raise exception 'VYRON_POST_NO_ACCOUNT: no Chart of Accounts entry for account code(s): %', v_missing_accounts;
    end if;

    select coalesce(round(sum((r->>'debit')::numeric), 2), 0), coalesce(round(sum((r->>'credit')::numeric), 2), 0)
      into v_total_debit, v_total_credit
      from jsonb_array_elements(v_journal->'lines') r
      where (r->>'transactionId')::bigint = any(v_journal_claimed_ids);

    if abs(v_total_debit - v_total_credit) > 0.01 then
      raise exception 'VYRON_POST_UNBALANCED: journal % debit % <> credit %', v_journal->>'journalNumber', v_total_debit, v_total_credit;
    end if;

    insert into ae_journals (
      company_id, journal_number, journal_date, journal_type, description, reference,
      source_type, source_id, status, total_debit, total_credit, posted_at,
      submitted_by, submitted_at, approved_by, approved_at, posting_batch_id
    )
    values (
      p_company_id,
      v_journal->>'journalNumber',
      (v_journal->>'journalDate')::date,
      coalesce(v_journal->>'journalType', 'Bank Transactions'),
      coalesce(v_journal->>'description', ''),
      coalesce(v_journal->>'reference', ''),
      'bank_transactions_post',
      null,
      'Posted',
      v_total_debit,
      v_total_credit,
      now(),
      p_posted_by, now(), p_posted_by, now(),
      v_batch_id
    )
    returning id into v_journal_id;

    insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order)
    select
      v_journal_id,
      r->>'accountCode',
      (r->>'debit')::numeric,
      (r->>'credit')::numeric,
      coalesce(r->>'description', ''),
      (t.ord - 1)::int
    from jsonb_array_elements(v_journal->'lines') with ordinality t(r, ord)
    where (r->>'transactionId')::bigint = any(v_journal_claimed_ids);

    insert into gl_transactions (
      company_id, journal_id, journal_line_id, account_id, posting_date, reference, description,
      debit, credit, financial_year_label, financial_period, posted_by
    )
    select
      p_company_id,
      v_journal_id,
      jl.id,
      c.id,
      (v_journal->>'journalDate')::date,
      coalesce(v_journal->>'reference', ''),
      case when jl.description <> '' then jl.description else coalesce(v_journal->>'description', '') end,
      jl.debit,
      jl.credit,
      coalesce(v_journal->>'financialYearLabel', ''),
      coalesce((v_journal->>'financialPeriod')::int, 0),
      p_posted_by
    from ae_journal_lines jl
    join chart_of_accounts c on c.company_id = p_company_id and c.account_code = jl.account_code
    where jl.journal_id = v_journal_id;

    -- Back-link every claimed transaction to the journal and batch that
    -- carried it into the ledger. This is what makes a posted row
    -- traceable to its GL entries and its GL entries traceable back to
    -- the originating bank transaction.
    update ae_bank_transactions
      set journal_id = v_journal_id, posting_batch_id = v_batch_id
      where company_id = p_company_id and id = any(v_journal_claimed_ids);

    v_journal_count := v_journal_count + 1;
    v_gl_line_count := v_gl_line_count + (select count(*) from ae_journal_lines where journal_id = v_journal_id);
    v_journals_out := v_journals_out || jsonb_build_object(
      'id', v_journal_id,
      'journalNumber', v_journal->>'journalNumber',
      'journalDate', v_journal->>'journalDate',
      'transactionIds', to_jsonb(v_journal_claimed_ids)
    );
  end loop;

  update posting_batches
    set journal_count = v_journal_count, transaction_count = v_gl_line_count
    where id = v_batch_id;

  select id, company_id, batch_number, posting_date, journal_count, transaction_count, posted_by, created_at
    into v_batch_row
    from posting_batches where id = v_batch_id;

  return jsonb_build_object(
    'batch', jsonb_build_object(
      'id', v_batch_row.id,
      'companyId', v_batch_row.company_id,
      'batchNumber', v_batch_row.batch_number,
      'postingDate', v_batch_row.posting_date,
      'journalCount', v_batch_row.journal_count,
      'transactionCount', v_batch_row.transaction_count,
      'postedBy', v_batch_row.posted_by,
      'createdAt', v_batch_row.created_at
    ),
    'journals', v_journals_out,
    'claimedTransactionIds', to_jsonb(v_claimed)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- E. Backstop for every other write path
-- ---------------------------------------------------------------------
--
-- Fires only when a transaction is being linked to a journal or flagged
-- posted. If a live Banking Rule journal exists for it, the only allowed
-- target is that journal. SECURITY DEFINER so the check sees the real
-- state even if the caller's RLS view of ae_journals were narrower.
-- Unlinking (journal_id -> NULL, e.g. the FK's ON DELETE SET NULL) is
-- never blocked.

create or replace function fn_guard_rule_engine_journal_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_journal record;
begin
  if (new.journal_id is not null and new.journal_id is distinct from old.journal_id)
     or (new.posted_flag and not old.posted_flag) then
    select id, journal_number, status, is_reversed
      into v_journal
      from ae_journals
      where company_id = old.company_id
        and source_type = 'bank_transaction_rule_engine'
        and source_id = old.id;
    if found
       and (v_journal.status in ('Draft', 'Submitted', 'Approved') or (v_journal.status = 'Posted' and not v_journal.is_reversed))
       and new.journal_id is distinct from v_journal.id then
      raise exception using
        errcode = 'P0001',
        message = format('VYRON_RULE_ENGINE_JOURNAL_EXISTS: bank transaction %s is already carried by Banking Rule journal %s (%s); it cannot be posted again or linked to another journal.', old.id, v_journal.journal_number, v_journal.status);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ae_bank_transactions_rule_engine_journal_guard on ae_bank_transactions;
create trigger ae_bank_transactions_rule_engine_journal_guard
  before update of journal_id, posted_flag on ae_bank_transactions
  for each row
  execute function fn_guard_rule_engine_journal_link();

-- ---------------------------------------------------------------------
-- G. The sweep's worklist, page by page
-- ---------------------------------------------------------------------
--
-- The API returns at most 1,000 rows per request, so the old single
-- `journal_id IS NULL` query silently dropped everything older than the
-- newest 1,000 rows. These return one page at a time with a keyset cursor
-- (never OFFSET: rows posted during the run would shift the pages).
--
-- Order is the one the sweep always used: newest transaction date first
-- (rows without a date first, as PostgreSQL's DESC puts NULLs), then id.
-- The cursor is the last row's (sort date, id); a NULL date sorts as
-- 'infinity'. SECURITY INVOKER: RLS decides what the caller sees.

create or replace function fn_list_rule_engine_worklist(
  p_company_id uuid,
  p_claimable_only boolean,
  p_after_sort_date date,
  p_after_id bigint,
  p_limit int
)
returns setof ae_bank_transactions
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select t.*
    from ae_bank_transactions t
    where t.company_id = p_company_id
      and t.journal_id is null
      and (not coalesce(p_claimable_only, false) or fn_bank_transaction_is_claimable_by_rule(t))
      and (p_after_id is null
           or (coalesce(t.transaction_date, 'infinity'::date), t.id) < (coalesce(p_after_sort_date, 'infinity'::date), p_after_id))
    order by coalesce(t.transaction_date, 'infinity'::date) desc, t.id desc
    limit least(greatest(coalesce(p_limit, 0), 0), 1000);
$$;

-- Transactions whose Banking Rule journal is Posted and unreversed but
-- whose link is missing, in the shape recovery may repair (not flagged
-- posted, not reconciled). Found directly, however long the worklist is.
create or replace function fn_list_rule_engine_recovery_candidates(p_company_id uuid, p_limit int)
returns setof ae_bank_transactions
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select t.*
    from ae_bank_transactions t
    where t.company_id = p_company_id
      and t.journal_id is null
      and t.posted_flag = false
      and t.reconciliation_id is null
      and exists (
        select 1 from ae_journals j
        where j.company_id = t.company_id
          and j.source_type = 'bank_transaction_rule_engine'
          and j.source_id = t.id
          and j.status = 'Posted'
          and not j.is_reversed
      )
    order by t.id
    limit least(greatest(coalesce(p_limit, 0), 0), 1000);
$$;

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
--
-- The posting functions are called by signed-in users ("Apply Rule",
-- "Run Rule Engine Now", imports) and by the scheduler (service role).
-- They are SECURITY INVOKER: RLS decides which company's rows they can
-- touch. Nobody calls the trigger function directly.

revoke execute on function fn_bank_transaction_has_live_rule_engine_journal(uuid, bigint) from public, anon;
revoke execute on function fn_record_rule_engine_link_audit(uuid, bigint, bigint, text, text, text, jsonb) from public, anon;
revoke execute on function fn_recover_rule_engine_journal_link(uuid, bigint, text) from public, anon;
revoke execute on function fn_post_rule_engine_journal(uuid, bigint, jsonb, text, date, jsonb) from public, anon;
revoke execute on function fn_bank_transaction_is_claimable_by_rule(ae_bank_transactions) from public, anon;
revoke execute on function fn_claim_bank_transaction_for_rule(uuid, bigint, jsonb, text) from public, anon;
revoke execute on function fn_list_rule_engine_worklist(uuid, boolean, date, bigint, int) from public, anon;
revoke execute on function fn_list_rule_engine_recovery_candidates(uuid, int) from public, anon;
revoke execute on function fn_guard_rule_engine_journal_link() from public, anon, authenticated;

grant execute on function fn_bank_transaction_has_live_rule_engine_journal(uuid, bigint) to authenticated, service_role;
grant execute on function fn_record_rule_engine_link_audit(uuid, bigint, bigint, text, text, text, jsonb) to authenticated, service_role;
grant execute on function fn_recover_rule_engine_journal_link(uuid, bigint, text) to authenticated, service_role;
grant execute on function fn_post_rule_engine_journal(uuid, bigint, jsonb, text, date, jsonb) to authenticated, service_role;
grant execute on function fn_bank_transaction_is_claimable_by_rule(ae_bank_transactions) to authenticated, service_role;
grant execute on function fn_claim_bank_transaction_for_rule(uuid, bigint, jsonb, text) to authenticated, service_role;
grant execute on function fn_list_rule_engine_worklist(uuid, boolean, date, bigint, int) to authenticated, service_role;
grant execute on function fn_list_rule_engine_recovery_candidates(uuid, int) to authenticated, service_role;
