-- =====================================================================
-- Subsidiary-ledger allocations count as allocated
-- =====================================================================
--
-- PRODUCTION DEFECT. An accountant allocated bank payments to a SUPPLIER
-- (Transaction Explorer -> Assign Supplier / Type "S"), saved them, and
-- then had no way to post them: "Post to Accounting" stayed disabled and
-- the Posting Status stayed "Unprocessed" forever. On Northwood
-- Management Investments that is 194 transactions.
--
-- ROOT CAUSE. `is_allocated` (migration 0092) — and its TypeScript twin
-- `transactionPostingStatus` — recognised only ONE way of telling VYRON
-- where a transaction belongs: a GL account written into
-- `suggested_gl_account` (or a split). But allocating a payment to a
-- supplier deliberately writes no GL account at all: the expense was
-- already recognised when the supplier INVOICE was captured, and the
-- payment settles a control-account balance instead. The company's own
-- seeded posting rules have always said exactly this (migration 0007):
--
--   Supplier Payment  DR creditors (2000)  CR bank (1000)
--   Customer Receipt  DR bank (1000)       CR debtors (1100)
--
-- So the destination of such a transaction was never unknown — it simply
-- was not being recognised as known.
--
-- WHAT THIS CHANGES. `is_allocated` now also counts an explicit
-- subsidiary-ledger allocation: allocation_type 'S' with a supplier, or
-- 'C' with a customer. Both halves of the pair are required — an
-- `allocation_type` with no counterparty identified is not a destination.
--
-- WHAT THIS DOES NOT CHANGE. It writes no data: `is_allocated` is a
-- generated column, so every value is re-derived from columns that
-- already exist, and no transaction's amount, date, direction,
-- allocation, VAT treatment or duplicate identity is touched. It does
-- not post anything — "Ready to Post" is not "Posted", and every posting
-- guard still applies afterwards, including supplier invoice matching
-- (migration 0095), the review hold (0094), the closed-period check and
-- the bank account's own GL configuration.
--
-- A generated column's expression cannot be altered in place, so the
-- column is dropped and re-added; the index that referenced it goes with
-- it and is recreated identically.

alter table ae_bank_transactions drop column is_allocated;

alter table ae_bank_transactions
  add column is_allocated boolean
  generated always as (
    nullif(btrim(coalesce(suggested_gl_account, '')), '') is not null
    or is_split
    or (allocation_type = 'S' and matched_supplier_id is not null)
    or (allocation_type = 'C' and matched_customer_id is not null)
  ) stored;

create index ae_bank_transactions_workflow_state_idx
  on ae_bank_transactions (company_id, posted_flag, reconciliation_id, is_allocated);

comment on column ae_bank_transactions.is_allocated is
  'Does VYRON know where this transaction belongs? True for a direct GL allocation, a split, or an explicit subsidiary-ledger allocation (supplier payment / customer receipt, which post to the Creditors / Debtors control account named by the company own posting rules). Must stay in agreement with isAllocatedForPosting() in src/server/accounting/types.ts — the Posting Status filter is this column and the badge in the grid is that function.';
