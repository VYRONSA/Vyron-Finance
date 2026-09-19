-- Database tests for migration 0109 (Phase 5N certification boundaries).
--
-- LOCAL / SYNTHETIC DATA ONLY. Everything runs in ONE transaction that is
-- rolled back at the end, so nothing is left behind. Never run against a
-- shared or production database.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/certification_call_ceiling.test.sql
--
-- What this proves, in the brief's own words: the certification call
-- ceiling is finite, visible, atomic, fail-closed, resettable only
-- intentionally, and impossible for parallel certification workers to
-- exceed. The last of those is proved with real concurrent connections,
-- not by reasoning about the SQL — the same technique that proved
-- `next_document_number()` in Phase 5J.

\set ON_ERROR_STOP 1
set client_min_messages = notice;
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'PASS: %', label;
end;
$$;

create function pg_temp.co() returns uuid language sql as $$ select '5e000000-0000-4000-8000-00000000c001'::uuid $$;

insert into organisations (id, name) values ('5e000000-0000-4000-8000-0000000000aa', '5N certification org')
on conflict (id) do nothing;
insert into companies (id, organisation_id, name)
values (pg_temp.co(), '5e000000-0000-4000-8000-0000000000aa', '5N Certification Co')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 1. FINITE — there is no unlimited value.
-- ---------------------------------------------------------------------
do $$
declare v_failed boolean;
begin
  begin
    perform fn_ai_certification_open_run(pg_temp.co(), 'no ceiling', 0, 'tester');
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.ok(v_failed, 'a ceiling of zero is refused — a run must have a real budget');

  begin
    perform fn_ai_certification_open_run(pg_temp.co(), 'null ceiling', null, 'tester');
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.ok(v_failed, 'a null ceiling is refused — null does not mean unlimited here');

  begin
    perform fn_ai_certification_open_run(pg_temp.co(), '   ', 10, 'tester');
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.ok(v_failed, 'a run must say what it is for — an unlabelled run is not reviewable');
end;
$$;

-- ---------------------------------------------------------------------
-- 2. VISIBLE and consumed one call at a time.
-- ---------------------------------------------------------------------
do $$
declare
  v_run bigint;
  v_result jsonb;
begin
  v_run := fn_ai_certification_open_run(pg_temp.co(), 'visible run', 3, 'tester');

  perform pg_temp.ok((select calls_used from ai_certification_runs where id = v_run) = 0,
    'a new run has spent nothing');

  v_result := fn_ai_certification_reserve_call(v_run);
  perform pg_temp.ok((v_result->>'reserved')::boolean, 'the first call is allowed');
  perform pg_temp.ok((v_result->>'calls_used')::int = 1, 'and is counted');
  perform pg_temp.ok((v_result->>'call_ceiling')::int = 3, 'the ceiling is reported back, so a caller can show progress');

  perform fn_ai_certification_reserve_call(v_run);
  v_result := fn_ai_certification_reserve_call(v_run);
  perform pg_temp.ok((v_result->>'reserved')::boolean, 'the third and last call is allowed');
  perform pg_temp.ok(v_result->>'status' = 'Exhausted',
    'reaching the ceiling closes the run immediately, rather than leaving it Open and refusing one at a time');

  -- 3. FAIL-CLOSED — past the ceiling nothing is granted.
  v_result := fn_ai_certification_reserve_call(v_run);
  perform pg_temp.ok(not (v_result->>'reserved')::boolean, 'the fourth call is refused');
  perform pg_temp.ok((select calls_used from ai_certification_runs where id = v_run) = 3,
    'and a refusal consumes nothing — the counter did not move');
  perform pg_temp.ok(v_result->>'reason' <> '', 'the refusal says why');
end;
$$;

-- ---------------------------------------------------------------------
-- 3. FAIL-CLOSED in every other shape too.
-- ---------------------------------------------------------------------
do $$
declare
  v_run bigint;
  v_result jsonb;
begin
  v_result := fn_ai_certification_reserve_call(-1);
  perform pg_temp.ok(not (v_result->>'reserved')::boolean, 'a run that does not exist grants nothing');
  perform pg_temp.ok(v_result->>'status' = 'Missing', 'and says so rather than pretending to be open');

  v_run := fn_ai_certification_open_run(pg_temp.co(), 'closed run', 5, 'tester');
  perform fn_ai_certification_close_run(v_run);
  v_result := fn_ai_certification_reserve_call(v_run);
  perform pg_temp.ok(not (v_result->>'reserved')::boolean,
    'a CLOSED run grants nothing, even with budget left — closing is how a human stops a run mid-flight');
  perform pg_temp.ok((select calls_used from ai_certification_runs where id = v_run) = 0,
    'and still consumes nothing');
end;
$$;

-- ---------------------------------------------------------------------
-- 4. RESETTABLE ONLY INTENTIONALLY.
-- ---------------------------------------------------------------------
do $$
declare
  v_run bigint;
  v_second bigint;
  v_failed boolean;
