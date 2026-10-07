-- Phase SD-3D — Supplier Document Intelligence: supplier-statement
-- reconciliation (READ-ONLY from an accounting perspective).
--
-- Records the result of comparing a Ready supplier statement with the
-- supplier ledger, and the reviewer decisions that explain differences.
-- NOTHING here writes, or can write, a journal, bill, payment, allocation,
-- GL row or supplier balance; the supplier ledger stays authoritative and
-- untouched, and no balancing adjustment exists anywhere.
--
-- WHAT THIS ADDS
--   * supplier_statement_reconciliations — one IMMUTABLE row per run, with the
--     balances (S, P, D, explained, unexplained), the engine version and the
--     complete persisted INPUT SNAPSHOT plus its SHA-256 fingerprint, so any
--     run can be reproduced exactly.
--   * supplier_statement_reconciliation_items — the run's classified results
--     (immutable).
--   * supplier_statement_resolutions — reviewer decisions (manual link,
--     explanation, revocation): APPEND-ONLY, a reason always required,
--     withdrawn by a new 'revoke' row, never by editing or deleting.
--   * Statement status 'Reconciled' (set by the server after a run); a
--     reconciled statement can be reopened for review like a ready one.
--   * Explicit grants on every object.
--
-- ORDER: 0109 → 0110 → 0111 → 0112 → 0113 → 0114 → 0115. Idempotent.

-- ---------------------------------------------------------------------
-- 1. 'Reconciled' status and the new event types.
-- ---------------------------------------------------------------------
alter table supplier_statements drop constraint if exists supplier_statements_status_check;
alter table supplier_statements add constraint supplier_statements_status_check check (status in (
  'Queued', 'Processing', 'ManualEntry', 'NeedsReview', 'Ready', 'Reconciled', 'Duplicate', 'Failed', 'Rejected'));

alter table supplier_statement_events drop constraint if exists supplier_statement_events_event_type_check;
alter table supplier_statement_events add constraint supplier_statement_events_event_type_check check (event_type in (
  'Uploaded', 'DuplicateEvaluated', 'ProcessingStarted', 'Extracted', 'ExtractionFailed', 'ManualEntryRequired',
  'ValidationEvaluated', 'SupplierProposed', 'SupplierConfirmed', 'SupplierUnconfirmed', 'SupplierAccountNumberSaved',
  'FieldCorrected', 'LineCorrected', 'LineAdded', 'LineRemoved', 'ManualEntryStarted', 'SubmittedForReview',
  'MarkedReady', 'Reopened', 'Rejected', 'ProcessingRequeued',
  'ReconciliationRun', 'ResolutionRecorded', 'ResolutionRevoked'));

-- ---------------------------------------------------------------------
-- 2. Runs.
-- ---------------------------------------------------------------------
create table if not exists supplier_statement_reconciliations (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  statement_id bigint not null references supplier_statements (id) on delete cascade,
  run_number integer not null check (run_number > 0),
  engine_version text not null,
  basis text not null check (basis = 'supplier-ledger-document-date'),
  supplier_id bigint not null references ae_suppliers (id),
  as_at_date date not null,
  window_from date not null,
  window_to date not null,
  statement_opening numeric(14,2) not null,
  statement_closing numeric(14,2) not null,
  precisia_balance_before_window numeric(14,2) not null,
  precisia_balance_at numeric(14,2) not null,
  difference numeric(14,2) not null,
  explained_amount numeric(14,2) not null,
  explained_by_reviewer_amount numeric(14,2) not null,
  unexplained_amount numeric(14,2) not null,
  category_summary jsonb not null,
  input_snapshot jsonb not null,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (statement_id, run_number),
  -- D = S − P and D = Explained + Unexplained, to the cent, always.
  constraint supplier_statement_reconciliations_difference check (difference = statement_closing - precisia_balance_at),
  constraint supplier_statement_reconciliations_identity check (difference = explained_amount + unexplained_amount),
  constraint supplier_statement_reconciliations_window check (window_from <= window_to and window_to = as_at_date)
);
create index if not exists supplier_statement_reconciliations_statement_idx on supplier_statement_reconciliations (statement_id, run_number desc);

