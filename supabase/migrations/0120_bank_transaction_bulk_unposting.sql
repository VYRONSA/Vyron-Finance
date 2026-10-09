-- Bulk Unpost and Unallocate POSTED Bank Transactions by date range.
--
-- Extends 0119 (Bulk Unallocate), which refuses every posted transaction.
-- This migration lets a posted bank transaction be taken back out of the
-- general ledger and returned to Unallocated, keeping its GL account,
-- customer or supplier beside it for the next review.
--
-- THE REVERSAL MECHANISM. PRECISIA reverses a posted journal one way
-- (journal-workflow-service.ts::reverseJournal): a brand-new journal with
-- every line's debit and credit swapped, journal_type 'Reversal',
-- source_type 'journal_reversal', source_id = the original, linked both
-- ways (original.is_reversed / reversed_by_journal_id,
-- reversal.reversal_of_journal_id). The original and its gl_transactions
-- are never edited or deleted. This migration uses exactly that shape, with
-- three owner-approved differences that the bank-transaction workflow needs
-- (decision 2026-10-09):
--
--   1. WHOLE JOURNAL ONLY. Post to Accounting writes one journal per
--      transaction DATE carrying every transaction posted for that date (any
--      bank account); its lines do not record which transaction they came
--      from. A journal is therefore reversed only when EVERY bank
--      transaction it carries is selected and eligible, and then all of them
--      are unposted together; otherwise none of them is touched and each is
--      reported with the reason. A Banking Rule journal carries one
--      transaction, so it always qualifies on its own.
--   2. DATED AT THE ORIGINAL JOURNAL DATE, so the original period nets to
--      zero and the repost lands back in it. The original date must pass the
--      same period rules the Posting Engine applies (financial-period-
--      service.ts::checkPostingDate: a covering financial year, not Closed,
--      after its lock date) — enforced here in the database.
--   3. POSTED ATOMICALLY with the bank-transaction reset: the reversal
--      journal, its lines, its gl_transactions (one mirror row per original
--      ledger row, debit and credit swapped, same account / period), the
--      original's reversed flag and the transactions' unposted state are one
--      sub-transaction per journal — all of it or none of it.
--
-- WHAT IS RETAINED. A posted transaction's allocation is its GL account
-- (`suggested_gl_account`), or for a subsidiary-ledger posting its customer
-- (`allocation_type 'C'` + `matched_customer_id`) or supplier ('S' +
-- `matched_supplier_id`). `is_allocated` (0096) is generated from those, so
-- the active columns are cleared and the values move to
--   retained_gl_account   (0119)
--   retained_customer_id  (new)
--   retained_supplier_id  (new)
-- — references for the next review only. Nothing reads them as an
-- allocation, nothing posts from them, and `is_manual_override` is set so
-- neither the Rule Engine nor AI re-allocates the transaction. VAT code,
-- supplier/merchant identification on a GL row, review state and every
-- source/identity column are untouched.
--
-- EXCLUDED, with the reason shown: reconciled, manual cashbook, split,
-- bill-matched, linked-but-not-posted (Generate Journal), posted with no
-- journal, journals other than Post to Accounting / Banking Rule, journals
-- already reversed, unbalanced or ledger-mismatched journals, and journals
-- dated in a closed / locked / uncovered period — and every companion of an
-- excluded transaction on the same journal.
--
-- AUDIT. The 0119 append-only run tables gain a mode ('unallocate' |
-- 'unpost') and the posting/reversal references of every transaction.
-- Banking:Edit AND GeneralLedger:Reverse are required, enforced here.
--
-- Requires 0098, 0100, 0111, 0119. Does NOT require 0102 (and works with
-- it: reversal columns stay writable under its guards). Idempotent.

-- ---------------------------------------------------------------------
-- 1. Retained customer / supplier.
--
-- Plain ids, deliberately WITHOUT foreign keys (like retained_gl_account,
-- which is plain text). A second foreign key from ae_bank_transactions to
-- ae_suppliers (or customers) makes PostgREST's unqualified embed
-- `matched_supplier:ae_suppliers(name)` — used by the Transaction Explorer
-- and the Report Centre, including the app already in production —
-- ambiguous (PGRST201), and those pages stop loading the moment this
-- migration is applied. A retained id is only a reference for the next
-- review; if the customer or supplier is later deleted the screen shows
-- the bare id.
-- ---------------------------------------------------------------------
alter table ae_bank_transactions
  add column if not exists retained_customer_id bigint,
  add column if not exists retained_supplier_id bigint;

comment on column ae_bank_transactions.retained_customer_id is
  'The customer this transaction was allocated to when it was bulk-unposted (fn_bulk_unpost_bank_transactions). A reference for the next review only: it is NOT an allocation, is_allocated ignores it, and nothing posts from it.';
comment on column ae_bank_transactions.retained_supplier_id is
  'The supplier this transaction was allocated to when it was bulk-unposted (fn_bulk_unpost_bank_transactions). A reference for the next review only: it is NOT an allocation, is_allocated ignores it, and nothing posts from it.';

-- ---------------------------------------------------------------------
-- 2. The audit tables gain the unposting facts. Adding columns and
--    replacing CHECKs fires no row trigger; every existing row is an
--    'unallocate' run and satisfies the widened checks.
-- ---------------------------------------------------------------------
alter table bank_unallocation_runs
  add column if not exists mode text not null default 'unallocate',
  add column if not exists unposted_count int not null default 0,
  add column if not exists reversed_journal_count int not null default 0,
  -- No foreign key: an ON DELETE action would have to UPDATE this
  -- append-only row.
  add column if not exists reversal_posting_batch_id bigint;

alter table bank_unallocation_runs drop constraint if exists bank_unallocation_runs_mode;
alter table bank_unallocation_runs add constraint bank_unallocation_runs_mode check (mode in ('unallocate', 'unpost'));
alter table bank_unallocation_runs drop constraint if exists bank_unallocation_runs_unposting_counts;
alter table bank_unallocation_runs add constraint bank_unallocation_runs_unposting_counts
  check (unposted_count >= 0 and reversed_journal_count >= 0 and (mode = 'unpost' or (unposted_count = 0 and reversed_journal_count = 0)));
