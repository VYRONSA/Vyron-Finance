-- Database tests for migration 0110 (Phase 5Q.6 certification evidence).
--
-- LOCAL / SYNTHETIC DATA ONLY. One transaction, rolled back at the end.
-- Never run against a shared or production database.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/certification_evidence.test.sql
--
-- What this proves: evidence is recorded, it is append-only, it is sealed
-- once the run closes, and recording it creates no accounting record of
-- any kind.

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

create function pg_temp.co() returns uuid language sql as $$ select '5f000000-0000-4000-8000-00000000e001'::uuid $$;

insert into organisations (id, name) values ('5f000000-0000-4000-8000-0000000000aa', '5Q evidence org')
on conflict (id) do nothing;
insert into companies (id, organisation_id, name)
values (pg_temp.co(), '5f000000-0000-4000-8000-0000000000aa', '5Q Evidence Co')
on conflict (id) do nothing;

-- A fingerprint of every accounting table, so "nothing was posted" is
-- counted rather than asserted.
create function pg_temp.accounting_fingerprint() returns text language sql as $$
  select (select count(*) from ae_journals)::text || '/' ||
         (select count(*) from ae_journal_lines)::text || '/' ||
         (select count(*) from gl_transactions)::text || '/' ||
         (select count(*) from ae_imported_bills)::text || '/' ||
         (select count(*) from ae_suppliers)::text || '/' ||
         (select count(*) from supplier_invoice_captures)::text || '/' ||
         (select count(*) from ai_extraction_attempts)::text || '/' ||
         (select count(*) from automation_tasks)::text || '/' ||
         (select count(*) from inventory_transactions)::text
$$;

-- ---------------------------------------------------------------------
-- 1. Recording evidence.
-- ---------------------------------------------------------------------
do $$
declare
  v_run bigint;
  v_id bigint;
  v_before text := pg_temp.accounting_fingerprint();
begin
  v_run := fn_ai_certification_open_run(pg_temp.co(), '5Q evidence run', 24, 'tester');

  v_id := fn_ai_certification_record_evidence(
    v_run, pg_temp.co(), 'clean-pdf',
    repeat('a', 64), 'clean-pdf.pdf', repeat('b', 64),
    'extracted', 'openai/gpt-4o-mini', 1, 24, 3500,
    '{"totalTokens":1685}'::jsonb, null, null, null,
    '{"header":{"invoiceNumber":"KW-10041","total":1150},"lines":[{"description":"Maize meal 10kg"}]}'::jsonb,
    'Pass', '[]'::jsonb, 1, 1
  );

  perform pg_temp.ok(v_id is not null, 'evidence is recorded and returns its id');
  perform pg_temp.ok(
    (select extracted -> 'header' ->> 'invoiceNumber' from ai_certification_evidence where id = v_id) = 'KW-10041',
    'the FULL extracted payload is stored, not a summary — this is what makes field-by-field scoring possible');
  perform pg_temp.ok(
    (select calls_used_at_reservation from ai_certification_evidence where id = v_id) = 1,
    'the reservation that authorised the call is recorded with it');

  -- THE DECISIVE CHECK: nothing accounting moved.
  perform pg_temp.ok(pg_temp.accounting_fingerprint() = v_before,
    'recording evidence creates NO journal, ledger entry, bill, supplier, capture, extraction attempt or task');
end;
$$;

-- ---------------------------------------------------------------------
-- 2. One row per case per run.
-- ---------------------------------------------------------------------
do $$
declare
  v_run bigint;
  v_failed boolean;
begin
  select id into v_run from ai_certification_runs where company_id = pg_temp.co() and status = 'Open';

  begin
    perform fn_ai_certification_record_evidence(
      v_run, pg_temp.co(), 'clean-pdf', repeat('a', 64), 'clean-pdf.pdf', repeat('b', 64), 'extracted');
    v_failed := false;
  exception when unique_violation then v_failed := true;
  end;
  perform pg_temp.ok(v_failed,
    'the same case cannot be recorded twice for one run — matching the runner''s one-call-no-retry rule');
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Fail closed on a wrong run, a wrong company, or a closed run.
-- ---------------------------------------------------------------------
do $$
declare
  v_run bigint;
  v_other uuid := '5f000000-0000-4000-8000-00000000e999';
  v_failed boolean;
begin
  select id into v_run from ai_certification_runs where company_id = pg_temp.co() and status = 'Open';

  begin
    perform fn_ai_certification_record_evidence(-1, pg_temp.co(), 'x', repeat('a',64), 'x.pdf', repeat('b',64), 'extracted');
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.ok(v_failed, 'a run that does not exist records nothing');

  begin
    perform fn_ai_certification_record_evidence(v_run, v_other, 'y', repeat('a',64), 'y.pdf', repeat('b',64), 'extracted');
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.ok(v_failed, 'a company that does not own the run records nothing');
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Append-only, and sealed once the run closes.
-- ---------------------------------------------------------------------
do $$
declare
  v_run bigint;
  v_id bigint;
  v_failed boolean;
begin
  select id into v_run from ai_certification_runs where company_id = pg_temp.co() and status = 'Open';
  select id into v_id from ai_certification_evidence where certification_run_id = v_run limit 1;

  -- An UPDATE is refused outright: nothing legitimately amends a result.
  begin
    update ai_certification_evidence set validation_status = 'Pass' where id = v_id;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.ok(v_failed, 'evidence is append-only — an UPDATE is refused even while the run is Open');

  -- While Open, a DELETE is still possible (nothing is sealed yet).
  perform pg_temp.ok(
    (select count(*) from ai_certification_evidence where certification_run_id = v_run) = 1,
    'the recorded row is present before the run closes');

  perform fn_ai_certification_close_run(v_run);

  begin
    delete from ai_certification_evidence where id = v_id;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.ok(v_failed,
    'once the run is Closed its evidence is SEALED — it cannot be quietly tidied away afterwards');

  -- And no further evidence may be added to a finished run.
  begin
    perform fn_ai_certification_record_evidence(
      v_run, pg_temp.co(), 'late-case', repeat('a',64), 'late.pdf', repeat('b',64), 'extracted');
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.ok(v_failed, 'a closed run accepts no further evidence');
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Structural isolation.
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.ok(
    not exists (
      select 1 from information_schema.table_constraints tc
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
      where tc.table_name = 'ai_certification_evidence' and tc.constraint_type = 'FOREIGN KEY'
        and ccu.table_name in ('supplier_invoice_captures','ae_imported_bills','ae_journals','ae_journal_lines','automation_tasks','gl_transactions')
    ),
    'evidence has NO foreign key into any capture, bill, journal or task table — it cannot become a production capture');

  perform pg_temp.ok(
    (select relrowsecurity from pg_class where relname = 'ai_certification_evidence'),
    'row level security is enabled');

  perform pg_temp.ok(
    not exists (select 1 from pg_policies where tablename = 'ai_certification_evidence'),
    'and there is no policy at all — reachable only through the security-definer writer');

  perform pg_temp.ok(
    not exists (
      select 1 from pg_proc where proname like 'fn_ai_certification%evidence%'
        and (proname like '%update%' or proname like '%delete%' or proname like '%upsert%')
    ),
    'there is no function that updates or deletes evidence');
end;
$$;

rollback;