create table if not exists supplier_statement_reconciliation_items (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  reconciliation_id bigint not null references supplier_statement_reconciliations (id) on delete cascade,
  item_order integer not null check (item_order > 0),
  -- Plain values, not a foreign key: a run is a snapshot (its input_snapshot
  -- keeps the line itself), and must not change if the line later does.
  statement_line_id bigint,
  statement_line_order integer,
  category text not null check (category in (
    'Matched', 'Amount Difference', 'Missing in PRECISIA', 'Missing on Statement', 'Potential Duplicate',
    'Credit Note', 'Payment', 'Unclassified', 'Opening Balance Difference')),
  sub_status text not null,
  match_tier text check (match_tier in ('manual', 'exact', 'normalised', 'payment-evidence')),
  precisia_ref_type text check (precisia_ref_type in ('bill', 'credit-note', 'debit-note', 'supplier-payment', 'bank-transaction', 'opening-balance', 'capture', 'unposted-bill')),
  precisia_ref_id bigint,
  related_refs jsonb not null default '[]'::jsonb,
  suggestions jsonb not null default '[]'::jsonb,
  statement_amount numeric(14,2),
  precisia_amount numeric(14,2),
  amount_difference numeric(14,2),
  effect_on_difference numeric(14,2) not null,
  explained boolean not null,
  explained_by_resolution_id bigint,
  message text not null,
  unique (reconciliation_id, item_order)
);
create index if not exists supplier_statement_reconciliation_items_run_idx on supplier_statement_reconciliation_items (reconciliation_id, item_order);

-- ---------------------------------------------------------------------
-- 3. Reviewer decisions: append-only.
-- ---------------------------------------------------------------------
create table if not exists supplier_statement_resolutions (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  statement_id bigint not null references supplier_statements (id) on delete cascade,
  action text not null check (action in ('manual-link', 'explained', 'revoke')),
  -- NO ACTION: a line that carries reviewer decisions cannot be deleted
  -- (the decision history is permanent).
  statement_line_id bigint references supplier_statement_lines (id),
  precisia_ref_type text check (precisia_ref_type in ('bill', 'credit-note', 'debit-note', 'supplier-payment', 'bank-transaction', 'opening-balance', 'opening-difference')),
  precisia_ref_id bigint,
  revokes_resolution_id bigint references supplier_statement_resolutions (id),
  reason text not null check (length(btrim(reason)) >= 3 and length(reason) <= 1000),
  performed_by text not null,
  created_at timestamptz not null default now(),
  constraint supplier_statement_resolutions_shape check (
    (action = 'manual-link' and statement_line_id is not null and precisia_ref_type is not null
       and precisia_ref_type not in ('opening-difference') and precisia_ref_id is not null and revokes_resolution_id is null)
    or (action = 'explained' and revokes_resolution_id is null
       and (statement_line_id is not null
            or (precisia_ref_type = 'opening-difference' and precisia_ref_id is null)
            or (precisia_ref_type is not null and precisia_ref_type <> 'opening-difference' and precisia_ref_id is not null)))
    or (action = 'revoke' and revokes_resolution_id is not null and statement_line_id is null and precisia_ref_type is null and precisia_ref_id is null)
  )
);
create index if not exists supplier_statement_resolutions_statement_idx on supplier_statement_resolutions (statement_id, id);

alter table supplier_statement_reconciliations enable row level security;
alter table supplier_statement_reconciliation_items enable row level security;
alter table supplier_statement_resolutions enable row level security;

-- ---------------------------------------------------------------------
-- 4. Explicit grants. Signed-in users READ (RLS decides which rows); runs
--    and items are written only by the server (service role) after the
--    request's permission check; resolutions only through their writer.
-- ---------------------------------------------------------------------
revoke all on table supplier_statement_reconciliations from public, anon, authenticated, service_role;
revoke all on table supplier_statement_reconciliation_items from public, anon, authenticated, service_role;
revoke all on table supplier_statement_resolutions from public, anon, authenticated, service_role;
grant select on table supplier_statement_reconciliations, supplier_statement_reconciliation_items, supplier_statement_resolutions to authenticated;
grant select, insert on table supplier_statement_reconciliations, supplier_statement_reconciliation_items to service_role;
grant select on table supplier_statement_resolutions to service_role;

