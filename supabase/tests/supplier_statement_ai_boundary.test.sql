-- Phase SD-3F — database tests for migration 0116 (supplier statement AI boundary).
--
-- LOCAL / SYNTHETIC DATA ONLY. One transaction, rolled back at the end. No
-- provider is involved anywhere: these test the controls a provider call
-- would have to pass through.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/supplier_statement_ai_boundary.test.sql
--
-- Sections:
--   G  explicit grants (service role only for every AI function)
--   B  budget scope sized inside the provider-wide fuse
--   A  the gate: only a statement being processed; daily cap; open circuit;
--      no reservation leaks
--   R  the recorder: append-only attempts, reservation released when nothing
--      was sent, circuit moved by signals, scope isolation
--   P  provenance: extracted_by is system-owned; AI vocabulary allowed
--   H  accounting untouched; no 0116 function writes an accounting table

\set ON_ERROR_STOP 1
set client_min_messages = notice;
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'SD3F_TEST_ROLLBACK';
exception when others then
  if sqlerrm = 'SD3F_TEST_ROLLBACK' then return null; end if;
  raise notice '  (error: %)', sqlerrm;
  return sqlerrm;
end $$;
create function pg_temp.run(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null;
exception when others then raise notice '  (error: %)', sqlerrm; return sqlerrm; end $$;

create function pg_temp.co_a() returns uuid language sql immutable as $$ select '5e000000-0000-4000-8000-0000000006a1'::uuid $$;
create function pg_temp.co_b() returns uuid language sql immutable as $$ select '5e000000-0000-4000-8000-0000000006b1'::uuid $$;
create function pg_temp.uid(p text) returns uuid language sql immutable as $$
  select (case p when 'editor' then '5e000000-0000-4000-8000-000000000604' when 'viewer' then '5e000000-0000-4000-8000-000000000602' end)::uuid $$;
create function pg_temp.hash(p text) returns text language sql immutable as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.as_user(p text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated","email":"sd3f-%s@synthetic.test"}', pg_temp.uid(p), p), true);
  perform set_config('request.jwt.claim.sub', pg_temp.uid(p)::text, true);
end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create function pg_temp.accounting_fingerprint() returns text language sql security definer as $$
  select md5(
    coalesce((select string_agg(j::text, '|' order by j.id) from ae_journals j), '') || '#' ||
    coalesce((select string_agg(l::text, '|' order by l.id) from ae_journal_lines l), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from gl_transactions g), '') || '#' ||
    coalesce((select string_agg(b::text, '|' order by b.id) from ae_imported_bills b), '') || '#' ||
    coalesce((select string_agg(s::text, '|' order by s.id) from supplier_payments s), '') || '#' ||
    coalesce((select string_agg(a::text, '|' order by a.id) from supplier_payment_allocations a), '') || '#' ||
    coalesce((select string_agg(t::text, '|' order by t.id) from ae_bank_transactions t), ''))
$$;

-- Fixtures
insert into auth.users (id, email, aud, role) select pg_temp.uid(n), 'sd3f-' || n || '@synthetic.test', 'authenticated', 'authenticated' from unnest(array['editor','viewer']) n;
insert into organisations (id, name) values ('5e000000-0000-4000-8000-0000000006aa', 'SD3F Org A'), ('5e000000-0000-4000-8000-0000000006bb', 'SD3F Org B');
insert into companies (id, organisation_id, name, base_currency_code) values
  (pg_temp.co_a(), '5e000000-0000-4000-8000-0000000006aa', 'SD3F Company A', 'ZAR'), (pg_temp.co_b(), '5e000000-0000-4000-8000-0000000006bb', 'SD3F Company B', 'ZAR');
insert into permission_roles (company_id, role_key, name) values (pg_temp.co_a(), 'sd3f_editor', 'e'), (pg_temp.co_a(), 'sd3f_viewer', 'v');
insert into role_permissions (role_id, permission_key) select id, 'Purchasing:' || a from permission_roles, unnest(case role_key when 'sd3f_editor' then array['View','Edit'] else array['View'] end) a where role_key like 'sd3f_%';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by) select pg_temp.uid(replace(role_key, 'sd3f_', '')), company_id, id, 'sd3f' from permission_roles where role_key like 'sd3f_%';
insert into documents (company_id, entity_type, entity_id, category, filename, storage_path, mime_type, size_bytes, uploaded_by, content_sha256)
select c, 'Supplier', 0, 'Statement', f, c || '/Supplier/0/' || f, 'application/pdf', 1, 'fixture', pg_temp.hash(f)
from (values (pg_temp.co_a(), 'ai-processing.pdf'), (pg_temp.co_a(), 'ai-review.pdf'), (pg_temp.co_b(), 'ai-b.pdf')) t(c, f);
insert into supplier_statements (company_id, document_id, content_sha256, source_type, status, uploaded_by)
select d.company_id, d.id, d.content_sha256, 'pdf-scanned', case d.filename when 'ai-review.pdf' then 'NeedsReview' else 'Processing' end, 'fixture'
from documents d where d.filename like 'ai-%';
create function pg_temp.st(p text) returns bigint language sql security definer as $$ select s.id from supplier_statements s join documents d on d.id = s.document_id where d.filename = p $$;
create function pg_temp.reserved(p_co uuid) returns integer language sql security definer as $$
  select coalesce((select reserved_requests from ai_provider_daily_usage where company_id = p_co and scope = 'supplier-statement-extraction' and usage_day = (now() at time zone 'UTC')::date), 0) $$;
