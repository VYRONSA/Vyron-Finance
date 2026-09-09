-- =====================================================================
-- Part 1 — Duplicate-preserving import identity
-- =====================================================================
--
-- Requirement change (client migration policy): VYRON migrates a client's
-- existing accounting records; it does NOT audit, consolidate or suppress
-- them. If a Xero export contains two transactions with the same date,
-- amount and description, BOTH are real client records and BOTH must be
-- imported. The client corrects their own accounting mistakes inside
-- VYRON, deliberately — the migration never does it for them.
--
-- `ae_bank_transactions_natural_key` (0004, rebuilt by 0089) made that
-- impossible: it is a value tuple
--   (company_id, bank_account, transaction_date, reference, debit,
--    credit, import_description)
-- so the second of two identical source rows was rejected as a duplicate
-- and silently counted as "already imported". Measured against the live
-- Metanoia Hospitality / New Handcrafted Food Products migration: 621
-- source rows in, 480 rows on file — 141 genuine Xero records dropped.
--
-- The fix is NOT to drop the constraint (that would also drop re-import
-- idempotency, which is still required). It is to make the key identify
-- a SOURCE RECORD instead of a VALUE:
--
--   `source_occurrence` = this row's 1-based ordinal among the rows that
--   share its value tuple WITHIN ITS OWN SOURCE (one statement file, one
--   Xero export, one bank-feed page).
--
-- Two identical rows in one file are occurrences 1 and 2 -> two distinct
-- keys -> both import. Re-submitting that same file reproduces
-- occurrences 1 and 2 -> both collide -> nothing is duplicated. Genuinely
-- separate source records are preserved; re-running one import is still
-- idempotent. `assignSourceOccurrences` (import-source-occurrence.ts) is
-- the single shared function that computes it, used by every ingestion
-- path (Import Centre, Xero migration, direct bank feed).
--
-- Backfill: every existing row is occurrence 1. That is exact, not an
-- approximation — under the old constraint no value tuple could ever have
-- had more than one row, so 1 is the only possible ordinal each of them
-- can have. It also means a re-run of any previously-run import matches
-- the rows already on file (occurrence 1) and only inserts what was
-- previously rejected (occurrences 2+), which is precisely the intended
-- recovery path for the 141 dropped Metanoia rows.

alter table ae_bank_transactions
  add column source_occurrence integer not null default 1;

alter table ae_bank_transactions
  drop constraint ae_bank_transactions_natural_key;

-- Name deliberately unchanged: `isDuplicateNaturalKey`
-- (transaction-explorer-repository.ts) classifies 23505 errors by
-- constraint name and must keep recognising this one.
alter table ae_bank_transactions
  add constraint ae_bank_transactions_natural_key
  unique (company_id, bank_account, transaction_date, reference, debit, credit, import_description, source_occurrence);

-- =====================================================================
-- Part 2 — Bank transaction -> accounting posting linkage
-- =====================================================================
--
-- `posted_flag` and `journal_id` have existed on this table since 0002/
-- 0005 but nothing ever set `posted_flag`: a transaction could be
-- classified (a GL account assigned) and even journaled, with no way to
-- tell from the row itself whether it had actually entered the General
-- Ledger. "Classified" is not "posted", and the Transaction Explorer has
-- to be able to say which of the two a row is. These columns make the
-- posted state real and traceable in both directions:
--
--   posted_flag       true only once gl_transactions rows exist for it
--   posted_at         when that happened
--   journal_id        the journal it was posted through (already existed)
--   posting_batch_id  the posting batch that wrote the ledger
--
-- Together with the pre-existing `reconciliation_id` this gives the four
-- states the workflow requires, all derived from real rows rather than a
-- decorative status column:
--   Unprocessed  — no allocation yet
--   Ready to Post— allocated, posted_flag false
--   Posted       — posted_flag true (gl_transactions exist)
--   Reconciled   — reconciliation_id set (and posted)

alter table ae_bank_transactions
  add column posted_at timestamptz,
  add column posting_batch_id bigint references posting_batches (id) on delete set null;

create index ae_bank_transactions_posted_flag_idx on ae_bank_transactions (company_id, posted_flag);
create index ae_bank_transactions_posting_batch_id_idx on ae_bank_transactions (posting_batch_id);