drop policy if exists "purchasing view reads statement reconciliations" on supplier_statement_reconciliations;
create policy "purchasing view reads statement reconciliations" on supplier_statement_reconciliations for select
  using (user_has_permission(company_id, 'Purchasing:View'));
drop policy if exists "purchasing view reads statement reconciliation items" on supplier_statement_reconciliation_items;
create policy "purchasing view reads statement reconciliation items" on supplier_statement_reconciliation_items for select
  using (user_has_permission(company_id, 'Purchasing:View'));
drop policy if exists "purchasing view reads statement resolutions" on supplier_statement_resolutions;
create policy "purchasing view reads statement resolutions" on supplier_statement_resolutions for select
  using (user_has_permission(company_id, 'Purchasing:View'));

-- ---------------------------------------------------------------------
-- 5. Immutability — runs, items and resolutions are never updated,
--    deleted or truncated (only a whole-company / statement cascade).
-- ---------------------------------------------------------------------
create or replace function fn_supplier_statement_reconciliation_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception '% is append-only: it cannot be truncated', tg_table_name;
  end if;
  if tg_op = 'UPDATE' then
    raise exception '% is append-only: a recorded row cannot be modified', tg_table_name;
  end if;
  if pg_trigger_depth() <= 1 then
    raise exception '% is append-only: a recorded row cannot be deleted', tg_table_name;
  end if;
  return old;
end;
$$;
revoke execute on function fn_supplier_statement_reconciliation_immutable() from public, anon, authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array['supplier_statement_reconciliations', 'supplier_statement_reconciliation_items', 'supplier_statement_resolutions'] loop
    execute format('drop trigger if exists %I on %I', t || '_immutable', t);
    execute format('create trigger %I before update or delete on %I for each row execute function fn_supplier_statement_reconciliation_immutable()', t || '_immutable', t);
    execute format('drop trigger if exists %I on %I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on %I for each statement execute function fn_supplier_statement_reconciliation_immutable()', t || '_no_truncate', t);
  end loop;
end $$;

-- A run may only be recorded for a statement that is ready for it: Ready or
-- already Reconciled, supplier CONFIRMED and the run's supplier, base
-- currency, and its closing balance — whoever inserts it.
create or replace function fn_supplier_statement_reconciliation_insert_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  s supplier_statements;
begin
  select * into s from supplier_statements where id = new.statement_id;
  if not found or s.company_id is distinct from new.company_id then
    raise exception 'the statement does not belong to this company' using errcode = '42501';
  end if;
  if s.status not in ('Ready', 'Reconciled') then
    raise exception 'only a ready statement can be reconciled (it is %)', s.status using errcode = '42501';
  end if;
  if s.supplier_id is null or s.supplier_confirmed_at is null or s.supplier_id is distinct from new.supplier_id then
    raise exception 'a reconciliation is only run against the CONFIRMED supplier' using errcode = '42501';
  end if;
  if not fn_supplier_statement_currency_supported(s.company_id, s.currency_code) then
    raise exception 'unsupported currency: this statement cannot be reconciled (manual review required)' using errcode = '42501';
  end if;
  if s.closing_balance is distinct from new.statement_closing or s.statement_date is distinct from new.as_at_date then
    raise exception 'the run must use the statement''s own closing balance and date' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function fn_supplier_statement_reconciliation_insert_guard() from public, anon, authenticated, service_role;

drop trigger if exists supplier_statement_reconciliations_insert_guard on supplier_statement_reconciliations;
create trigger supplier_statement_reconciliations_insert_guard
  before insert on supplier_statement_reconciliations
  for each row execute function fn_supplier_statement_reconciliation_insert_guard();

create or replace function fn_supplier_statement_reconciliation_item_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from supplier_statement_reconciliations r where r.id = new.reconciliation_id and r.company_id = new.company_id) then
    raise exception 'the reconciliation does not belong to this company' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function fn_supplier_statement_reconciliation_item_guard() from public, anon, authenticated, service_role;

drop trigger if exists supplier_statement_reconciliation_items_insert_guard on supplier_statement_reconciliation_items;
create trigger supplier_statement_reconciliation_items_insert_guard
  before insert on supplier_statement_reconciliation_items
  for each row execute function fn_supplier_statement_reconciliation_item_guard();

