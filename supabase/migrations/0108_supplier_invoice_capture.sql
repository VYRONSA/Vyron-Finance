-- Phase 5L — VYRON AI Supplier Invoice Capture.
--
-- Schema for capturing a supplier invoice document, extracting it with AI,
-- validating it deterministically, reviewing it by hand, and converting it
-- into an ORDINARY DRAFT PURCHASE BILL. No accounting is performed here:
-- the bill, its journal and its ledger entries remain entirely the
-- existing purchasing/posting engine's business.
--
-- WHAT THIS DELIBERATELY DOES NOT DO, having reviewed VYRON COST (5K):
--   * No `using (true)` policies. Every table below is tenant-scoped with
--     a real predicate and a WITH CHECK, from its first migration. COST's
--     `-- RLS (demo-open; tighten for production)` was never tightened.
--   * No costing mutation. COST's approval rewrote `purchase_cost` and
--     `true_unit_cost` on master data. Conversion here writes a Draft bill
--     and nothing else.
--   * No raw provider transcript table. Attempts record metadata only —
--     see `ai_extraction_attempts` and Decision 2.
--   * No learning keyed on a free-text supplier name. `supplier_line_mappings`
--     is keyed on `supplier_id`.

-- ---------------------------------------------------------------------
-- 1. Deterministic file identity on the existing Document Platform.
--
--    Additive and nullable: every document uploaded before this migration
--    genuinely has no hash on record, and inventing one would mean reading
--    and rehashing the whole bucket. Absent means unknown, not "no match".
-- ---------------------------------------------------------------------
alter table documents
  add column if not exists content_sha256 text;

comment on column documents.content_sha256 is
  'Phase 5L — SHA-256 of the stored bytes, set at upload. Null on documents predating 5L.';

create index if not exists documents_company_content_hash_idx
  on documents (company_id, content_sha256)
  where content_sha256 is not null;

-- ---------------------------------------------------------------------
-- 2. The capture — one row per supplier-invoice document in the workflow.
--
--    Header fields are what the EXTRACTION produced or a human corrected.
--    They are working data for review, never an accounting record. The
--    accounting record is the purchase bill this eventually becomes.
--
--    Money columns are numeric(14,2), matching `ae_imported_bills`, so a
--    value cannot change shape on conversion. They are NULLABLE on
--    purpose: an unreadable total is null, never 0 and never the string
--    "Needs Review" — COST wrote that magic string into numeric fields.
-- ---------------------------------------------------------------------
create table if not exists supplier_invoice_captures (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  document_id bigint not null references documents (id) on delete cascade,

  status text not null default 'Uploaded' check (status in (
    'Uploaded',     -- stored and hashed, no work queued yet
    'Queued',       -- extraction work created; the browser may leave
    'Extracting',   -- claimed by the automation runner
    'NeedsReview',  -- extraction finished; a human must review it
    'Converted',    -- a Draft bill exists (terminal)
    'Duplicate',    -- deterministically blocked as a duplicate (terminal until released)
    'Failed',       -- extraction failed terminally
    'Cancelled'     -- discarded by a human (terminal)
  )),

  -- Extracted header. Every one nullable: unknown is unknown.
  supplier_name_extracted text,
  supplier_vat_number_extracted text,
  supplier_registration_number_extracted text,
  invoice_number text,
  invoice_date date,
  due_date date,
  order_reference text,
  currency_code text,
  subtotal numeric(14, 2),
  discount_total numeric(14, 2),
  vat_amount numeric(14, 2),
  total numeric(14, 2),

  -- Supplier resolution. `supplier_id` is set only by a DETERMINISTIC
  -- match or an explicit human choice — never by a fuzzy score.
  supplier_id bigint references ae_suppliers (id) on delete set null,
  supplier_match_tier text check (supplier_match_tier is null or supplier_match_tier in (
    'vat', 'registration', 'supplier-code', 'exact-name', 'normalised-name', 'learned', 'manual'
  )),
  supplier_candidates jsonb not null default '[]'::jsonb,

  -- Deterministic validation outcome (never model confidence).
  validation_status text not null default 'Pending' check (validation_status in (
    'Pending', 'Pass', 'Review', 'Incomplete'
  )),
  validation_findings jsonb not null default '[]'::jsonb,
  -- Model self-reported confidence. Retained for information. NEVER used
  -- to decide review state, and never used to trigger a retry.
  model_confidence integer check (model_confidence is null or (model_confidence between 0 and 100)),

  duplicate_status text not null default 'None' check (duplicate_status in ('None', 'Possible', 'Blocked')),
  duplicate_of_capture_id bigint references supplier_invoice_captures (id) on delete set null,
  duplicate_of_bill_id bigint references ae_imported_bills (id) on delete set null,
  duplicate_reason text not null default '',

  extraction_attempts integer not null default 0 check (extraction_attempts >= 0),
  last_error_category text,
  -- Operator-facing sentence only. Never a provider payload — see
  -- Decision 2 and `sanitizeProviderMessage`.
  last_error_message text check (last_error_message is null or char_length(last_error_message) <= 300),

  -- The Draft bill this became. Unique, so one capture can never produce
  -- two bills however many times conversion is attempted.
  bill_id bigint references ae_imported_bills (id) on delete set null,
  converted_at timestamptz,
  converted_by text,

  uploaded_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One capture per document: re-uploading a file creates a new document,
  -- and re-queuing an existing document reuses its capture.
  unique (document_id)
);

