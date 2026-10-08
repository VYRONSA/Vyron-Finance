-- Rollback for 0116_supplier_statement_ai_boundary.sql.
--
-- Removes the statement AI boundary. Statements read by AI keep their
-- values; their lines' provenance column is dropped. Attempt records are
-- DESTROYED — export them first. Roll the application back first.
begin;

drop table if exists ai_statement_extraction_attempts;
drop function if exists fn_ai_statement_extraction_attempts_immutable();
drop function if exists fn_ai_statement_extraction_record_attempt(uuid,bigint,text,boolean,text,text,integer,text,jsonb,integer,integer,text,text,boolean,timestamptz);
drop function if exists fn_ai_statement_extraction_gate(uuid,bigint,timestamptz);
drop function if exists fn_ai_scope_record_signal(text,text,text,integer,text,boolean,timestamptz);
drop function if exists fn_ai_scope_gate(uuid,text,timestamptz);

-- 0114's line guard, verbatim (no extracted_by).
create or replace function fn_supplier_statement_line_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row supplier_statement_lines;
  v_status text;
  v_company uuid;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if current_user = 'anon' or auth.uid() is null then
    raise exception 'supplier statements require a signed-in user' using errcode = '42501';
  end if;

  v_row := case when tg_op = 'DELETE' then old else new end;
  select s.status, s.company_id into v_status, v_company from supplier_statements s where s.id = v_row.statement_id;
  if not found or v_company is distinct from v_row.company_id then
    raise exception 'the statement does not belong to this company' using errcode = '42501';
  end if;
  if not user_has_permission(v_company, 'Purchasing:Edit') then
    raise exception 'Purchasing:Edit is required to change statement lines' using errcode = '42501';
  end if;
  if v_status not in ('NeedsReview', 'ManualEntry') then
    raise exception 'only a statement in review or manual entry can have its lines changed (it is %)', v_status using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if cardinality(new.unresolved_fields) <> 0 or new.raw_text is not null then
      raise exception 'a line entered by a reviewer has no unread values' using errcode = '42501';
    end if;
    new.corrected := true;
    new.type_source := 'reviewer';
    new.created_at := now();
    new.updated_at := now();
    perform fn_supplier_statement_mark_unvalidated(new.statement_id);
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform fn_supplier_statement_mark_unvalidated(old.statement_id);
    return old;
  end if;

  -- UPDATE
  if (new.id, new.company_id, new.statement_id, new.line_order, new.page_number, new.row_on_page, new.raw_text, new.created_at)
     is distinct from (old.id, old.company_id, old.statement_id, old.line_order, old.page_number, old.row_on_page, old.raw_text, old.created_at) then
    raise exception 'a line''s identity and provenance cannot be changed' using errcode = '42501';
  end if;
  if new.unresolved_fields is distinct from old.unresolved_fields then
    raise exception 'unread values are resolved by correcting them, not by editing the list' using errcode = '42501';
  end if;

  -- A field the reviewer has now set is no longer unread.
  new.unresolved_fields := array(
    select f from unnest(old.unresolved_fields) f
    where (f = 'transaction_date' and new.transaction_date is not distinct from old.transaction_date)
       or (f = 'reference_text' and new.reference_text is not distinct from old.reference_text)
       or (f = 'debit' and new.debit is not distinct from old.debit and new.credit is not distinct from old.credit)
       or (f = 'credit' and new.credit is not distinct from old.credit and new.debit is not distinct from old.debit)
       or (f = 'running_balance' and new.running_balance is not distinct from old.running_balance)
       or (f = 'transaction_type' and new.transaction_type is not distinct from old.transaction_type)
  );
  if new.transaction_type is distinct from old.transaction_type then
    new.type_source := 'reviewer';
  elsif new.type_source is distinct from old.type_source then
    raise exception 'how a line''s type was decided is recorded by the system' using errcode = '42501';
  end if;
  new.corrected := true;
  new.updated_at := clock_timestamp();
  perform fn_supplier_statement_mark_unvalidated(new.statement_id);
  return new;
end;
$$;
revoke execute on function fn_supplier_statement_line_guard() from public, anon, authenticated, service_role;

alter table supplier_statement_lines drop constraint if exists supplier_statement_lines_extracted_by_check;
alter table supplier_statement_lines drop column if exists extracted_by;

-- Vocabularies back to 0115 — only where no row uses the SD-3F values.
do $do$
begin
  if not exists (select 1 from supplier_statements where extraction_method = 'ai') then
    alter table supplier_statements drop constraint if exists supplier_statements_extraction_method_check;
    alter table supplier_statements add constraint supplier_statements_extraction_method_check
      check (extraction_method in ('layout', 'tabular', 'manual'));
  end if;
  if not exists (select 1 from supplier_statement_events where event_type in ('AiExtractionSkipped', 'AiExtractionRefused', 'AiExtracted', 'AiExtractionFailed')) then
    alter table supplier_statement_events drop constraint if exists supplier_statement_events_event_type_check;
    alter table supplier_statement_events add constraint supplier_statement_events_event_type_check check (event_type in (
      'Uploaded', 'DuplicateEvaluated', 'ProcessingStarted', 'Extracted', 'ExtractionFailed', 'ManualEntryRequired',
      'ValidationEvaluated', 'SupplierProposed', 'SupplierConfirmed', 'SupplierUnconfirmed', 'SupplierAccountNumberSaved',
      'FieldCorrected', 'LineCorrected', 'LineAdded', 'LineRemoved', 'ManualEntryStarted', 'SubmittedForReview',
      'MarkedReady', 'Reopened', 'Rejected', 'ProcessingRequeued',
      'ReconciliationRun', 'ResolutionRecorded', 'ResolutionRevoked'));
  end if;
end
$do$;

delete from ai_provider_daily_usage where scope = 'supplier-statement-extraction';
delete from ai_provider_circuit_state where scope = 'supplier-statement-extraction';
delete from ai_provider_company_budget_overrides where scope = 'supplier-statement-extraction';
delete from ai_provider_scope_budgets where scope = 'supplier-statement-extraction';

select pg_notify('pgrst', 'reload schema');
commit;
