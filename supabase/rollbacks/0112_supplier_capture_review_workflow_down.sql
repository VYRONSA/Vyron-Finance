-- Rollback for 0112_supplier_capture_review_workflow.sql — restores the 0111 state.
--
-- WARNING: this REMOVES the retention of captured supplier documents (they
-- become deletable again, cascading their capture and history away, and
-- their stored files deletable through the storage API), and the SD-1
-- review workflow (manual entry, corrections of totals, re-validation gate,
-- reviewer line add/remove, Draft-matching on conversion).
--
-- It refuses to run while any capture is in 'ManualEntry', because the 0111
-- status constraint does not allow that state: finish or reject those
-- captures first. Columns added by 0112 are DROPPED, which discards the
-- stored extraction snapshots.

do $$
begin
  if exists (select 1 from supplier_invoice_captures where status = 'ManualEntry') then
    raise exception 'rollback refused: captures are in ManualEntry; submit or reject them first';
  end if;
  if exists (select 1 from supplier_invoice_capture_events where event_type in ('ManualEntryStarted', 'SubmittedForReview')) then
    raise exception 'rollback refused: the event history contains SD-1 event types, which the 0111 constraint does not allow and which may not be deleted';
  end if;
end $$;

-- 5. Retention
drop policy if exists "delete own-company documents in storage" on storage.objects;
create policy "delete own-company documents in storage" on storage.objects for delete using (
  bucket_id = 'documents' and user_can_access_company((storage.foldername(name))[1]::uuid)
);
drop trigger if exists documents_retain_capture_evidence on documents;
drop function if exists fn_documents_retain_capture_evidence();
drop function if exists fn_storage_object_is_capture_evidence(text);
drop function if exists fn_document_is_capture_evidence(bigint);

-- 4. Events: the 0111 writer and constraint
alter table supplier_invoice_capture_events drop constraint if exists supplier_invoice_capture_events_event_type_check;
alter table supplier_invoice_capture_events add constraint supplier_invoice_capture_events_event_type_check check (event_type in (
  'Uploaded', 'Queued', 'ExtractionStarted', 'ExtractionSucceeded', 'ExtractionFailed',
  'ValidationEvaluated', 'SupplierResolved', 'DuplicateEvaluated', 'FieldCorrected',
  'SupplierCreated', 'ConvertedToBill', 'Cancelled', 'Requeued'
));

create or replace function fn_supplier_invoice_capture_record_event(
  p_company_id uuid, p_capture_id bigint, p_event_type text, p_detail jsonb default '{}'::jsonb
)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text;
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'recording a capture event requires a signed-in user' using errcode = '42501';
  end if;
  select c.status into v_status from supplier_invoice_captures c where c.id = p_capture_id and c.company_id = p_company_id;
  if not found then
    raise exception 'capture % does not exist in this company', p_capture_id using errcode = '42501';
  end if;
  if p_event_type = 'Queued' then
    if not user_has_permission(p_company_id, 'Purchasing:Create') then raise exception 'Purchasing:Create is required' using errcode = '42501'; end if;
    if v_status <> 'Queued' then raise exception 'a Queued event requires a queued capture' using errcode = '42501'; end if;
  elsif p_event_type = 'FieldCorrected' then
    if not user_has_permission(p_company_id, 'Purchasing:Edit') then raise exception 'Purchasing:Edit is required' using errcode = '42501'; end if;
    if v_status <> 'NeedsReview' then raise exception 'a correction can only be recorded for a capture in review' using errcode = '42501'; end if;
  elsif p_event_type = 'Cancelled' then
    if not user_has_permission(p_company_id, 'Purchasing:Reject') then raise exception 'Purchasing:Reject is required' using errcode = '42501'; end if;
    if v_status <> 'Cancelled' then raise exception 'a Cancelled event requires a rejected capture' using errcode = '42501'; end if;
  elsif p_event_type = 'ConvertedToBill' then
    if not (user_has_permission(p_company_id, 'Purchasing:Create') and user_has_permission(p_company_id, 'Purchasing:Approve')) then
      raise exception 'Purchasing:Create and Purchasing:Approve are required' using errcode = '42501';
    end if;
    if v_status <> 'Converted' then raise exception 'a ConvertedToBill event requires a converted capture' using errcode = '42501'; end if;
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

