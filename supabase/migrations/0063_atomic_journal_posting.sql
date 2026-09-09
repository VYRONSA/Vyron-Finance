-- Master Implementation Tracker — Epic E1 (Accounting Integrity & Posting
-- Engine), Root Cause RC-2 / Finding #041.
--
-- `posting-engine-service.ts::postApprovedJournals` previously claimed
-- Approved journals by reading them, then wrote posting_batches,
-- gl_transactions, and the ae_journals status update as three separate,
-- non-transactional PostgREST calls. Two concurrent "Post Approved
-- Journals" runs could both read the same Approved journal before either
-- one marked it Posted, producing duplicate GL entries for one journal; a
-- failure between the three calls could also leave a journal Posted with
-- no matching gl_transactions, or a posting_batches row with no journals
-- actually claimed.
--
-- This function makes the whole write atomic and race-safe in one
-- statement: the UPDATE...WHERE status = 'Approved' inside it only ever
-- claims a row still Approved at the moment it runs, so a second
-- concurrent call naturally excludes anything the first call already
-- claimed (Postgres serializes concurrent UPDATEs touching the same
-- rows). Balance/account/period validation stays in TypeScript
-- (`buildGlTransactionRowsForJournal`, `checkPostingDate`) — deliberately
-- kept pure and independently unit-tested, per that function's own header
-- comment — this migration only makes the DB write atomic, it doesn't
-- move validation into SQL.
create or replace function fn_post_approved_journals(
  p_company_id uuid,
  p_journal_ids bigint[],
  p_gl_rows jsonb,
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
  v_claimed_ids bigint[];
  v_claimed_count int;
  v_batch_id bigint;
  v_batch_row record;
begin
  with claimed as (
    update ae_journals
      set status = 'Posted', posted_at = now()
      where company_id = p_company_id
        and id = any(p_journal_ids)
        and status = 'Approved'
      returning id
  )
  select array_agg(id) into v_claimed_ids from claimed;

  v_claimed_count := coalesce(array_length(v_claimed_ids, 1), 0);

  if v_claimed_count = 0 then
    return jsonb_build_object('batch', null, 'claimedJournalIds', '[]'::jsonb);
  end if;

  insert into posting_batches (company_id, batch_number, posting_date, journal_count, transaction_count, posted_by)
  values (
    p_company_id,
    p_batch_number,
    p_posting_date,
    v_claimed_count,
    (select count(*) from jsonb_array_elements(p_gl_rows) r where (r->>'journalId')::bigint = any(v_claimed_ids)),
    p_posted_by
  )
  returning id into v_batch_id;

  update ae_journals set posting_batch_id = v_batch_id where company_id = p_company_id and id = any(v_claimed_ids);

  insert into gl_transactions (
    company_id, journal_id, journal_line_id, account_id, posting_date, reference, description,
    debit, credit, financial_year_label, financial_period, posted_by
  )
  select
    p_company_id,
    (r->>'journalId')::bigint,
    (r->>'journalLineId')::bigint,
    (r->>'accountId')::bigint,
    (r->>'postingDate')::date,
    coalesce(r->>'reference', ''),
    coalesce(r->>'description', ''),
    (r->>'debit')::numeric,
    (r->>'credit')::numeric,
    coalesce(r->>'financialYearLabel', ''),
    (r->>'financialPeriod')::int,
    p_posted_by
  from jsonb_array_elements(p_gl_rows) r
  where (r->>'journalId')::bigint = any(v_claimed_ids);

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
    'claimedJournalIds', to_jsonb(v_claimed_ids)
  );
end;
$$;