create function pg_temp.fuse(p_co uuid) returns integer language sql security definer as $$
  select coalesce((select reserved_requests from ai_provider_daily_usage where company_id = p_co and scope = '__provider__' and usage_day = (now() at time zone 'UTC')::date), 0) $$;
create function pg_temp.circuit() returns text language sql security definer as $$ select state from ai_provider_circuit_state where scope = 'supplier-statement-extraction' $$;
create function pg_temp.invoice_circuit() returns text language sql security definer as $$ select state from ai_provider_circuit_state where scope = 'supplier-invoice-extraction' $$;
create function pg_temp.backoff() returns integer language sql security definer as $$ select probe_backoff_seconds from ai_provider_circuit_state where scope = 'supplier-statement-extraction' $$;
create function pg_temp.rec(p_signal text, p_request boolean, p_outcome text, p_statement text default 'ai-processing.pdf', p_probe boolean default false) returns jsonb language sql as $$
  select fn_ai_statement_extraction_record_attempt(pg_temp.co_a(), pg_temp.st(p_statement), p_outcome, p_request, 'test-model', 'provider-error', 500, 'synthetic', null, 10, 1, 'test', p_signal, p_probe)
$$;

-- Start from a clean, closed circuit for the statement scope (inside this transaction only).
update ai_provider_circuit_state set state = 'closed', consecutive_timeouts = 0, consecutive_provider_failures = 0, opened_at = null, open_reason = null,
  next_probe_at = null, probe_backoff_seconds = 3600, probe_in_flight_until = null where scope = 'supplier-statement-extraction';
create temp table sd3f_state as select pg_temp.accounting_fingerprint() as before,
  (select state from ai_provider_circuit_state where scope = 'supplier-invoice-extraction') as invoice_circuit;
grant select on sd3f_state to authenticated, service_role;

-- =====================================================================
-- G. Grants
-- =====================================================================
select pg_temp.ok(
  not has_table_privilege('anon', 'ai_statement_extraction_attempts', 'select')
  and has_table_privilege('authenticated', 'ai_statement_extraction_attempts', 'select')
  and not has_table_privilege('authenticated', 'ai_statement_extraction_attempts', 'insert')
  and not has_table_privilege('service_role', 'ai_statement_extraction_attempts', 'insert')
  and not has_table_privilege('service_role', 'ai_statement_extraction_attempts', 'update')
  and not has_table_privilege('service_role', 'ai_statement_extraction_attempts', 'delete'),
  'G1 attempts: readable (RLS), written only through the recorder — not even the service role writes directly');