alter table bank_unallocation_runs drop constraint if exists bank_unallocation_runs_counts;
alter table bank_unallocation_runs add constraint bank_unallocation_runs_counts
  check (requested_count = unallocated_count + unposted_count + skipped_count + failed_count);

alter table bank_unallocation_run_items
  add column if not exists previous_posted_flag boolean,
  add column if not exists previous_journal_id bigint,
  add column if not exists previous_journal_number text,
  add column if not exists previous_journal_source_type text,
  add column if not exists previous_posting_batch_id bigint,
  add column if not exists reversal_journal_id bigint,
  add column if not exists reversal_journal_number text,
  add column if not exists previous_customer_id bigint,
  add column if not exists previous_customer_code text,
  add column if not exists previous_supplier_id bigint,
  add column if not exists previous_supplier_code text;

alter table bank_unallocation_run_items drop constraint if exists bank_unallocation_run_items_outcome_check;
alter table bank_unallocation_run_items add constraint bank_unallocation_run_items_outcome_check
  check (outcome in ('unallocated', 'unposted', 'skipped', 'failed'));

-- ---------------------------------------------------------------------
-- 3. Eligibility. NULL = may be unposted here; otherwise the reason, in
--    words an accountant can act on. Three layers, one rule:
--      row      — the transaction itself
--      journal  — the journal that carried it into the ledger
--      combined — row, then journal, then every companion on the journal
-- ---------------------------------------------------------------------
create or replace function fn_bank_unposting_row_exclusion(p_txn ae_bank_transactions)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when p_txn.reconciliation_id is not null
      then 'Included in a bank reconciliation. A reconciled transaction is never unposted here; unclear it in its reconciliation first.'
    when p_txn.entry_source = 'Manual'
      then 'Manual cashbook entry. Reverse it in the Cashbook.'
    when not p_txn.posted_flag and p_txn.journal_id is null
      then 'Not posted to the general ledger, so there is nothing to reverse.'
    when not p_txn.posted_flag
      then 'Linked to a journal but not posted from Banking (Generate Journal). It is not unposted here.'
    when p_txn.journal_id is null
      then 'Marked posted but linked to no journal. It needs investigation and is not unposted here.'
    when p_txn.is_split
      then 'Split across several accounts. Split transactions are not unposted here.'
    when p_txn.matched_bill_id is not null
      then 'Matched to a supplier bill. Bill-matched transactions are not unposted here.'
    when nullif(btrim(coalesce(p_txn.suggested_gl_account, '')), '') is null
         and not (p_txn.allocation_type = 'C' and p_txn.matched_customer_id is not null)
         and not (p_txn.allocation_type = 'S' and p_txn.matched_supplier_id is not null)
      then 'No GL account, customer or supplier allocation to keep.'
    else null
  end
$$;
revoke execute on function fn_bank_unposting_row_exclusion(ae_bank_transactions) from public, anon;
grant execute on function fn_bank_unposting_row_exclusion(ae_bank_transactions) to authenticated, service_role;

create or replace function fn_bank_unposting_journal_exclusion(p_company_id uuid, p_journal_id bigint, p_transaction_id bigint)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_j ae_journals;
  v_line_count int;
  v_line_debit numeric;
  v_line_credit numeric;
  v_gl_count int;
  v_gl_debit numeric;
  v_gl_credit numeric;
  v_orphans int;
  v_fy financial_years;
begin
  select * into v_j from ae_journals where company_id = p_company_id and id = p_journal_id;
  if v_j.id is null then
    return 'Its journal no longer exists.';
  end if;
  if v_j.source_type is distinct from 'bank_transactions_post' and v_j.source_type is distinct from 'bank_transaction_rule_engine' then
    return format('Posted through journal %s (%s), which is not a Post to Accounting or Banking Rule posting. It is not unposted here.',
      v_j.journal_number, coalesce(nullif(v_j.source_type, ''), 'no source'));
  end if;
  if v_j.source_type = 'bank_transaction_rule_engine' and v_j.source_id is distinct from p_transaction_id then
    return format('Banking Rule journal %s belongs to another transaction. It is not unposted here.', v_j.journal_number);
  end if;
  if v_j.status <> 'Posted' then
    return format('Journal %s is %s, not Posted.', v_j.journal_number, v_j.status);
  end if;
  if coalesce(v_j.is_reversed, false) or v_j.reversed_by_journal_id is not null
     or exists (select 1 from ae_journals r where r.company_id = p_company_id and r.source_type = 'journal_reversal' and r.source_id = v_j.id)
     or exists (select 1 from ae_journals r where r.company_id = p_company_id and r.reversal_of_journal_id = v_j.id) then
    return format('Journal %s has already been reversed. A journal is never reversed twice; this transaction needs investigation.', v_j.journal_number);
  end if;

  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_line_count, v_line_debit, v_line_credit
    from ae_journal_lines where journal_id = v_j.id;
  if v_line_count = 0 or abs(v_line_debit - v_line_credit) > 0.005 then
    return format('Journal %s has no lines or does not balance. It is not reversed here.', v_j.journal_number);
  end if;

  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0),
         count(*) filter (where g.journal_line_id is null or not exists (select 1 from ae_journal_lines l where l.id = g.journal_line_id and l.journal_id = v_j.id))
    into v_gl_count, v_gl_debit, v_gl_credit, v_orphans
    from gl_transactions g where g.company_id = p_company_id and g.journal_id = v_j.id;
  if v_gl_count <> v_line_count or v_orphans > 0 or v_gl_debit <> v_line_debit or v_gl_credit <> v_line_credit then
    return format('The general ledger entries of journal %s do not match its lines. It is not reversed here.', v_j.journal_number);
  end if;

  -- The same three rules as financial-period-service.ts::checkPostingDate.
  select * into v_fy from financial_years
    where company_id = p_company_id and start_date <= v_j.journal_date and v_j.journal_date <= end_date
    order by start_date desc limit 1;
  if v_fy.id is null then
    return format('No financial year covers %s, the date of journal %s, so its reversal cannot be dated there.', v_j.journal_date, v_j.journal_number);
  end if;
  if v_fy.status = 'Closed' then
    return format('Financial year %s is closed. Journal %s (%s) cannot be reversed into it.', v_fy.year_label, v_j.journal_number, v_j.journal_date);
  end if;
  if v_fy.lock_date is not null and v_j.journal_date <= v_fy.lock_date then
    return format('%s is on or before the %s lock date (%s). Journal %s cannot be reversed into a locked period.',
      v_j.journal_date, v_fy.year_label, v_fy.lock_date, v_j.journal_number);
  end if;
  return null;
