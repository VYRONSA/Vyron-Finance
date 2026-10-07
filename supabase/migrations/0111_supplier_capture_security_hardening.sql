-- Phase SD-0 — Supplier Document Intelligence: security hardening.
--
-- Closes two pre-existing gaps found during the SD discovery review
-- (2026-10-07). Security only: no accounting calculation, supplier balance,
-- posting rule or bill approval behaviour is changed by this migration.
--
-- WHY
--   1. Migrations 0107–0110 created SECURITY DEFINER functions without
--      revoking EXECUTE. On a Supabase project new functions are executable
--      by PUBLIC (and so by `anon` and `authenticated`), and none of these
--      functions checks its caller. Measured on a sandbox built from the
--      repository: 11 functions were callable by `anon` — anyone holding
--      the public anon key could reserve or release any company's AI budget,
--      record fake provider failures that open the shared AI circuit for
--      every tenant, and open, reserve against, close and read
--      certification runs. 0099 already shows the correct pattern
--      (0099:558-567): revoke from public/anon/authenticated, grant to
--      service_role.
--   2. The capture tables from 0108 were protected by company membership
--      alone (`user_can_access_company`). Any member of a company — with no
--      Purchasing permission at all — could, through the API, rewrite a
--      capture's status, bill link, validation result or duplicate verdict,
--      seed learned GL mappings, and insert capture events under any
--      `performed_by` name.
--
-- WHAT THIS DOES
--   * Locks the 0107–0110 AI functions to service_role. Conditional on each
--     function existing, so this applies cleanly whether or not 0110 has
--     been applied (production was at 0109 when this was written).
--   * Replaces membership-only RLS on the capture tables with Purchasing
--     permissions, and adds guard triggers that enforce, per column and per
--     status transition, what a signed-in client may change:
--       - reviewer fields          Purchasing:Edit, only while NeedsReview
--       - reject (Cancelled)       Purchasing:Reject
--       - convert (Converted)      Purchasing:Create AND Purchasing:Approve
--       - extraction / validation / duplicate results: never by a client
--       - referenced supplier, bill and document must be the same company
--   * Capture events: no direct client writes. Two writer functions — one
--     for signed-in users that derives the actor from the session and
--     refuses a caller-supplied one, and one for server (service_role)
--     processing. Event rows can never be updated, deleted or truncated.
--
-- SERVER PATHS
--   Code running with the service-role key (the automation runner, and the
--   application's explicit system writes) is trusted, as everywhere else in
--   this schema: the application checks permissions before it uses it. The
--   guard triggers therefore apply to the `authenticated` and `anon` roles.
--
-- ROLLBACK: supabase/rollbacks/0111_supplier_capture_security_hardening_down.sql
--   (restores the 0108 policies and the previous — exposed — grants).

-- ---------------------------------------------------------------------
-- 1. Service-role-only AI functions (0107–0110).
-- ---------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    -- 0107
    'fn_ai_resolve_daily_cap(uuid,text)',
    'fn_ai_reserve_request(uuid,text,timestamptz,integer)',
    'fn_ai_release_request(uuid,text,timestamptz)',
    'fn_ai_classification_release_reservation(uuid,text,timestamptz)',
    -- 0108
    'fn_ai_extraction_record_attempt(uuid,bigint,bigint,integer,text,boolean,text,text,integer,text,jsonb,integer,text,text,timestamptz,text,boolean)',
    'fn_ai_extraction_gate(uuid,bigint,timestamptz,text)',
    -- 0109
    'fn_ai_certification_open_run(uuid,text,integer,text)',
    'fn_ai_certification_reserve_call(bigint)',
    'fn_ai_certification_close_run(bigint)',
    -- 0110 (may not be applied yet)
    'fn_ai_certification_read_evidence(bigint)',
    'fn_ai_certification_record_evidence(bigint,uuid,text,text,text,text,text,text,integer,integer,integer,jsonb,text,integer,text,jsonb,text,jsonb,integer,integer)'
  ] loop
    if to_regprocedure(v_fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
      execute format('grant execute on function %s to service_role', v_fn);
    end if;
  end loop;
end $$;

-- The learned-mapping upsert is SECURITY INVOKER: it runs under the caller's
-- own RLS (section 5), so signed-in users keep EXECUTE. Anonymous callers
-- have no business with it.
revoke execute on function fn_upsert_supplier_line_mapping(uuid,bigint,text,text,text,text,bigint) from public, anon;
grant execute on function fn_upsert_supplier_line_mapping(uuid,bigint,text,text,text,text,bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. The session actor.
--
--    Same rule as the application's `getPerformedByLabel()`: the signed-in
--    user's email, else their auth id. Read from the verified JWT claims,
--    never from a parameter.
-- ---------------------------------------------------------------------
create or replace function fn_session_actor_label()
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''),
    auth.uid()::text
  )
