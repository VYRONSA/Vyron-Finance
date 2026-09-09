-- Master Implementation Tracker — Epic E1 (Accounting Integrity & Posting
-- Engine), Root Cause RC-2, Finding #195.
--
-- `depreciation-run-service.ts::runDepreciation` posts its journal
-- through the now-atomic `fn_post_approved_journals` (0063), but the
-- write-back AFTER that — insert depreciation_run_lines, update every
-- depreciated asset's accumulated_depreciation, mark the run Posted —
-- was still three separate, non-transactional calls. A failure between
-- them could leave a real, posted GL journal with no matching run lines,
-- some assets updated and others not, and the run itself still reading
-- as not-yet-posted even though its journal is already live.
--
-- Two independent fixes:
-- 1. A partial unique index makes it impossible for the SAME period to
--    ever have two Posted runs for one company — the real-world trigger
--    for double-depreciating (a stuck/ambiguous run getting re-run).
--    Scoped to `status = 'Posted'` only, so a Draft run that never ends
--    up posting (e.g. total depreciation was zero, or a retry after a
--    failure) never blocks a later legitimate attempt at that period.
-- 2. `fn_post_depreciation_run` makes the run-lines/asset-update/mark-
--    posted sequence one atomic statement, the same pattern as
--    `fn_post_approved_journals`.

create unique index depreciation_runs_company_period_posted_idx
  on depreciation_runs (company_id, period_start, period_end)
  where status = 'Posted';

create or replace function fn_post_depreciation_run(
  p_company_id uuid,
  p_run_id bigint,
  p_journal_id bigint,
  p_total_amount numeric,
  p_lines jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into depreciation_run_lines (run_id, asset_id, depreciation_amount, accumulated_depreciation_after, net_book_value_after)
  select
    p_run_id,
    (l->>'assetId')::bigint,
    (l->>'depreciationAmount')::numeric,
    (l->>'accumulatedDepreciationAfter')::numeric,
    (l->>'netBookValueAfter')::numeric
  from jsonb_array_elements(p_lines) l;

  update fixed_assets fa
    set accumulated_depreciation = (l->>'accumulatedDepreciationAfter')::numeric
    from jsonb_array_elements(p_lines) l
    where fa.company_id = p_company_id and fa.id = (l->>'assetId')::bigint;

  update depreciation_runs
    set status = 'Posted', total_amount = p_total_amount, journal_id = p_journal_id
    where company_id = p_company_id and id = p_run_id;
end;
$$;