-- Idempotency for conversion (Part 20): the same capture can never be
-- attached to two bills, and two captures can never claim one bill.
create unique index if not exists supplier_invoice_captures_bill_unique
  on supplier_invoice_captures (bill_id) where bill_id is not null;

create index if not exists supplier_invoice_captures_company_status_idx
  on supplier_invoice_captures (company_id, status, created_at desc);
create index if not exists supplier_invoice_captures_company_supplier_idx
  on supplier_invoice_captures (company_id, supplier_id) where supplier_id is not null;
-- Duplicate probe: supplier + invoice number, the strongest deterministic signal.
create index if not exists supplier_invoice_captures_dup_probe_idx
  on supplier_invoice_captures (company_id, supplier_id, invoice_number)
  where invoice_number is not null;

alter table supplier_invoice_captures enable row level security;
drop policy if exists "members can access their company's invoice captures" on supplier_invoice_captures;
create policy "members can access their company's invoice captures"
  on supplier_invoice_captures for all
  using (user_can_access_company(company_id))
  with check (user_can_access_company(company_id));

-- ---------------------------------------------------------------------
-- 3. Extracted lines.
--
--    Shaped to map ONE-TO-ONE onto `ae_purchase_bill_lines` so conversion
--    is a copy, not a translation — with two extras the bill has no room
--    for (`supplier_sku`, `uom`, `pack_description`), which are document
--    information only.
--
--    Pack/UOM is CAPTURED AS PRINTED and never used to derive a unit cost.
--    COST divided nothing and still wrote the case price into a column
--    called `true_unit_cost`; this schema simply does not offer anywhere
--    for such a derivation to hide.
-- ---------------------------------------------------------------------
create table if not exists supplier_invoice_capture_lines (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  capture_id bigint not null references supplier_invoice_captures (id) on delete cascade,
  line_order integer not null default 0,

  description text not null default '',
  supplier_sku text,
  quantity numeric(14, 4),
  uom text,
  pack_description text,
  pack_quantity numeric(14, 4),
  unit_price numeric(14, 4),
  discount numeric(14, 2),
  vat_rate_percent numeric(6, 3),
  vat_amount numeric(14, 2),
  line_total numeric(14, 2),

  -- Suggestions. Deterministic sources rank above AI — see
  -- `gl-vat-suggestion.ts`. `*_source` records WHICH rung produced it so
  -- the reviewer can see whether a configured default or a guess is on
  -- screen.
  gl_account_suggested text,
  gl_account_source text check (gl_account_source is null or gl_account_source in (
    'supplier-default', 'learned-mapping', 'historical-bill', 'ai', 'none'
  )),
  vat_code_suggested text,
  vat_code_source text check (vat_code_source is null or vat_code_source in (
    'supplier-default', 'learned-mapping', 'historical-bill', 'printed-rate', 'ai', 'none'
  )),

  -- What the human settled on. Null until they touch it; conversion uses
  -- coalesce(confirmed, suggested) and refuses when neither is present.
  gl_account_confirmed text,
  vat_code_confirmed text,

  is_excluded boolean not null default false,
  line_confidence integer check (line_confidence is null or (line_confidence between 0 and 100)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (capture_id, line_order)
);

create index if not exists supplier_invoice_capture_lines_capture_idx
  on supplier_invoice_capture_lines (capture_id, line_order);

alter table supplier_invoice_capture_lines enable row level security;
drop policy if exists "members can access their company's capture lines" on supplier_invoice_capture_lines;
create policy "members can access their company's capture lines"
  on supplier_invoice_capture_lines for all
  using (user_can_access_company(company_id))
  with check (user_can_access_company(company_id));

-- ---------------------------------------------------------------------
-- 4. Traceability (Part 21). Append-only in practice: the application
--    never updates or deletes an event, and nothing in the product offers
--    a way to.
--
--    `detail` holds metadata — field names, counts, categories, ids.
--    It must NEVER hold document bytes, base64, prompts or provider
--    payloads (Decision 2); `pii-logging.test.ts` asserts that.
-- ---------------------------------------------------------------------
create table if not exists supplier_invoice_capture_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  capture_id bigint not null references supplier_invoice_captures (id) on delete cascade,
  event_type text not null check (event_type in (
    'Uploaded', 'Queued', 'ExtractionStarted', 'ExtractionSucceeded', 'ExtractionFailed',
    'ValidationEvaluated', 'SupplierResolved', 'DuplicateEvaluated', 'FieldCorrected',
    'SupplierCreated', 'ConvertedToBill', 'Cancelled', 'Requeued'
  )),
  detail jsonb not null default '{}'::jsonb,
  performed_by text not null default '',
  occurred_at timestamptz not null default now()
);