$$;
revoke execute on function fn_session_actor_label() from public, anon;
grant execute on function fn_session_actor_label() to authenticated, service_role;

-- No direct client access for the anonymous role on any capture table, and
-- no TRUNCATE for clients (TRUNCATE is not subject to RLS).
revoke all on table supplier_invoice_captures, supplier_invoice_capture_lines,
  supplier_invoice_capture_events, supplier_line_mappings, ai_extraction_attempts from anon;
revoke truncate on table supplier_invoice_captures, supplier_invoice_capture_lines,
  supplier_invoice_capture_events, supplier_line_mappings, ai_extraction_attempts from authenticated;

-- ---------------------------------------------------------------------
-- 3. supplier_invoice_captures
-- ---------------------------------------------------------------------
drop policy if exists "members can access their company's invoice captures" on supplier_invoice_captures;

drop policy if exists "purchasing view reads invoice captures" on supplier_invoice_captures;
create policy "purchasing view reads invoice captures"
  on supplier_invoice_captures for select
  using (user_has_permission(company_id, 'Purchasing:View'));

drop policy if exists "purchasing create uploads invoice captures" on supplier_invoice_captures;
create policy "purchasing create uploads invoice captures"
  on supplier_invoice_captures for insert
  with check (user_has_permission(company_id, 'Purchasing:Create'));

-- Who may attempt an update at all. WHICH change each permission allows is
-- decided by the guard trigger below.
drop policy if exists "purchasing reviewers update invoice captures" on supplier_invoice_captures;
create policy "purchasing reviewers update invoice captures"
  on supplier_invoice_captures for update
  using (
    user_has_permission(company_id, 'Purchasing:Edit')
    or user_has_permission(company_id, 'Purchasing:Reject')
    or user_has_permission(company_id, 'Purchasing:Approve')
  )
  with check (
    user_has_permission(company_id, 'Purchasing:Edit')
    or user_has_permission(company_id, 'Purchasing:Reject')
    or user_has_permission(company_id, 'Purchasing:Approve')
  );
-- Deliberately no DELETE policy: a capture is rejected, never deleted.

