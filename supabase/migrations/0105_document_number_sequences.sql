-- Phase 5J — race-safe, company-scoped Sales document numbering.
--
-- THE DEFECT. `sales-invoice-repository.ts::nextInvoiceNumber` generated
-- the next number as `COUNT(*) + 1` over `sales_invoices` filtered by
-- company and document type. Two problems, both real:
--
--   1. Not concurrency safe. Two invoices created in the same instant
--      both count N and both propose INV00000N+1. One wins; the other
--      hits `sales_invoices_company_id_invoice_number_key` and surfaces
--      as an unhandled 500 with an invoice half-created.
--   2. Not stable. COUNT(*) falls when a row is deleted, so the
--      generator can propose a number that was already issued.
--
-- THE MECHANISM CHOSEN, AND WHY NOT THE ALTERNATIVES.
--
--   * A Postgres SEQUENCE is the reflexive answer and is wrong here.
--     Sequences are schema objects, not rows, so "per company per
--     document type" would mean issuing DDL (`create sequence`) at
--     tenant-creation time and holding thousands of catalogue objects.
--     They are also explicitly non-transactional: `nextval` is never
--     rolled back, so an invoice whose surrounding transaction aborts
--     burns its number and leaves a gap that nothing can explain.
--
--   * An advisory lock serialises correctly but keeps no state — the
--     counter would still have to be derived by scanning the invoices,
--     which is the defect being fixed.
--
--   * A COUNTER ROW claimed with `insert ... on conflict do update ...
--     returning` — what this migration implements. The claim is ONE
--     statement, so Postgres takes a row lock on exactly that company's
--     counter for the duration: concurrent callers serialise on it and
--     each receives a distinct number, while a different company's
--     invoices never contend. Because it is an ordinary row write it
--     participates in the caller's transaction like any other, and the
--     lock is held for microseconds.
--
-- GAPS ARE ALLOWED, AND THAT IS DELIBERATE. VAT Act s20(4)(b) requires
-- an "individual serialized number" — a number that uniquely identifies
-- the document. It does not require an unbroken sequence, and no gap-free
-- guarantee is achievable anyway once a transaction can roll back. A
-- cancelled invoice therefore keeps its number and that number is never
-- re-issued: re-using it would attach one serial number to two documents,
-- which is the thing the requirement actually prohibits. See
-- docs/INVOICING_ACCOUNTING_5J.md for the full note.
--
-- HISTORICAL NUMBERS ARE PRESERVED. The backfill at the bottom seeds
-- each counter from the highest number ALREADY ISSUED, so the next
-- document continues the existing series. Nothing is renumbered, and no
-- existing row is written to by this migration.
--
-- Scope: this migration covers the three Sales document types only.
-- Journals, receipts, orders, quotations and deliveries still use their
-- own COUNT-based generators; they have the same weakness and are
-- deliberately left for their own phase rather than being changed
-- underneath a phase that was not asked to touch them.

create table if not exists document_number_sequences (
  company_id uuid not null references companies (id) on delete cascade,
  document_type text not null,
  prefix text not null,
  -- The next number to hand out. Claimed and incremented atomically.
  next_number bigint not null default 1 check (next_number > 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, document_type)
);

alter table document_number_sequences enable row level security;

drop policy if exists "members can access their company's document number sequences" on document_number_sequences;
create policy "members can access their company's document number sequences"
  on document_number_sequences for all using (user_can_access_company(company_id));

