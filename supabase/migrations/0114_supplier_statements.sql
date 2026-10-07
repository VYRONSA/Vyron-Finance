-- Phase SD-3C — Supplier Document Intelligence: supplier statements.
--
-- The data model and workflow for receiving a supplier's statement, reading
-- it (PDF first), validating its arithmetic and confirming whose statement it
-- is. NO reconciliation (SD-3D), NO AI (SD-3F), NO accounting: nothing here
-- reads or writes a journal, bill, payment, allocation or supplier balance.
--
-- WHAT THIS ADDS
--   * ae_suppliers.our_account_number — the company's account number AT the
--     supplier, as the supplier prints it. Nullable. A matching signal only:
--     it never creates a supplier and never confirms one.
--   * supplier_statements — one per statement document. The original is a
--     retained `documents` row (entity Supplier, category Statement).
--   * supplier_statement_lines — the statement's transactions, references
--     kept EXACTLY as printed; unreadable values left unresolved, never
--     guessed.
--   * supplier_statement_events — immutable audit of lifecycle and reviewer
--     actions; user writer (actor from the session) and system writer.
--   * Retention: statement originals join capture originals as evidence that
--     cannot be deleted or altered, and as "audited originals" whose every
--     view/download is recorded (0113); the access writer now accepts them.
--
-- WORKFLOW (owner decision: extraction is asynchronous)
--   Upload → Queued (original retained, response returned)
--          → Processing (server, after the response)
--          → NeedsReview | ManualEntry (scanned/image: no OCR in SD-3C)
--          | Failed (unreadable, encrypted) | Duplicate (same file)
--   ManualEntry → NeedsReview (submit)
--   NeedsReview → Ready (validation Pass/Review, supplier CONFIRMED,
--                        base currency) → NeedsReview (reopen)
--   any → Rejected
--   'Reconciled' is added by SD-3D (0115).
--
-- SECURITY: explicit grants on every object; RLS by Purchasing permission;
-- guard triggers enforce identity, system-only columns, transitions and
-- same-company references for signed-in users. Server paths (service role)
-- pass the guards, as in 0111/0112.
--
-- ORDER: 0109 → 0110 → 0111 → 0112 → 0113 → 0114. Idempotent.

-- ---------------------------------------------------------------------
-- 1. Our account number at the supplier.
-- ---------------------------------------------------------------------
alter table ae_suppliers add column if not exists our_account_number text;
alter table ae_suppliers drop constraint if exists ae_suppliers_our_account_number_length;
alter table ae_suppliers add constraint ae_suppliers_our_account_number_length
  check (our_account_number is null or (length(btrim(our_account_number)) between 1 and 60));