end;
$$;
revoke execute on function fn_bank_unposting_journal_exclusion(uuid, bigint, bigint) from public, anon;
grant execute on function fn_bank_unposting_journal_exclusion(uuid, bigint, bigint) to authenticated, service_role;

create or replace function fn_bank_unposting_exclusion(p_txn ae_bank_transactions)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_companion ae_bank_transactions;
  v_companion_reason text;
begin
  v_reason := fn_bank_unposting_row_exclusion(p_txn);
  if v_reason is not null then return v_reason; end if;
  v_reason := fn_bank_unposting_journal_exclusion(p_txn.company_id, p_txn.journal_id, p_txn.id);
  if v_reason is not null then return v_reason; end if;
  for v_companion in
    select * from ae_bank_transactions c
      where c.company_id = p_txn.company_id and c.journal_id = p_txn.journal_id and c.id <> p_txn.id
      order by c.id
  loop
    v_companion_reason := fn_bank_unposting_row_exclusion(v_companion);
    if v_companion_reason is not null then
      return format('Posted together on journal %s with transaction #%s (%s), which cannot be unposted: %s The whole journal is reversed or none of it.',
        (select journal_number from ae_journals where id = p_txn.journal_id), v_companion.id, v_companion.transaction_date, v_companion_reason);
    end if;
  end loop;
  return null;