-- 3. Lines: back to the 0111 update-only guard
drop trigger if exists supplier_invoice_capture_lines_changed on supplier_invoice_capture_lines;
drop function if exists fn_supplier_invoice_capture_lines_changed();
drop function if exists fn_supplier_invoice_capture_mark_unvalidated(bigint);
drop policy if exists "purchasing edit adds capture lines" on supplier_invoice_capture_lines;
drop policy if exists "purchasing edit removes capture lines" on supplier_invoice_capture_lines;

create or replace function fn_supplier_invoice_capture_line_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (new.id, new.company_id, new.capture_id, new.line_order, new.created_at)
     is distinct from (old.id, old.company_id, old.capture_id, old.line_order, old.created_at) then
    raise exception 'a capture line''s identity cannot be changed' using errcode = '42501';
  end if;
  if (new.supplier_sku, new.uom, new.pack_description, new.pack_quantity, new.vat_rate_percent, new.vat_amount,
      new.line_total, new.gl_account_suggested, new.gl_account_source, new.vat_code_suggested, new.vat_code_source,
      new.line_confidence)
     is distinct from
     (old.supplier_sku, old.uom, old.pack_description, old.pack_quantity, old.vat_rate_percent, old.vat_amount,
      old.line_total, old.gl_account_suggested, old.gl_account_source, old.vat_code_suggested, old.vat_code_source,
      old.line_confidence) then
    raise exception 'extracted and suggested line values cannot be changed by a user' using errcode = '42501';
  end if;
  if not exists (
    select 1 from supplier_invoice_captures c
    where c.id = new.capture_id and c.company_id = new.company_id and c.status = 'NeedsReview'
  ) then
    raise exception 'only lines of a capture in review can be corrected' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function fn_supplier_invoice_capture_line_guard() from public, anon, authenticated;
drop trigger if exists supplier_invoice_capture_lines_guard on supplier_invoice_capture_lines;
create trigger supplier_invoice_capture_lines_guard
  before update on supplier_invoice_capture_lines
  for each row execute function fn_supplier_invoice_capture_line_guard();