-- THE PRINTED FORMAT IS `<PREFIX>-<number>`, AND THE NUMBER IS NOT PADDED.
--
-- An earlier draft of this migration asserted the opposite -- `INV`/`CN`/`DN`
-- followed by six zero-padded digits, matching the application's own
-- `COUNT(*)+1` generator. That assertion was never true of the live data.
-- Every Sales document on the production system is hyphenated and
-- unpadded: 333 invoices INV-3440 .. INV-3495 and 9 credit notes from
-- CN-3369, with no zero-padded value anywhere. Those numbers were imported,
-- not generated here, which is why the generator's format and the data's
-- format were free to disagree.
--
-- The consequence of believing the draft was concrete: `^INV[0-9]+$` matches
-- no hyphenated number, so the backfill below would have seeded NOTHING, and
-- the first document issued afterwards would have been INV-1 formatted as
-- INV000001 while the live series stood at INV-3495. Not a duplicate -- a
-- second, incompatible series in the same VAT record.
--
-- So the series is continued as printed: INV-3495 -> INV-3496.
--
-- RECOGNITION IS DELIBERATELY WIDER THAN GENERATION. The pattern below
-- accepts an OPTIONAL hyphen, so a company holding `INV000012` from the old
-- generator still seeds its counter from 12 rather than being ignored and
-- colliding later. Generation always emits the hyphenated form.
--
-- The digit run is bounded at 18 so a malformed 20-digit value cannot
-- overflow bigint and abort the claim; such a value simply does not
-- participate in the maximum.
--
-- This pattern appears twice -- once in the claim below and once in the
-- backfill at the foot of this file. They MUST stay identical; a value the
-- backfill counts but the claim ignores (or the reverse) is how a series
-- silently forks.
create or replace function document_number_prefix(p_document_type text)
returns text
language sql
immutable
as $$
  select case p_document_type
    when 'Invoice' then 'INV'
    when 'Credit Note' then 'CN'
    when 'Debit Note' then 'DN'
  end;
$$;

/**
 * Claims and returns the next document number for one company and
 * document type. `security invoker`, so the RLS policy above applies and
 * a caller cannot claim a number in a company they cannot access —
 * matching `seed_company_defaults()`'s own choice to stay invoker-rights
 * rather than hiding a privilege escalation inside a function.
 *
 * The loop exists for one reason: a company may already hold a document
 * whose number matches the generated format but did not come from this
 * counter (an imported Xero invoice, a hand-typed number). Rather than
 * let the insert fail on the unique index, the claim simply advances past
 * any number that is already taken. Each iteration claims a NEW number
 * atomically, so two concurrent callers never test the same candidate.
 */
create or replace function next_document_number(p_company_id uuid, p_document_type text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prefix text;
  v_pattern text;
  v_number bigint;
  v_candidate text;
begin
  v_prefix := document_number_prefix(p_document_type);
  if v_prefix is null then
    raise exception 'VYRON_DOCNUM_UNKNOWN_TYPE: "%" is not a Sales document type', p_document_type;
  end if;
  -- Keep identical to the backfill's pattern at the foot of this file.
  v_pattern := '^' || v_prefix || '-?([0-9]{1,18})$';

  for _attempt in 1..25 loop
    -- One statement, therefore one row lock, therefore no two callers
    -- can be handed the same number. On the insert path `next_number`
    -- starts at (highest already issued + 1) so an existing series
    -- continues rather than restarting at 1; on the conflict path it
    -- simply advances. Both paths return the number being claimed,
    -- which is always `next_number - 1` after the write.
    insert into document_number_sequences as seq (company_id, document_type, prefix, next_number)
    select
      p_company_id,
      p_document_type,
      v_prefix,
      coalesce(
        max(substring(i.invoice_number from v_pattern)::bigint),
        0
      ) + 2
    from sales_invoices i
    where i.company_id = p_company_id
      and i.document_type = p_document_type
      and i.invoice_number ~ v_pattern
    on conflict (company_id, document_type)
    do update set next_number = seq.next_number + 1, updated_at = now()
    returning seq.next_number - 1 into v_number;

    -- As printed on every existing document: prefix, hyphen, unpadded.
    v_candidate := v_prefix || '-' || v_number::text;

    if not exists (
      select 1 from sales_invoices
      where company_id = p_company_id and invoice_number = v_candidate
    ) then
      return v_candidate;
    end if;
  end loop;

  raise exception 'VYRON_DOCNUM_EXHAUSTED: could not find a free % number for company % after 25 attempts', p_document_type, p_company_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Backfill. Idempotent: `on conflict do nothing` means re-running this
-- migration never rewinds a counter that has since moved on. Reads
-- `sales_invoices`; writes only the new table.
-- ---------------------------------------------------------------------
-- The pattern here MUST match the one the claim builds above.
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
