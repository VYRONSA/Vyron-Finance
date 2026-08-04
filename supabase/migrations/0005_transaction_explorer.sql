-- Transaction Explorer module (Migration Roadmap Module 6).
--
-- Adds: a human "reviewed" flag on bank transactions (deliberately
-- separate from allocation_status, which is the Matching/Allocation
-- Engines' own fixed-meaning field — see ARCHITECTURE.md's layering
-- notes), its audit-history table (same shape as ae_match_history /
-- ae_allocation_history), a GL control-account code per bank account
-- (needed by Journal generation below), and ae_journals/ae_journal_lines
-- ported field-for-field from the reference `accounting_engine/schema.py`
-- (JournalService creates and validates Draft journals only — posting to
-- a General Ledger is out of scope there too, not just here).

alter table ae_bank_transactions
  add column review_status text check (review_status in ('Approved', 'Rejected', 'Ignored')),
  add column reviewed_by text,
  add column reviewed_at timestamptz,
  add column review_note text;

create table ae_transaction_review_history (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  transaction_id bigint not null references ae_bank_transactions (id) on delete cascade,
  previous_review_status text,
  new_review_status text not null,
  note text not null default '',
  performed_by text not null default 'System',
  created_at timestamptz not null default now()
);

create index ae_transaction_review_history_transaction_id_idx on ae_transaction_review_history (transaction_id);

alter table ae_transaction_review_history enable row level security;
create policy "members can access their company's transaction review history" on ae_transaction_review_history for all using (user_can_access_company(company_id));

-- The bank-side control account Journal generation debits/credits against.
-- Empty by default (most bank accounts won't have one set until an
-- operator assigns it via Edit Bank Account); Journal generation falls
-- back to a synthetic 'BANK-{account_number}' code when unset rather than
-- failing, so this column being empty never blocks the feature.
alter table ae_bank_accounts
  add column gl_account text not null default '';

create table ae_journals (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  journal_number text not null,
  journal_date date not null,
  journal_type text not null default '',
  description text not null default '',
  reference text not null default '',
  source_type text not null default '',
  source_id bigint,
  status text not null default 'Draft' check (status in ('Draft', 'Approved', 'Rejected', 'Posted')),
  total_debit numeric(14, 2) not null default 0,
  total_credit numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  unique (company_id, journal_number)
);

create table ae_journal_lines (
  id bigint generated always as identity primary key,
  journal_id bigint not null references ae_journals (id) on delete cascade,
  account_code text not null,
  debit numeric(14, 2) not null default 0,
  credit numeric(14, 2) not null default 0,
  description text not null default '',
  line_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index ae_journals_company_id_idx on ae_journals (company_id);
create index ae_journals_status_idx on ae_journals (company_id, status);
create index ae_journal_lines_journal_id_idx on ae_journal_lines (journal_id);

alter table ae_journals enable row level security;
alter table ae_journal_lines enable row level security;
create policy "members can access their company's journals" on ae_journals for all using (user_can_access_company(company_id));
-- ae_journal_lines has no company_id of its own — scoped transitively
-- through its parent journal, same pattern the reference's schema uses
-- (journal_lines carries no company_id either).
create policy "members can access their journal's lines" on ae_journal_lines for all using (
  exists (select 1 from ae_journals j where j.id = journal_id and user_can_access_company(j.company_id))
);

-- Every transaction a journal was generated from links back to it; not
-- "posted" until a future Posting Engine exists (out of scope here, and
-- in the reference app).
alter table ae_bank_transactions
  add constraint ae_bank_transactions_journal_id_fkey foreign key (journal_id) references ae_journals (id) on delete set null;

create index ae_bank_transactions_review_status_idx on ae_bank_transactions (company_id, review_status);
create index ae_bank_transactions_journal_id_idx on ae_bank_transactions (journal_id);

-- Company-wide Executive Summary aggregates for Transaction Explorer.
-- A DB-side aggregate is necessary (not optional) once a company can have
-- 100,000+ transactions — pulling every row client-side to sum/count in
-- Node would violate the module's own performance requirement. security
-- invoker (the default) means this rides on ae_bank_transactions' RLS
-- policy like every other query in the app; p_company_id is still passed
-- explicitly and filtered on, matching this codebase's "never rely on RLS
-- alone" convention.
create function fn_transaction_explorer_summary(p_company_id uuid)
returns table (
  total_transactions bigint,
  matched bigint,
  unmatched bigint,
  awaiting_review bigint,
  journals_created bigint,
  total_value numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) as total_transactions,
    count(*) filter (where allocation_status in ('Matched', 'Allocated')) as matched,
    count(*) filter (where allocation_status = 'Unallocated') as unmatched,
    count(*) filter (where allocation_status = 'Suggested' and review_status is null) as awaiting_review,
    count(*) filter (where journal_id is not null) as journals_created,
    coalesce(sum(debit), 0) + coalesce(sum(credit), 0) as total_value
  from ae_bank_transactions
  where company_id = p_company_id;
$$;