create index if not exists supplier_invoice_capture_events_capture_idx
  on supplier_invoice_capture_events (capture_id, occurred_at desc);

alter table supplier_invoice_capture_events enable row level security;
drop policy if exists "members can read their company's capture events" on supplier_invoice_capture_events;
create policy "members can read their company's capture events"
  on supplier_invoice_capture_events for select
  using (user_can_access_company(company_id));
drop policy if exists "members can append their company's capture events" on supplier_invoice_capture_events;
create policy "members can append their company's capture events"
  on supplier_invoice_capture_events for insert
  with check (user_can_access_company(company_id));
-- Deliberately NO update or delete policy: an audit row cannot be edited
-- or removed through the API. COST's audit tables were fully writable.

-- ---------------------------------------------------------------------
-- 5. Learning (Part 22) — keyed by supplier_id, never by name.
--
--    Written ONLY from a human-approved conversion, never from raw AI
--    output. `times_confirmed` counts confirmations, so a mapping earns
--    its authority instead of being asserted by one extraction.
-- ---------------------------------------------------------------------
create table if not exists supplier_line_mappings (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  supplier_id bigint not null references ae_suppliers (id) on delete cascade,

  -- Lower-cased, punctuation-collapsed description. The SKU is part of the
  -- key, not a passenger: COST left it out and two different SKUs sharing
  -- a description collapsed into one mapping, last write wins.
  description_normalised text not null,
  supplier_sku_normalised text not null default '',

  gl_account text not null default '',
  vat_code text not null default '',
  times_confirmed integer not null default 1 check (times_confirmed >= 1),
  last_confirmed_at timestamptz not null default now(),
  last_capture_id bigint references supplier_invoice_captures (id) on delete set null,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, supplier_id, description_normalised, supplier_sku_normalised)
);

create index if not exists supplier_line_mappings_lookup_idx
  on supplier_line_mappings (company_id, supplier_id) where disabled = false;

alter table supplier_line_mappings enable row level security;
drop policy if exists "members can access their company's supplier line mappings" on supplier_line_mappings;
create policy "members can access their company's supplier line mappings"
  on supplier_line_mappings for all
  using (user_can_access_company(company_id))
  with check (user_can_access_company(company_id));

