-- Phase 30A — `fn_trial_balance` (migration 0007) ordered its rows with
-- `order by coa.account_code`, a plain TEXT-column ORDER BY — Postgres's
-- default lexicographic collation. Every real account code today happens
-- to be the same length (4 digits), which is exactly why this has always
-- LOOKED correct: for same-length numeric strings, lexicographic order
-- and numeric order agree. It stops agreeing the moment a differently
-- sized code exists (e.g. a 3-digit or 5-digit code), where lexicographic
-- order would misplace it relative to the existing 4-digit accounts.
--
-- Fixed the identical way Phase 30 already fixed every application-side
-- GL ordering location (`compareGlAccountCodes` in
-- `src/server/general-ledger/types.ts`): `order by length(coa.account_code),
-- coa.account_code` — shorter codes first, then lexicographic within each
-- length. This is numerically correct for the numeric-only codes this
-- chart actually uses (a shorter numeric string is always the smaller
-- number, and same-length numeric strings compare identically whether
-- sorted as text or as numbers), and — deliberately, unlike a
-- `::integer` cast — it can never fail or misbehave if a genuinely
-- non-numeric account code is ever entered (the account-code format
-- already permits letters/dots/dashes/underscores; a cast to integer
-- would raise a runtime error on any such code, silently breaking Trial
-- Balance for the whole company). This length-then-lexicographic
-- comparison degrades gracefully to a stable, deterministic order for
-- non-numeric codes instead.
--
-- CREATE OR REPLACE — everything else about the function (parameters,
-- return shape, the join, the WHERE clause, the GROUP BY, `security
-- invoker`, `stable`) is copied verbatim from 0007. Only the final
-- `order by` line changed. No balances, no transactions, no journals, no
-- account codes are touched by this migration — it is a pure read-query
-- ordering fix.
create or replace function fn_trial_balance(p_company_id uuid, p_as_of_date date default null)
returns table (
  account_id bigint,
  account_code text,
  description text,
  account_type text,
  normal_balance text,
  total_debit numeric,
  total_credit numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coa.id,
    coa.account_code,
    coa.description,
    coa.account_type,
    coa.normal_balance,
    coalesce(sum(gt.debit), 0) as total_debit,
    coalesce(sum(gt.credit), 0) as total_credit
  from chart_of_accounts coa
  left join gl_transactions gt
    on gt.account_id = coa.id
    and gt.company_id = coa.company_id
    and (p_as_of_date is null or gt.posting_date <= p_as_of_date)
  where coa.company_id = p_company_id and coa.is_active
  group by coa.id, coa.account_code, coa.description, coa.account_type, coa.normal_balance
  order by length(coa.account_code), coa.account_code;
$$;

-- Phase 30B — the one approved account classification correction from
-- this phase's investigation: the seeded "Suspense" account (9999) was
-- typed `account_type = 'Equity'`, which would incorrectly sweep any
-- future Suspense balance into the Statement of Changes in Equity
-- (`equity-engine.ts` filters `accountType === 'Equity'`) and the Cash
-- Flow Statement's equity/financing bucket (`cash-flow-engine.ts` does
-- the same) — neither engine has a name-based exclusion for "Suspense"
-- the way the AI candidate list already does. Corrected to `'Asset'`,
-- which is also consistent with this account's own existing
-- `normal_balance = 'Debit'` (this chart's own convention: non-contra
-- Debit-normal accounts are Asset-typed; every genuine Equity account
-- in this chart is Credit-normal except the deliberately-contra
-- "Drawings").
--
-- Read-only production verification (Phase 30B, Task 1) confirmed
-- exactly one such row exists company-wide today — account_code 9999,
-- description 'Suspense', account_type 'Equity', category 'Suspense',
-- normal_balance 'Debit' — with ZERO existing bank transactions, ZERO
-- gl_transactions (journals), ZERO ae_allocation_history rows, and ZERO
-- Banking Rule actions referencing it. This correction therefore has no
-- historical accounting impact.
--
-- The WHERE clause is deliberately narrow and self-verifying rather than
-- hardcoded to one company: `account_code = '9999' and description =
-- 'Suspense' and account_type = 'Equity'` matches only a seeded
-- Suspense account that is STILL in its original, unwanted state, for
-- EVERY company (safe for the multi-company architecture — this is not
-- scoped to one company_id) — it is also naturally idempotent, since a
-- second run would find nothing left to match. Nothing else about the
-- row (account_code, description, category, normal_balance,
-- is_control_account, company_id) is touched. No other account, no
-- transaction, no journal, no allocation, and no rule is touched by this
-- statement.
update chart_of_accounts
set account_type = 'Asset'
where account_code = '9999'
  and description = 'Suspense'
  and account_type = 'Equity';