select pg_temp.ok((select bool_and(not has_function_privilege(r, f, 'execute') and has_function_privilege('service_role', f, 'execute'))
  from unnest(array['anon','authenticated']) r, unnest(array[
    'fn_ai_scope_gate(uuid,text,timestamptz)',
    'fn_ai_scope_record_signal(text,text,text,integer,text,boolean,timestamptz)',
    'fn_ai_statement_extraction_gate(uuid,bigint,timestamptz)',
    'fn_ai_statement_extraction_record_attempt(uuid,bigint,text,boolean,text,text,integer,text,jsonb,integer,integer,text,text,boolean,timestamptz)']) f),
  'G2 every AI function is callable by the service role only — never by a user or anon');
select pg_temp.ok((select bool_and(not has_function_privilege(r, 'fn_ai_statement_extraction_attempts_immutable()', 'execute')) from unnest(array['anon','authenticated','service_role']) r),
  'G3 the immutability trigger function is callable by no API role');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('select fn_ai_statement_extraction_gate(%L, %s)', pg_temp.co_a(), pg_temp.st('ai-processing.pdf'))) like '%permission denied%',
  'G4 a signed-in user cannot open the gate (no user can trigger a provider call)');
select pg_temp.as_admin();

-- =====================================================================
-- B. Budget
-- =====================================================================
select pg_temp.ok((select daily_request_cap = 50 from ai_provider_scope_budgets where scope = 'supplier-statement-extraction'), 'B1 the statement scope has its own daily cap (50)');
select pg_temp.ok((select sum(daily_request_cap) from ai_provider_scope_budgets where scope <> '__provider__') <= (select daily_request_cap from ai_provider_scope_budgets where scope = '__provider__'),
  'B2 all feature scopes together fit inside the provider-wide fuse');

-- =====================================================================
-- A. Gate
-- =====================================================================
select pg_temp.as_service();
select pg_temp.ok((fn_ai_statement_extraction_gate(pg_temp.co_a(), pg_temp.st('ai-review.pdf')) ->> 'decision') = 'not_processing' and pg_temp.reserved(pg_temp.co_a()) = 0,
  'A1 a statement a person is reviewing is never sent (and nothing is reserved)');
select pg_temp.ok(pg_temp.err(format('select fn_ai_statement_extraction_gate(%L, %s)', pg_temp.co_a(), pg_temp.st('ai-b.pdf'))) like '%does not belong%',
  'A2 another company''s statement is refused');
select pg_temp.ok((fn_ai_statement_extraction_gate(pg_temp.co_a(), pg_temp.st('ai-processing.pdf')) ->> 'decision') = 'allow'
              and pg_temp.reserved(pg_temp.co_a()) = 1 and pg_temp.fuse(pg_temp.co_a()) = 1,
  'A3 a processing statement is allowed, reserving one request in the scope AND the fuse');
select pg_temp.as_admin();
insert into ai_provider_company_budget_overrides (company_id, scope, daily_request_cap, reason) values (pg_temp.co_a(), 'supplier-statement-extraction', 1, 'test cap');
select pg_temp.as_service();
select pg_temp.ok((fn_ai_statement_extraction_gate(pg_temp.co_a(), pg_temp.st('ai-processing.pdf')) ->> 'decision') = 'daily_cap'
              and pg_temp.reserved(pg_temp.co_a()) = 1 and pg_temp.fuse(pg_temp.co_a()) = 1,
  'A4 at the daily cap the gate refuses — and the refusal consumes no budget');

-- =====================================================================
-- R. Recorder
-- =====================================================================
select pg_temp.ok((pg_temp.rec('none', false, 'document_error') ->> 'attempt_number')::integer = 1
              and pg_temp.reserved(pg_temp.co_a()) = 0 and pg_temp.fuse(pg_temp.co_a()) = 0,
  'R1 an attempt that never reached the provider gives the reservation back (scope and fuse)');
select pg_temp.as_admin();
delete from ai_provider_company_budget_overrides where company_id = pg_temp.co_a();
select pg_temp.as_service();
select pg_temp.ok((fn_ai_statement_extraction_gate(pg_temp.co_a(), pg_temp.st('ai-processing.pdf')) ->> 'decision') = 'allow', 'R2 (gate allows again)');
select pg_temp.ok((pg_temp.rec('success', true, 'extracted') ->> 'circuit_state') = 'closed' and pg_temp.reserved(pg_temp.co_a()) = 1,
  'R3 a request that reached the provider keeps its reservation (it was spent) and success keeps the circuit closed');