-- ---------------------------------------------------------------------
-- 6. The resolution writer. The actor is the session's (no parameter);
--    Purchasing:Edit; the statement must be Ready or Reconciled; every
--    referenced record must belong to THIS company and THIS statement's
--    confirmed supplier; a revocation must target a live decision of the
--    same statement.
-- ---------------------------------------------------------------------
create or replace function fn_supplier_statement_record_resolution(
  p_company_id uuid,
  p_statement_id bigint,
  p_action text,
  p_statement_line_id bigint,
  p_precisia_ref_type text,
  p_precisia_ref_id bigint,
  p_revokes_resolution_id bigint,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s supplier_statements;
  v_ok boolean;
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'recording a reconciliation decision requires a signed-in user' using errcode = '42501';
  end if;
  if not user_has_permission(p_company_id, 'Purchasing:Edit') then
    raise exception 'Purchasing:Edit is required' using errcode = '42501';
  end if;
  select * into s from supplier_statements where id = p_statement_id and company_id = p_company_id;
  if not found then
    raise exception 'statement % does not exist in this company', p_statement_id using errcode = '42501';
  end if;
  if s.status not in ('Ready', 'Reconciled') then
    raise exception 'decisions are recorded on a ready or reconciled statement (it is %)', s.status using errcode = '42501';
  end if;
  if s.supplier_id is null or s.supplier_confirmed_at is null then
    raise exception 'the statement''s supplier is not confirmed' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;

  if p_statement_line_id is not null
     and not exists (select 1 from supplier_statement_lines l where l.id = p_statement_line_id and l.statement_id = p_statement_id and l.company_id = p_company_id and not l.is_excluded) then
    raise exception 'the line is not a transaction of this statement' using errcode = '42501';
  end if;

  if p_precisia_ref_type is not null and p_precisia_ref_type <> 'opening-difference' then
    v_ok := case p_precisia_ref_type
      when 'bill' then exists (select 1 from ae_imported_bills b where b.id = p_precisia_ref_id and b.company_id = p_company_id and b.supplier_id = s.supplier_id)
      when 'credit-note' then exists (select 1 from ae_imported_bills b where b.id = p_precisia_ref_id and b.company_id = p_company_id and b.supplier_id = s.supplier_id)
      when 'debit-note' then exists (select 1 from ae_imported_bills b where b.id = p_precisia_ref_id and b.company_id = p_company_id and b.supplier_id = s.supplier_id)
      when 'supplier-payment' then exists (select 1 from supplier_payments p where p.id = p_precisia_ref_id and p.company_id = p_company_id and p.supplier_id = s.supplier_id)
      when 'bank-transaction' then exists (select 1 from ae_bank_transactions t where t.id = p_precisia_ref_id and t.company_id = p_company_id and t.matched_supplier_id = s.supplier_id)
      when 'opening-balance' then exists (select 1 from opening_balance_entries o where o.id = p_precisia_ref_id and o.company_id = p_company_id and o.supplier_id = s.supplier_id)
      else false
    end;
    if not v_ok then
      raise exception 'the PRECISIA record does not belong to this statement''s supplier in this company' using errcode = '42501';
    end if;
  end if;

  if p_action = 'revoke' then
    if not exists (
      select 1 from supplier_statement_resolutions r
      where r.id = p_revokes_resolution_id and r.statement_id = p_statement_id and r.action <> 'revoke'
        and not exists (select 1 from supplier_statement_resolutions x where x.revokes_resolution_id = r.id)
    ) then
      raise exception 'only a live decision of this statement can be revoked' using errcode = '42501';
    end if;
  end if;

  insert into supplier_statement_resolutions (company_id, statement_id, action, statement_line_id, precisia_ref_type, precisia_ref_id,
                                              revokes_resolution_id, reason, performed_by)
  values (p_company_id, p_statement_id, p_action, p_statement_line_id, p_precisia_ref_type, p_precisia_ref_id,
          p_revokes_resolution_id, btrim(p_reason), fn_session_actor_label())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function fn_supplier_statement_record_resolution(uuid,bigint,text,bigint,text,bigint,bigint,text) from public, anon, service_role;
grant execute on function fn_supplier_statement_record_resolution(uuid,bigint,text,bigint,text,bigint,bigint,text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. The statement guard learns 'Reconciled': set only by the server; a
--    reconciled statement can be reopened for review (Edit), and is not
--    edited in place. (Body otherwise unchanged from 0114.)
-- ---------------------------------------------------------------------
create or replace function fn_supplier_statement_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new; -- server paths (service role, owner)
  end if;
  if current_user = 'anon' or auth.uid() is null then
    raise exception 'supplier statements require a signed-in user' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if not user_has_permission(new.company_id, 'Purchasing:Create') then
      raise exception 'Purchasing:Create is required to upload a supplier statement' using errcode = '42501';
    end if;
    if new.status <> 'Queued'
       or new.source_type not in ('pdf', 'image', 'csv', 'xlsx')
       or new.validation_status <> 'Pending'
       or new.supplier_candidates <> '[]'::jsonb
       or new.validation_findings <> '[]'::jsonb
       or new.warnings <> '[]'::jsonb
       or new.status_reason <> ''
       or new.manual_entry
       or new.sign_convention <> 'debit-increases-owed'
       or num_nonnulls(
            new.extraction_method, new.duplicate_of_statement_id, new.supplier_id, new.supplier_match_tier,
            new.supplier_confirmed_by, new.supplier_confirmed_at,
            new.supplier_name_extracted, new.supplier_vat_extracted, new.supplier_registration_extracted,
            new.account_number_extracted, new.statement_date, new.period_from, new.period_to, new.currency_code,
            new.opening_balance, new.closing_balance, new.printed_total_debits, new.printed_total_credits,
            new.printed_ageing, new.page_count, new.validated_at, new.extraction_snapshot
          ) <> 0 then
      raise exception 'a new supplier statement must start Queued with no results' using errcode = '42501';
    end if;
    if not exists (
      select 1 from documents d
      where d.id = new.document_id and d.company_id = new.company_id
        and d.entity_type = 'Supplier' and d.category = 'Statement'
        and d.content_sha256 = new.content_sha256
    ) then
      raise exception 'the document is not a supplier statement stored for this company' using errcode = '42501';
    end if;
    new.uploaded_by := fn_session_actor_label();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if (new.id, new.company_id, new.document_id, new.content_sha256, new.uploaded_by, new.created_at)
     is distinct from (old.id, old.company_id, old.document_id, old.content_sha256, old.uploaded_by, old.created_at) then
    raise exception 'a statement''s identity cannot be changed' using errcode = '42501';
  end if;
  if old.status = 'Rejected' then
    raise exception 'this statement was rejected and can no longer be changed' using errcode = '42501';
  end if;

  if (new.source_type, new.extraction_method, new.status_reason, new.duplicate_of_statement_id,
      new.supplier_candidates, new.supplier_name_extracted, new.supplier_vat_extracted,
      new.supplier_registration_extracted, new.account_number_extracted, new.page_count,
      new.validation_status, new.validation_findings, new.validated_at,
      new.extraction_snapshot, new.warnings, new.manual_entry)
     is distinct from
     (old.source_type, old.extraction_method, old.status_reason, old.duplicate_of_statement_id,
      old.supplier_candidates, old.supplier_name_extracted, old.supplier_vat_extracted,
      old.supplier_registration_extracted, old.account_number_extracted, old.page_count,
      old.validation_status, old.validation_findings, old.validated_at,
      old.extraction_snapshot, old.warnings, old.manual_entry) then
    raise exception 'extraction, validation and duplicate results cannot be changed by a user' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if (new.supplier_id, new.supplier_match_tier, new.supplier_confirmed_at, new.statement_date, new.period_from,
        new.period_to, new.currency_code, new.opening_balance, new.closing_balance, new.printed_total_debits,
        new.printed_total_credits, new.printed_ageing, new.sign_convention)
       is distinct from
       (old.supplier_id, old.supplier_match_tier, old.supplier_confirmed_at, old.statement_date, old.period_from,
        old.period_to, old.currency_code, old.opening_balance, old.closing_balance, old.printed_total_debits,
        old.printed_total_credits, old.printed_ageing, old.sign_convention) then
      raise exception 'a status change cannot also edit the statement' using errcode = '42501';
    end if;

    if new.status = 'Rejected' then
      if not user_has_permission(new.company_id, 'Purchasing:Reject') then
        raise exception 'Purchasing:Reject is required to reject a supplier statement' using errcode = '42501';
      end if;
      new.updated_at := clock_timestamp();
      return new;
    end if;

    if not user_has_permission(new.company_id, 'Purchasing:Edit') then
      raise exception 'Purchasing:Edit is required to change a supplier statement' using errcode = '42501';
    end if;

    if new.status = 'ManualEntry' then
      if old.status not in ('Queued', 'Failed') then
        raise exception 'only a queued or failed statement can be entered by hand (it is %)', old.status using errcode = '42501';
      end if;
      new.manual_entry := true;
      new.extraction_method := 'manual';
      new.validation_status := 'Pending';
      new.validated_at := null;
      new.updated_at := clock_timestamp();
      return new;
    end if;

    if new.status = 'NeedsReview' then
      if old.status = 'ManualEntry' then
        new.validation_status := 'Pending';
        new.validated_at := null;
      elsif old.status not in ('Ready', 'Reconciled') then
        raise exception 'status NeedsReview cannot be set by a user from %', old.status using errcode = '42501';
      end if;
      new.updated_at := clock_timestamp();
      return new;
    end if;

    if new.status = 'Ready' then
      if old.status <> 'NeedsReview' then
        raise exception 'only a statement in review can be marked ready (it is %)', old.status using errcode = '42501';
      end if;
      if old.validation_status not in ('Pass', 'Review') then
        raise exception 'the statement must validate before it is ready (it is %)', old.validation_status using errcode = '42501';
      end if;
      if old.supplier_id is null or old.supplier_confirmed_at is null then
        raise exception 'a reviewer must confirm the supplier before the statement is ready' using errcode = '42501';
      end if;
      if not fn_supplier_statement_currency_supported(old.company_id, old.currency_code) then
        raise exception 'unsupported currency: a % statement cannot be reconciled in this company (manual review required)', old.currency_code
          using errcode = '42501';
      end if;
      if exists (select 1 from supplier_statement_lines l
                 where l.statement_id = old.id and not l.is_excluded and cardinality(l.unresolved_fields) > 0) then
        raise exception 'every unreadable value must be resolved before the statement is ready' using errcode = '42501';
      end if;
      new.updated_at := clock_timestamp();
      return new;
    end if;

    -- 'Reconciled' (and every processing state) is set by the server only.
    raise exception 'status % cannot be set by a user', new.status using errcode = '42501';
  end if;

  if (new.supplier_id, new.supplier_match_tier, new.supplier_confirmed_at, new.supplier_confirmed_by,
      new.statement_date, new.period_from, new.period_to, new.currency_code, new.opening_balance,
      new.closing_balance, new.printed_total_debits, new.printed_total_credits, new.printed_ageing, new.sign_convention)
     is not distinct from
     (old.supplier_id, old.supplier_match_tier, old.supplier_confirmed_at, old.supplier_confirmed_by,
      old.statement_date, old.period_from, old.period_to, old.currency_code, old.opening_balance,
      old.closing_balance, old.printed_total_debits, old.printed_total_credits, old.printed_ageing, old.sign_convention) then
    return new;
  end if;

  if not user_has_permission(new.company_id, 'Purchasing:Edit') then
    raise exception 'Purchasing:Edit is required to correct a supplier statement' using errcode = '42501';
  end if;
  if old.status not in ('NeedsReview', 'ManualEntry') then
    raise exception 'only a statement in review or manual entry can be changed (it is %)', old.status using errcode = '42501';
  end if;

  if new.supplier_id is distinct from old.supplier_id then
    if new.supplier_id is not null
       and not exists (select 1 from ae_suppliers s where s.id = new.supplier_id and s.company_id = new.company_id) then
      raise exception 'the supplier does not belong to this company' using errcode = '42501';
    end if;
    new.supplier_match_tier := case when new.supplier_id is null then null else 'manual' end;
  elsif new.supplier_match_tier is distinct from old.supplier_match_tier then
    raise exception 'the supplier match tier is recorded by the system' using errcode = '42501';
  end if;

  if new.supplier_confirmed_at is not null
     and new.supplier_confirmed_at is distinct from old.supplier_confirmed_at then
    if new.supplier_id is null then
      raise exception 'there is no supplier to confirm' using errcode = '42501';
    end if;
    new.supplier_confirmed_by := fn_session_actor_label();
    new.supplier_confirmed_at := now();
  elsif new.supplier_id is distinct from old.supplier_id then
    new.supplier_confirmed_by := null;
    new.supplier_confirmed_at := null;
  elsif new.supplier_confirmed_at is null then
    new.supplier_confirmed_by := null;
  elsif new.supplier_confirmed_by is distinct from old.supplier_confirmed_by
        or new.supplier_confirmed_at is distinct from old.supplier_confirmed_at then
    raise exception 'a confirmation is recorded by the system' using errcode = '42501';
  end if;

  if (new.statement_date, new.period_from, new.period_to, new.currency_code, new.opening_balance,
      new.closing_balance, new.printed_total_debits, new.printed_total_credits, new.printed_ageing, new.sign_convention)
     is distinct from
     (old.statement_date, old.period_from, old.period_to, old.currency_code, old.opening_balance,
      old.closing_balance, old.printed_total_debits, old.printed_total_credits, old.printed_ageing, old.sign_convention) then
    new.validation_status := 'Pending';
    new.validated_at := null;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke execute on function fn_supplier_statement_guard() from public, anon, authenticated, service_role;

-- The user event writer accepts the new reviewer events.
create or replace function fn_supplier_statement_record_event(
  p_company_id uuid,
  p_statement_id bigint,
  p_event_type text,
  p_detail jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_confirmed timestamptz;
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'recording a statement event requires a signed-in user' using errcode = '42501';
  end if;
  select s.status, s.supplier_confirmed_at into v_status, v_confirmed
  from supplier_statements s where s.id = p_statement_id and s.company_id = p_company_id;
  if not found then
    raise exception 'statement % does not exist in this company', p_statement_id using errcode = '42501';
  end if;

  if p_event_type = 'Uploaded' then
    if not user_has_permission(p_company_id, 'Purchasing:Create') then
      raise exception 'Purchasing:Create is required' using errcode = '42501';
    end if;
  elsif p_event_type = 'Rejected' then
    if not user_has_permission(p_company_id, 'Purchasing:Reject') then
      raise exception 'Purchasing:Reject is required' using errcode = '42501';
    end if;
    if v_status <> 'Rejected' then
      raise exception 'a Rejected event requires a rejected statement' using errcode = '42501';
    end if;
  elsif p_event_type in ('FieldCorrected', 'LineCorrected', 'LineAdded', 'LineRemoved', 'SupplierConfirmed',
                         'SupplierUnconfirmed', 'SupplierAccountNumberSaved', 'ManualEntryStarted',
                         'SubmittedForReview', 'MarkedReady', 'Reopened', 'ProcessingRequeued',
                         'ResolutionRecorded', 'ResolutionRevoked') then
    if not user_has_permission(p_company_id, 'Purchasing:Edit') then
      raise exception 'Purchasing:Edit is required' using errcode = '42501';
    end if;
    if p_event_type = 'SupplierConfirmed' and v_confirmed is null then
      raise exception 'a SupplierConfirmed event requires a confirmed supplier' using errcode = '42501';
    end if;
    if p_event_type = 'ManualEntryStarted' and v_status <> 'ManualEntry' then
      raise exception 'a ManualEntryStarted event requires a statement in manual entry' using errcode = '42501';
    end if;
    if p_event_type = 'MarkedReady' and v_status <> 'Ready' then
      raise exception 'a MarkedReady event requires a ready statement' using errcode = '42501';
    end if;
  else
    raise exception 'event type % is recorded by the system only', p_event_type using errcode = '42501';
  end if;

  insert into supplier_statement_events (company_id, statement_id, event_type, detail, performed_by)
  values (p_company_id, p_statement_id, p_event_type, coalesce(p_detail, '{}'::jsonb), fn_session_actor_label())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function fn_supplier_statement_record_event(uuid,bigint,text,jsonb) from public, anon, service_role;
grant execute on function fn_supplier_statement_record_event(uuid,bigint,text,jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema');