-- 2. Capture guard: the 0111 definition
create or replace function fn_supplier_invoice_capture_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if current_user = 'anon' or auth.uid() is null then
    raise exception 'supplier invoice captures require a signed-in user' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if not user_has_permission(new.company_id, 'Purchasing:Create') then
      raise exception 'Purchasing:Create is required to upload a supplier invoice' using errcode = '42501';
    end if;
    if new.status <> 'Uploaded' or new.validation_status <> 'Pending' or new.duplicate_status <> 'None'
       or new.extraction_attempts <> 0 or new.supplier_candidates <> '[]'::jsonb or new.validation_findings <> '[]'::jsonb
       or new.duplicate_reason <> ''
       or num_nonnulls(
            new.supplier_name_extracted, new.supplier_vat_number_extracted, new.supplier_registration_number_extracted,
            new.invoice_number, new.invoice_date, new.due_date, new.order_reference, new.currency_code,
            new.subtotal, new.discount_total, new.vat_amount, new.total,
            new.supplier_id, new.supplier_match_tier, new.model_confidence,
            new.duplicate_of_capture_id, new.duplicate_of_bill_id,
            new.last_error_category, new.last_error_message, new.document_type,
            new.bill_id, new.converted_at, new.converted_by) <> 0 then
      raise exception 'a new supplier invoice capture must start in the Uploaded state with no results' using errcode = '42501';
    end if;
    if not exists (select 1 from documents d where d.id = new.document_id and d.company_id = new.company_id) then
      raise exception 'the document does not belong to this company' using errcode = '42501';
    end if;
    new.uploaded_by := fn_session_actor_label();
    return new;
  end if;
  if (new.id, new.company_id, new.document_id, new.uploaded_by, new.created_at)
     is distinct from (old.id, old.company_id, old.document_id, old.uploaded_by, old.created_at) then
    raise exception 'a capture''s identity cannot be changed' using errcode = '42501';
  end if;
  if old.status in ('Converted', 'Cancelled') then
    raise exception 'this capture is % and can no longer be changed', old.status using errcode = '42501';
  end if;
  if (new.supplier_name_extracted, new.supplier_vat_number_extracted, new.supplier_registration_number_extracted,
      new.currency_code, new.subtotal, new.discount_total, new.vat_amount, new.total,
      new.supplier_candidates, new.validation_status, new.validation_findings, new.model_confidence,
      new.duplicate_status, new.duplicate_of_capture_id, new.duplicate_of_bill_id, new.duplicate_reason,
      new.extraction_attempts, new.last_error_category, new.last_error_message, new.document_type)
     is distinct from
     (old.supplier_name_extracted, old.supplier_vat_number_extracted, old.supplier_registration_number_extracted,
      old.currency_code, old.subtotal, old.discount_total, old.vat_amount, old.total,
      old.supplier_candidates, old.validation_status, old.validation_findings, old.model_confidence,
      old.duplicate_status, old.duplicate_of_capture_id, old.duplicate_of_bill_id, old.duplicate_reason,
      old.extraction_attempts, old.last_error_category, old.last_error_message, old.document_type) then
    raise exception 'extraction, validation and duplicate results cannot be changed by a user' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if (new.supplier_id, new.supplier_match_tier, new.invoice_number, new.invoice_date, new.due_date, new.order_reference)
       is distinct from (old.supplier_id, old.supplier_match_tier, old.invoice_number, old.invoice_date, old.due_date, old.order_reference) then
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
    if new.status = 'Converted' then
      if not (user_has_permission(new.company_id, 'Purchasing:Create') and user_has_permission(new.company_id, 'Purchasing:Approve')) then
        raise exception 'Purchasing:Create and Purchasing:Approve are required to convert a supplier invoice' using errcode = '42501';
      end if;
      if old.status <> 'NeedsReview' or old.bill_id is not null or new.bill_id is null then
        raise exception 'only a capture in review with no bill can be converted' using errcode = '42501';
      end if;
      if old.duplicate_status = 'Blocked' or old.validation_status = 'Incomplete' then
        raise exception 'a blocked duplicate or an incomplete capture cannot be converted' using errcode = '42501';
      end if;
      if not exists (select 1 from ae_imported_bills b where b.id = new.bill_id and b.company_id = new.company_id) then
        raise exception 'the bill does not belong to this company' using errcode = '42501';
      end if;
      new.converted_by := fn_session_actor_label();
      new.converted_at := now();
      return new;
    end if;
    raise exception 'status % cannot be set by a user', new.status using errcode = '42501';
  end if;
  if (new.bill_id, new.converted_at, new.converted_by) is distinct from (old.bill_id, old.converted_at, old.converted_by) then
    raise exception 'a bill can only be linked by converting the capture' using errcode = '42501';
  end if;
  if (new.supplier_id, new.supplier_match_tier, new.invoice_number, new.invoice_date, new.due_date, new.order_reference)
     is distinct from (old.supplier_id, old.supplier_match_tier, old.invoice_number, old.invoice_date, old.due_date, old.order_reference) then
    if not user_has_permission(new.company_id, 'Purchasing:Edit') then
      raise exception 'Purchasing:Edit is required to correct a supplier invoice' using errcode = '42501';
    end if;
    if old.status <> 'NeedsReview' then
      raise exception 'only a capture in review can be corrected (it is %)', old.status using errcode = '42501';
    end if;
    if new.supplier_id is distinct from old.supplier_id then
      if new.supplier_match_tier is distinct from (case when new.supplier_id is null then null else 'manual' end) then
        raise exception 'a supplier chosen by a reviewer is recorded as a manual match' using errcode = '42501';
      end if;
      if new.supplier_id is not null and not exists (select 1 from ae_suppliers s where s.id = new.supplier_id and s.company_id = new.company_id) then
        raise exception 'the supplier does not belong to this company' using errcode = '42501';
      end if;
    elsif new.supplier_match_tier is distinct from old.supplier_match_tier then
      raise exception 'the supplier match tier is recorded by the system' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function fn_supplier_invoice_capture_guard() from public, anon, authenticated;

-- 1. Capture state
alter table supplier_invoice_captures drop constraint if exists supplier_invoice_captures_document_id_fkey;
alter table supplier_invoice_captures add constraint supplier_invoice_captures_document_id_fkey
  foreign key (document_id) references documents (id) on delete cascade;
alter table supplier_invoice_captures drop column if exists validated_at;
alter table supplier_invoice_captures drop column if exists manual_entry;
alter table supplier_invoice_captures drop column if exists extraction_snapshot;
alter table supplier_invoice_captures drop constraint if exists supplier_invoice_captures_status_check;
alter table supplier_invoice_captures add constraint supplier_invoice_captures_status_check check (status in (
  'Uploaded', 'Queued', 'Extracting', 'NeedsReview', 'Converted', 'Duplicate', 'Failed', 'Cancelled'
));

select pg_notify('pgrst', 'reload schema');
