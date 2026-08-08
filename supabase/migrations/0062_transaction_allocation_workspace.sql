-- Transaction Explorer Redesign, Phase 1 (Bank Transaction Allocation
-- Workspace) — adds the two columns the new inline allocation grid needs
-- that nothing existing could stand in for:
--
-- `allocation_type` ('G'/'C'/'S') is the missing discriminator. GL
-- allocation (suggested_gl_account), Supplier allocation
-- (matched_supplier_id), and Customer allocation (matched_customer_id)
-- are NOT mutually exclusive in this schema (e.g. a supplier-matched row
-- can also carry a suggested GL account resolved from the supplier's
-- default) — so there was previously no reliable way to know which of
-- the three the accountant currently intends as "the" allocation for a
-- row, which the new grid's single Type column needs to render/edit the
-- right one. Backfilled below by priority for existing rows; every new
-- write via the allocate-row action sets it explicitly going forward.
--
-- `allocation_notes` is a NEW accountant-entered notes field, deliberately
-- separate from the existing `notes` column — that column holds the
-- as-imported bank statement's own memo text (see
-- `BankTransactionRecord`'s doc comment in accounting/types.ts); reusing
-- it here would silently overwrite imported data every time an
-- accountant typed a note while allocating.

alter table ae_bank_transactions
  add column allocation_type text check (allocation_type in ('G', 'C', 'S')),
  add column allocation_notes text not null default '';

update ae_bank_transactions
set allocation_type = case
  when matched_supplier_id is not null then 'S'
  when matched_customer_id is not null then 'C'
  when suggested_gl_account is not null and suggested_gl_account <> '' then 'G'
  else null
end
where allocation_type is null;