-- ---------------------------------------------------------------------
-- 2. Statements.
-- ---------------------------------------------------------------------
create table if not exists supplier_statements (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  -- NO ACTION: a statement's original is evidence (see retention below).
  document_id bigint not null unique references documents (id),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),

  -- What the file IS, from its bytes. 'pdf' until processing has looked at
  -- its text layer.
  source_type text not null check (source_type in ('pdf', 'pdf-text', 'pdf-scanned', 'pdf-mixed', 'image', 'csv', 'xlsx')),
  -- How its lines were obtained. ('ai' arrives with SD-3F.)
  extraction_method text check (extraction_method in ('layout', 'tabular', 'manual')),

  status text not null default 'Queued' check (status in (
    'Queued', 'Processing', 'ManualEntry', 'NeedsReview', 'Ready', 'Duplicate', 'Failed', 'Rejected')),
  -- Plain-language reason for the current status (e.g. "scanned — enter by hand").
  status_reason text not null default '' check (length(status_reason) <= 500),
  duplicate_of_statement_id bigint references supplier_statements (id),

  -- Supplier: PROPOSED by deterministic matching, CONFIRMED only by a reviewer.
  supplier_id bigint references ae_suppliers (id),
  supplier_match_tier text check (supplier_match_tier in (
    'vat', 'registration', 'supplier-code', 'account-number', 'exact-name', 'normalised-name', 'learned', 'manual')),
  supplier_candidates jsonb not null default '[]'::jsonb,
  supplier_confirmed_by text,
  supplier_confirmed_at timestamptz,
  constraint supplier_statements_confirmation_pair check ((supplier_confirmed_by is null) = (supplier_confirmed_at is null)),
  constraint supplier_statements_confirmed_has_supplier check (supplier_confirmed_at is null or supplier_id is not null),

  -- As printed on the statement (read by the system; never corrected).
  supplier_name_extracted text,
  supplier_vat_extracted text,
  supplier_registration_extracted text,
  account_number_extracted text,

  -- Header values (system-extracted, reviewer-correctable).
  statement_date date,
  period_from date,
  period_to date,
  currency_code text check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  opening_balance numeric(14,2),
  closing_balance numeric(14,2),
  printed_total_debits numeric(14,2),
  printed_total_credits numeric(14,2),
  printed_ageing jsonb,
  sign_convention text not null default 'debit-increases-owed'
    check (sign_convention in ('debit-increases-owed', 'credit-increases-owed')),

  page_count integer check (page_count is null or page_count between 0 and 60),

  validation_status text not null default 'Pending' check (validation_status in ('Pending', 'Pass', 'Review', 'Incomplete')),
  validation_findings jsonb not null default '[]'::jsonb,
  validated_at timestamptz,

  -- Immutable once written: the header and lines exactly as extracted, with
  -- provenance and warnings. Reviewer corrections never touch it.
  extraction_snapshot jsonb,
  warnings jsonb not null default '[]'::jsonb,
  manual_entry boolean not null default false,

  uploaded_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supplier_statements_company_status_idx on supplier_statements (company_id, status, created_at desc);
create index if not exists supplier_statements_company_supplier_idx on supplier_statements (company_id, supplier_id, statement_date desc);
create index if not exists supplier_statements_hash_idx on supplier_statements (company_id, content_sha256);

alter table supplier_statements enable row level security;

-- ---------------------------------------------------------------------
-- 3. Statement lines.
-- ---------------------------------------------------------------------
create table if not exists supplier_statement_lines (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  statement_id bigint not null references supplier_statements (id) on delete cascade,
  line_order integer not null check (line_order > 0),
  page_number integer check (page_number is null or page_number between 1 and 60),
  row_on_page integer check (row_on_page is null or row_on_page > 0),

  transaction_date date,
  -- EXACTLY as printed: leading zeros, spaces and punctuation preserved.
  -- Matching keys are derived from it in code; it is never normalised here.
  reference_text text,
  description text,
  transaction_type text not null default 'unknown' check (transaction_type in (
    'invoice', 'credit-note', 'debit-note', 'payment', 'opening', 'interest', 'adjustment', 'other', 'unknown')),
  type_source text not null default 'inferred' check (type_source in ('printed', 'inferred', 'reviewer')),
  debit numeric(14,2),
  credit numeric(14,2),
  amount numeric(14,2) generated always as (coalesce(debit, 0) - coalesce(credit, 0)) stored,
  running_balance numeric(14,2),
  -- The source row as read, for the reviewer. Never parsed again.
  raw_text text,
  -- Structured fields the reader could NOT interpret reliably. They stay
  -- empty (null) and the statement cannot validate until a reviewer resolves
  -- them against the original.
  unresolved_fields text[] not null default '{}'
    check (unresolved_fields <@ array['transaction_date', 'reference_text', 'debit', 'credit', 'running_balance', 'transaction_type']::text[]),
  -- Brought/carried-forward, page and sub-totals: kept, but not transactions.
  is_excluded boolean not null default false,
  exclusion_reason text,
  corrected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (statement_id, line_order)
);

create index if not exists supplier_statement_lines_statement_idx on supplier_statement_lines (statement_id, line_order);

