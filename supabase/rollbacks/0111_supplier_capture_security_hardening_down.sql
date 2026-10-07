-- Rollback for 0111_supplier_capture_security_hardening.sql
--
-- WARNING: this RESTORES THE EXPOSURE that 0111 closed — the 0107–0110 AI
-- functions become executable by PUBLIC (anon and authenticated) again, and
-- the capture tables return to membership-only access with direct client
-- event inserts. Use only to back out a faulty 0111, and re-harden promptly.
--
-- Event rows written while 0111 was live are kept (nothing is deleted).

-- 7. Events
drop function if exists fn_supplier_invoice_capture_record_system_event(uuid,bigint,text,jsonb,text);
drop function if exists fn_supplier_invoice_capture_record_event(uuid,bigint,text,jsonb);
drop trigger if exists supplier_invoice_capture_events_no_truncate on supplier_invoice_capture_events;
drop trigger if exists supplier_invoice_capture_events_immutable on supplier_invoice_capture_events;
drop function if exists fn_supplier_invoice_capture_events_immutable();
drop policy if exists "purchasing view reads capture events" on supplier_invoice_capture_events;
create policy "members can read their company's capture events"
  on supplier_invoice_capture_events for select
  using (user_can_access_company(company_id));
create policy "members can append their company's capture events"
  on supplier_invoice_capture_events for insert
  with check (user_can_access_company(company_id));
grant insert on table supplier_invoice_capture_events to authenticated;

-- 6. Attempts
drop policy if exists "purchasing view reads extraction attempts" on ai_extraction_attempts;
create policy "members can read their company's extraction attempts"
  on ai_extraction_attempts for select
  using (user_can_access_company(company_id));

-- 5. Mappings
drop policy if exists "purchasing approvers update supplier line mappings" on supplier_line_mappings;
drop policy if exists "purchasing approvers learn supplier line mappings" on supplier_line_mappings;
drop policy if exists "purchasing view reads supplier line mappings" on supplier_line_mappings;
create policy "members can access their company's supplier line mappings"
  on supplier_line_mappings for all
  using (user_can_access_company(company_id))
  with check (user_can_access_company(company_id));

-- 4. Lines
drop trigger if exists supplier_invoice_capture_lines_guard on supplier_invoice_capture_lines;
drop function if exists fn_supplier_invoice_capture_line_guard();
drop policy if exists "purchasing edit corrects capture lines" on supplier_invoice_capture_lines;
drop policy if exists "purchasing view reads capture lines" on supplier_invoice_capture_lines;
create policy "members can access their company's capture lines"
  on supplier_invoice_capture_lines for all
  using (user_can_access_company(company_id))
  with check (user_can_access_company(company_id));

-- 3. Captures
drop trigger if exists supplier_invoice_captures_guard on supplier_invoice_captures;
drop function if exists fn_supplier_invoice_capture_guard();
drop policy if exists "purchasing reviewers update invoice captures" on supplier_invoice_captures;
drop policy if exists "purchasing create uploads invoice captures" on supplier_invoice_captures;
drop policy if exists "purchasing view reads invoice captures" on supplier_invoice_captures;
create policy "members can access their company's invoice captures"
  on supplier_invoice_captures for all
  using (user_can_access_company(company_id))
  with check (user_can_access_company(company_id));

-- 2. Session actor / table grants
grant all on table supplier_invoice_captures, supplier_invoice_capture_lines,
  supplier_invoice_capture_events, supplier_line_mappings, ai_extraction_attempts to anon, authenticated;
drop function if exists fn_session_actor_label();

-- 1. Function grants back to the pre-0111 (PUBLIC) state.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'fn_ai_resolve_daily_cap(uuid,text)',
    'fn_ai_reserve_request(uuid,text,timestamptz,integer)',
    'fn_ai_release_request(uuid,text,timestamptz)',
    'fn_ai_classification_release_reservation(uuid,text,timestamptz)',
    'fn_ai_extraction_record_attempt(uuid,bigint,bigint,integer,text,boolean,text,text,integer,text,jsonb,integer,text,text,timestamptz,text,boolean)',
    'fn_ai_extraction_gate(uuid,bigint,timestamptz,text)',
    'fn_ai_certification_open_run(uuid,text,integer,text)',
    'fn_ai_certification_reserve_call(bigint)',
    'fn_ai_certification_close_run(bigint)',
    'fn_ai_certification_read_evidence(bigint)',
    'fn_ai_certification_record_evidence(bigint,uuid,text,text,text,text,text,text,integer,integer,integer,jsonb,text,integer,text,jsonb,text,jsonb,integer,integer)',
    'fn_upsert_supplier_line_mapping(uuid,bigint,text,text,text,text,bigint)'
  ] loop
    if to_regprocedure(v_fn) is not null then
      execute format('grant execute on function %s to public', v_fn);
    end if;
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema');
