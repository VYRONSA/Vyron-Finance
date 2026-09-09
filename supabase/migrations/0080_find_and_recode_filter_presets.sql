-- Phase 25F -- Find & Recode Saved Filter Presets. A personal (per-user),
-- company-scoped convenience feature: a named, reusable snapshot of the
-- EXISTING `TransactionExplorerFilters` object Find & Recode already
-- builds and sends to its own search/preview/commit endpoints -- no new
-- filter representation, no accounting-data mutation. Presets are
-- read-only convenience state; applying one only populates the existing
-- search controls and re-runs the existing search, never a preview or
-- commit (find-and-recode-service.ts -- previewRecode/commitRecode -- is
-- completely untouched by this migration).
--
-- No existing saved-search/user-preference table exists anywhere in this
-- schema (confirmed by inspection before writing this) -- this is
-- genuinely new, minimal storage, not a duplicate of anything.
--
-- Personal, not company-shared (the brief's own default absent a strong
-- existing precedent for company-shared saved searches, and none
-- exists): a user can only ever see/manage their OWN presets, via
-- `user_id = auth.uid()` in the RLS policy below -- the same real
-- per-user ownership pattern `user_role_assignments` (0025) already
-- established, minus that migration's RBAC-specific
-- `user_has_permission` escalation concern (irrelevant here: a preset's
-- owner never needs to manage another user's rows, so the simpler
-- `user_id = auth.uid()` check is both correct and sufficient -- not a
-- shortcut). `filters` is stored as `jsonb` -- matching this schema's own
-- existing convention for a structured-but-not-relationally-queried
-- blob -- and is validated server-side against the real
-- `TransactionExplorerFilters` shape before ever being written (see
-- find-and-recode-preset-service.ts), so a malformed row can only ever
-- originate from a direct, unauthorized database write, not from this
-- application's own code path.

create table find_and_recode_filter_presets (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  filters jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, company_id, name)
);

create index find_and_recode_filter_presets_company_id_idx on find_and_recode_filter_presets (company_id);

alter table find_and_recode_filter_presets enable row level security;

create policy "users manage their own find & recode presets" on find_and_recode_filter_presets
  for all
  using (user_id = auth.uid() and user_can_access_company(company_id));