select pg_temp.ok((select count(*) = 2 and max(attempt_number) = 2 from ai_statement_extraction_attempts where statement_id = pg_temp.st('ai-processing.pdf')),
  'R4 attempts are numbered per statement');
select pg_temp.ok((select provider_message is not null and usage is null and outcome = 'extracted' from ai_statement_extraction_attempts where statement_id = pg_temp.st('ai-processing.pdf') and attempt_number = 2)
              and not exists (select 1 from information_schema.columns where table_name = 'ai_statement_extraction_attempts' and column_name ~ '(prompt|response|content|text_)'),
  'R5 attempts are metadata only — there is no column for a prompt, a response or document content');
select pg_temp.rec('provider_failure', true, 'provider_error');
select pg_temp.rec('provider_failure', true, 'provider_error');
select pg_temp.rec('provider_failure', true, 'provider_error');
select pg_temp.ok(pg_temp.circuit() = 'closed', 'R6 three consecutive provider failures do not open the circuit yet');
select pg_temp.rec('provider_failure', true, 'provider_error');
select pg_temp.rec('provider_failure', true, 'provider_error');
select pg_temp.ok(pg_temp.circuit() = 'open', 'R7 the fifth consecutive provider failure OPENS the circuit');
select pg_temp.ok((fn_ai_statement_extraction_gate(pg_temp.co_a(), pg_temp.st('ai-processing.pdf')) ->> 'decision') = 'circuit_open',
  'R8 with the circuit open the gate refuses before reserving anything');
select pg_temp.ok(pg_temp.invoice_circuit() is not distinct from (select invoice_circuit from sd3f_state),
  'R9 the statement circuit is its own: invoice extraction''s circuit is unaffected');
select pg_temp.as_admin();
update ai_provider_circuit_state set next_probe_at = now() - interval '1 minute' where scope = 'supplier-statement-extraction';
select pg_temp.as_service();
select pg_temp.ok((fn_ai_statement_extraction_gate(pg_temp.co_a(), pg_temp.st('ai-processing.pdf')) ->> 'decision') = 'probe',
  'R10 after its back-off an open circuit admits exactly one probe');
select pg_temp.ok((fn_ai_statement_extraction_gate(pg_temp.co_a(), pg_temp.st('ai-processing.pdf')) ->> 'decision') = 'circuit_open',
  'R11 … and only one: a second caller is refused while the probe is in flight');
select pg_temp.ok((pg_temp.rec('auth', true, 'provider_error', 'ai-processing.pdf', true) ->> 'circuit_state') = 'open'
              and pg_temp.backoff() = 7200,
  'R12 a failed probe keeps it open and doubles the back-off');
select pg_temp.as_admin();
update ai_provider_circuit_state set state = 'closed', consecutive_provider_failures = 0 where scope = 'supplier-statement-extraction';
select pg_temp.as_service();
select pg_temp.ok((pg_temp.rec('auth', true, 'provider_error') ->> 'circuit_state') = 'open', 'R13 an authentication/credit failure opens the circuit at once');
select pg_temp.ok(pg_temp.err(format('select fn_ai_statement_extraction_record_attempt(%L, %s, %L, false, null, null, null, null, null, null, null, null, %L)',
  pg_temp.co_a(), pg_temp.st('ai-b.pdf'), 'document_error', 'none')) like '%does not belong%', 'R14 an attempt cannot be recorded against another company''s statement');
select pg_temp.ok(pg_temp.err(format('select fn_ai_statement_extraction_record_attempt(%L, %s, %L, false, null, null, null, null, null, null, null, null, %L)',
  pg_temp.co_a(), pg_temp.st('ai-processing.pdf'), 'document_error', 'nonsense')) like '%unknown circuit signal%', 'R15 an unknown circuit signal is refused');
