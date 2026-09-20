-- Database tests for migration 0105 (race-safe Sales document numbering).
--
-- LOCAL / SYNTHETIC DATA ONLY. Everything runs in ONE transaction that is
-- rolled back at the end, so nothing is left behind. Never run against a
-- shared or production database.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/document_number_sequences.test.sql
--
-- WHY THIS SUITE EXISTS. 0105 shipped with no database tests at all, and
-- every local database used to verify it held ZERO sales documents. The
-- migration's format assumption -- prefix plus six zero-padded digits --
-- was therefore never once compared against a real series, and it was
-- wrong: the live data is hyphenated and unpadded (INV-3440 .. INV-3495,
-- CN-3369). A production release was halted on exactly that. The fixture
-- below is deliberately shaped like the live data, because a fixture that
-- is not is how this defect survived in the first place.

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

-- Five synthetic companies, each isolating one property of the numbering.
create function pg_temp.co_a() returns uuid language sql as $$ select '5d000000-0000-4000-8000-00000000a001'::uuid $$;  -- the live-shaped series
create function pg_temp.co_b() returns uuid language sql as $$ select '5d000000-0000-4000-8000-00000000b002'::uuid $$;  -- independence
create function pg_temp.co_c() returns uuid language sql as $$ select '5d000000-0000-4000-8000-00000000c003'::uuid $$;  -- empty series
create function pg_temp.co_d() returns uuid language sql as $$ select '5d000000-0000-4000-8000-00000000d004'::uuid $$;  -- legacy padded, no hyphen
create function pg_temp.co_e() returns uuid language sql as $$ select '5d000000-0000-4000-8000-00000000e005'::uuid $$;  -- malformed values present

insert into organisations (id, name) values ('5d000000-0000-4000-8000-0000000000aa', '5J numbering org')
on conflict (id) do nothing;
insert into companies (id, organisation_id, name) values
  (pg_temp.co_a(), '5d000000-0000-4000-8000-0000000000aa', '5J Numbering A'),
  (pg_temp.co_b(), '5d000000-0000-4000-8000-0000000000aa', '5J Numbering B'),
  (pg_temp.co_c(), '5d000000-0000-4000-8000-0000000000aa', '5J Numbering C'),
  (pg_temp.co_d(), '5d000000-0000-4000-8000-0000000000aa', '5J Numbering D'),
  (pg_temp.co_e(), '5d000000-0000-4000-8000-0000000000aa', '5J Numbering E')
on conflict (id) do nothing;

insert into customers (company_id, customer_code, name) values
  (pg_temp.co_a(), 'NUMA', 'Numbering Customer A'),
  (pg_temp.co_b(), 'NUMB', 'Numbering Customer B'),
  (pg_temp.co_c(), 'NUMC', 'Numbering Customer C'),
  (pg_temp.co_d(), 'NUMD', 'Numbering Customer D'),
  (pg_temp.co_e(), 'NUME', 'Numbering Customer E');

create function pg_temp.cust(p_company uuid) returns bigint language sql as $$
  select id from customers where company_id = p_company limit 1
$$;

create function pg_temp.doc(p_company uuid, p_number text, p_type text) returns void language sql as $$
  insert into sales_invoices (company_id, customer_id, invoice_number, document_type, invoice_date)
  values (p_company, pg_temp.cust(p_company), p_number, p_type, date '2026-01-15');
$$;

create function pg_temp.seq(p_company uuid, p_type text) returns bigint language sql as $$
  select next_number from document_number_sequences
  where company_id = p_company and document_type = p_type
$$;

-- ---------------------------------------------------------------------
-- FIXTURE -- shaped like the live production series, not like the
-- generator's own output. Mixed digit lengths on purpose: a max taken as
-- TEXT would pick INV-99 over INV-3495.
-- ---------------------------------------------------------------------
select pg_temp.doc(pg_temp.co_a(), 'INV-1',    'Invoice');
select pg_temp.doc(pg_temp.co_a(), 'INV-9',    'Invoice');
select pg_temp.doc(pg_temp.co_a(), 'INV-99',   'Invoice');
select pg_temp.doc(pg_temp.co_a(), 'INV-3440', 'Invoice');
select pg_temp.doc(pg_temp.co_a(), 'INV-3495', 'Invoice');       -- the live high-water mark
select pg_temp.doc(pg_temp.co_a(), 'CN-1',     'Credit Note');
select pg_temp.doc(pg_temp.co_a(), 'CN-3369',  'Credit Note');   -- the live credit-note mark
select pg_temp.doc(pg_temp.co_a(), 'DN-7',     'Debit Note');    -- synthetic: production holds no debit note

select pg_temp.doc(pg_temp.co_b(), 'INV-2',    'Invoice');

