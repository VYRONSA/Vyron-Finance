-- Phase 5Q.6 — certification evidence. LOCAL ONLY.
--
-- WHY THIS EXISTS. Certification run #47 made 24 provider calls and kept
-- the answers in memory. The summary was printed; the payloads were not
-- written anywhere. Field-by-field scoring against the countersigned
-- answer keys is therefore impossible for that run, and recovering it
-- would mean paying for 24 more calls. A certification that cannot be
-- scored afterwards was not a certification.
--
-- WHY NOT `ai_extraction_attempts`. That table was the obvious candidate
-- and is disqualified on three counts:
--
--   1. `capture_id` is NOT NULL with a hard FK to
--      `supplier_invoice_captures`. Writing certification evidence there
--      REQUIRES creating a capture row — a production capture, which
--      `listCaptures` would then show in the review inbox as a real
--      invoice, and which a reviewer could convert to a Draft Bill.
--   2. `listCapturesAwaitingExtraction` selects on (company_id, status)
--      with no notion of certification, so a certification capture in
--      'Queued' would be swept and re-sent by the extraction task.
--   3. It has no column for the extracted payload at all. `usage` is
--      token counts; `provider_message` is capped at 300 characters.
--
-- So this is a separate table whose ONLY foreign key is to the
-- certification run. No capture, no bill, no journal, no task. Nothing in
-- the application reads it, so nothing in the application can act on it.

-- ---------------------------------------------------------------------
-- 1. The evidence.
-- ---------------------------------------------------------------------
create table if not exists ai_certification_evidence (
  id bigint generated always as identity primary key,

  -- The only FK into the rest of the system. RESTRICT, not CASCADE: a run
  -- that produced evidence cannot be deleted out from under it, because
  -- the point of the table is that the record outlives the experiment.
  certification_run_id bigint not null references ai_certification_runs (id) on delete restrict,
  company_id uuid not null references companies (id) on delete restrict,

  -- Which corpus, which document, provably. A result that cannot be tied
  -- to the exact bytes it was produced from is an anecdote.
  corpus_case_id text not null,
  corpus_sha256 text not null check (char_length(corpus_sha256) = 64),
  document_file text not null,
  document_sha256 text not null check (char_length(document_sha256) = 64),

  -- Which provider answered, and what the reservation that authorised it
  -- had spent at that moment.
  provider text not null default 'vercel-ai-gateway',
  model text,
  calls_used_at_reservation integer check (calls_used_at_reservation is null or calls_used_at_reservation >= 1),
  call_ceiling integer check (call_ceiling is null or call_ceiling >= 1),

  attempted_at timestamptz not null default now(),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  usage jsonb,

  outcome text not null check (outcome in ('extracted', 'provider_error')),
  error_category text,
  http_status integer,
  -- Operator-facing sentence only, sanitised at the provider boundary —
  -- the same 300-character discipline as `ai_extraction_attempts`.
  provider_message text check (provider_message is null or char_length(provider_message) <= 300),

  -- THE POINT OF THE TABLE. The complete ExtractionResult: header, every
  -- line, invoiceNumbersSeen, missingFields, warnings, declaredLineCount.
  -- Null only when the provider failed and there was nothing to record.
  extracted jsonb,

  validation_status text check (validation_status is null or validation_status in ('Pass', 'Review', 'Incomplete')),
  validation_findings jsonb not null default '[]'::jsonb,
  line_count integer check (line_count is null or line_count >= 0),
  declared_line_count integer check (declared_line_count is null or declared_line_count >= 0),

  recorded_at timestamptz not null default now(),

  -- One row per case per run. A case cannot be recorded twice, which
  -- matches the runner's rule that a case gets one reserved call and no
  -- retry.
  unique (certification_run_id, corpus_case_id)
);

alter table ai_certification_evidence enable row level security;
revoke all on table ai_certification_evidence from public, anon, authenticated, service_role;

create index if not exists ai_certification_evidence_run_idx
  on ai_certification_evidence (certification_run_id, corpus_case_id);

comment on table ai_certification_evidence is
  'Phase 5Q.6. Full AI extraction payloads from a certification run, for field-by-field scoring. Never read by application code; never a supplier invoice capture; creates no accounting record.';