select pg_temp.as_admin();
select pg_temp.ok(pg_temp.err('update ai_statement_extraction_attempts set outcome = ''extracted''') like '%append-only%'
              and pg_temp.err('delete from ai_statement_extraction_attempts') like '%append-only%', 'R16 attempts cannot be edited or deleted, even by the owner');
select pg_temp.as_user('viewer');
select pg_temp.ok((select count(*) from ai_statement_extraction_attempts) > 0 and not exists (select 1 from ai_statement_extraction_attempts where company_id <> pg_temp.co_a()),
  'R17 a Purchasing:View holder reads their company''s attempt history only');

-- =====================================================================
-- P. Provenance
-- =====================================================================
select pg_temp.as_service();
insert into supplier_statement_lines (company_id, statement_id, line_order, reference_text, transaction_type, debit, raw_text, extracted_by)
values (pg_temp.co_a(), pg_temp.st('ai-review.pdf'), 1, '0001', 'invoice', 10, 'row', 'ai');
update supplier_statements set extraction_method = 'ai' where id = pg_temp.st('ai-review.pdf');
select pg_temp.ok((select extracted_by = 'ai' from supplier_statement_lines where statement_id = pg_temp.st('ai-review.pdf') and line_order = 1)
              and (select extraction_method = 'ai' from supplier_statements where id = pg_temp.st('ai-review.pdf')),
  'P1 the server records AI-read lines and the AI extraction method');
select pg_temp.as_user('editor');
select pg_temp.ok(pg_temp.err(format('update supplier_statement_lines set extracted_by = ''reviewer'' where statement_id = %s', pg_temp.st('ai-review.pdf'))) like '%provenance%',
  'P2 a reviewer cannot disguise an AI-read line as their own (or vice versa)');
select pg_temp.ok(pg_temp.run(format('update supplier_statement_lines set debit = 12 where statement_id = %s and line_order = 1', pg_temp.st('ai-review.pdf'))) is null, 'P3a (a reviewer corrects the AI-read amount)');
select pg_temp.ok((select extracted_by = 'ai' and corrected from supplier_statement_lines where statement_id = pg_temp.st('ai-review.pdf') and line_order = 1),
  'P3 the corrected line still says it was read by AI, and is marked corrected — the two are always distinguishable');
select pg_temp.ok(pg_temp.run(format('insert into supplier_statement_lines (company_id, statement_id, line_order, debit, extracted_by) values (%L, %s, 2, 5, %L)',
  pg_temp.co_a(), pg_temp.st('ai-review.pdf'), 'ai')) is null, 'P4a (a reviewer adds a line, claiming it was read by AI)');
select pg_temp.ok((select extracted_by = 'reviewer' from supplier_statement_lines where statement_id = pg_temp.st('ai-review.pdf') and line_order = 2),
  'P4 a line a reviewer types is always recorded as the reviewer''s, whatever they claim');
select pg_temp.as_admin();
select pg_temp.ok((select extracted_by = 'reader' from supplier_statement_lines where id = (select min(id) from supplier_statement_lines where extracted_by is not null and company_id not in (pg_temp.co_a(), pg_temp.co_b()))) is not false,
  'P5 existing lines default to the deterministic reader');

-- =====================================================================
-- H. Accounting untouched
-- =====================================================================
select pg_temp.ok((select before from sd3f_state) = pg_temp.accounting_fingerprint(), 'H1 journals, ledger, bills, payments, allocations and bank transactions are byte-for-byte unchanged');
select pg_temp.ok(not exists (
  select 1 from pg_proc where proname in ('fn_ai_scope_gate', 'fn_ai_scope_record_signal', 'fn_ai_statement_extraction_gate', 'fn_ai_statement_extraction_record_attempt')
    and prosrc ~* '(insert into|update|delete from)\s+(ae_journals|ae_journal_lines|gl_transactions|ae_imported_bills|supplier_payments|supplier_payment_allocations|ae_bank_transactions|opening_balance_entries|ae_suppliers|supplier_statement_reconciliations|supplier_statement_resolutions)'),
  'H2 no AI function writes an accounting or reconciliation table');

rollback;