select pg_temp.doc(pg_temp.co_d(), 'INV000012','Invoice');       -- legacy: padded, no hyphen

select pg_temp.doc(pg_temp.co_e(), 'INV-5',    'Invoice');
select pg_temp.doc(pg_temp.co_e(), 'INV-ABC',  'Invoice');       -- malformed: not numeric
select pg_temp.doc(pg_temp.co_e(), 'INV-99999999999999999999', 'Invoice'); -- 20 digits: would overflow bigint

create temporary table _docs_before on commit drop as
  select company_id, document_type, invoice_number from sales_invoices;

-- ---------------------------------------------------------------------
-- THE BACKFILL, exactly as 0105 performs it at the foot of the migration.
-- Run here so this suite exercises the seeding path, not only generation.
-- ---------------------------------------------------------------------
delete from document_number_sequences
 where company_id in (pg_temp.co_a(), pg_temp.co_b(), pg_temp.co_c(), pg_temp.co_d(), pg_temp.co_e());

insert into document_number_sequences (company_id, document_type, prefix, next_number)
select
  i.company_id,
  i.document_type,
  document_number_prefix(i.document_type),
  max(substring(i.invoice_number from '^' || document_number_prefix(i.document_type) || '-?([0-9]{1,18})$')::bigint) + 1
from sales_invoices i
where document_number_prefix(i.document_type) is not null
  and i.invoice_number ~ ('^' || document_number_prefix(i.document_type) || '-?([0-9]{1,18})$')
group by i.company_id, i.document_type
on conflict (company_id, document_type) do nothing;

-- ---------------------------------------------------------------------
-- 1. Seeding: the counter must reflect the live high-water mark.
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.ok(pg_temp.seq(pg_temp.co_a(), 'Invoice') = 3496,
    '11: the backfill RECOGNISES hyphenated numbers and seeds Invoice from INV-3495');
  perform pg_temp.ok(pg_temp.seq(pg_temp.co_a(), 'Credit Note') = 3370,
    '11b: the backfill seeds Credit Note from CN-3369');
  perform pg_temp.ok(pg_temp.seq(pg_temp.co_a(), 'Debit Note') = 8,
    '11c: the backfill seeds Debit Note from DN-7');
  perform pg_temp.ok(pg_temp.seq(pg_temp.co_d(), 'Invoice') = 13,
    '11d: a legacy unhyphenated INV000012 is still recognised -- seeds from 12, never ignored');
  perform pg_temp.ok(pg_temp.seq(pg_temp.co_e(), 'Invoice') = 6,
    '12: a malformed INV-ABC and a bigint-overflowing 20-digit value are skipped, not fatal; seeds from INV-5');
  perform pg_temp.ok(pg_temp.seq(pg_temp.co_c(), 'Invoice') is null,
    '8a: a company with no documents gets no counter row until it claims one');
end $$;

-- ---------------------------------------------------------------------
-- 2. Generation: continue the printed series.
-- ---------------------------------------------------------------------
do $$
declare n1 text; n2 text; n3 text;
begin
  n1 := next_document_number(pg_temp.co_a(), 'Invoice');
  perform pg_temp.ok(n1 = 'INV-3496',
    format('1: INV-3495 -> INV-3496 (got %s) -- the live series continues, it does not restart', n1));

  n2 := next_document_number(pg_temp.co_a(), 'Invoice');
  perform pg_temp.ok(n2 = 'INV-3497', format('1b: the next claim is INV-3497 (got %s)', n2));

  n3 := next_document_number(pg_temp.co_a(), 'Credit Note');
  perform pg_temp.ok(n3 = 'CN-3370', format('2: CN-3369 -> CN-3370 (got %s)', n3));

  perform pg_temp.ok(next_document_number(pg_temp.co_a(), 'Debit Note') = 'DN-8',
    '3: DN-7 -> DN-8');

  -- 6/7: claiming an Invoice must not move the Credit Note or Debit Note counter.
  perform pg_temp.ok(pg_temp.seq(pg_temp.co_a(), 'Credit Note') = 3371,
    '6: the Credit Note counter moved only for its OWN claim, not the Invoice claims');
  perform pg_temp.ok(pg_temp.seq(pg_temp.co_a(), 'Debit Note') = 9,
    '7: the Debit Note counter is independent of Invoice and Credit Note');
end $$;