alter table supplier_statement_lines enable row level security;

-- ---------------------------------------------------------------------
-- 4. Statement events — immutable.
-- ---------------------------------------------------------------------
create table if not exists supplier_statement_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  statement_id bigint not null references supplier_statements (id) on delete cascade,
  event_type text not null check (event_type in (
    'Uploaded', 'DuplicateEvaluated', 'ProcessingStarted', 'Extracted', 'ExtractionFailed', 'ManualEntryRequired',
    'ValidationEvaluated', 'SupplierProposed', 'SupplierConfirmed', 'SupplierUnconfirmed', 'SupplierAccountNumberSaved',
    'FieldCorrected', 'LineCorrected', 'LineAdded', 'LineRemoved', 'ManualEntryStarted', 'SubmittedForReview',
    'MarkedReady', 'Reopened', 'Rejected', 'ProcessingRequeued')),
  -- Field NAMES and ids only — never statement content.
  detail jsonb not null default '{}'::jsonb,
  performed_by text not null,
  occurred_at timestamptz not null default now()
);

create index if not exists supplier_statement_events_statement_idx on supplier_statement_events (statement_id, occurred_at);

alter table supplier_statement_events enable row level security;

-- ---------------------------------------------------------------------
-- 5. Explicit grants. (Nothing relies on Supabase defaults or CLI
--    behaviour; TRUNCATE is never granted — it bypasses RLS.)
-- ---------------------------------------------------------------------
revoke all on table supplier_statements from public, anon, authenticated, service_role;
grant select, insert, update on table supplier_statements to authenticated;
grant select, insert, update on table supplier_statements to service_role;

revoke all on table supplier_statement_lines from public, anon, authenticated, service_role;
grant select, insert, update, delete on table supplier_statement_lines to authenticated;
grant select, insert, update, delete on table supplier_statement_lines to service_role;

revoke all on table supplier_statement_events from public, anon, authenticated, service_role;
grant select on table supplier_statement_events to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. RLS — Purchasing permissions, company by company.
-- ---------------------------------------------------------------------
drop policy if exists "purchasing view reads supplier statements" on supplier_statements;
create policy "purchasing view reads supplier statements" on supplier_statements for select
  using (user_has_permission(company_id, 'Purchasing:View'));
drop policy if exists "purchasing create uploads supplier statements" on supplier_statements;
create policy "purchasing create uploads supplier statements" on supplier_statements for insert
  with check (user_has_permission(company_id, 'Purchasing:Create'));
drop policy if exists "purchasing edit or reject changes supplier statements" on supplier_statements;
create policy "purchasing edit or reject changes supplier statements" on supplier_statements for update
  using (user_has_permission(company_id, 'Purchasing:Edit') or user_has_permission(company_id, 'Purchasing:Reject'))
  with check (user_has_permission(company_id, 'Purchasing:Edit') or user_has_permission(company_id, 'Purchasing:Reject'));

drop policy if exists "purchasing view reads supplier statement lines" on supplier_statement_lines;
create policy "purchasing view reads supplier statement lines" on supplier_statement_lines for select
  using (user_has_permission(company_id, 'Purchasing:View'));
drop policy if exists "purchasing edit adds supplier statement lines" on supplier_statement_lines;
create policy "purchasing edit adds supplier statement lines" on supplier_statement_lines for insert
  with check (user_has_permission(company_id, 'Purchasing:Edit'));
drop policy if exists "purchasing edit corrects supplier statement lines" on supplier_statement_lines;
create policy "purchasing edit corrects supplier statement lines" on supplier_statement_lines for update
  using (user_has_permission(company_id, 'Purchasing:Edit'))
  with check (user_has_permission(company_id, 'Purchasing:Edit'));
drop policy if exists "purchasing edit removes supplier statement lines" on supplier_statement_lines;
create policy "purchasing edit removes supplier statement lines" on supplier_statement_lines for delete
  using (user_has_permission(company_id, 'Purchasing:Edit'));

