-- Matching Platform Phase 3 — the one dimension Split Transactions was
-- still missing (GL Account/Customer/Supplier/VAT Code/Branch/
-- Department/Cost Centre/Project were already real, see
-- 0023_matching_platform.sql). Nullable, same "optional dimensional FK"
-- treatment as the other seven — a split line isn't required to name a
-- stock item.

alter table bank_transaction_splits
  add column inventory_item_id bigint references stock_items (id) on delete set null;
