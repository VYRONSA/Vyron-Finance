-- =====================================================================
-- 0121 — Sales posting integrity and credit-note allocation.
-- =====================================================================
--
-- WHAT WENT WRONG (production, Metanoia Hospitality, 2026-10-21)
--
-- 1. DOUBLE POSTING (INV-3611, JR001436 + JR001437, created one second
--    apart). `sales-invoice-service.ts::approveAndPostInvoice` read the
--    invoice's status, created an Approved journal, linked it, and then
--    called `postApprovedJournals`, which posts EVERY Approved journal in
--    the company. Two overlapping approvals both passed the status check,
--    both created a journal, the second link overwrote the first, and the
--    posting engine posted both. Nothing in the database said a sales
--    document may only have one journal.
--
-- 2. CREDIT NOTES WITH THE WRONG SIGN. PRECISIA stores a credit note as
--    POSITIVE figures; its direction comes from the document type (the
--    'Customer Credit Note' posting rule is DR Sales Returns / DR VAT
--    Output / CR Debtors; the VAT201 engine, statements and customer
--    balances all negate a credit note). The Xero importer stored Xero's
--    NEGATIVE credit-note figures verbatim, so every consumer negated them
--    a second time: the ten imported credit notes increased Debtors and
--    Output VAT instead of reducing them. The importer is fixed in the
--    application; this migration adds the database backstop.
--
-- 3. NO WAY TO APPLY A POSTED CREDIT NOTE. A credit note could only be
--    linked to an invoice when it was created (`original_invoice_id`).
--    There was no supported way to apply a posted credit note's credit to
--    an invoice afterwards.
--
-- WHAT THIS MIGRATION DOES
--
--   A. One LIVE journal per sales document. A BEFORE INSERT/UPDATE
--      trigger on `ae_journals`, serialised per document by an advisory
--      transaction lock, refuses a second live `sales_invoice` journal.
--      Live = not reversed and not Rejected/Cancelled. A reversed journal
--      no longer counts, so an approved correction (reverse, then post
--      again) remains possible. A trigger rather than a unique index
--      because production already holds one duplicate (INV-3611): an index
--      could not be built until it is corrected, and correcting it is a
--      separately approved accounting procedure. The trigger checks only
--      rows being written, so existing rows are untouched.
--   B. A sales document cannot be re-linked from one live journal to
--      another (the overwrite in 1. above). Linking a document that has no
--      journal, or whose journal has been reversed, is still allowed.
--   C. Sales documents are stored with non-negative totals. Checked only
--      when a row is inserted or its total/subtotal/VAT is changed, so the
--      ten existing negative credit notes are untouched (their correction
--      is a separate procedure) and can still be allocated.
--   D. `sales_credit_note_allocations` and `fn_allocate_sales_credit_note`
--      — applies part or all of a Posted credit note's remaining credit to
--      a Posted invoice/debit note of the SAME company and customer, in one
--      transaction: both rows locked, both outstanding balances moved,
--      the allocation and its audit entry written, or nothing at all.
--      Idempotent on a caller-supplied request key, so a retried request
--      returns the first result instead of allocating twice. No journal:
--      the credit note's posting already credited Debtors, so applying it
--      to an invoice only matches two open items in the customer ledger.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- No existing row is updated or deleted. No journal, journal line,
-- posting batch, GL row, amount, VAT or posting rule is touched. The
-- duplicate INV-3611 journal and the ten sign-inverted credit-note
-- journals are NOT corrected here.
--
-- Rollback: supabase/rollbacks/0121_sales_posting_integrity_and_credit_note_allocation_down.sql

-- ---------------------------------------------------------------------
-- A. One live journal per sales document
-- ---------------------------------------------------------------------

create or replace function fn_sales_journal_is_live(p_status text, p_is_reversed boolean)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select not coalesce(p_is_reversed, false) and p_status not in ('Rejected', 'Cancelled')
$$;

