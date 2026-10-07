-- Rollback for 0113_supplier_document_access_audit.sql.
--
-- WARNING: dropping supplier_document_access_events DESTROYS the permanent
-- record of who viewed or downloaded supplier originals. Export it first
-- if any rows exist. The application must be rolled back to a build that
-- does not call fn_record_supplier_document_access BEFORE running this —
-- otherwise the viewer (which fails closed) will refuse every original.
begin;

-- Storage read policy back to 0027's.
drop policy if exists "read own-company documents in storage" on storage.objects;
create policy "read own-company documents in storage" on storage.objects for select
  using (bucket_id = 'documents' and user_can_access_company((storage.foldername(name))[1]::uuid));

drop function if exists fn_storage_object_is_audited_original(text);
drop function if exists fn_document_is_audited_original(bigint);
drop function if exists fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text);

drop table if exists supplier_document_access_events;
drop function if exists fn_supplier_document_access_events_immutable();
drop function if exists fn_supplier_document_access_events_stamp();

drop index if exists documents_storage_path_idx;
drop index if exists supplier_invoice_captures_document_idx;

select pg_notify('pgrst', 'reload schema');
commit;