end;
$$;
revoke execute on function fn_bank_unposting_exclusion(ae_bank_transactions) from public, anon;
grant execute on function fn_bank_unposting_exclusion(ae_bank_transactions) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Preview. Read-only, runs as the caller (RLS applies). Lists every
--    transaction DATED in the range (inclusive; transaction_date) that is
--    in, or linked to, the ledger — eligible or not. A transaction whose
--    journal also carries transactions outside these criteria is excluded:
--    the whole journal is reversed or none of it.
-- ---------------------------------------------------------------------
create or replace function fn_preview_bank_unposting(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_bank_account_id bigint,
  p_limit int
)
returns table (
  id bigint,
  transaction_date date,
  description text,
  reference text,
  debit numeric,
  credit numeric,
  bank_account_id bigint,
  bank_account_name text,
  allocation_status text,
  allocation_type text,
  gl_account_code text,
  gl_account_name text,
  customer_id bigint,
  customer_code text,
  customer_name text,
  supplier_id bigint,
  supplier_code text,
  supplier_name text,
  journal_id bigint,
  journal_number text,
  journal_date date,
  journal_source_type text,
  journal_transaction_count int,
  exclusion_reason text
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'a signed-in user is required' using errcode = '42501';
  end if;
  if not user_has_permission(p_company_id, 'Banking:Edit') or not user_has_permission(p_company_id, 'GeneralLedger:Reverse') then
    raise exception 'Banking:Edit and GeneralLedger:Reverse are required' using errcode = '42501';
  end if;
  if p_date_from is null or p_date_to is null then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: From Date and To Date are required.' using errcode = '22023';
  end if;
  if p_date_from > p_date_to then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: From Date cannot be later than To Date.' using errcode = '22023';
  end if;

  return query
    with candidates as (
      select t.*
        from ae_bank_transactions t
        where t.company_id = p_company_id
          and t.transaction_date between p_date_from and p_date_to
          and (p_bank_account_id is null or t.bank_account_id = p_bank_account_id)
          and (t.posted_flag or t.journal_id is not null or t.posting_batch_id is not null)
        order by t.transaction_date, t.id
        limit greatest(coalesce(p_limit, 5001), 1)
    )
    select t.id, t.transaction_date, t.description, t.reference, t.debit, t.credit,
           t.bank_account_id, coalesce(nullif(ba.account_name, ''), ba.account_number),
           t.allocation_status, t.allocation_type,
           nullif(btrim(coalesce(t.suggested_gl_account, '')), ''),
           coa.description,
           case when t.allocation_type = 'C' then t.matched_customer_id end, cu.customer_code, cu.name,
           case when t.allocation_type = 'S' then t.matched_supplier_id end, su.supplier_code, su.name,
           t.journal_id, j.journal_number, j.journal_date, j.source_type,
           (select count(*)::int from ae_bank_transactions c where c.company_id = t.company_id and c.journal_id = t.journal_id),
           coalesce(
             fn_bank_unposting_exclusion(t::ae_bank_transactions),
             (select format('Posted together on journal %s with %s transaction(s) outside this preview (another bank account or outside the dates). The whole journal is reversed or none of it; widen the criteria to include them.',
                       j.journal_number, count(*))
                from ae_bank_transactions c
                where c.company_id = t.company_id and c.journal_id = t.journal_id and c.id <> t.id
                  and (c.transaction_date is null or c.transaction_date not between p_date_from and p_date_to
                       or (p_bank_account_id is not null and c.bank_account_id is distinct from p_bank_account_id))
                having count(*) > 0))
      from candidates t
      left join ae_bank_accounts ba on ba.id = t.bank_account_id and ba.company_id = t.company_id
      left join chart_of_accounts coa on coa.company_id = t.company_id and coa.account_code = btrim(t.suggested_gl_account)
      left join customers cu on cu.id = t.matched_customer_id and cu.company_id = t.company_id and t.allocation_type = 'C'
      left join ae_suppliers su on su.id = t.matched_supplier_id and su.company_id = t.company_id and t.allocation_type = 'S'
      left join ae_journals j on j.id = t.journal_id and j.company_id = t.company_id
      order by t.transaction_date, t.id;
end;
$$;
revoke execute on function fn_preview_bank_unposting(uuid, date, date, bigint, int) from public, anon, service_role;
grant execute on function fn_preview_bank_unposting(uuid, date, date, bigint, int) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Next document numbers, in the formats the application uses
--    (journal-repository.ts::nextJournalNumber "JR000042",
--    posting-repository.ts::nextPostingBatchNumber "PB000007"), stepping
--    past any number already taken.
-- ---------------------------------------------------------------------
create or replace function fn_bank_unposting_next_number(p_company_id uuid, p_prefix text)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_n bigint;
  v_candidate text;
begin
  if p_prefix = 'JR' then
    select count(*) + 1 into v_n from ae_journals where company_id = p_company_id;
  else
    select count(*) + 1 into v_n from posting_batches where company_id = p_company_id;
  end if;
  loop
    v_candidate := p_prefix || case when length(v_n::text) < 6 then lpad(v_n::text, 6, '0') else v_n::text end;
    exit when p_prefix = 'JR' and not exists (select 1 from ae_journals where company_id = p_company_id and journal_number = v_candidate);
    exit when p_prefix = 'PB' and not exists (select 1 from posting_batches where company_id = p_company_id and batch_number = v_candidate);
    v_n := v_n + 1;
  end loop;
  return v_candidate;
end;
$$;
revoke execute on function fn_bank_unposting_next_number(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. The writer.
--
-- p_items: [{ "id", "journalId", "glAccount", "customerId", "supplierId" }]
-- — what the preview showed. A transaction whose journal or allocation has
-- changed since is skipped, never unposted on a stale picture; and every
-- companion of a skipped transaction on the same journal is skipped too.
--
-- Per reversed journal (one sub-transaction): reversal journal + lines +
-- mirrored gl_transactions in one posting batch for the run; original
-- flagged reversed; then for every transaction it carried:
--   posted_flag false; posted_at, journal_id, posting_batch_id -> NULL
--   retained_gl_account  <- suggested_gl_account (or NULL)
--   retained_customer_id <- matched_customer_id when allocation_type 'C'
--   retained_supplier_id <- matched_supplier_id when allocation_type 'S'
--   suggested_gl_account, allocation_type/method, rule_id -> NULL;
--   the 'C'/'S' party id -> NULL; allocation_status 'Unallocated';
--   is_manual_override true; one ae_allocation_history row.
-- ---------------------------------------------------------------------
create or replace function fn_bulk_unpost_bank_transactions(
  p_company_id uuid,
  p_request_key uuid,
  p_date_from date,
  p_date_to date,
  p_bank_account_id bigint,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text;
  v_ids bigint[];
  v_expected jsonb := '{}'::jsonb;
  v_item jsonb;
  v_id bigint;
  v_txn ae_bank_transactions;
  v_info jsonb := '{}'::jsonb;
  v_entry jsonb;
  v_reason text;
  v_gl text;
  v_journal_ids bigint[];
  v_jid bigint;
  v_j ae_journals;
  v_companions bigint[];
  v_requested_on_j bigint[];
  v_block text;
  v_cid bigint;
  v_run_id bigint;
  v_batch_id bigint;
  v_batch_here boolean;
  v_rev_id bigint;
  v_rev_number text;
  v_line ae_journal_lines;
  v_new_line_id bigint;
  v_orig_debit numeric;
  v_orig_credit numeric;
  v_rev_debit numeric;
  v_rev_credit numeric;
  v_updated int;
  v_reversed_journals int := 0;
  v_gl_rows int := 0;
  v_unposted int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_rows jsonb := '[]'::jsonb;
  v_results jsonb;
begin
  if auth.uid() is null then
    raise exception 'a signed-in user is required' using errcode = '42501';
  end if;
  if not user_has_permission(p_company_id, 'Banking:Edit') or not user_has_permission(p_company_id, 'GeneralLedger:Reverse') then
    raise exception 'Banking:Edit and GeneralLedger:Reverse are required' using errcode = '42501';
  end if;
  if p_request_key is null then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: a request key is required.' using errcode = '22023';
  end if;
  if p_date_from is null or p_date_to is null then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: From Date and To Date are required.' using errcode = '22023';
  end if;
  if p_date_from > p_date_to then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: From Date cannot be later than To Date.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: select at least one transaction.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 5000 then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: at most 5000 transactions per run; narrow the date range.' using errcode = '22023';
  end if;
  if p_bank_account_id is not null
     and not exists (select 1 from ae_bank_accounts where id = p_bank_account_id and company_id = p_company_id) then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: that bank account does not belong to this company.' using errcode = '42501';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    -- coalesce: jsonb_typeof of a missing key is NULL, and NULL <> 'number'
    -- would let the item through.
    if jsonb_typeof(v_item) <> 'object' or coalesce(jsonb_typeof(v_item->'id'), 'null') <> 'number'
       or coalesce(jsonb_typeof(v_item->'journalId'), 'null') <> 'number' then
      raise exception 'PRECISIA_UNALLOCATION_INVALID: every item needs a numeric id and journalId.' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_item->'customerId'), 'null') not in ('null', 'number')
       or coalesce(jsonb_typeof(v_item->'supplierId'), 'null') not in ('null', 'number') then
      raise exception 'PRECISIA_UNALLOCATION_INVALID: customerId and supplierId must be numbers or null.' using errcode = '22023';
    end if;
    v_expected := v_expected || jsonb_build_object(v_item->>'id', v_item);
  end loop;
  select array_agg(distinct k::bigint order by k::bigint) into v_ids from jsonb_object_keys(v_expected) k;

  -- One execution per preview, even under a double click or a retry; the
  -- request key is shared with 0119 runs, so it can never run both ways.
  perform pg_advisory_xact_lock(hashtextextended('bank-unallocation:' || p_request_key::text, 0));
  if exists (select 1 from bank_unallocation_runs where request_key = p_request_key) then
    raise exception 'PRECISIA_UNALLOCATION_DUPLICATE: this preview has already been executed. Preview again to start a new run.'
      using errcode = '23505';
  end if;

  v_actor := left(coalesce(nullif(btrim(fn_session_actor_label()), ''), auth.uid()::text), 200);
  v_run_id := nextval(pg_get_serial_sequence('bank_unallocation_runs', 'id'));

  -- Locks, always in this order (no deadlock between two overlapping runs):
  -- the requested rows, their journals, then every row those journals carry.
  perform 1 from ae_bank_transactions where company_id = p_company_id and id = any(v_ids) order by id for update;
  select coalesce(array_agg(distinct t.journal_id order by t.journal_id), '{}'::bigint[]) into v_journal_ids
    from ae_bank_transactions t where t.company_id = p_company_id and t.id = any(v_ids) and t.journal_id is not null;
  perform 1 from ae_journals where company_id = p_company_id and id = any(v_journal_ids) order by id for update;
  perform 1 from ae_bank_transactions where company_id = p_company_id and journal_id = any(v_journal_ids) order by id for update;

  -- Each requested row on its own: the shared rule, then the criteria and
  -- the preview's picture.
  foreach v_id in array v_ids loop
    v_txn := null;
    select * into v_txn from ae_bank_transactions where company_id = p_company_id and id = v_id;
    v_item := v_expected->(v_id::text);
    if v_txn.id is null then
      v_info := v_info || jsonb_build_object(v_id::text, jsonb_build_object('transaction_id', v_id, 'reason', 'Transaction not found in this company.'));
      continue;
    end if;

    v_gl := nullif(btrim(coalesce(v_txn.suggested_gl_account, '')), '');
    v_reason := fn_bank_unposting_exclusion(v_txn);
    if v_reason is null and (v_txn.transaction_date is null or v_txn.transaction_date not between p_date_from and p_date_to) then
      v_reason := 'Outside the selected date range.';
    end if;
    if v_reason is null and p_bank_account_id is not null and v_txn.bank_account_id is distinct from p_bank_account_id then
      v_reason := 'Not on the selected bank account.';
    end if;
    if v_reason is null and (
         v_txn.journal_id is distinct from (v_item->>'journalId')::bigint
      or coalesce(v_gl, '') <> btrim(coalesce(v_item->>'glAccount', ''))
      or (case when v_txn.allocation_type = 'C' then v_txn.matched_customer_id end) is distinct from (v_item->>'customerId')::bigint
      or (case when v_txn.allocation_type = 'S' then v_txn.matched_supplier_id end) is distinct from (v_item->>'supplierId')::bigint) then
      v_reason := 'Changed since the preview (its posting or allocation is different now). Preview again.';
    end if;

    select j.* into v_j from ae_journals j where j.company_id = p_company_id and j.id = v_txn.journal_id;
    v_info := v_info || jsonb_build_object(v_id::text, jsonb_build_object(
      'transaction_id', v_id,
      'reason', v_reason,
      'journal_id', v_txn.journal_id,
      'transaction_date', v_txn.transaction_date, 'debit', v_txn.debit, 'credit', v_txn.credit,
      'previous_allocation_status', v_txn.allocation_status, 'previous_allocation_type', v_txn.allocation_type,
      'previous_allocation_method', v_txn.allocation_method, 'previous_rule_id', v_txn.rule_id,
      'previous_is_manual_override', v_txn.is_manual_override,
      'previous_gl_account', v_gl,
      'previous_gl_account_name', (select description from chart_of_accounts where company_id = p_company_id and account_code = v_gl limit 1),
      'previous_posted_flag', v_txn.posted_flag,
      'previous_journal_id', v_txn.journal_id,
      'previous_journal_number', v_j.journal_number,
      'previous_journal_source_type', v_j.source_type,
      'previous_posting_batch_id', v_txn.posting_batch_id,
      'previous_customer_id', case when v_txn.allocation_type = 'C' then v_txn.matched_customer_id end,
      'previous_customer_code', case when v_txn.allocation_type = 'C' then
        (select coalesce(nullif(customer_code, ''), name) from customers where id = v_txn.matched_customer_id and company_id = p_company_id) end,
      'previous_supplier_id', case when v_txn.allocation_type = 'S' then v_txn.matched_supplier_id end,
      'previous_supplier_code', case when v_txn.allocation_type = 'S' then
        (select coalesce(nullif(supplier_code, ''), name) from ae_suppliers where id = v_txn.matched_supplier_id and company_id = p_company_id) end));
  end loop;

  -- Each journal as a whole.
  foreach v_jid in array v_journal_ids loop
    select * into v_j from ae_journals where company_id = p_company_id and id = v_jid;
    select coalesce(array_agg(id order by id), '{}'::bigint[]) into v_companions
      from ae_bank_transactions where company_id = p_company_id and journal_id = v_jid;
    select coalesce(array_agg(k::bigint order by k::bigint), '{}'::bigint[]) into v_requested_on_j
      from jsonb_each(v_info) e(k, v) where (v->>'journal_id')::bigint = v_jid;

    -- Already-skipped rows keep their own reason; the rest of the journal
    -- is held back with the reason that blocks it.
    v_block := null;
    foreach v_cid in array v_companions loop
      if not (v_cid = any(v_ids)) then
        v_block := format('Posted together on journal %s with transaction #%s, which is not in this selection. The whole journal is reversed or none of it; preview again and select them together.',
          v_j.journal_number, v_cid);
        exit;
      end if;
      if v_info->(v_cid::text)->>'reason' is not null then
        v_block := format('Posted together on journal %s with transaction #%s, which is being skipped (%s). The whole journal is reversed or none of it.',
          v_j.journal_number, v_cid, v_info->(v_cid::text)->>'reason');
        exit;
      end if;
    end loop;
    if v_block is not null then
      foreach v_cid in array v_requested_on_j loop
        if v_info->(v_cid::text)->>'reason' is null then
          v_info := jsonb_set(v_info, array[v_cid::text, 'reason'], to_jsonb(v_block));
        end if;
      end loop;
      continue;
    end if;

    v_batch_here := false;
    begin
      if v_batch_id is null then
        insert into posting_batches (company_id, batch_number, posting_date, journal_count, transaction_count, posted_by)
        values (p_company_id, fn_bank_unposting_next_number(p_company_id, 'PB'), current_date, 0, 0, v_actor)
        returning id into v_batch_id;
        v_batch_here := true;
      end if;

      v_rev_number := fn_bank_unposting_next_number(p_company_id, 'JR');
      insert into ae_journals (
        company_id, journal_number, journal_date, journal_type, description, reference,
        source_type, source_id, status, total_debit, total_credit, posted_at,
        submitted_by, submitted_at, approved_by, approved_at, posting_batch_id, reversal_of_journal_id
      ) values (
        p_company_id, v_rev_number, v_j.journal_date, 'Reversal',
        format('Reversal of %s (bulk unpost, run %s)', v_j.journal_number, v_run_id), coalesce(v_j.reference, ''),
        'journal_reversal', v_j.id, 'Posted', v_j.total_credit, v_j.total_debit, now(),
        v_actor, now(), v_actor, now(), v_batch_id, v_j.id
      ) returning id into v_rev_id;

      -- Line for line, ledger row for ledger row: same account, same date,
      -- same period, debit and credit swapped.
      for v_line in select * from ae_journal_lines where journal_id = v_j.id order by line_order, id loop
        insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order)
        values (v_rev_id, v_line.account_code, v_line.credit, v_line.debit, v_line.description, v_line.line_order)
        returning id into v_new_line_id;
        insert into gl_transactions (
          company_id, journal_id, journal_line_id, account_id, posting_date, reference, description,
          debit, credit, financial_year_label, financial_period, posted_by
        )
        select p_company_id, v_rev_id, v_new_line_id, g.account_id, g.posting_date, g.reference, g.description,
               g.credit, g.debit, g.financial_year_label, g.financial_period, v_actor
          from gl_transactions g
          where g.company_id = p_company_id and g.journal_id = v_j.id and g.journal_line_id = v_line.id
          order by g.id;
      end loop;

      -- Backstops: the reversal must exactly mirror the original and balance.
      select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_orig_debit, v_orig_credit
        from gl_transactions where company_id = p_company_id and journal_id = v_j.id;
      select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_rev_debit, v_rev_credit
        from gl_transactions where company_id = p_company_id and journal_id = v_rev_id;
      if v_rev_debit <> v_orig_credit or v_rev_credit <> v_orig_debit or v_rev_debit <> v_rev_credit
         or (select count(*) from gl_transactions where journal_id = v_rev_id) <> (select count(*) from gl_transactions where journal_id = v_j.id) then
        raise exception 'PRECISIA_UNPOST_MISMATCH: reversal of journal % does not mirror its ledger entries', v_j.journal_number;
      end if;

      update ae_journals set is_reversed = true, reversed_by_journal_id = v_rev_id
        where company_id = p_company_id and id = v_j.id and not coalesce(is_reversed, false) and reversed_by_journal_id is null;
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'PRECISIA_UNPOST_RACE: journal % was reversed concurrently', v_j.journal_number;
      end if;

      insert into ae_allocation_history (
        company_id, transaction_id, previous_status, new_status, previous_gl_account, new_gl_account,
        previous_vat_code, new_vat_code, allocation_method, allocation_reason, is_manual_override, performed_by
      )
      select p_company_id, t.id, t.allocation_status, 'Unallocated', nullif(btrim(coalesce(t.suggested_gl_account, '')), ''), null,
             t.suggested_vat_code, t.suggested_vat_code, 'Manual',
             format('Bulk unposted (run %s): journal %s reversed by %s; previous allocation retained for review', v_run_id, v_j.journal_number, v_rev_number),
             true, v_actor
        from ae_bank_transactions t
        where t.company_id = p_company_id and t.journal_id = v_j.id
        order by t.id;

      update ae_bank_transactions t
         set posted_flag = false,
             posted_at = null,
             journal_id = null,
             posting_batch_id = null,
             retained_gl_account = nullif(btrim(coalesce(t.suggested_gl_account, '')), ''),
             retained_customer_id = case when t.allocation_type = 'C' then t.matched_customer_id end,
             retained_supplier_id = case when t.allocation_type = 'S' then t.matched_supplier_id end,
             matched_customer_id = case when t.allocation_type = 'C' then null else t.matched_customer_id end,
             matched_supplier_id = case when t.allocation_type = 'S' then null else t.matched_supplier_id end,
             suggested_gl_account = null,
             allocation_type = null,
             allocation_status = 'Unallocated',
             allocation_method = null,
             rule_id = null,
             is_manual_override = true,
             allocation_reason = format('Bulk unposted (run %s): journal %s reversed by %s; previous allocation retained for review', v_run_id, v_j.journal_number, v_rev_number)
       where t.company_id = p_company_id and t.journal_id = v_j.id;
      get diagnostics v_updated = row_count;
      if v_updated <> coalesce(array_length(v_companions, 1), 0) then
        raise exception 'PRECISIA_UNPOST_RACE: journal % carries a different set of transactions than was checked', v_j.journal_number;
      end if;

      v_reversed_journals := v_reversed_journals + 1;
      v_gl_rows := v_gl_rows + (select count(*) from gl_transactions where journal_id = v_rev_id);
      foreach v_cid in array v_requested_on_j loop
        v_info := jsonb_set(v_info, array[v_cid::text], (v_info->(v_cid::text)) || jsonb_build_object(
          'outcome', 'unposted', 'reversal_journal_id', v_rev_id, 'reversal_journal_number', v_rev_number));
      end loop;
    exception when others then
      -- The sub-transaction is rolled back: the journal, its ledger entries
      -- and every transaction it carries are exactly as they were.
      if v_batch_here then v_batch_id := null; end if;
      v_reason := left(sqlerrm, 500);
      foreach v_cid in array v_requested_on_j loop
        v_info := jsonb_set(v_info, array[v_cid::text], (v_info->(v_cid::text)) || jsonb_build_object('outcome', 'failed', 'reason', v_reason));
      end loop;
    end;
  end loop;

  if v_batch_id is not null then
    update posting_batches set journal_count = v_reversed_journals, transaction_count = v_gl_rows where id = v_batch_id;
  end if;

  foreach v_id in array v_ids loop
    v_entry := v_info->(v_id::text);
    if v_entry->>'outcome' is null then
      v_entry := v_entry || jsonb_build_object('outcome', 'skipped', 'reason', coalesce(v_entry->>'reason', 'Not processed.'));
    end if;
    if v_entry->>'outcome' = 'unposted' then
      v_entry := v_entry || jsonb_build_object('reason', '');
      v_unposted := v_unposted + 1;
    elsif v_entry->>'outcome' = 'skipped' then v_skipped := v_skipped + 1;
    else v_failed := v_failed + 1;
    end if;
    v_rows := v_rows || v_entry;
  end loop;

  insert into bank_unallocation_runs (
    id, company_id, request_key, bank_account_id, date_from, date_to, mode,
    requested_count, unallocated_count, unposted_count, skipped_count, failed_count,
    reversed_journal_count, reversal_posting_batch_id, actor_user_id, actor_label
  ) overriding system value values (
    v_run_id, p_company_id, p_request_key, p_bank_account_id, p_date_from, p_date_to, 'unpost',
    coalesce(array_length(v_ids, 1), 0), 0, v_unposted, v_skipped, v_failed,
    v_reversed_journals, v_batch_id, auth.uid(), 'session'
  );

  insert into bank_unallocation_run_items (
    run_id, company_id, transaction_id, outcome, reason, transaction_date, debit, credit,
    previous_allocation_status, previous_allocation_type, previous_allocation_method,
    previous_rule_id, previous_is_manual_override, previous_gl_account, previous_gl_account_name,
    previous_posted_flag, previous_journal_id, previous_journal_number, previous_journal_source_type,
    previous_posting_batch_id, reversal_journal_id, reversal_journal_number,
    previous_customer_id, previous_customer_code, previous_supplier_id, previous_supplier_code
  )
  select v_run_id, p_company_id, r.transaction_id, r.outcome, coalesce(r.reason, ''), r.transaction_date, r.debit, r.credit,
         r.previous_allocation_status, r.previous_allocation_type, r.previous_allocation_method,
         r.previous_rule_id, r.previous_is_manual_override, r.previous_gl_account, r.previous_gl_account_name,
         r.previous_posted_flag, r.previous_journal_id, r.previous_journal_number, r.previous_journal_source_type,
         r.previous_posting_batch_id, r.reversal_journal_id, r.reversal_journal_number,
         r.previous_customer_id, r.previous_customer_code, r.previous_supplier_id, r.previous_supplier_code
  from jsonb_to_recordset(v_rows) as r(
    transaction_id bigint, outcome text, reason text, transaction_date date, debit numeric, credit numeric,
    previous_allocation_status text, previous_allocation_type text, previous_allocation_method text,
    previous_rule_id bigint, previous_is_manual_override boolean, previous_gl_account text, previous_gl_account_name text,
    previous_posted_flag boolean, previous_journal_id bigint, previous_journal_number text, previous_journal_source_type text,
    previous_posting_batch_id bigint, reversal_journal_id bigint, reversal_journal_number text,
    previous_customer_id bigint, previous_customer_code text, previous_supplier_id bigint, previous_supplier_code text
  )
  order by r.transaction_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'transactionId', (r->>'transaction_id')::bigint,
           'outcome', r->>'outcome',
           'reason', coalesce(r->>'reason', ''),
           'glAccount', r->>'previous_gl_account',
           'glAccountName', r->>'previous_gl_account_name',
           'customerCode', r->>'previous_customer_code',
           'supplierCode', r->>'previous_supplier_code',
           'journalNumber', r->>'previous_journal_number',
           'reversalJournalNumber', r->>'reversal_journal_number'
         ) order by (r->>'transaction_id')::bigint), '[]'::jsonb)
    into v_results
    from jsonb_array_elements(v_rows) r;

  return jsonb_build_object(
    'runId', v_run_id,
    'requested', coalesce(array_length(v_ids, 1), 0),
    'unposted', v_unposted,
    'skipped', v_skipped,
    'failed', v_failed,
    'reversedJournals', v_reversed_journals,
    'postingBatchId', v_batch_id,
    'items', v_results
  );
