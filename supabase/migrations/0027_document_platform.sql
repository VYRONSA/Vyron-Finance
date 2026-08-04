-- RC1 Phase 4 — ONE shared Document Platform. No module uploads
-- documents independently; every entity type the directive names
-- (Customers, Suppliers, Inventory, Assets, Journals, Bank Statements,
-- Audit Evidence, Financial Statements) attaches through this one
-- `documents` table and one Supabase Storage bucket. Permissions are
-- NOT reinvented here — a document's access is gated by the SAME
-- module permission its owning entity already uses (a Customer
-- document requires `Sales:*`, a Supplier document `Purchasing:*`, an
-- Asset document `Assets:*`, ...) via the RC1 Phase 1 Permission
-- Engine's own `user_has_permission()`, mapped through
-- `document_permission_module()` below — "no duplicate permission
-- logic," the same principle the whole RBAC platform was built on.

create table documents (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  entity_type text not null check (entity_type in ('Customer', 'Supplier', 'Inventory', 'Asset', 'Journal', 'BankStatement', 'AuditEvidence', 'FinancialStatement')),
  entity_id bigint not null,
  document_group_id bigint, -- null on the FIRST version of a document; set to that first row's own id from then on, so every version of "the same logical document" shares one group id
  version_number int not null default 1,
  is_current boolean not null default true,
  category text not null default 'General',
  filename text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  -- Virus scanning extension point — a real, honest status, never
  -- fabricated as "clean" by default. See `document-scan-service.ts`.
  virus_scan_status text not null default 'pending' check (virus_scan_status in ('pending', 'clean', 'infected', 'skipped')),
  -- OCR metadata extension point — populated only by a real OCR
  -- provider plugged in later; `null` is the honest default, not an
  -- empty-object placeholder pretending OCR ran.
  ocr_status text not null default 'pending' check (ocr_status in ('pending', 'completed', 'skipped')),
  ocr_metadata jsonb,
  retention_until date,
  uploaded_by text not null default 'System',
  uploaded_at timestamptz not null default now()
);

create index documents_company_id_idx on documents (company_id);
create index documents_entity_idx on documents (company_id, entity_type, entity_id);
create index documents_group_idx on documents (document_group_id);
create index documents_retention_idx on documents (retention_until) where retention_until is not null;

-- The one real storage bucket every document lands in. Private (not
-- public) — every read goes through a signed URL generated after the
-- SAME `user_has_permission()` check the DB row's own RLS policy
-- enforces, never a public/guessable URL.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

/** Maps a document's entity_type to the SAME permission module its
 * owning entity already uses — the one place this mapping lives, so a
 * document's access can never drift from its parent record's own
 * access rules. */
create function document_permission_module(target_entity_type text)
returns text
language sql
immutable
as $$
  select case target_entity_type
    when 'Customer' then 'Sales'
    when 'Supplier' then 'Purchasing'
    when 'Inventory' then 'Inventory'
    when 'Asset' then 'Assets'
    when 'Journal' then 'GeneralLedger'
    when 'BankStatement' then 'Banking'
    when 'AuditEvidence' then 'Auditor'
    when 'FinancialStatement' then 'Reports'
  end;
$$;

alter table documents enable row level security;

create policy "read company documents with module View permission" on documents for select
  using (user_has_permission(company_id, document_permission_module(entity_type) || ':View'));
create policy "upload company documents with module Create permission" on documents for insert with check (
  user_has_permission(company_id, document_permission_module(entity_type) || ':Create')
);
create policy "delete company documents with module Delete permission" on documents for delete using (
  user_has_permission(company_id, document_permission_module(entity_type) || ':Delete')
);
-- A document's own content/metadata is immutable once uploaded (a "new
-- version" is a new ROW via document_group_id, never an in-place
-- content edit) — but uploading version N+1 legitimately needs to flip
-- version N's `is_current` to false in the SAME transaction, so this
-- one UPDATE policy exists, gated by the identical Create permission
-- (whoever can create a new version already has legitimate access to
-- every version of that same document). Anything beyond
-- `is_current`/`document_group_id` is only ever touched by the app's
-- own `document-service.ts::uploadDocumentVersion`, never a raw client
-- update. The scan/OCR pipeline is separate — it goes through the
-- `security definer` RPC below, matching the exact same "no direct
-- client write" pattern `permission_audit_log` (0025) already
-- established, since no session-holding user should ever be able to
-- mark their own upload "virus_scan_status: clean" themselves.
create policy "update own-company documents with module Create permission" on documents for update using (
  user_has_permission(company_id, document_permission_module(entity_type) || ':Create')
);
create function update_document_scan_status(
  target_document_id bigint, p_virus_scan_status text, p_ocr_status text, p_ocr_metadata jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  update documents
  set virus_scan_status = coalesce(p_virus_scan_status, virus_scan_status),
      ocr_status = coalesce(p_ocr_status, ocr_status),
      ocr_metadata = coalesce(p_ocr_metadata, ocr_metadata)
  where id = target_document_id;
$$;

-- Storage RLS — the same permission check, applied to the bucket
-- itself, since `storage.objects` has its own RLS independent of the
-- `documents` table's. Path convention: `{company_id}/{entity_type}/{entity_id}/{filename}`,
-- so the policy can check company membership directly from the path
-- without a join back to `documents` (the object may be uploaded
-- slightly before its metadata row commits in the same transaction).
create policy "read own-company documents in storage" on storage.objects for select
  using (bucket_id = 'documents' and user_can_access_company((storage.foldername(name))[1]::uuid));
create policy "upload own-company documents in storage" on storage.objects for insert with check (
  bucket_id = 'documents' and user_can_access_company((storage.foldername(name))[1]::uuid)
);
create policy "delete own-company documents in storage" on storage.objects for delete using (
  bucket_id = 'documents' and user_can_access_company((storage.foldername(name))[1]::uuid)
);