create or replace function fn_guard_sales_invoice_journal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing text;
begin
  if new.source_type is distinct from 'sales_invoice' or new.source_id is null then
    return new;
  end if;
  if not fn_sales_journal_is_live(new.status, new.is_reversed) then
    return new;
  end if;
  -- An update that leaves an already-live journal live on the same
  -- document (Draft -> Approved -> Posted, a description edit) is not a
  -- second journal.
  if tg_op = 'UPDATE'
     and old.source_type is not distinct from new.source_type
     and old.source_id is not distinct from new.source_id
     and fn_sales_journal_is_live(old.status, old.is_reversed) then
    return new;
  end if;

  -- Serialise every writer of a journal for this document. Held to the end
  -- of the writing transaction, so a concurrent writer waits, then sees the
  -- committed journal below (READ COMMITTED takes a fresh snapshot per
  -- statement).
  perform pg_advisory_xact_lock(hashtextextended('precisia.sales_invoice_journal.' || new.company_id::text || '.' || new.source_id::text, 0));

  select j.journal_number into v_existing
    from ae_journals j
    where j.company_id = new.company_id
      and j.source_type = 'sales_invoice'
      and j.source_id = new.source_id
      and j.id is distinct from new.id
      and fn_sales_journal_is_live(j.status, j.is_reversed)
    limit 1;
  if v_existing is not null then
    raise exception 'PRECISIA_SALES_JOURNAL_EXISTS: sales document % already has live journal %.', new.source_id, v_existing
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists ae_journals_sales_invoice_single_live on ae_journals;
create trigger ae_journals_sales_invoice_single_live
  before insert or update of status, is_reversed, source_type, source_id on ae_journals
  for each row execute function fn_guard_sales_invoice_journal();

-- ---------------------------------------------------------------------
-- B. No re-linking a sales document away from its live journal
-- ---------------------------------------------------------------------

create or replace function fn_guard_sales_invoice_journal_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.journal_id is null or new.journal_id is not distinct from old.journal_id then
    return new;
  end if;
  if exists (
    select 1 from ae_journals j
      where j.id = old.journal_id
        and fn_sales_journal_is_live(j.status, j.is_reversed)
  ) then
    raise exception 'PRECISIA_SALES_JOURNAL_RELINK: % is already linked to a live journal; it cannot be linked to another.', old.invoice_number
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists sales_invoices_journal_link_guard on sales_invoices;
create trigger sales_invoices_journal_link_guard
  before update of journal_id on sales_invoices
  for each row execute function fn_guard_sales_invoice_journal_link();

-- ---------------------------------------------------------------------
-- C. Sales documents are stored with non-negative totals
-- ---------------------------------------------------------------------

create or replace function fn_guard_sales_invoice_sign()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.total < 0 or new.subtotal < 0 or new.vat_amount < 0 then
    raise exception 'PRECISIA_SALES_NEGATIVE_AMOUNT: % % has a negative total, net or VAT. Sales documents are stored as positive figures; a credit note''s direction comes from its document type.', new.document_type, new.invoice_number
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists sales_invoices_sign_guard on sales_invoices;
create trigger sales_invoices_sign_guard
  before insert or update of total, subtotal, vat_amount on sales_invoices
  for each row execute function fn_guard_sales_invoice_sign();

-- ---------------------------------------------------------------------
-- D. Credit-note allocation
-- ---------------------------------------------------------------------