end;
$$;
revoke execute on function fn_bulk_unpost_bank_transactions(uuid, uuid, date, date, bigint, jsonb) from public, anon, service_role;
grant execute on function fn_bulk_unpost_bank_transactions(uuid, uuid, date, date, bigint, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 7. 0119's writer, unchanged except for one thing: when it retains a GL
--    account it also clears any customer / supplier retained by an earlier
--    unposting, so the retained references always describe the same, most
--    recent allocation.
-- ---------------------------------------------------------------------
create or replace function fn_bulk_unallocate_bank_transactions(
  p_company_id uuid,
  p_request_key uuid,
  p_date_from date,
  p_date_to date,
  p_bank_account_id bigint,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text;
  v_ids bigint[];
  v_expected jsonb := '{}'::jsonb;
  v_item jsonb;
  v_id bigint;
  v_txn ae_bank_transactions;
  v_gl text;
  v_gl_name text;
  v_reason text;
  v_outcome text;
  v_run_id bigint;
  v_rows jsonb := '[]'::jsonb;
  v_results jsonb;
  v_unallocated int := 0;
  v_skipped int := 0;
  v_failed int := 0;
begin
  if auth.uid() is null then
    raise exception 'a signed-in user is required' using errcode = '42501';
  end if;
  if not user_has_permission(p_company_id, 'Banking:Edit') then
    raise exception 'Banking:Edit is required' using errcode = '42501';
  end if;
  if p_request_key is null then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: a request key is required.' using errcode = '22023';
  end if;
  if p_date_from is null or p_date_to is null then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: From Date and To Date are required.' using errcode = '22023';
  end if;
  if p_date_from > p_date_to then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: From Date cannot be later than To Date.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: select at least one transaction.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 5000 then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: at most 5000 transactions per run; narrow the date range.' using errcode = '22023';
  end if;
  if p_bank_account_id is not null
     and not exists (select 1 from ae_bank_accounts where id = p_bank_account_id and company_id = p_company_id) then
    raise exception 'PRECISIA_UNALLOCATION_INVALID: that bank account does not belong to this company.' using errcode = '42501';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'id') <> 'number' then
      raise exception 'PRECISIA_UNALLOCATION_INVALID: every item needs a numeric id.' using errcode = '22023';
    end if;
    v_expected := v_expected || jsonb_build_object(v_item->>'id', coalesce(v_item->>'glAccount', ''));
  end loop;
  select array_agg(distinct k::bigint order by k::bigint) into v_ids from jsonb_object_keys(v_expected) k;

  -- One execution per preview, even under a double click or a retry.
  perform pg_advisory_xact_lock(hashtextextended('bank-unallocation:' || p_request_key::text, 0));
  if exists (select 1 from bank_unallocation_runs where request_key = p_request_key) then
    raise exception 'PRECISIA_UNALLOCATION_DUPLICATE: this preview has already been executed. Preview again to start a new run.'
      using errcode = '23505';
  end if;

  v_actor := left(coalesce(nullif(btrim(fn_session_actor_label()), ''), auth.uid()::text), 200);
  v_run_id := nextval(pg_get_serial_sequence('bank_unallocation_runs', 'id'));

  -- Lock every requested row of THIS company, in id order (no deadlock
  -- between two overlapping runs), before deciding anything.
  perform 1 from ae_bank_transactions
    where company_id = p_company_id and id = any(v_ids)
    order by id
    for update;

  foreach v_id in array v_ids loop
    v_txn := null;
    v_gl := null;
    v_gl_name := null;
    select * into v_txn from ae_bank_transactions where company_id = p_company_id and id = v_id;

    if v_txn.id is null then
      v_outcome := 'skipped';
      v_reason := 'Transaction not found in this company.';
    else
      v_gl := nullif(btrim(coalesce(v_txn.suggested_gl_account, '')), '');
      select description into v_gl_name from chart_of_accounts where company_id = p_company_id and account_code = v_gl limit 1;
      v_reason := fn_bank_unallocation_exclusion(v_txn);
      if v_reason is null and (v_txn.transaction_date is null or v_txn.transaction_date not between p_date_from and p_date_to) then
        v_reason := 'Outside the selected date range.';
      end if;
      if v_reason is null and p_bank_account_id is not null and v_txn.bank_account_id is distinct from p_bank_account_id then
        v_reason := 'Not on the selected bank account.';
      end if;
      if v_reason is null and coalesce(v_gl, '') <> btrim(v_expected->>v_id::text) then
        v_reason := format('Changed since the preview (GL account is now %s). Preview again.', coalesce(v_gl, 'none'));
      end if;

      if v_reason is not null then
        v_outcome := 'skipped';
      else
        begin
          update ae_bank_transactions
             set retained_gl_account = v_gl,
                 retained_customer_id = null,
                 retained_supplier_id = null,
                 suggested_gl_account = null,
                 allocation_type = null,
                 allocation_status = 'Unallocated',
                 allocation_method = null,
                 rule_id = null,
                 is_manual_override = true,
                 allocation_reason = format('Bulk unallocated (run %s); GL account %s retained for review', v_run_id, v_gl)
           where company_id = p_company_id and id = v_id;

          insert into ae_allocation_history (
            company_id, transaction_id, previous_status, new_status, previous_gl_account, new_gl_account,
            previous_vat_code, new_vat_code, allocation_method, allocation_reason, is_manual_override, performed_by
          ) values (
            p_company_id, v_id, v_txn.allocation_status, 'Unallocated', v_gl, null,
            v_txn.suggested_vat_code, v_txn.suggested_vat_code, 'Manual',
            format('Bulk unallocated (run %s); GL account %s retained for review', v_run_id, v_gl), true, v_actor
          );
          v_outcome := 'unallocated';
          v_reason := '';
        exception when others then
          -- The sub-transaction is rolled back: this row is exactly as it was.
          v_outcome := 'failed';
          v_reason := left(sqlerrm, 500);
        end;
      end if;
    end if;

    if v_outcome = 'unallocated' then v_unallocated := v_unallocated + 1;
    elsif v_outcome = 'skipped' then v_skipped := v_skipped + 1;
    else v_failed := v_failed + 1;
    end if;

    v_rows := v_rows || jsonb_build_object(
      'transaction_id', v_id, 'outcome', v_outcome, 'reason', v_reason,
      'transaction_date', v_txn.transaction_date, 'debit', v_txn.debit, 'credit', v_txn.credit,
      'previous_allocation_status', v_txn.allocation_status, 'previous_allocation_type', v_txn.allocation_type,
      'previous_allocation_method', v_txn.allocation_method, 'previous_rule_id', v_txn.rule_id,
      'previous_is_manual_override', v_txn.is_manual_override,
      'previous_gl_account', v_gl, 'previous_gl_account_name', v_gl_name
    );
  end loop;

  insert into bank_unallocation_runs (
    id, company_id, request_key, bank_account_id, date_from, date_to,
    requested_count, unallocated_count, skipped_count, failed_count, actor_user_id, actor_label
  ) overriding system value values (
    v_run_id, p_company_id, p_request_key, p_bank_account_id, p_date_from, p_date_to,
    coalesce(array_length(v_ids, 1), 0), v_unallocated, v_skipped, v_failed, auth.uid(), 'session'
  );

  insert into bank_unallocation_run_items (
    run_id, company_id, transaction_id, outcome, reason, transaction_date, debit, credit,
    previous_allocation_status, previous_allocation_type, previous_allocation_method,
    previous_rule_id, previous_is_manual_override, previous_gl_account, previous_gl_account_name
  )
  select v_run_id, p_company_id, r.transaction_id, r.outcome, r.reason, r.transaction_date, r.debit, r.credit,
         r.previous_allocation_status, r.previous_allocation_type, r.previous_allocation_method,
         r.previous_rule_id, r.previous_is_manual_override, r.previous_gl_account, r.previous_gl_account_name
  from jsonb_to_recordset(v_rows) as r(
    transaction_id bigint, outcome text, reason text, transaction_date date, debit numeric, credit numeric,
    previous_allocation_status text, previous_allocation_type text, previous_allocation_method text,
    previous_rule_id bigint, previous_is_manual_override boolean, previous_gl_account text, previous_gl_account_name text
  )
  order by r.transaction_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'transactionId', (r->>'transaction_id')::bigint,
           'outcome', r->>'outcome',
           'reason', r->>'reason',
           'glAccount', r->>'previous_gl_account',
           'glAccountName', r->>'previous_gl_account_name'
         ) order by (r->>'transaction_id')::bigint), '[]'::jsonb)
    into v_results
    from jsonb_array_elements(v_rows) r;

  return jsonb_build_object(
    'runId', v_run_id,
    'requested', coalesce(array_length(v_ids, 1), 0),
    'unallocated', v_unallocated,
    'skipped', v_skipped,
    'failed', v_failed,
    'items', v_results
  );
end;
$$;
revoke execute on function fn_bulk_unallocate_bank_transactions(uuid, uuid, date, date, bigint, jsonb) from public, anon, service_role;
grant execute on function fn_bulk_unallocate_bank_transactions(uuid, uuid, date, date, bigint, jsonb) to authenticated;
