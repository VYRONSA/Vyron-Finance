-- Phase SD-3G (UAT) — supplier statements: a safe REPROCESS.
--
-- Lets a reviewer have a statement's RETAINED original read again by the
-- current reader, without a new upload: the original document is never
-- replaced, deleted or copied, and only the statement's derived extraction
-- (lines, header facts, supplier proposal, validation) is rebuilt.
--
--   1. supplier_document_access_events: the access action 'reprocess' — the
--      server reading the original at a reviewer's request is recorded like
--      every other access (actor from the session, fail-closed). Statements
--      only; requires Purchasing:Edit. (fn_record_supplier_document_access:
--      the 0114 body with only that rule added.)
--   2. supplier_statement_events: the event type 'Reprocessed'.
--
-- Refusing to overwrite a reviewer's work (corrections, manual entry, a
-- confirmed supplier, decisions, runs) is enforced by the application before
-- anything is changed; derived data is rebuilt by the existing system writers.
--
-- ORDER: … → 0116 → 0117 → 0118. Idempotent.

alter table supplier_document_access_events drop constraint if exists supplier_document_access_events_action_check;
alter table supplier_document_access_events add constraint supplier_document_access_events_action_check
  check (action in ('view', 'download', 'reprocess'));

create or replace function fn_record_supplier_document_access(
  p_company_id uuid,
  p_document_id bigint,
  p_capture_id bigint,
  p_statement_id bigint,
  p_action text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'recording an access requires a signed-in user' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('view', 'download', 'reprocess') then
    raise exception 'access action must be view, download or reprocess' using errcode = '22023';
  end if;
  -- SD-3G reprocess: the server re-reads a STATEMENT original with the current
  -- reader at a reviewer's request. Only statements; it changes derived data,
  -- so it needs Purchasing:Edit.
  if p_action = 'reprocess' then
    if p_statement_id is null then
      raise exception 'only a supplier statement can be reprocessed' using errcode = '22023';
    end if;
    if not user_has_permission(p_company_id, 'Purchasing:Edit') then
      raise exception 'Purchasing:Edit is required to reprocess a statement' using errcode = '42501';
    end if;
  end if;
  if num_nonnulls(p_capture_id, p_statement_id) <> 1 then
    raise exception 'an access is recorded against exactly one capture or one statement' using errcode = '22023';
  end if;
  if not user_has_permission(p_company_id, 'Purchasing:View') then
    raise exception 'Purchasing:View is required' using errcode = '42501';
  end if;

  if p_statement_id is not null then
    if not exists (
      select 1
      from supplier_statements s
      join documents d on d.id = s.document_id and d.company_id = s.company_id
      where s.id = p_statement_id
        and s.company_id = p_company_id
        and s.document_id = p_document_id
    ) then
      raise exception 'document % is not the original of statement % in this company', p_document_id, p_statement_id
        using errcode = '42501';
    end if;
  elsif not exists (
    select 1
    from supplier_invoice_captures c
    join documents d on d.id = c.document_id and d.company_id = c.company_id
    where c.id = p_capture_id
      and c.company_id = p_company_id
      and c.document_id = p_document_id
  ) then
    raise exception 'document % is not the original of capture % in this company', p_document_id, p_capture_id
      using errcode = '42501';
  end if;

  insert into supplier_document_access_events (company_id, document_id, capture_id, statement_id, action, actor_user_id, actor_label)
  -- actor_* are placeholders: the stamp trigger overwrites them from the session.
  values (p_company_id, p_document_id, p_capture_id, p_statement_id, p_action, auth.uid(), 'session')
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text) from public, anon, service_role;
grant execute on function fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text) to authenticated;

alter table supplier_statement_events drop constraint if exists supplier_statement_events_event_type_check;
alter table supplier_statement_events add constraint supplier_statement_events_event_type_check check (event_type in (
  'Uploaded', 'DuplicateEvaluated', 'ProcessingStarted', 'Extracted', 'ExtractionFailed', 'ManualEntryRequired',
  'ValidationEvaluated', 'SupplierProposed', 'SupplierConfirmed', 'SupplierUnconfirmed', 'SupplierAccountNumberSaved',
  'FieldCorrected', 'LineCorrected', 'LineAdded', 'LineRemoved', 'ManualEntryStarted', 'SubmittedForReview',
  'MarkedReady', 'Reopened', 'Rejected', 'ProcessingRequeued',
  'ReconciliationRun', 'ResolutionRecorded', 'ResolutionRevoked',
  'AiExtractionSkipped', 'AiExtractionRefused', 'AiExtracted', 'AiExtractionFailed',
  'Reprocessed'));