-- "Has this transaction been told where it belongs?" — the difference
-- between Unprocessed and Ready to Post, as a single stored fact rather
-- than a condition each caller re-expresses.
--
-- It is a generated column and not a plain boolean specifically so it
-- cannot drift: TypeScript treats a blank `suggested_gl_account` as
-- unallocated (`transactionPostingStatus`), and a hand-written SQL
-- predicate spelling that as `suggested_gl_account is not null` would
-- silently disagree for the empty string — which is exactly what the
-- Explorer writes when an accountant CLEARS an allocation. Deriving it in
-- the database from the same two columns removes the possibility of the
-- badge in the grid and the filter behind it telling different stories.
alter table ae_bank_transactions
  add column is_allocated boolean
  generated always as (nullif(btrim(coalesce(suggested_gl_account, '')), '') is not null or is_split) stored;

create index ae_bank_transactions_workflow_state_idx
  on ae_bank_transactions (company_id, posted_flag, reconciliation_id, is_allocated);

-- =====================================================================
-- Part 3 — Bank reconciliation: statement period and opening balance
-- =====================================================================
--
-- `bank_reconciliations` (0022) recorded only a statement DATE and a
-- CLOSING balance, so the reconciliation could show a difference but not
-- the arithmetic that produced it. A real reconciliation proves:
--
--   opening balance + cleared deposits - cleared payments = closing balance
--
-- which needs the period's start and its opening balance as first-class,
-- user-confirmable values. `statement_date` keeps its existing meaning as
-- the period END (every existing row and every code path that reads it is
-- unaffected); `statement_period_start` is nullable because reconciliations
-- created before this migration genuinely have no recorded start date —
-- defaulting it to something invented would fabricate a fact.

alter table bank_reconciliations
  add column statement_period_start date,
  add column statement_opening_balance numeric(14, 2) not null default 0;

-- =====================================================================
-- Part 4 — fn_post_bank_transactions: the atomic bank posting write
-- =====================================================================
--
-- Posting processed bank transactions to the accounting ledger touches
-- five tables (ae_journals, ae_journal_lines, posting_batches,
-- gl_transactions, ae_bank_transactions). Doing that as separate
-- PostgREST calls has the exact two failure modes 0063 was written to
-- eliminate for manual journals: a concurrent second "Post to Accounting"
-- could post the same transaction twice, and a mid-sequence failure could
-- leave a transaction flagged posted with no ledger entries (or ledger
-- entries with no flag). This function is the bank-transaction
-- counterpart of `fn_post_approved_journals` — one statement, one
-- transaction, all of it or none of it.
--
-- Race safety comes from the same conditional-claim discipline: the
-- opening UPDATE only claims rows that are still `posted_flag = false
-- and journal_id is null` at the instant it runs, so a concurrent run can
-- never claim a row this one already took. Every journal's lines are then
-- filtered down to the transactions THIS call actually claimed, which is
-- safe because each transaction contributes its own self-balancing group
-- of lines (see `buildJournalLinesForTransaction`) — dropping a
-- transaction's whole group can never unbalance the remainder.
--
-- One posting batch per call, one journal per transaction DATE within it.
-- Per-date journals are not cosmetic: gl_transactions.posting_date and
-- the financial period are taken from the journal date, so a single
-- journal covering six months of migrated statement lines would post
-- every one of them into whatever period the run happened to fall in.
--
-- Validation that can be expressed purely (balance, chart-of-accounts
-- coverage, financial period) stays in TypeScript and is unit tested
-- there — same split 0063 established. The two checks repeated here are
-- backstops against a caller bug corrupting the ledger, and they abort
-- the whole call rather than writing something half-valid.
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

-- =====================================================================
-- Part 5 — fn_bank_posting_summary: Transaction Explorer status counts
-- =====================================================================
--
-- The four workflow states counted DB-side for the same reason
-- `fn_transaction_explorer_summary` (0005) exists: a company can hold
-- 100,000+ transactions and pulling them all into Node to count them
-- would violate the module's own performance requirement.
create or replace function fn_bank_posting_summary(p_company_id uuid)
returns table (
  unprocessed bigint,
  ready_to_post bigint,
  posted bigint,
  reconciled bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where posted_flag = false and reconciliation_id is null and is_allocated = false) as unprocessed,
    count(*) filter (where posted_flag = false and reconciliation_id is null and is_allocated = true) as ready_to_post,
    count(*) filter (where posted_flag = true and reconciliation_id is null) as posted,
    count(*) filter (where reconciliation_id is not null) as reconciled
  from ae_bank_transactions
  where company_id = p_company_id;
$$;
