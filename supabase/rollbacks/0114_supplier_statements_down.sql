-- Rollback for 0114_supplier_statements.sql.
--
-- WARNING: this DESTROYS every supplier statement, its lines and its event
-- history, and any recorded view/download of a statement original. Export
-- first if any rows exist. Roll the application back to a build without
-- SD-3C BEFORE running this. The statement ORIGINALS (documents rows and
-- stored files) are NOT deleted: once their statements are gone they are
-- ordinary Supplier documents again.
begin;

-- Access audit back to 0113 (captures only).
delete from supplier_document_access_events where statement_id is not null; -- (refused by the immutability trigger if any exist: export first)
alter table supplier_document_access_events drop constraint if exists supplier_document_access_events_statement_id_fkey;

create or replace function fn_record_supplier_document_access(
  p_company_id uuid, p_document_id bigint, p_capture_id bigint, p_statement_id bigint, p_action text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
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
    raise exception 'supplier statement originals are not available yet' using errcode = '42501';
  end if;
  if not exists (
    select 1 from supplier_invoice_captures c
    join documents d on d.id = c.document_id and d.company_id = c.company_id
    where c.id = p_capture_id and c.company_id = p_company_id and c.document_id = p_document_id
  ) then
    raise exception 'document % is not the original of capture % in this company', p_document_id, p_capture_id using errcode = '42501';
  end if;
  insert into supplier_document_access_events (company_id, document_id, capture_id, statement_id, action, actor_user_id, actor_label)
  values (p_company_id, p_document_id, p_capture_id, null, p_action, auth.uid(), 'session')
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text) from public, anon, service_role;
grant execute on function fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text) to authenticated;

-- Retention and audited-original predicates back to captures only.
create or replace function fn_documents_retain_capture_evidence()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if not fn_document_is_capture_evidence(old.id) then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
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

create or replace function fn_document_is_audited_original(p_document_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select fn_document_is_capture_evidence(p_document_id)
$$;
create or replace function fn_storage_object_is_audited_original(p_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select fn_storage_object_is_capture_evidence(p_name)
$$;

drop policy if exists "delete own-company documents in storage" on storage.objects;
create policy "delete own-company documents in storage" on storage.objects for delete using (
  bucket_id = 'documents'
  and user_can_access_company((storage.foldername(name))[1]::uuid)
  and not fn_storage_object_is_capture_evidence(name)
);

drop function if exists fn_document_is_statement_original(bigint);

drop table if exists supplier_statement_events;
drop table if exists supplier_statement_lines;
drop table if exists supplier_statements;

drop function if exists fn_supplier_statement_record_system_event(uuid,bigint,text,jsonb,text);
drop function if exists fn_supplier_statement_record_event(uuid,bigint,text,jsonb);
drop function if exists fn_supplier_statement_events_immutable();
drop function if exists fn_supplier_statement_line_guard();
drop function if exists fn_supplier_statement_guard();
drop function if exists fn_supplier_statement_mark_unvalidated(bigint);
drop function if exists fn_supplier_statement_currency_supported(uuid,text);

alter table ae_suppliers drop constraint if exists ae_suppliers_our_account_number_length;
alter table ae_suppliers drop column if exists our_account_number;

select pg_notify('pgrst', 'reload schema');
commit;