-- ---------------------------------------------------------------------
-- 6. Provider attempts for this scope.
--
--    A sibling of `ai_classification_attempts`, not a reuse of it: that
--    table's `transaction_id` is NOT NULL and references a bank
--    transaction. Same columns, same outcome and error vocabulary, so the
--    two can be read together by operations.
--
--    METADATA ONLY. No prompt, no response, no document content — see
--    Decision 2. There is deliberately no `raw_response` column for one to
--    be put in later without thinking about it.
-- ---------------------------------------------------------------------
create table if not exists ai_extraction_attempts (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  capture_id bigint not null references supplier_invoice_captures (id) on delete cascade,
  task_run_id bigint,
  attempt_number integer not null check (attempt_number >= 1),
  attempted_at timestamptz not null default now(),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  outcome text not null check (outcome in (
    'extracted',          -- a usable extraction was stored
    'validation_failed',  -- provider answered; deterministic checks rejected it
    'invalid_response',   -- provider answered; the answer did not fit the schema
    'provider_error',     -- the provider failed
    'document_error',     -- the document could not be read (no request made)
    'write_error'         -- the answer could not be saved
  )),
  provider_request_made boolean not null,
  provider text not null default 'vercel-ai-gateway',
  model text,
  error_category text,
  http_status integer,
  provider_message text check (provider_message is null or char_length(provider_message) <= 300),
  usage jsonb,
  performed_by text not null default 'VYRON AI'
);

create index if not exists ai_extraction_attempts_company_time_idx
  on ai_extraction_attempts (company_id, attempted_at desc);
create index if not exists ai_extraction_attempts_capture_idx
  on ai_extraction_attempts (capture_id, attempt_number);

alter table ai_extraction_attempts enable row level security;
drop policy if exists "members can read their company's extraction attempts" on ai_extraction_attempts;
create policy "members can read their company's extraction attempts"
  on ai_extraction_attempts for select
  using (user_can_access_company(company_id));
-- No insert/update/delete policy: written only by the security-definer
-- recorder below, exactly as 0099 treats classification attempts.

-- ---------------------------------------------------------------------
-- 7. The automation task type.
--
--    Extraction runs on the EXISTING runner — task claiming, time limits,
--    retries, suspension and audit all come free, and closing the browser
--    cannot abandon the work. COST orchestrated extraction from the
--    browser and a closed tab left documents stranded.
-- ---------------------------------------------------------------------
alter table automation_tasks drop constraint if exists automation_tasks_task_type_check;
alter table automation_tasks add constraint automation_tasks_task_type_check
  check (task_type in (
    'RecurringTemplate', 'RuleEngineRun', 'ReportRefresh', 'CommunicationQueue', 'Custom',
    'SubscriptionLifecycleSweep', 'BankSync', 'AiClassificationSweep', 'SupplierInvoiceExtraction'
  ));

