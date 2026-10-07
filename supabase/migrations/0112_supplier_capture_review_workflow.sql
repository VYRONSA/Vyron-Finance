-- Phase SD-1 — Supplier Document Intelligence: complete and harden the
-- invoice-capture review workflow.
--
-- Builds on 0111 (SD-0). No accounting calculation, posting rule, supplier
-- balance or bill approval behaviour is changed: conversion still produces
-- an ordinary DRAFT purchase document through `createPurchaseBill`, and
-- only the existing Submit -> Approve -> Post workflow ever posts it.
--
-- WHY
--   A. Retention. Deleting a captured invoice's document cascaded the
--      capture and its whole audit history away. Worse, the application
--      deleted the STORAGE FILE before the database row, and the storage
--      delete policy only checked company membership — so the original
--      invoice could disappear even where a database refusal existed. A
--      captured supplier document is accounting evidence.
--   C. Corrections. Reviewers could not correct header totals, document
--      type or currency, and nothing re-ran validation after a correction:
--      an Incomplete capture could never become convertible, and a
--      corrected one was converted on a stale validation verdict.
--   D. Manual entry. With live AI off, nothing extracts an upload; a person
--      must be able to enter the invoice by hand from the original.
--   F. Credit notes. Conversion may now produce a Draft supplier CREDIT
--      NOTE through the existing purchase-bill path; the guard below makes
--      sure a capture can only ever be linked to the very document its
--      conversion created.
--
-- WHAT THIS DOES
--   1. Capture state: adds 'ManualEntry'; adds `extraction_snapshot` (the
--      extraction exactly as received — header, lines and boundary facts —
--      immutable, so corrections never erase what the document was read
--      as), `manual_entry`, `validated_at`.
--   2. Capture guard (replaces 0111's): reviewers with Purchasing:Edit may
--      correct header values including totals, document type and currency
--      while NeedsReview or ManualEntry; ANY reviewer change resets
--      validation to Pending, and conversion requires a Pass or Review
--      verdict, so validation must run again first. New transitions:
--      Queued/Failed -> ManualEntry and ManualEntry -> NeedsReview (Edit).
--      Conversion may only link the Draft document created for this
--      capture (same company, supplier, number and document type).
--   3. Capture lines: reviewers may add and remove lines (Edit, only while
--      NeedsReview/ManualEntry); suggestions stay system-owned; any line
--      change by a reviewer resets the capture's validation to Pending.
--   4. Events: 'ManualEntryStarted' and 'SubmittedForReview'.
--   5. Retention: a document referenced by a capture cannot be deleted, and
--      its content (path, hash, file name, type, size, company, owner
--      record) cannot be changed, by anyone; its storage object cannot be
--      deleted through the storage API. Whole-company deletion (a
--      foreign-key cascade) is unaffected.
--
-- ROLLBACK: supabase/rollbacks/0112_supplier_capture_review_workflow_down.sql

-- ---------------------------------------------------------------------
-- 1. Capture state
-- ---------------------------------------------------------------------
alter table supplier_invoice_captures drop constraint if exists supplier_invoice_captures_status_check;
alter table supplier_invoice_captures add constraint supplier_invoice_captures_status_check check (status in (
  'Uploaded',     -- stored and hashed, no work queued yet
  'Queued',       -- extraction work created
  'Extracting',   -- claimed by the automation runner
  'ManualEntry',  -- a person is entering it by hand from the original (SD-1)
  'NeedsReview',  -- ready for a human review decision
  'Converted',    -- a Draft purchase document exists (terminal)
  'Duplicate',    -- deterministically blocked as a duplicate
  'Failed',       -- extraction failed terminally (can still be entered by hand)
  'Cancelled'     -- rejected by a human (terminal)
));

alter table supplier_invoice_captures
  add column if not exists extraction_snapshot jsonb,
  add column if not exists manual_entry boolean not null default false,
  add column if not exists validated_at timestamptz;

comment on column supplier_invoice_captures.extraction_snapshot is
  'SD-1: the extraction exactly as received (header, lines, invoice numbers seen, declared line count). Written once by the server; never changed by a reviewer. Current columns hold the reviewed values.';

-- Retention (section 5) needs captures to stop cascading away with their
-- document. NO ACTION is checked at the end of the statement, so deleting a
-- whole company — which removes the document and the capture in the same
-- statement — still works.
alter table supplier_invoice_captures drop constraint if exists supplier_invoice_captures_document_id_fkey;
alter table supplier_invoice_captures add constraint supplier_invoice_captures_document_id_fkey
  foreign key (document_id) references documents (id) on delete no action;

-- ---------------------------------------------------------------------
-- 2. Capture guard (replaces 0111's definition; same trigger)
-- ---------------------------------------------------------------------
create or replace function fn_supplier_invoice_capture_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new; -- server paths (service role, owner); see 0111
  end if;
  if current_user = 'anon' or auth.uid() is null then
    raise exception 'supplier invoice captures require a signed-in user' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if not user_has_permission(new.company_id, 'Purchasing:Create') then
      raise exception 'Purchasing:Create is required to upload a supplier invoice' using errcode = '42501';
    end if;
    if new.status <> 'Uploaded'
       or new.validation_status <> 'Pending'
       or new.duplicate_status <> 'None'
       or new.extraction_attempts <> 0
       or new.supplier_candidates <> '[]'::jsonb
       or new.validation_findings <> '[]'::jsonb
       or new.duplicate_reason <> ''
       or new.manual_entry
       or num_nonnulls(
            new.supplier_name_extracted, new.supplier_vat_number_extracted, new.supplier_registration_number_extracted,
            new.invoice_number, new.invoice_date, new.due_date, new.order_reference, new.currency_code,
            new.subtotal, new.discount_total, new.vat_amount, new.total,
            new.supplier_id, new.supplier_match_tier, new.model_confidence,
            new.duplicate_of_capture_id, new.duplicate_of_bill_id,
            new.last_error_category, new.last_error_message, new.document_type,
            new.bill_id, new.converted_at, new.converted_by,
            new.extraction_snapshot, new.validated_at
          ) <> 0 then
      raise exception 'a new supplier invoice capture must start in the Uploaded state with no results' using errcode = '42501';
    end if;
    if not exists (select 1 from documents d where d.id = new.document_id and d.company_id = new.company_id) then
      raise exception 'the document does not belong to this company' using errcode = '42501';
    end if;
    new.uploaded_by := fn_session_actor_label();
    return new;
  end if;

  -- UPDATE ------------------------------------------------------------
  if (new.id, new.company_id, new.document_id, new.uploaded_by, new.created_at)
     is distinct from (old.id, old.company_id, old.document_id, old.uploaded_by, old.created_at) then
    raise exception 'a capture''s identity cannot be changed' using errcode = '42501';
  end if;

  if old.status in ('Converted', 'Cancelled') then
    raise exception 'this capture is % and can no longer be changed', old.status using errcode = '42501';
  end if;

  -- What the system read and decided is never a reviewer's to change.
  -- (Reviewed header values below are; the extraction itself is kept in
  -- extraction_snapshot.)
  if (new.supplier_name_extracted, new.supplier_vat_number_extracted, new.supplier_registration_number_extracted,
      new.supplier_candidates, new.validation_status, new.validation_findings, new.validated_at, new.model_confidence,
      new.duplicate_status, new.duplicate_of_capture_id, new.duplicate_of_bill_id, new.duplicate_reason,
      new.extraction_attempts, new.last_error_category, new.last_error_message,
      new.extraction_snapshot, new.manual_entry)
     is distinct from
     (old.supplier_name_extracted, old.supplier_vat_number_extracted, old.supplier_registration_number_extracted,
      old.supplier_candidates, old.validation_status, old.validation_findings, old.validated_at, old.model_confidence,
      old.duplicate_status, old.duplicate_of_capture_id, old.duplicate_of_bill_id, old.duplicate_reason,
      old.extraction_attempts, old.last_error_category, old.last_error_message,
      old.extraction_snapshot, old.manual_entry) then
    raise exception 'extraction, validation and duplicate results cannot be changed by a user' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if (new.supplier_id, new.supplier_match_tier, new.invoice_number, new.invoice_date, new.due_date, new.order_reference,
        new.currency_code, new.subtotal, new.discount_total, new.vat_amount, new.total, new.document_type)
       is distinct from
       (old.supplier_id, old.supplier_match_tier, old.invoice_number, old.invoice_date, old.due_date, old.order_reference,
        old.currency_code, old.subtotal, old.discount_total, old.vat_amount, old.total, old.document_type) then
      raise exception 'a status change cannot also edit invoice fields' using errcode = '42501';
    end if;

    if new.status = 'Cancelled' then
      if not user_has_permission(new.company_id, 'Purchasing:Reject') then
        raise exception 'Purchasing:Reject is required to reject a supplier invoice' using errcode = '42501';
      end if;
      if old.bill_id is not null or new.bill_id is not null or new.converted_at is not null or new.converted_by is not null then
        raise exception 'a converted capture cannot be rejected' using errcode = '42501';
      end if;
      return new;
    end if;

    if new.status = 'ManualEntry' then
      if not user_has_permission(new.company_id, 'Purchasing:Edit') then
        raise exception 'Purchasing:Edit is required to enter a supplier invoice by hand' using errcode = '42501';
      end if;
      if old.status not in ('Queued', 'Failed') then
        raise exception 'only a queued or failed capture can be entered by hand (it is %)', old.status using errcode = '42501';
      end if;
      if (new.bill_id, new.converted_at, new.converted_by) is distinct from (old.bill_id, old.converted_at, old.converted_by) then
        raise exception 'a bill can only be linked by converting the capture' using errcode = '42501';
      end if;
      new.manual_entry := true;
      new.validation_status := 'Pending';
      new.validated_at := null;
      new.updated_at := clock_timestamp();
      return new;
    end if;

    if new.status = 'NeedsReview' then
      if not user_has_permission(new.company_id, 'Purchasing:Edit') then
        raise exception 'Purchasing:Edit is required to submit a supplier invoice for review' using errcode = '42501';
      end if;
      if old.status <> 'ManualEntry' then
        raise exception 'status NeedsReview cannot be set by a user from %', old.status using errcode = '42501';
      end if;
      if (new.bill_id, new.converted_at, new.converted_by) is distinct from (old.bill_id, old.converted_at, old.converted_by) then
        raise exception 'a bill can only be linked by converting the capture' using errcode = '42501';
      end if;
      new.validation_status := 'Pending';
      new.validated_at := null;
      new.updated_at := clock_timestamp();
      return new;
    end if;

    if new.status = 'Converted' then
      if not (user_has_permission(new.company_id, 'Purchasing:Create')
              and user_has_permission(new.company_id, 'Purchasing:Approve')) then
        raise exception 'Purchasing:Create and Purchasing:Approve are required to convert a supplier invoice' using errcode = '42501';
      end if;
      if old.status <> 'NeedsReview' or old.bill_id is not null or new.bill_id is null then
        raise exception 'only a capture in review with no bill can be converted' using errcode = '42501';
      end if;
      if old.duplicate_status = 'Blocked' then
        raise exception 'a blocked duplicate cannot be converted' using errcode = '42501';
      end if;
      if old.validation_status not in ('Pass', 'Review') then
        raise exception 'validation must run on the reviewed values before conversion (it is %)', old.validation_status using errcode = '42501';
      end if;
      -- The bill must be the Draft purchase document THIS conversion
      -- created: same company, supplier, number and kind of document.
      if not exists (
        select 1 from ae_imported_bills b
        where b.id = new.bill_id
          and b.company_id = new.company_id
          and b.supplier_id = old.supplier_id
          and b.invoice_number = btrim(old.invoice_number)
          and b.origin = 'Purchasing'
          and b.posting_status = 'Draft'
          and b.document_type = case when old.document_type = 'Credit Note' then 'Credit Note' else 'Bill' end
      ) then
        raise exception 'the bill is not the draft created for this capture' using errcode = '42501';
      end if;
      new.converted_by := fn_session_actor_label();
      new.converted_at := now();
      return new;
    end if;

    raise exception 'status % cannot be set by a user', new.status using errcode = '42501';
  end if;

  -- No status change.
  if (new.bill_id, new.converted_at, new.converted_by) is distinct from (old.bill_id, old.converted_at, old.converted_by) then
    raise exception 'a bill can only be linked by converting the capture' using errcode = '42501';
  end if;

  if (new.supplier_id, new.supplier_match_tier, new.invoice_number, new.invoice_date, new.due_date, new.order_reference,
      new.currency_code, new.subtotal, new.discount_total, new.vat_amount, new.total, new.document_type)
     is distinct from
     (old.supplier_id, old.supplier_match_tier, old.invoice_number, old.invoice_date, old.due_date, old.order_reference,
      old.currency_code, old.subtotal, old.discount_total, old.vat_amount, old.total, old.document_type) then
    if not user_has_permission(new.company_id, 'Purchasing:Edit') then
      raise exception 'Purchasing:Edit is required to correct a supplier invoice' using errcode = '42501';
    end if;
    if old.status not in ('NeedsReview', 'ManualEntry') then
      raise exception 'only a capture in review or manual entry can be corrected (it is %)', old.status using errcode = '42501';
    end if;
    if new.supplier_id is distinct from old.supplier_id then
      if new.supplier_match_tier is distinct from (case when new.supplier_id is null then null else 'manual' end) then
        raise exception 'a supplier chosen by a reviewer is recorded as a manual match' using errcode = '42501';
      end if;
      if new.supplier_id is not null
         and not exists (select 1 from ae_suppliers s where s.id = new.supplier_id and s.company_id = new.company_id) then
        raise exception 'the supplier does not belong to this company' using errcode = '42501';
      end if;
    elsif new.supplier_match_tier is distinct from old.supplier_match_tier then
      raise exception 'the supplier match tier is recorded by the system' using errcode = '42501';
    end if;
    -- A corrected capture has not been validated as corrected.
    new.validation_status := 'Pending';
    new.validated_at := null;
    new.updated_at := clock_timestamp();
  end if;

  return new;
end;
$$;
revoke execute on function fn_supplier_invoice_capture_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Capture lines
-- ---------------------------------------------------------------------
drop policy if exists "purchasing edit adds capture lines" on supplier_invoice_capture_lines;
create policy "purchasing edit adds capture lines"
  on supplier_invoice_capture_lines for insert
  with check (user_has_permission(company_id, 'Purchasing:Edit'));

drop policy if exists "purchasing edit removes capture lines" on supplier_invoice_capture_lines;
create policy "purchasing edit removes capture lines"
  on supplier_invoice_capture_lines for delete
  using (user_has_permission(company_id, 'Purchasing:Edit'));

-- Resets a capture's verdict after a reviewer changes its lines. Security
-- definer so it can write the system-owned column. It is executable by
-- `authenticated` only because the line trigger runs as the caller, so it
-- re-checks that the caller may edit that capture's company — called
-- directly, it can do nothing a reviewer's own edit would not.
create or replace function fn_supplier_invoice_capture_mark_unvalidated(p_capture_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_status text;
begin
  select c.company_id, c.status into v_company, v_status from supplier_invoice_captures c where c.id = p_capture_id;
  if v_company is null then
    return;
  end if;
  if auth.uid() is null or not user_has_permission(v_company, 'Purchasing:Edit') then
    raise exception 'Purchasing:Edit is required' using errcode = '42501';
  end if;
  if v_status not in ('NeedsReview', 'ManualEntry') then
    raise exception 'only a capture in review or manual entry can be changed' using errcode = '42501';
  end if;
  -- Always bumps updated_at: the server's re-validation writes its verdict
  -- only if the capture has not changed since it read it.
  update supplier_invoice_captures
  set validation_status = 'Pending', validated_at = null, updated_at = clock_timestamp()
  where id = p_capture_id;
end;
$$;
revoke execute on function fn_supplier_invoice_capture_mark_unvalidated(bigint) from public, anon, authenticated;

create or replace function fn_supplier_invoice_capture_line_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row supplier_invoice_capture_lines;
  v_status text;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if current_user = 'anon' or auth.uid() is null then
    raise exception 'supplier invoice capture lines require a signed-in user' using errcode = '42501';
  end if;

  v_row := coalesce(new, old);

  if tg_op = 'UPDATE' then
    if (new.id, new.company_id, new.capture_id, new.created_at)
       is distinct from (old.id, old.company_id, old.capture_id, old.created_at) then
      raise exception 'a capture line''s identity cannot be changed' using errcode = '42501';
    end if;
    if (new.pack_description, new.pack_quantity, new.gl_account_suggested, new.gl_account_source,
        new.vat_code_suggested, new.vat_code_source, new.line_confidence)
       is distinct from
       (old.pack_description, old.pack_quantity, old.gl_account_suggested, old.gl_account_source,
        old.vat_code_suggested, old.vat_code_source, old.line_confidence) then
      raise exception 'suggested line values cannot be changed by a user' using errcode = '42501';
    end if;
  elsif tg_op = 'INSERT' then
    if num_nonnulls(new.pack_description, new.pack_quantity, new.gl_account_suggested, new.gl_account_source,
                    new.vat_code_suggested, new.vat_code_source, new.line_confidence) <> 0 then
      raise exception 'a line added by a reviewer carries no system suggestion' using errcode = '42501';
    end if;
  end if;

  select c.status into v_status
  from supplier_invoice_captures c
  where c.id = v_row.capture_id and c.company_id = v_row.company_id;
  if v_status is null or v_status not in ('NeedsReview', 'ManualEntry') then
    raise exception 'only lines of a capture in review or manual entry can be changed' using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;
revoke execute on function fn_supplier_invoice_capture_line_guard() from public, anon, authenticated;

drop trigger if exists supplier_invoice_capture_lines_guard on supplier_invoice_capture_lines;
create trigger supplier_invoice_capture_lines_guard
  before insert or update or delete on supplier_invoice_capture_lines
  for each row execute function fn_supplier_invoice_capture_line_guard();

create or replace function fn_supplier_invoice_capture_lines_changed()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Only a reviewer's change invalidates the verdict. The server replacing
  -- extracted lines is followed by its own validation.
  if current_user = 'authenticated' then
    perform fn_supplier_invoice_capture_mark_unvalidated(case when tg_op = 'DELETE' then old.capture_id else new.capture_id end);
  end if;
  return null;
end;
$$;
revoke execute on function fn_supplier_invoice_capture_lines_changed() from public, anon, authenticated;

drop trigger if exists supplier_invoice_capture_lines_changed on supplier_invoice_capture_lines;
create trigger supplier_invoice_capture_lines_changed
  after insert or update or delete on supplier_invoice_capture_lines
  for each row execute function fn_supplier_invoice_capture_lines_changed();

-- The line trigger calls the definer function as `authenticated`.
grant execute on function fn_supplier_invoice_capture_mark_unvalidated(bigint) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Events
-- ---------------------------------------------------------------------
alter table supplier_invoice_capture_events drop constraint if exists supplier_invoice_capture_events_event_type_check;
alter table supplier_invoice_capture_events add constraint supplier_invoice_capture_events_event_type_check check (event_type in (
  'Uploaded', 'Queued', 'ExtractionStarted', 'ExtractionSucceeded', 'ExtractionFailed',
  'ValidationEvaluated', 'SupplierResolved', 'DuplicateEvaluated', 'FieldCorrected',
  'SupplierCreated', 'ConvertedToBill', 'Cancelled', 'Requeued',
  'ManualEntryStarted', 'SubmittedForReview'
));

create or replace function fn_supplier_invoice_capture_record_event(
  p_company_id uuid,
  p_capture_id bigint,
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
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'recording a capture event requires a signed-in user' using errcode = '42501';
  end if;

  select c.status into v_status
  from supplier_invoice_captures c
  where c.id = p_capture_id and c.company_id = p_company_id;
  if not found then
    raise exception 'capture % does not exist in this company', p_capture_id using errcode = '42501';
  end if;

  if p_event_type = 'Queued' then
    if not user_has_permission(p_company_id, 'Purchasing:Create') then
      raise exception 'Purchasing:Create is required' using errcode = '42501';
    end if;
    if v_status <> 'Queued' then
      raise exception 'a Queued event requires a queued capture' using errcode = '42501';
    end if;
  elsif p_event_type = 'FieldCorrected' then
    if not user_has_permission(p_company_id, 'Purchasing:Edit') then
      raise exception 'Purchasing:Edit is required' using errcode = '42501';
    end if;
    if v_status not in ('NeedsReview', 'ManualEntry') then
      raise exception 'a correction can only be recorded for a capture in review or manual entry' using errcode = '42501';
    end if;
  elsif p_event_type = 'ManualEntryStarted' then
    if not user_has_permission(p_company_id, 'Purchasing:Edit') then
      raise exception 'Purchasing:Edit is required' using errcode = '42501';
    end if;
    if v_status <> 'ManualEntry' then
      raise exception 'a ManualEntryStarted event requires a capture in manual entry' using errcode = '42501';
    end if;
  elsif p_event_type = 'SubmittedForReview' then
    if not user_has_permission(p_company_id, 'Purchasing:Edit') then
      raise exception 'Purchasing:Edit is required' using errcode = '42501';
    end if;
    if v_status <> 'NeedsReview' then
      raise exception 'a SubmittedForReview event requires a capture in review' using errcode = '42501';
    end if;
  elsif p_event_type = 'Cancelled' then
    if not user_has_permission(p_company_id, 'Purchasing:Reject') then
      raise exception 'Purchasing:Reject is required' using errcode = '42501';
    end if;
    if v_status <> 'Cancelled' then
      raise exception 'a Cancelled event requires a rejected capture' using errcode = '42501';
    end if;
  elsif p_event_type = 'ConvertedToBill' then
    if not (user_has_permission(p_company_id, 'Purchasing:Create') and user_has_permission(p_company_id, 'Purchasing:Approve')) then
      raise exception 'Purchasing:Create and Purchasing:Approve are required' using errcode = '42501';
    end if;
    if v_status <> 'Converted' then
      raise exception 'a ConvertedToBill event requires a converted capture' using errcode = '42501';
    end if;
  else
    raise exception 'event type % is recorded by the system only', p_event_type using errcode = '42501';
  end if;

  insert into supplier_invoice_capture_events (company_id, capture_id, event_type, detail, performed_by)
  values (p_company_id, p_capture_id, p_event_type, coalesce(p_detail, '{}'::jsonb), fn_session_actor_label())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function fn_supplier_invoice_capture_record_event(uuid,bigint,text,jsonb) from public, anon;
grant execute on function fn_supplier_invoice_capture_record_event(uuid,bigint,text,jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Retention of captured supplier documents
-- ---------------------------------------------------------------------
create or replace function fn_document_is_capture_evidence(p_document_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from supplier_invoice_captures c where c.document_id = p_document_id)
$$;
revoke execute on function fn_document_is_capture_evidence(bigint) from public, anon;
grant execute on function fn_document_is_capture_evidence(bigint) to authenticated, service_role;

-- For the storage policy, which only knows the object's path. Answers only
-- for a path inside a company the caller belongs to.
create or replace function fn_storage_object_is_capture_evidence(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from documents d
    join supplier_invoice_captures c on c.document_id = d.id
    where d.storage_path = p_name
      and (auth.uid() is null or user_can_access_company(d.company_id))
  )
$$;
revoke execute on function fn_storage_object_is_capture_evidence(text) from public, anon;
grant execute on function fn_storage_object_is_capture_evidence(text) to authenticated, service_role;

create or replace function fn_documents_retain_capture_evidence()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not fn_document_is_capture_evidence(old.id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    -- A whole-company deletion removes documents through a foreign-key
    -- cascade, one trigger level deeper than any direct statement.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'document % is the original of a captured supplier invoice and is retained as accounting evidence', old.id
      using errcode = '42501';
  end if;

  if (new.company_id, new.entity_type, new.entity_id, new.storage_path, new.content_sha256,
      new.filename, new.mime_type, new.size_bytes, new.uploaded_by, new.uploaded_at)
     is distinct from
     (old.company_id, old.entity_type, old.entity_id, old.storage_path, old.content_sha256,
      old.filename, old.mime_type, old.size_bytes, old.uploaded_by, old.uploaded_at) then
    raise exception 'document % is the original of a captured supplier invoice; its content cannot be changed', old.id
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function fn_documents_retain_capture_evidence() from public, anon, authenticated;

drop trigger if exists documents_retain_capture_evidence on documents;
create trigger documents_retain_capture_evidence
  before update or delete on documents
  for each row execute function fn_documents_retain_capture_evidence();

-- Storage: the same object cannot be removed behind the documents table's back.
drop policy if exists "delete own-company documents in storage" on storage.objects;
create policy "delete own-company documents in storage" on storage.objects for delete using (
  bucket_id = 'documents'
  and user_can_access_company((storage.foldername(name))[1]::uuid)
  and not fn_storage_object_is_capture_evidence(name)
);

select pg_notify('pgrst', 'reload schema');