create table if not exists sales_credit_note_allocations (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  credit_note_id bigint not null references sales_invoices (id),
  invoice_id bigint not null references sales_invoices (id),
  amount numeric(14, 2) not null check (amount > 0),
  allocation_date date not null default current_date,
  request_key uuid not null,
  performed_by text not null,
  audit_id bigint references automation_audit_log (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint sales_credit_note_allocations_distinct_documents check (credit_note_id <> invoice_id),
  constraint sales_credit_note_allocations_request_key unique (company_id, request_key)
);

create index if not exists sales_credit_note_allocations_credit_note_idx on sales_credit_note_allocations (company_id, credit_note_id);
create index if not exists sales_credit_note_allocations_invoice_idx on sales_credit_note_allocations (company_id, invoice_id);

alter table sales_credit_note_allocations enable row level security;
drop policy if exists "members can read their company's credit note allocations" on sales_credit_note_allocations;
create policy "members can read their company's credit note allocations" on sales_credit_note_allocations
  for select using (user_can_access_company(company_id));
-- No insert/update/delete policy: rows are written only by
-- fn_allocate_sales_credit_note, and never changed afterwards.
revoke insert, update, delete, truncate on sales_credit_note_allocations from anon, authenticated;
grant select on sales_credit_note_allocations to authenticated, service_role;

-- The credit still available on a credit note, as a positive amount,
-- whichever sign it is stored with (the ten legacy imported credit notes
-- are negative; every credit note written after this change is positive).
create or replace function fn_credit_note_available(p_total numeric, p_outstanding numeric)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when p_total < 0 then -p_outstanding else p_outstanding end
$$;

create or replace function fn_allocate_sales_credit_note(
  p_company_id uuid,
  p_credit_note_id bigint,
  p_invoice_id bigint,
  p_amount numeric,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text;
  v_cn sales_invoices;
  v_inv sales_invoices;
  v_prior sales_credit_note_allocations;
  v_available numeric;
  v_cn_after numeric;
  v_inv_after numeric;
  v_allocation_id bigint;
  v_audit_id bigint;
begin
  if auth.uid() is null then
    raise exception 'a signed-in user is required' using errcode = '42501';
  end if;
  if not user_can_access_company(p_company_id) then
    raise exception 'PRECISIA_CN_ALLOCATION_FORBIDDEN: not a member of this company.' using errcode = '42501';
  end if;
  if not user_has_permission(p_company_id, 'Sales:Edit') or not user_has_permission(p_company_id, 'Sales:Approve') then
    raise exception 'PRECISIA_CN_ALLOCATION_FORBIDDEN: Sales:Edit and Sales:Approve are required.' using errcode = '42501';
  end if;
  if p_request_key is null then
    raise exception 'PRECISIA_CN_ALLOCATION_INVALID: a request key is required.' using errcode = '22023';
  end if;
  if p_credit_note_id is null or p_invoice_id is null or p_credit_note_id = p_invoice_id then
    raise exception 'PRECISIA_CN_ALLOCATION_INVALID: choose a credit note and a different invoice.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'PRECISIA_CN_ALLOCATION_INVALID: the amount must be greater than zero, in rand and cents.' using errcode = '22023';
  end if;

  v_actor := left(coalesce(nullif(btrim(fn_session_actor_label()), ''), auth.uid()::text), 200);

  -- Lock both documents, lowest id first, so two allocations touching the
  -- same pair in opposite roles cannot deadlock. Every check below is made
  -- on the locked rows.
  perform 1 from sales_invoices
    where company_id = p_company_id and id in (p_credit_note_id, p_invoice_id)
    order by id
    for update;
  select * into v_cn from sales_invoices where company_id = p_company_id and id = p_credit_note_id;
  select * into v_inv from sales_invoices where company_id = p_company_id and id = p_invoice_id;
  if v_cn.id is null or v_inv.id is null then
    raise exception 'PRECISIA_CN_ALLOCATION_NOT_FOUND: the credit note or the invoice does not exist in this company.' using errcode = 'P0002';
  end if;

  -- A retried request (same key) returns what the first one did — checked
  -- after the locks, so a concurrent retry sees the first one's row.
  select * into v_prior from sales_credit_note_allocations where company_id = p_company_id and request_key = p_request_key;
  if v_prior.id is not null then
    if v_prior.credit_note_id <> p_credit_note_id or v_prior.invoice_id <> p_invoice_id or v_prior.amount <> p_amount then
      raise exception 'PRECISIA_CN_ALLOCATION_KEY_REUSED: this request key was already used for a different allocation.' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'allocationId', v_prior.id, 'replayed', true, 'amount', v_prior.amount,
      'creditNoteId', v_cn.id, 'creditNoteNumber', v_cn.invoice_number, 'creditNoteOutstanding', v_cn.outstanding,
      'invoiceId', v_inv.id, 'invoiceNumber', v_inv.invoice_number, 'invoiceOutstanding', v_inv.outstanding,
      'auditId', v_prior.audit_id);
  end if;

  if v_cn.document_type <> 'Credit Note' then
    raise exception 'PRECISIA_CN_ALLOCATION_INVALID: % is not a credit note.', v_cn.invoice_number using errcode = '22023';
  end if;
  if v_inv.document_type not in ('Invoice', 'Debit Note') then
    raise exception 'PRECISIA_CN_ALLOCATION_INVALID: a credit note can only be applied to an invoice or debit note, not to %.', v_inv.invoice_number using errcode = '22023';
  end if;
  if v_cn.status <> 'Posted' then
    raise exception 'PRECISIA_CN_ALLOCATION_INVALID: % is %; only a Posted credit note can be applied.', v_cn.invoice_number, v_cn.status using errcode = '22023';
  end if;
  if v_inv.status <> 'Posted' then
    raise exception 'PRECISIA_CN_ALLOCATION_INVALID: % is %; a credit note can only be applied to a Posted invoice.', v_inv.invoice_number, v_inv.status using errcode = '22023';
  end if;
  if v_cn.customer_id <> v_inv.customer_id then
    raise exception 'PRECISIA_CN_ALLOCATION_INVALID: % and % belong to different customers.', v_cn.invoice_number, v_inv.invoice_number using errcode = '22023';
  end if;

  v_available := fn_credit_note_available(v_cn.total, v_cn.outstanding);
  if p_amount > v_available then
    raise exception 'PRECISIA_CN_ALLOCATION_OVER: % has only % of credit left to apply.', v_cn.invoice_number, greatest(v_available, 0) using errcode = '22023';
  end if;
  if p_amount > v_inv.outstanding then
    raise exception 'PRECISIA_CN_ALLOCATION_OVER: % has only % outstanding.', v_inv.invoice_number, greatest(v_inv.outstanding, 0) using errcode = '22023';
  end if;

  -- The credit note's outstanding moves towards zero in whichever sign it
  -- is stored with; the invoice's outstanding falls by the amount.
  v_cn_after := case when v_cn.total < 0 then v_cn.outstanding + p_amount else v_cn.outstanding - p_amount end;
  v_inv_after := v_inv.outstanding - p_amount;
  update sales_invoices set outstanding = v_cn_after where company_id = p_company_id and id = v_cn.id;
  update sales_invoices set outstanding = v_inv_after where company_id = p_company_id and id = v_inv.id;

  insert into sales_credit_note_allocations (company_id, credit_note_id, invoice_id, amount, request_key, performed_by)
  values (p_company_id, v_cn.id, v_inv.id, p_amount, p_request_key, v_actor)
  returning id into v_allocation_id;

  insert into automation_audit_log (company_id, performed_by, action_type, reason, changes, journal_ids, document_type, document_id, is_reversible)
  values (
    p_company_id, v_actor, 'SalesCreditNoteAllocated',
    format('Applied %s of credit note %s to %s', to_char(p_amount, 'FM999999999990.00'), v_cn.invoice_number, v_inv.invoice_number),
    jsonb_build_object(
      'allocationId', v_allocation_id, 'requestKey', p_request_key, 'amount', p_amount,
      'creditNote', jsonb_build_object('id', v_cn.id, 'number', v_cn.invoice_number, 'outstandingBefore', v_cn.outstanding, 'outstandingAfter', v_cn_after),
      'invoice', jsonb_build_object('id', v_inv.id, 'number', v_inv.invoice_number, 'outstandingBefore', v_inv.outstanding, 'outstandingAfter', v_inv_after),
      'customerId', v_cn.customer_id),
    '{}', 'SalesInvoice', v_cn.id, false)
  returning id into v_audit_id;

  update sales_credit_note_allocations set audit_id = v_audit_id where id = v_allocation_id;

  return jsonb_build_object(
    'allocationId', v_allocation_id, 'replayed', false, 'amount', p_amount,
    'creditNoteId', v_cn.id, 'creditNoteNumber', v_cn.invoice_number, 'creditNoteOutstanding', v_cn_after,
    'invoiceId', v_inv.id, 'invoiceNumber', v_inv.invoice_number, 'invoiceOutstanding', v_inv_after,
    'auditId', v_audit_id);
end;
$$;

revoke execute on function fn_allocate_sales_credit_note(uuid, bigint, bigint, numeric, uuid) from public, anon;
grant execute on function fn_allocate_sales_credit_note(uuid, bigint, bigint, numeric, uuid) to authenticated;
revoke execute on function fn_guard_sales_invoice_journal() from public, anon, authenticated;
revoke execute on function fn_guard_sales_invoice_journal_link() from public, anon, authenticated;