-- ---------------------------------------------------------------------
-- 8. Attempt recorder. Mirrors `fn_ai_classification_record_attempt`'s
--    contract for this scope: record the attempt, give back an unused
--    reservation, and move the SHARED circuit breaker. There is no second
--    circuit — `ai_provider_circuit_state` is keyed by scope and already
--    holds a row for 'supplier-invoice-extraction' (0107).
-- ---------------------------------------------------------------------
create or replace function fn_ai_extraction_record_attempt(
  p_company_id uuid,
  p_capture_id bigint,
  p_task_run_id bigint,
  p_attempt_number integer,
  p_outcome text,
  p_provider_request_made boolean,
  p_model text,
  p_error_category text,
  p_http_status integer,
  p_provider_message text,
  p_usage jsonb,
  p_duration_ms integer,
  p_performed_by text,
  p_circuit_signal text,
  p_now timestamptz default now(),
  p_scope text default 'supplier-invoice-extraction',
  p_probe boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  c ai_provider_circuit_state%rowtype;
  v_message text := left(p_provider_message, 300);
  v_backoff integer;
begin
  select company_id into v_company from supplier_invoice_captures where id = p_capture_id;
  if v_company is null or v_company <> p_company_id then
    raise exception 'fn_ai_extraction_record_attempt: capture % does not belong to company %', p_capture_id, p_company_id;
  end if;
  if p_circuit_signal not in ('success', 'auth', 'timeout', 'provider_failure', 'rate_limit', 'none') then
    raise exception 'fn_ai_extraction_record_attempt: unknown circuit signal "%"', p_circuit_signal;
  end if;

  insert into ai_extraction_attempts (
    company_id, capture_id, task_run_id, attempt_number, attempted_at, duration_ms, outcome,
    provider_request_made, model, error_category, http_status, provider_message, usage, performed_by
  ) values (
    p_company_id, p_capture_id, p_task_run_id, p_attempt_number, p_now, p_duration_ms, p_outcome,
    p_provider_request_made, p_model, p_error_category, p_http_status, v_message, p_usage,
    coalesce(p_performed_by, 'VYRON AI')
  );

  if p_provider_request_made then
    perform fn_record_internal_usage_event(
      p_company_id, 'ai_provider_requests', 1,
      jsonb_build_object('scope', p_scope, 'outcome', p_outcome, 'capture_id', p_capture_id,
        'task_run_id', p_task_run_id, 'error_category', p_error_category),
      p_now);
  else
    perform fn_ai_release_request(p_company_id, p_scope, p_now);
  end if;

  select * into c from ai_provider_circuit_state where scope = p_scope for update;
  if not found then
    insert into ai_provider_circuit_state (scope) values (p_scope) on conflict (scope) do nothing;
    select * into c from ai_provider_circuit_state where scope = p_scope for update;
  end if;

  if p_circuit_signal = 'success' then
    update ai_provider_circuit_state
    set state = 'closed', consecutive_timeouts = 0, consecutive_provider_failures = 0, opened_at = null,
        open_reason = null, next_probe_at = null, probe_backoff_seconds = 3600, probe_in_flight_until = null,
        updated_at = now()
    where scope = p_scope;
  elsif p_circuit_signal in ('auth', 'timeout', 'provider_failure', 'rate_limit') then
    if c.state = 'open' then
      if p_probe then
        v_backoff := least(c.probe_backoff_seconds * 2, 86400);
        update ai_provider_circuit_state
        set probe_backoff_seconds = v_backoff, next_probe_at = p_now + make_interval(secs => v_backoff),
            probe_in_flight_until = null, last_error_category = p_error_category, last_http_status = p_http_status,
            last_error_message = v_message, updated_at = now()
        where scope = p_scope;
      else
        update ai_provider_circuit_state
        set last_error_category = p_error_category, last_http_status = p_http_status,
            last_error_message = v_message, updated_at = now()
        where scope = p_scope;
      end if;
    elsif p_circuit_signal = 'auth'
       or (p_circuit_signal = 'timeout' and c.consecutive_timeouts + 1 >= 3)
       or (p_circuit_signal = 'provider_failure' and c.consecutive_provider_failures + 1 >= 5) then
      update ai_provider_circuit_state
      set state = 'open', opened_at = p_now, open_reason = coalesce(p_error_category, p_circuit_signal),
          consecutive_timeouts = case when p_circuit_signal = 'timeout' then c.consecutive_timeouts + 1 else c.consecutive_timeouts end,
          consecutive_provider_failures = case when p_circuit_signal = 'provider_failure' then c.consecutive_provider_failures + 1 else c.consecutive_provider_failures end,
          probe_backoff_seconds = 3600, next_probe_at = p_now + interval '1 hour', probe_in_flight_until = null,
          last_error_category = p_error_category, last_http_status = p_http_status, last_error_message = v_message,
          updated_at = now()
      where scope = p_scope;
    else
      update ai_provider_circuit_state
      set consecutive_timeouts = case when p_circuit_signal = 'timeout' then c.consecutive_timeouts + 1 else c.consecutive_timeouts end,
          consecutive_provider_failures = case when p_circuit_signal = 'provider_failure' then c.consecutive_provider_failures + 1 else c.consecutive_provider_failures end,
          last_error_category = p_error_category, last_http_status = p_http_status, last_error_message = v_message,
          updated_at = now()
      where scope = p_scope;
    end if;
  elsif p_probe and c.state = 'open' then
    update ai_provider_circuit_state set probe_in_flight_until = null, updated_at = now() where scope = p_scope;
  end if;

  select * into c from ai_provider_circuit_state where scope = p_scope;
  return jsonb_build_object('circuit_state', c.state, 'open_reason', c.open_reason, 'next_probe_at', c.next_probe_at);
end;
$$;

-- ---------------------------------------------------------------------
-- 9. The extraction gate. Circuit + two-layer budget for this scope.
--
--    Simpler than the classification gate because there is no per-item
--    queue-hold concept: a capture is either awaiting extraction or it is
--    not, and `supplier_invoice_captures.status` already says which.
-- ---------------------------------------------------------------------
create or replace function fn_ai_extraction_gate(
  p_company_id uuid,
  p_capture_id bigint,
  p_now timestamptz default now(),
  p_scope text default 'supplier-invoice-extraction'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  c ai_provider_circuit_state%rowtype;
  v_reservation jsonb;
  v_probe boolean := false;
  v_claimed text;
begin
  select company_id into v_company from supplier_invoice_captures where id = p_capture_id;
  if v_company is null or v_company <> p_company_id then
    raise exception 'fn_ai_extraction_gate: capture % does not belong to company %', p_capture_id, p_company_id;
  end if;

  select * into c from ai_provider_circuit_state where scope = p_scope;
  if not found then
    insert into ai_provider_circuit_state (scope) values (p_scope) on conflict (scope) do nothing;
    select * into c from ai_provider_circuit_state where scope = p_scope;
  end if;
  if c.state = 'open' then
    if c.next_probe_at is null or p_now < c.next_probe_at
       or (c.probe_in_flight_until is not null and p_now < c.probe_in_flight_until) then
      return jsonb_build_object('decision', 'circuit_open', 'circuit_state', 'open',
        'open_reason', c.open_reason, 'next_probe_at', c.next_probe_at);
    end if;
    v_probe := true;
  end if;

  v_reservation := fn_ai_reserve_request(p_company_id, p_scope, p_now);
  if not (v_reservation ->> 'reserved')::boolean then
    return jsonb_build_object('decision', 'daily_cap', 'circuit_state', c.state,
      'refused_layer', v_reservation ->> 'refused_layer',
      'requests_today', (v_reservation ->> 'scope_used')::integer,
      'daily_cap', (v_reservation ->> 'scope_cap')::integer);
  end if;

  if v_probe then
    update ai_provider_circuit_state
    set probe_in_flight_until = p_now + interval '10 minutes', updated_at = now()
    where scope = p_scope and state = 'open' and next_probe_at is not null and next_probe_at <= p_now
      and (probe_in_flight_until is null or probe_in_flight_until <= p_now)
    returning scope into v_claimed;
    if v_claimed is null then
      select * into c from ai_provider_circuit_state where scope = p_scope;
      if c.state = 'open' then
        perform fn_ai_release_request(p_company_id, p_scope, p_now);
        return jsonb_build_object('decision', 'circuit_open', 'circuit_state', 'open',
          'open_reason', c.open_reason, 'next_probe_at', c.next_probe_at);
      end if;
      v_probe := false;
    end if;
  end if;

  return jsonb_build_object('decision', case when v_probe then 'probe' else 'allow' end,
    'circuit_state', case when v_probe then 'open' else 'closed' end,
    'requests_today', (v_reservation ->> 'scope_used')::integer,
    'daily_cap', (v_reservation ->> 'scope_cap')::integer);
end;
$$;

comment on table supplier_invoice_captures is
  'Phase 5L — VYRON AI Supplier Invoice Capture. Working data for review; never an accounting record.';
comment on table ai_extraction_attempts is
  'Phase 5L — provider attempt metadata for supplier-invoice-extraction. Never prompts, responses or document content.';

-- ---------------------------------------------------------------------
-- 10. Learning upsert.
--
--     A function rather than an application-side upsert so
--     `times_confirmed` increments atomically — the count is the whole
--     point of the column. A mapping earns its authority by being
--     confirmed repeatedly; asserted once by one extraction, it is just an
--     opinion.
--
--     Called ONLY from a human-approved conversion. There is deliberately
--     no path from raw AI output to this function.
-- ---------------------------------------------------------------------
create or replace function fn_upsert_supplier_line_mapping(
  p_company_id uuid,
  p_supplier_id bigint,
  p_description_normalised text,
  p_supplier_sku_normalised text,
  p_gl_account text,
  p_vat_code text,
  p_capture_id bigint
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if coalesce(p_description_normalised, '') = '' then
    return; -- nothing to key a mapping on; silently learning nothing is correct here
  end if;

  insert into supplier_line_mappings (
    company_id, supplier_id, description_normalised, supplier_sku_normalised,
    gl_account, vat_code, times_confirmed, last_confirmed_at, last_capture_id
  ) values (
    p_company_id, p_supplier_id, p_description_normalised, coalesce(p_supplier_sku_normalised, ''),
    coalesce(p_gl_account, ''), coalesce(p_vat_code, ''), 1, now(), p_capture_id
  )
  on conflict (company_id, supplier_id, description_normalised, supplier_sku_normalised)
  do update set
    gl_account = excluded.gl_account,
    vat_code = excluded.vat_code,
    times_confirmed = supplier_line_mappings.times_confirmed + 1,
    last_confirmed_at = now(),
    last_capture_id = excluded.last_capture_id,
    disabled = false,
    updated_at = now();
end;
$$;