-- ---------------------------------------------------------------------
-- 2. Immutability.
--
--    Evidence that can be edited after the fact is not evidence. An
--    UPDATE is refused outright — nothing legitimately amends a recorded
--    result. A DELETE is refused once the run is no longer Open, so a
--    finished run's record cannot be quietly tidied away.
-- ---------------------------------------------------------------------
create or replace function fn_ai_certification_evidence_immutable()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'ai_certification_evidence is append-only: recorded certification evidence cannot be modified';
  end if;

  select status into v_status from ai_certification_runs where id = old.certification_run_id;
  if v_status is distinct from 'Open' then
    raise exception 'certification run % is %, so its evidence is sealed and cannot be deleted',
      old.certification_run_id, coalesce(v_status, 'missing');
  end if;

  return old;
end;
$$;

drop trigger if exists ai_certification_evidence_immutable on ai_certification_evidence;
create trigger ai_certification_evidence_immutable
  before update or delete on ai_certification_evidence
  for each row execute function fn_ai_certification_evidence_immutable();

-- ---------------------------------------------------------------------
-- 3. The writer.
--
--    Insert-only, and it verifies the run is Open and belongs to the
--    company before recording anything. There is deliberately no update
--    function and no upsert: a second attempt to record the same case
--    raises rather than overwriting the first.
-- ---------------------------------------------------------------------
-- ---------------------------------------------------------------------
-- 3a. The reader.
--
--    The table has RLS on, every grant revoked, and no policy — which is
--    what keeps it out of reach of the application. That also means it
--    cannot be SELECTed through PostgREST at all, including by the
--    certification tooling that has to score it. Found by running the
--    writer end to end: the INSERT succeeded and every read came back
--    empty.
--
--    So reading is a function too, with the same security-definer
--    boundary as writing. One run at a time, because scoring is per run
--    and nothing needs to sweep the table.
-- ---------------------------------------------------------------------
create or replace function fn_ai_certification_read_evidence(p_run_id bigint)
returns setof ai_certification_evidence
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from ai_certification_evidence
  where certification_run_id = p_run_id
  order by corpus_case_id;
$$;

create or replace function fn_ai_certification_record_evidence(
  p_run_id bigint,
  p_company_id uuid,
  p_case_id text,
  p_corpus_sha256 text,
  p_document_file text,
  p_document_sha256 text,
  p_outcome text,
  p_model text default null,
  p_calls_used integer default null,
  p_call_ceiling integer default null,
  p_duration_ms integer default null,
  p_usage jsonb default null,
  p_error_category text default null,
  p_http_status integer default null,
  p_provider_message text default null,
  p_extracted jsonb default null,
  p_validation_status text default null,
  p_validation_findings jsonb default '[]'::jsonb,
  p_line_count integer default null,
  p_declared_line_count integer default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_run ai_certification_runs;
begin
  select * into v_run from ai_certification_runs where id = p_run_id;

  if v_run.id is null then
    raise exception 'no certification run %', p_run_id;
  end if;
  if v_run.company_id <> p_company_id then
    raise exception 'certification run % belongs to a different company', p_run_id;
  end if;
  if v_run.status <> 'Open' then
    raise exception 'certification run % is %, so no further evidence may be recorded', p_run_id, v_run.status;
  end if;

  insert into ai_certification_evidence (
    certification_run_id, company_id, corpus_case_id, corpus_sha256, document_file, document_sha256,
    model, calls_used_at_reservation, call_ceiling, duration_ms, usage,
    outcome, error_category, http_status, provider_message,
    extracted, validation_status, validation_findings, line_count, declared_line_count
  ) values (
    p_run_id, p_company_id, p_case_id, p_corpus_sha256, p_document_file, p_document_sha256,
    p_model, p_calls_used, p_call_ceiling, p_duration_ms, p_usage,
    p_outcome, p_error_category, p_http_status, p_provider_message,
    p_extracted, p_validation_status, coalesce(p_validation_findings, '[]'::jsonb), p_line_count, p_declared_line_count
  )
  returning id into v_id;

  return v_id;
end;
$$;