create or replace function fn_supplier_invoice_capture_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new; -- server paths; see SERVER PATHS in the header
  end if;
  if current_user = 'anon' or auth.uid() is null then
    raise exception 'supplier invoice captures require a signed-in user' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if not user_has_permission(new.company_id, 'Purchasing:Create') then
      raise exception 'Purchasing:Create is required to upload a supplier invoice' using errcode = '42501';
    end if;
    -- A new capture starts empty. Every result field is the system's to fill.
    if new.status <> 'Uploaded'
       or new.validation_status <> 'Pending'
       or new.duplicate_status <> 'None'
       or new.extraction_attempts <> 0
       or new.supplier_candidates <> '[]'::jsonb
       or new.validation_findings <> '[]'::jsonb
       or new.duplicate_reason <> ''
       or num_nonnulls(
            new.supplier_name_extracted, new.supplier_vat_number_extracted, new.supplier_registration_number_extracted,
            new.invoice_number, new.invoice_date, new.due_date, new.order_reference, new.currency_code,
            new.subtotal, new.discount_total, new.vat_amount, new.total,
            new.supplier_id, new.supplier_match_tier, new.model_confidence,
            new.duplicate_of_capture_id, new.duplicate_of_bill_id,
            new.last_error_category, new.last_error_message, new.document_type,
            new.bill_id, new.converted_at, new.converted_by
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

  -- Extraction, validation and duplicate results belong to the system.
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
    -- A status change carries no reviewer edits with it.
    if (new.supplier_id, new.supplier_match_tier, new.invoice_number, new.invoice_date, new.due_date, new.order_reference)
       is distinct from
       (old.supplier_id, old.supplier_match_tier, old.invoice_number, old.invoice_date, old.due_date, old.order_reference) then
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
      if not (user_has_permission(new.company_id, 'Purchasing:Create')
              and user_has_permission(new.company_id, 'Purchasing:Approve')) then
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

  -- No status change.
  if (new.bill_id, new.converted_at, new.converted_by) is distinct from (old.bill_id, old.converted_at, old.converted_by) then
    raise exception 'a bill can only be linked by converting the capture' using errcode = '42501';
  end if;

  if (new.supplier_id, new.supplier_match_tier, new.invoice_number, new.invoice_date, new.due_date, new.order_reference)
     is distinct from
     (old.supplier_id, old.supplier_match_tier, old.invoice_number, old.invoice_date, old.due_date, old.order_reference) then
    if not user_has_permission(new.company_id, 'Purchasing:Edit') then
      raise exception 'Purchasing:Edit is required to correct a supplier invoice' using errcode = '42501';
    end if;
    if old.status <> 'NeedsReview' then
      raise exception 'only a capture in review can be corrected (it is %)', old.status using errcode = '42501';
    end if;
    if new.supplier_id is distinct from old.supplier_id then
      -- A person choosing the supplier is a manual match, and only within the company.
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
  end if;

  return new;
end;
$$;
revoke execute on function fn_supplier_invoice_capture_guard() from public, anon, authenticated;

drop trigger if exists supplier_invoice_captures_guard on supplier_invoice_captures;
create trigger supplier_invoice_captures_guard
  before insert or update on supplier_invoice_captures
  for each row execute function fn_supplier_invoice_capture_guard();

-- ---------------------------------------------------------------------
-- 4. supplier_invoice_capture_lines
--
--    Lines are written by extraction (server) and corrected by reviewers.
--    No client INSERT or DELETE policy exists.
-- ---------------------------------------------------------------------
drop policy if exists "members can access their company's capture lines" on supplier_invoice_capture_lines;

drop policy if exists "purchasing view reads capture lines" on supplier_invoice_capture_lines;
create policy "purchasing view reads capture lines"
  on supplier_invoice_capture_lines for select
  using (user_has_permission(company_id, 'Purchasing:View'));

drop policy if exists "purchasing edit corrects capture lines" on supplier_invoice_capture_lines;
create policy "purchasing edit corrects capture lines"
  on supplier_invoice_capture_lines for update
  using (user_has_permission(company_id, 'Purchasing:Edit'))
  with check (user_has_permission(company_id, 'Purchasing:Edit'));

create or replace function fn_supplier_invoice_capture_line_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (new.id, new.company_id, new.capture_id, new.line_order, new.created_at)
     is distinct from (old.id, old.company_id, old.capture_id, old.line_order, old.created_at) then
    raise exception 'a capture line''s identity cannot be changed' using errcode = '42501';
  end if;
  -- What the document printed, and what the system suggested, stay as recorded.
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

-- ---------------------------------------------------------------------
-- 5. supplier_line_mappings — learned only from an approved conversion.
-- ---------------------------------------------------------------------
drop policy if exists "members can access their company's supplier line mappings" on supplier_line_mappings;

drop policy if exists "purchasing view reads supplier line mappings" on supplier_line_mappings;
create policy "purchasing view reads supplier line mappings"
  on supplier_line_mappings for select
  using (user_has_permission(company_id, 'Purchasing:View'));

drop policy if exists "purchasing approvers learn supplier line mappings" on supplier_line_mappings;
create policy "purchasing approvers learn supplier line mappings"
  on supplier_line_mappings for insert
  with check (user_has_permission(company_id, 'Purchasing:Create') and user_has_permission(company_id, 'Purchasing:Approve'));

drop policy if exists "purchasing approvers update supplier line mappings" on supplier_line_mappings;
create policy "purchasing approvers update supplier line mappings"
  on supplier_line_mappings for update
  using (user_has_permission(company_id, 'Purchasing:Create') and user_has_permission(company_id, 'Purchasing:Approve'))
  with check (user_has_permission(company_id, 'Purchasing:Create') and user_has_permission(company_id, 'Purchasing:Approve'));

-- ---------------------------------------------------------------------
-- 6. ai_extraction_attempts — read with Purchasing:View, not membership.
-- ---------------------------------------------------------------------
drop policy if exists "members can read their company's extraction attempts" on ai_extraction_attempts;
drop policy if exists "purchasing view reads extraction attempts" on ai_extraction_attempts;
create policy "purchasing view reads extraction attempts"
  on ai_extraction_attempts for select
  using (user_has_permission(company_id, 'Purchasing:View'));

-- ---------------------------------------------------------------------
-- 7. supplier_invoice_capture_events — immutable, written by function only.
-- ---------------------------------------------------------------------
drop policy if exists "members can read their company's capture events" on supplier_invoice_capture_events;
drop policy if exists "members can append their company's capture events" on supplier_invoice_capture_events;

drop policy if exists "purchasing view reads capture events" on supplier_invoice_capture_events;
create policy "purchasing view reads capture events"
  on supplier_invoice_capture_events for select
  using (user_has_permission(company_id, 'Purchasing:View'));

revoke insert, update, delete, truncate on table supplier_invoice_capture_events from public, anon, authenticated;

create or replace function fn_supplier_invoice_capture_events_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'supplier_invoice_capture_events is append-only: it cannot be truncated';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'supplier_invoice_capture_events is append-only: a recorded event cannot be modified';
  end if;
  -- DELETE: refused unless it is the database removing the whole capture
  -- through a foreign-key cascade (the document or company being deleted),
  -- which runs one trigger level deeper than any direct statement.
  if pg_trigger_depth() <= 1 then
    raise exception 'supplier_invoice_capture_events is append-only: a recorded event cannot be deleted';
  end if;
  return old;
end;
$$;
revoke execute on function fn_supplier_invoice_capture_events_immutable() from public, anon, authenticated;

drop trigger if exists supplier_invoice_capture_events_immutable on supplier_invoice_capture_events;
create trigger supplier_invoice_capture_events_immutable
  before update or delete on supplier_invoice_capture_events
  for each row execute function fn_supplier_invoice_capture_events_immutable();

drop trigger if exists supplier_invoice_capture_events_no_truncate on supplier_invoice_capture_events;
create trigger supplier_invoice_capture_events_no_truncate
  before truncate on supplier_invoice_capture_events
  for each statement execute function fn_supplier_invoice_capture_events_immutable();

-- 7a. Signed-in users. The actor is the session's; there is no parameter
--     through which a caller could name one. Only the events a reviewer's
--     own action produces, each with the permission and state it implies.
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
    if v_status <> 'NeedsReview' then
      raise exception 'a correction can only be recorded for a capture in review' using errcode = '42501';
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

-- 7b. Server processing (extraction, validation, duplicate evaluation).
--     service_role only; the application passes the actor it established.
create or replace function fn_supplier_invoice_capture_record_system_event(
  p_company_id uuid,
  p_capture_id bigint,
  p_event_type text,
  p_detail jsonb,
  p_performed_by text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  if not exists (select 1 from supplier_invoice_captures c where c.id = p_capture_id and c.company_id = p_company_id) then
    raise exception 'capture % does not exist in this company', p_capture_id;
  end if;
  insert into supplier_invoice_capture_events (company_id, capture_id, event_type, detail, performed_by)
  values (p_company_id, p_capture_id, p_event_type, coalesce(p_detail, '{}'::jsonb),
          left(coalesce(nullif(btrim(p_performed_by), ''), 'System'), 200))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function fn_supplier_invoice_capture_record_system_event(uuid,bigint,text,jsonb,text) from public, anon, authenticated;
grant execute on function fn_supplier_invoice_capture_record_system_event(uuid,bigint,text,jsonb,text) to service_role;

select pg_notify('pgrst', 'reload schema');
