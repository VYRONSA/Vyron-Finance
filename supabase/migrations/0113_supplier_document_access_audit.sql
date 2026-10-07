-- Phase SD-3B — Supplier Document Intelligence: permanent audit of every
-- view and download of a supplier document's ORIGINAL.
--
-- Security and audit only: no accounting calculation, supplier balance,
-- posting rule, bill approval or capture workflow behaviour is changed.
--
-- WHY
--   The original of a captured supplier invoice is accounting evidence
--   (retained since 0112). The owner requires a permanent record of who
--   looked at or downloaded it, when, in which company, and whether it was
--   viewed or downloaded — recorded BEFORE the file is shown, and refusing
--   the file when it cannot be recorded (fail closed).
--
--   Two paths reached those files without passing the SD-2 viewer, so an
--   audit written only by the viewer would not have been a complete record:
--     a. Storage. The 0027 read policy lets ANY member of a company read
--        every object in its folder directly from the Storage API —
--        no Purchasing permission and no record. This migration stops
--        signed-in clients reading supplier originals that way; the
--        application reads them server-side, only after the audit row is
--        written. Every other document is unaffected.
--     b. The generic document download route (signed URL). Closed in the
--        application in the same change: it refuses supplier originals and
--        points to the audited viewer.
--
-- WHAT THIS ADDS
--   * supplier_document_access_events — immutable; one row per view or
--     download; written only by fn_record_supplier_document_access, whose
--     actor is the signed-in session (there is no actor parameter), and a
--     BEFORE INSERT trigger that re-derives the actor from the session so
--     not even a privileged insert can name someone else.
--   * Foundation for supplier statement originals (SD-3C): the table
--     carries `statement_id` (exactly one of capture/statement), and the
--     writer accepts it but REFUSES it until 0114 creates statements and
--     replaces the writer — so nothing can be recorded against a statement
--     that does not exist.
--   * fn_document_is_audited_original / fn_storage_object_is_audited_original
--     — "is this document (by id / by stored path) a supplier original whose
--     access must be audited". Captures today; 0114 extends both to
--     statements. Used by the generic document routes and the Storage read
--     policy.
--   * Explicit grants on every object (new Supabase projects no longer
--     grant new tables to API roles automatically, and this migration must
--     not depend on either behaviour).
--
-- ORDER: 0109 → 0110 → 0111 → 0112 → 0113. Requires 0111
-- (fn_session_actor_label) and 0112 (fn_storage_object_is_capture_evidence).
-- Idempotent.

-- ---------------------------------------------------------------------
-- 1. The event table.
-- ---------------------------------------------------------------------
create table if not exists supplier_document_access_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  -- NO ACTION: an original that has been seen cannot be deleted out from
  -- under its audit trail. (A whole-company deletion removes both in the
  -- same statement, which NO ACTION permits.)
  document_id bigint not null references documents (id),
  capture_id bigint references supplier_invoice_captures (id),
  -- Foreign key added by 0114, when supplier_statements exists.
  statement_id bigint,
  action text not null check (action in ('view', 'download')),
  actor_user_id uuid not null,
  actor_label text not null check (length(btrim(actor_label)) > 0),
  occurred_at timestamptz not null default now(),
  constraint supplier_document_access_events_one_subject check (num_nonnulls(capture_id, statement_id) = 1)
);

create index if not exists supplier_document_access_events_document_idx
  on supplier_document_access_events (company_id, document_id, occurred_at desc);
create index if not exists supplier_document_access_events_capture_idx
  on supplier_document_access_events (capture_id) where capture_id is not null;
create index if not exists supplier_document_access_events_statement_idx
  on supplier_document_access_events (statement_id) where statement_id is not null;

alter table supplier_document_access_events enable row level security;

-- ---------------------------------------------------------------------
-- 2. Explicit grants. Nobody writes the table directly — not even the
--    service role: the only way in is the writer function below.
-- ---------------------------------------------------------------------
revoke all on table supplier_document_access_events from public, anon, authenticated, service_role;
grant select on table supplier_document_access_events to authenticated, service_role;

drop policy if exists "purchasing view reads supplier document access events" on supplier_document_access_events;
create policy "purchasing view reads supplier document access events"
  on supplier_document_access_events for select
  using (user_has_permission(company_id, 'Purchasing:View'));

-- ---------------------------------------------------------------------
-- 3. The actor is always the session's.
-- ---------------------------------------------------------------------
create or replace function fn_supplier_document_access_events_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'an access to a supplier original can only be recorded for a signed-in user'
      using errcode = '42501';
  end if;
  new.actor_user_id := auth.uid();
  new.actor_label := left(coalesce(nullif(btrim(fn_session_actor_label()), ''), auth.uid()::text), 200);
  new.occurred_at := now();
  return new;