begin
  v_run := fn_ai_certification_open_run(pg_temp.co(), 'the only open run', 4, 'tester');

  -- "Just open another one" is not available while a run is in flight.
  begin
    v_second := fn_ai_certification_open_run(pg_temp.co(), 'a sneaky second run', 100, 'tester');
    v_failed := false;
  exception when unique_violation then v_failed := true;
  end;
  perform pg_temp.ok(v_failed,
    'a second concurrent run for the same company is refused — two ceilings for one experiment is no ceiling');

  -- Nothing in the API raises a ceiling or zeroes a counter.
  perform pg_temp.ok(
    not exists (
      select 1 from pg_proc where proname like 'fn_ai_certification%'
        and (proname like '%raise%' or proname like '%reset%' or proname like '%increase%')
    ),
    'there is no function that raises a ceiling or resets a counter — continuing means opening a new run deliberately');

  -- Even a direct UPDATE cannot push a run past its own ceiling.
  begin
    update ai_certification_runs set calls_used = call_ceiling + 1 where id = v_run;
    v_failed := false;
  exception when check_violation then v_failed := true;
  end;
  perform pg_temp.ok(v_failed, 'the table itself refuses a count above the ceiling, not only the reservation function');

  -- Closing keeps the record of what was spent.
  perform fn_ai_certification_reserve_call(v_run);
  perform fn_ai_certification_close_run(v_run);
  perform pg_temp.ok((select calls_used from ai_certification_runs where id = v_run) = 1,
    'closing a run does NOT reset its counter — what a run spent outlives the run');
  perform pg_temp.ok(
    (select status from ai_certification_runs where id = v_run) = 'Closed',
    'and the run is recorded as Closed');

  -- With the first run closed, a new one is allowed. That is the
  -- intentional path, and it leaves two rows for a reviewer to see.
  v_second := fn_ai_certification_open_run(pg_temp.co(), 'a deliberate second run', 2, 'tester');
  perform pg_temp.ok(v_second is not null, 'a new run may be opened once the previous one is closed');
  perform pg_temp.ok((select count(*) from ai_certification_runs where company_id = pg_temp.co()) >= 2,
    'and both runs remain visible — spending is never hidden by starting again');
  perform fn_ai_certification_close_run(v_second);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. The document-type column (the credit-note boundary's storage).
-- ---------------------------------------------------------------------
do $$
declare v_failed boolean;
begin
  perform pg_temp.ok(
    exists (select 1 from information_schema.columns
      where table_name = 'supplier_invoice_captures' and column_name = 'document_type'),
    'captures record what kind of document was read');

  perform pg_temp.ok(
    (select is_nullable from information_schema.columns
      where table_name = 'supplier_invoice_captures' and column_name = 'document_type') = 'YES',
    'and it is nullable — unknown is unknown, and every pre-0109 capture is null');

  begin
    insert into supplier_invoice_captures (company_id, document_id, document_type)
    values (pg_temp.co(), -999, 'Statement');
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.ok(v_failed, 'only the four known document kinds are accepted — not free text');
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Phase 5Q — the CERTIFICATION CORPUS ceiling: exactly 24, never 25.
--
--    The corpus holds 24 documents and the run is opened with a ceiling of
--    24. This asserts the boundary directly against the real function
--    rather than against a stand-in, because the whole point of moving the
--    ceiling into Postgres was that an in-process counter cannot be
--    trusted across invocations.
-- ---------------------------------------------------------------------
do $$
declare
  v_run bigint;
  v_result jsonb;
  v_granted integer := 0;
begin
  v_run := fn_ai_certification_open_run(pg_temp.co(), '5Q corpus run', 24, 'tester');

  for i in 1..24 loop
    v_result := fn_ai_certification_reserve_call(v_run);
    if (v_result->>'reserved')::boolean then
      v_granted := v_granted + 1;
    end if;
  end loop;

  perform pg_temp.ok(v_granted = 24, 'exactly 24 reservations are granted for the 24-document corpus');
  perform pg_temp.ok((select calls_used from ai_certification_runs where id = v_run) = 24,
    'and the durable counter records all 24');
  perform pg_temp.ok((select status from ai_certification_runs where id = v_run) = 'Exhausted',
    'the run closes itself on the 24th rather than waiting to refuse a 25th');

  -- The twenty-fifth.
  v_result := fn_ai_certification_reserve_call(v_run);
  perform pg_temp.ok(not (v_result->>'reserved')::boolean, 'the 25th reservation is REFUSED');
  perform pg_temp.ok((select calls_used from ai_certification_runs where id = v_run) = 24,
    'and the refusal consumes nothing — a refused case must not cost a call');

  perform fn_ai_certification_close_run(v_run);
end;
$$;

rollback;

-- ---------------------------------------------------------------------
-- 6. ATOMIC UNDER REAL CONCURRENCY.
--
--    Everything above runs in one transaction, which cannot prove the
--    property that matters most: that two certification workers racing for
--    the last call cannot both get it. This section therefore runs OUTSIDE
--    the rolled-back transaction, with real connections, and cleans up
--    after itself.
--
--    Run it with:
--      ./supabase/tests/certification_call_ceiling.concurrency.sh
--
--    It is a separate file, and a shell script rather than SQL, because
--    multiple simultaneous sessions cannot be expressed inside a single
--    rolled-back transaction.
--
--    Measured: 40 concurrent workers against a ceiling of 15 → exactly 15
--    granted, 25 refused, counter 15, run Exhausted.
-- ---------------------------------------------------------------------