-- ---------------------------------------------------------------------
-- 3. Mixed digit lengths, other companies, empty series.
-- ---------------------------------------------------------------------
do $$
begin
  -- 4: had the maximum been taken as text, 'INV-99' > 'INV-3495' and the
  --    next number would have been INV-100.
  perform pg_temp.ok(
    (select max(substring(invoice_number from '^INV-?([0-9]{1,18})$')::bigint)
       from sales_invoices where company_id = pg_temp.co_a() and document_type = 'Invoice'
        and invoice_number <> 'INV-3496' and invoice_number <> 'INV-3497') = 3495,
    '4: mixed digit lengths compare NUMERICALLY -- INV-99 does not outrank INV-3495');

  perform pg_temp.ok(next_document_number(pg_temp.co_b(), 'Invoice') = 'INV-3',
    '5: a second company numbers from its OWN series (INV-2 -> INV-3), untouched by company A');

  perform pg_temp.ok(next_document_number(pg_temp.co_c(), 'Invoice') = 'INV-1',
    '8: an empty series starts at INV-1');

  perform pg_temp.ok(next_document_number(pg_temp.co_d(), 'Invoice') = 'INV-13',
    '8b: a legacy padded series continues numerically in the printed format (INV000012 -> INV-13)');

  perform pg_temp.ok(next_document_number(pg_temp.co_e(), 'Invoice') = 'INV-6',
    '12b: malformed neighbours do not corrupt the claim (INV-5 -> INV-6)');
end $$;

-- ---------------------------------------------------------------------
-- 4. Uniqueness, history, idempotence.
-- ---------------------------------------------------------------------
do $$
declare v_num text; v_n bigint;
begin
  -- 13: the generated value must satisfy the same unique constraint every
  --     existing document satisfies -- prove it by actually inserting one.
  v_num := next_document_number(pg_temp.co_a(), 'Invoice');
  perform pg_temp.doc(pg_temp.co_a(), v_num, 'Invoice');
  perform pg_temp.ok(
    (select count(*) from sales_invoices where company_id = pg_temp.co_a() and invoice_number = v_num) = 1,
    format('13: the generated number %s inserts cleanly under UNIQUE (company_id, invoice_number)', v_num));

  -- 9: nothing the migration or the claims did rewrote a historical number.
  perform pg_temp.ok(
    not exists (select * from _docs_before except
                select company_id, document_type, invoice_number from sales_invoices),
    '9: every pre-existing document number is unchanged -- nothing was renumbered');

  -- 10 (sequential form): successive claims are strictly increasing and
  --     never repeat. The atomic form is proven by the concurrency harness.
  v_n := pg_temp.seq(pg_temp.co_a(), 'Invoice');
  perform pg_temp.ok(
    (select count(distinct x) from (
       select next_document_number(pg_temp.co_a(), 'Invoice') as x
       from generate_series(1, 10)) s) = 10,
    '10: ten successive claims yield ten DISTINCT numbers -- the counter never hands out a repeat');
  perform pg_temp.ok(pg_temp.seq(pg_temp.co_a(), 'Invoice') = v_n + 10,
    '10b: the counter advanced by exactly the number of claims made');

  -- 14: re-running the backfill is inert -- `on conflict do nothing` keeps
  --     the counter where it has since moved to, never rewinding it.
  v_n := pg_temp.seq(pg_temp.co_a(), 'Invoice');
  insert into document_number_sequences (company_id, document_type, prefix, next_number)
  select i.company_id, i.document_type, document_number_prefix(i.document_type),
         max(substring(i.invoice_number from '^' || document_number_prefix(i.document_type) || '-?([0-9]{1,18})$')::bigint) + 1
  from sales_invoices i
  where document_number_prefix(i.document_type) is not null
    and i.invoice_number ~ ('^' || document_number_prefix(i.document_type) || '-?([0-9]{1,18})$')
  group by i.company_id, i.document_type
  on conflict (company_id, document_type) do nothing;
  perform pg_temp.ok(pg_temp.seq(pg_temp.co_a(), 'Invoice') = v_n,
    '14: re-running the backfill does not rewind a counter that has already moved on');
end $$;

-- ---------------------------------------------------------------------
-- 5. The format contract itself.
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.ok(
    next_document_number(pg_temp.co_b(), 'Invoice') ~ '^INV-[0-9]+$',
    'format: generated Invoice numbers are prefix + hyphen + UNPADDED digits, as printed on every live document');
  perform pg_temp.ok(
    next_document_number(pg_temp.co_b(), 'Credit Note') ~ '^CN-[0-9]+$',
    'format: generated Credit Note numbers follow the same convention');
  perform pg_temp.ok(
    next_document_number(pg_temp.co_b(), 'Debit Note') ~ '^DN-[0-9]+$',
    'format: generated Debit Note numbers follow the same convention');
  begin
    perform next_document_number(pg_temp.co_b(), 'Quotation');
    perform pg_temp.ok(false, 'guard: an unknown document type must be refused');
  exception when others then
    perform pg_temp.ok(sqlerrm like '%VYRON_DOCNUM_UNKNOWN_TYPE%',
      'guard: an unknown document type is refused, never silently numbered');
  end;
end $$;

rollback;
\echo 'document_number_sequences: all checks passed (transaction rolled back)'
