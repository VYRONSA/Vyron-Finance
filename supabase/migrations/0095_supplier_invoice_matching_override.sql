-- =====================================================================
-- Supplier Invoice Matching Override
-- =====================================================================
--
-- A supplier payment is normally expected to settle a supplier invoice
-- that VYRON can point at (`ae_bank_transactions.matched_bill_id`). Real
-- bookkeeping has legitimate exceptions — a deposit, a pro-forma
-- settlement, an on-account payment, an invoice that was never captured
-- because it predates the migration — and an accountant must be able to
-- say so explicitly rather than being stuck.
--
-- This column is that statement, and only that statement:
--
--   "Do not require a supplier invoice match for this payment."
--
-- WHAT IT DOES NOT DO
--
-- It does not create an invoice or a supplier bill, does not fabricate a
-- match, does not alter the Xero source transaction, its amount, its
-- debit/credit direction, its date, its reference or its duplicate
-- identity, and does not classify the payment to any account. Every other
-- allocation and posting rule continues to apply unchanged — the override
-- lifts exactly one requirement and nothing else.
--
-- Defaults to false, so this migration changes no existing transaction's
-- eligibility. Setting it is a deliberate, attributed act, which is why
-- who and when are recorded alongside it: an override is an accounting
-- judgement and the audit trail has to show whose it was.

alter table ae_bank_transactions
  add column override_supplier_invoice_matching boolean not null default false,
  add column override_supplier_invoice_matching_by text,
  add column override_supplier_invoice_matching_at timestamptz;

-- The posting preflight filters on this together with the supplier and
-- bill columns it already reads.
create index ae_bank_transactions_supplier_override_idx
  on ae_bank_transactions (company_id, override_supplier_invoice_matching)
  where override_supplier_invoice_matching = true;

comment on column ae_bank_transactions.override_supplier_invoice_matching is
  'Explicit accountant confirmation that this supplier payment may post without a linked supplier invoice (matched_bill_id). Lifts only the invoice-matching requirement; every other allocation and posting rule still applies. Never set automatically.';