drop policy if exists "purchasing view reads supplier statement events" on supplier_statement_events;
create policy "purchasing view reads supplier statement events" on supplier_statement_events for select
  using (user_has_permission(company_id, 'Purchasing:View'));

-- ---------------------------------------------------------------------
-- 7. A reviewer's change to a statement or its lines means it has not
--    been validated as it now stands. Owner-run, so it can reset the
--    system-owned validation columns the guard protects from users.
-- ---------------------------------------------------------------------
create or replace function fn_supplier_statement_mark_unvalidated(p_statement_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from supplier_statements where id = p_statement_id;
  if not found then
    raise exception 'statement % does not exist', p_statement_id using errcode = '42501';
  end if;
  if current_user in ('authenticated', 'anon') or auth.uid() is not null then
    if not user_has_permission(v_company, 'Purchasing:Edit') then
      raise exception 'Purchasing:Edit is required' using errcode = '42501';
    end if;
  end if;
  update supplier_statements
     set validation_status = 'Pending', validated_at = null, updated_at = clock_timestamp()
   where id = p_statement_id;
end;
$$;
revoke execute on function fn_supplier_statement_mark_unvalidated(bigint) from public, anon, service_role;
grant execute on function fn_supplier_statement_mark_unvalidated(bigint) to authenticated;

-- Whether a statement's currency can be reconciled in its company: only
-- the company's base currency (no exchange-rate handling exists). Owner-run
-- so the answer never depends on whether the caller can read the company
-- row. Unknown base currency => not supported (fail closed).
create or replace function fn_supplier_statement_currency_supported(p_company_id uuid, p_currency_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_currency_code is null
      or exists (select 1 from companies c where c.id = p_company_id and c.base_currency_code = p_currency_code)
$$;
revoke execute on function fn_supplier_statement_currency_supported(uuid,text) from public, anon;
grant execute on function fn_supplier_statement_currency_supported(uuid,text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. Statement guard (signed-in users only; server paths pass).
-- ---------------------------------------------------------------------
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

drop trigger if exists supplier_statements_guard on supplier_statements;
create trigger supplier_statements_guard
  before insert or update on supplier_statements
  for each row execute function fn_supplier_statement_guard();

-- ---------------------------------------------------------------------
-- 9. Line guard (signed-in users only; server paths pass).
-- ---------------------------------------------------------------------
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

drop trigger if exists supplier_statement_lines_guard on supplier_statement_lines;
create trigger supplier_statement_lines_guard
  before insert or update or delete on supplier_statement_lines
  for each row execute function fn_supplier_statement_line_guard();

-- ---------------------------------------------------------------------
-- 10. Events: immutable; user writer (actor from the session) and system
--     writer (service role).
-- ---------------------------------------------------------------------
create or replace function fn_supplier_statement_events_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'supplier_statement_events is append-only: it cannot be truncated';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'supplier_statement_events is append-only: a recorded event cannot be modified';
  end if;
  if pg_trigger_depth() <= 1 then
    raise exception 'supplier_statement_events is append-only: a recorded event cannot be deleted';
  end if;
  return old;
end;
$$;
revoke execute on function fn_supplier_statement_events_immutable() from public, anon, authenticated, service_role;

drop trigger if exists supplier_statement_events_immutable on supplier_statement_events;
create trigger supplier_statement_events_immutable
  before update or delete on supplier_statement_events
  for each row execute function fn_supplier_statement_events_immutable();
drop trigger if exists supplier_statement_events_no_truncate on supplier_statement_events;
create trigger supplier_statement_events_no_truncate
  before truncate on supplier_statement_events
  for each statement execute function fn_supplier_statement_events_immutable();

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

create or replace function fn_supplier_statement_record_system_event(
  p_company_id uuid,
  p_statement_id bigint,
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
  if not exists (select 1 from supplier_statements s where s.id = p_statement_id and s.company_id = p_company_id) then
    raise exception 'statement % does not exist in this company', p_statement_id;
  end if;
  insert into supplier_statement_events (company_id, statement_id, event_type, detail, performed_by)
  values (p_company_id, p_statement_id, p_event_type, coalesce(p_detail, '{}'::jsonb),
          left(coalesce(nullif(btrim(p_performed_by), ''), 'System'), 200))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function fn_supplier_statement_record_system_event(uuid,bigint,text,jsonb,text) from public, anon, authenticated;
grant execute on function fn_supplier_statement_record_system_event(uuid,bigint,text,jsonb,text) to service_role;

-- ---------------------------------------------------------------------
-- 11. Retention and audited access: statement originals join capture
--     originals.
-- ---------------------------------------------------------------------
create or replace function fn_document_is_statement_original(p_document_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from supplier_statements s where s.document_id = p_document_id)
$$;
revoke execute on function fn_document_is_statement_original(bigint) from public, anon;
grant execute on function fn_document_is_statement_original(bigint) to authenticated, service_role;

create or replace function fn_document_is_audited_original(p_document_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select fn_document_is_capture_evidence(p_document_id) or fn_document_is_statement_original(p_document_id)
$$;

create or replace function fn_storage_object_is_audited_original(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select fn_storage_object_is_capture_evidence(p_name)
      or exists (
           select 1
           from documents d
           join supplier_statements s on s.document_id = d.id
           where d.storage_path = p_name
             and (auth.uid() is null or user_can_access_company(d.company_id))
         )
$$;

-- The documents retention rule (0112) now covers statement originals too.
create or replace function fn_documents_retain_capture_evidence()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not fn_document_is_audited_original(old.id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    -- A whole-company deletion removes documents through a foreign-key
    -- cascade, one trigger level deeper than any direct statement.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'document % is the original of a supplier invoice or statement and is retained as accounting evidence', old.id
      using errcode = '42501';
  end if;

  if (new.company_id, new.entity_type, new.entity_id, new.storage_path, new.content_sha256,
      new.filename, new.mime_type, new.size_bytes, new.uploaded_by, new.uploaded_at)
     is distinct from
     (old.company_id, old.entity_type, old.entity_id, old.storage_path, old.content_sha256,
      old.filename, old.mime_type, old.size_bytes, old.uploaded_by, old.uploaded_at) then
    raise exception 'document % is the original of a supplier invoice or statement; its content cannot be changed', old.id
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Storage: neither can a statement original's file be removed behind the
-- documents table's back.
drop policy if exists "delete own-company documents in storage" on storage.objects;
create policy "delete own-company documents in storage" on storage.objects for delete using (
  bucket_id = 'documents'
  and user_can_access_company((storage.foldername(name))[1]::uuid)
  and not fn_storage_object_is_audited_original(name)
);

create index if not exists supplier_statements_document_idx on supplier_statements (document_id);

-- The access audit (0113) now has statements to point at.
alter table supplier_document_access_events drop constraint if exists supplier_document_access_events_statement_id_fkey;
alter table supplier_document_access_events add constraint supplier_document_access_events_statement_id_fkey
  foreign key (statement_id) references supplier_statements (id);

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
    if not exists (
      select 1
      from supplier_statements s
      join documents d on d.id = s.document_id and d.company_id = s.company_id
      where s.id = p_statement_id
        and s.company_id = p_company_id
        and s.document_id = p_document_id
    ) then
      raise exception 'document % is not the original of statement % in this company', p_document_id, p_statement_id
        using errcode = '42501';
    end if;
  elsif not exists (
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
  values (p_company_id, p_document_id, p_capture_id, p_statement_id, p_action, auth.uid(), 'session')
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text) from public, anon, service_role;
grant execute on function fn_record_supplier_document_access(uuid,bigint,bigint,bigint,text) to authenticated;

select pg_notify('pgrst', 'reload schema');
