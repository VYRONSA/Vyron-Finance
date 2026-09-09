-- Phase 20B — Company Branding & Logo Storage Foundation. A dedicated,
-- per-company extension table (the same "one row per company" shape as
-- `company_currencies`/`bank_connections`, not a reuse of the RC1 Phase 4
-- `documents` table — that table's `entity_type` check constraint has no
-- 'Company' value, and its version/OCR/virus-scan machinery is unneeded
-- complexity for a single mutable per-company asset). Storage RLS below
-- deliberately mirrors 0027_document_platform.sql's `documents` bucket
-- policies exactly — same `user_can_access_company((storage.foldername
-- (name))[1]::uuid)` shape, not a new authorization model.
--
-- Scope note: this migration is the storage/database foundation only.
-- No invoice/statement/credit-note/financial-statement/report/PDF
-- rendering reads from this table yet — that "Document Branding Layer"
-- is deliberately not built in this phase.

create table company_branding (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  logo_storage_path text,
  logo_filename text,
  logo_mime_type text,
  logo_size_bytes bigint,
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id)
);

create index company_branding_company_id_idx on company_branding (company_id);

-- The dedicated bucket for logo assets — private, never public, exactly
-- like the `documents` bucket. Every read goes through a short-lived
-- signed URL generated after the same permission check the table's own
-- RLS policy enforces.
insert into storage.buckets (id, name, public)
values ('company-branding', 'company-branding', false)
on conflict (id) do nothing;

alter table company_branding enable row level security;

-- Table RLS — fine-grained module permissions (Settings:View / Settings:
-- Edit), the same `user_has_permission()` check the `documents` table
-- uses, scoped to the one module this data actually belongs to.
create policy "read company branding with Settings View permission" on company_branding for select
  using (user_has_permission(company_id, 'Settings:View'));
create policy "insert company branding with Settings Edit permission" on company_branding for insert with check (
  user_has_permission(company_id, 'Settings:Edit')
);
create policy "update company branding with Settings Edit permission" on company_branding for update using (
  user_has_permission(company_id, 'Settings:Edit')
);
create policy "delete company branding with Settings Edit permission" on company_branding for delete using (
  user_has_permission(company_id, 'Settings:Edit')
);

-- Storage RLS — mirrors 0027's `documents` bucket policies exactly: the
-- coarser `user_can_access_company()` check (not the fine-grained
-- permission), since storage.objects RLS can't join back to context.
-- Path convention: `{company_id}/logo/{timestamp}-{filename}`, so
-- `(storage.foldername(name))[1]` is always the company id.
create policy "read own-company branding assets in storage" on storage.objects for select
  using (bucket_id = 'company-branding' and user_can_access_company((storage.foldername(name))[1]::uuid));
create policy "upload own-company branding assets in storage" on storage.objects for insert with check (
  bucket_id = 'company-branding' and user_can_access_company((storage.foldername(name))[1]::uuid)
);
create policy "delete own-company branding assets in storage" on storage.objects for delete using (
  bucket_id = 'company-branding' and user_can_access_company((storage.foldername(name))[1]::uuid)
);