end;
$$;
revoke execute on function fn_supplier_document_access_events_stamp() from public, anon, authenticated, service_role;

drop trigger if exists supplier_document_access_events_stamp on supplier_document_access_events;
create trigger supplier_document_access_events_stamp
  before insert on supplier_document_access_events
  for each row execute function fn_supplier_document_access_events_stamp();

-- ---------------------------------------------------------------------
-- 4. Immutable: no UPDATE, no DELETE, no TRUNCATE — except the database
--    removing a whole company through a foreign-key cascade (one trigger
--    level deeper than any direct statement), as in 0111.
-- ---------------------------------------------------------------------
create or replace function fn_supplier_document_access_events_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'supplier_document_access_events is append-only: it cannot be truncated';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'supplier_document_access_events is append-only: a recorded access cannot be modified';
  end if;
  if pg_trigger_depth() <= 1 then
    raise exception 'supplier_document_access_events is append-only: a recorded access cannot be deleted';
  end if;
  return old;
end;
$$;
revoke execute on function fn_supplier_document_access_events_immutable() from public, anon, authenticated, service_role;

drop trigger if exists supplier_document_access_events_immutable on supplier_document_access_events;
create trigger supplier_document_access_events_immutable
  before update or delete on supplier_document_access_events
  for each row execute function fn_supplier_document_access_events_immutable();

drop trigger if exists supplier_document_access_events_no_truncate on supplier_document_access_events;
create trigger supplier_document_access_events_no_truncate
  before truncate on supplier_document_access_events
  for each statement execute function fn_supplier_document_access_events_immutable();

-- ---------------------------------------------------------------------
-- 5. The writer. Called by the viewer under the signed-in user's session,
--    BEFORE the file is returned. Verifies, itself, that:
--      - there is a signed-in user (the actor);
--      - the user holds Purchasing:View in the company;
--      - the document belongs to the company AND is the original of the
--        named capture in that same company.
--    A refusal raises, so nothing is recorded and the viewer serves
--    nothing. There is deliberately no actor parameter.
-- ---------------------------------------------------------------------
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
  if p_action is null or p_action not in ('view', 'download') then
    raise exception 'access action must be view or download' using errcode = '22023';
  end if;
  if num_nonnulls(p_capture_id, p_statement_id) <> 1 then
    raise exception 'an access is recorded against exactly one capture or one statement' using errcode = '22023';
  end if;
  if not user_has_permission(p_company_id, 'Purchasing:View') then
    raise exception 'Purchasing:View is required' using errcode = '42501';
  end if;

  if p_statement_id is not null then
    -- Replaced by 0114 once supplier statements exist.
    raise exception 'supplier statement originals are not available yet' using errcode = '42501';
  end if;

  if not exists (
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
  values (p_company_id, p_document_id, p_capture_id, null, p_action, auth.uid(), 'session')
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text) from public, anon, service_role;
grant execute on function fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Storage: a supplier original is read only through the audited
--    viewer. Signed-in clients can no longer read it directly from the
--    Storage API (the server reads it, after the audit row is written).
--    Every other object keeps the 0027 rule unchanged.
-- ---------------------------------------------------------------------
-- By document id, for the application: the generic document routes refuse
-- these and point to the audited viewer instead.
create or replace function fn_document_is_audited_original(p_document_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Captures today; 0114 adds supplier statement originals.
  select fn_document_is_capture_evidence(p_document_id)
$$;
revoke execute on function fn_document_is_audited_original(bigint) from public, anon;
grant execute on function fn_document_is_audited_original(bigint) to authenticated, service_role;

create or replace function fn_storage_object_is_audited_original(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Captures today; 0114 adds supplier statement originals.
  select fn_storage_object_is_capture_evidence(p_name)
$$;
revoke execute on function fn_storage_object_is_audited_original(text) from public, anon;
grant execute on function fn_storage_object_is_audited_original(text) to authenticated, service_role;

-- The read policy now evaluates this per object read; neither lookup it
-- makes was indexed (0112's delete policy only ran on deletes).
create index if not exists documents_storage_path_idx on documents (storage_path);
create index if not exists supplier_invoice_captures_document_idx on supplier_invoice_captures (document_id);

drop policy if exists "read own-company documents in storage" on storage.objects;
create policy "read own-company documents in storage" on storage.objects for select
  using (
    bucket_id = 'documents'
    and user_can_access_company((storage.foldername(name))[1]::uuid)
    and not fn_storage_object_is_audited_original(name)
  );

select pg_notify('pgrst', 'reload schema');
