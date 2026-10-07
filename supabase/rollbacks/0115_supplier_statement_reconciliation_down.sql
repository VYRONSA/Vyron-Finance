-- Rollback for 0115_supplier_statement_reconciliation.sql.
--
-- WARNING: this DESTROYS every reconciliation run, its items and every
-- reviewer decision (resolution). Export them first. Roll the application
-- back to a build without SD-3D BEFORE running this. Statements that were
-- 'Reconciled' are returned to 'Ready'. No accounting record is touched
-- (none was ever written by SD-3D).
begin;

drop table if exists supplier_statement_reconciliation_items;
drop table if exists supplier_statement_reconciliations;
drop table if exists supplier_statement_resolutions;
drop function if exists fn_supplier_statement_record_resolution(uuid,bigint,text,bigint,text,bigint,bigint,text);
drop function if exists fn_supplier_statement_reconciliation_insert_guard();
drop function if exists fn_supplier_statement_reconciliation_item_guard();
drop function if exists fn_supplier_statement_reconciliation_immutable();

-- (owner-run: bypasses the statement guard)
update supplier_statements set status = 'Ready' where status = 'Reconciled';

alter table supplier_statements drop constraint if exists supplier_statements_status_check;
alter table supplier_statements add constraint supplier_statements_status_check check (status in (
  'Queued', 'Processing', 'ManualEntry', 'NeedsReview', 'Ready', 'Duplicate', 'Failed', 'Rejected'));

-- Events of the removed types cannot be deleted (append-only); the 0114 type
-- list is restored only if none exist, otherwise the wider list is kept.
do $do$
begin
  if not exists (select 1 from supplier_statement_events where event_type in ('ReconciliationRun', 'ResolutionRecorded', 'ResolutionRevoked')) then
    alter table supplier_statement_events drop constraint if exists supplier_statement_events_event_type_check;
    alter table supplier_statement_events add constraint supplier_statement_events_event_type_check check (event_type in (
      'Uploaded', 'DuplicateEvaluated', 'ProcessingStarted', 'Extracted', 'ExtractionFailed', 'ManualEntryRequired',
      'ValidationEvaluated', 'SupplierProposed', 'SupplierConfirmed', 'SupplierUnconfirmed', 'SupplierAccountNumberSaved',
      'FieldCorrected', 'LineCorrected', 'LineAdded', 'LineRemoved', 'ManualEntryStarted', 'SubmittedForReview',
      'MarkedReady', 'Reopened', 'Rejected', 'ProcessingRequeued'));
  end if;
end
$do$;

-- 0114's guard and user event writer, verbatim.
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

  -- UPDATE ------------------------------------------------------------
  if (new.id, new.company_id, new.document_id, new.content_sha256, new.uploaded_by, new.created_at)
     is distinct from (old.id, old.company_id, old.document_id, old.content_sha256, old.uploaded_by, old.created_at) then
    raise exception 'a statement''s identity cannot be changed' using errcode = '42501';
  end if;
  if old.status = 'Rejected' then
    raise exception 'this statement was rejected and can no longer be changed' using errcode = '42501';
  end if;

  -- What the system read and decided is never a reviewer's to change.
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

  -- Status transitions -------------------------------------------------
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
      elsif old.status <> 'Ready' then
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

    raise exception 'status % cannot be set by a user', new.status using errcode = '42501';
  end if;

  -- No status change: header corrections and supplier confirmation --------
  if (new.supplier_id, new.supplier_match_tier, new.supplier_confirmed_at, new.supplier_confirmed_by,
      new.statement_date, new.period_from, new.period_to, new.currency_code, new.opening_balance,
      new.closing_balance, new.printed_total_debits, new.printed_total_credits, new.printed_ageing, new.sign_convention)
     is not distinct from
     (old.supplier_id, old.supplier_match_tier, old.supplier_confirmed_at, old.supplier_confirmed_by,
      old.statement_date, old.period_from, old.period_to, old.currency_code, old.opening_balance,
      old.closing_balance, old.printed_total_debits, old.printed_total_credits, old.printed_ageing, old.sign_convention) then
    return new; -- nothing a user can change has changed
  end if;

  if not user_has_permission(new.company_id, 'Purchasing:Edit') then
    raise exception 'Purchasing:Edit is required to correct a supplier statement' using errcode = '42501';
  end if;
  if old.status not in ('NeedsReview', 'ManualEntry') then
    raise exception 'only a statement in review or manual entry can be changed (it is %)', old.status using errcode = '42501';
  end if;

  -- Supplier: chosen and confirmed by a reviewer, never guessed.
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
    -- An explicit confirmation (the caller set the confirmation time):
    -- the confirmer is the session user, now — never a value the caller
    -- supplies. Changing the supplier alone never confirms it.
    if new.supplier_id is null then
      raise exception 'there is no supplier to confirm' using errcode = '42501';
    end if;
    new.supplier_confirmed_by := fn_session_actor_label();
    new.supplier_confirmed_at := now();
  elsif new.supplier_id is distinct from old.supplier_id then
    -- A different supplier must be confirmed again.
    new.supplier_confirmed_by := null;
    new.supplier_confirmed_at := null;
  elsif new.supplier_confirmed_at is null then
    new.supplier_confirmed_by := null; -- unconfirming
  elsif new.supplier_confirmed_by is distinct from old.supplier_confirmed_by
        or new.supplier_confirmed_at is distinct from old.supplier_confirmed_at then
    raise exception 'a confirmation is recorded by the system' using errcode = '42501';
  end if;

  -- Any change to what the statement says has not been validated yet.
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

  -- Only the events a reviewer's own action produces, each with the
  -- permission and resulting state it implies.
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
                         'SubmittedForReview', 'MarkedReady', 'Reopened', 'ProcessingRequeued') then
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
commit;
