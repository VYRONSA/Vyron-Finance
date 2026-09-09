-- Phase 33 — Supplier Duplicate Merge is currently broken: "Suggested
-- Merge" on a Supplier finding (merge-service.ts::recordPartyMerge) only
-- inserts one `party_merges` audit row and one `matching_overrides` row.
-- It never repoints a single foreign key and never deactivates the
-- duplicate — both suppliers remain active, unchanged, in the Suppliers
-- list, and Duplicate Detection keeps finding the same pair on every
-- subsequent scan. This function is the real merge operation, invoked
-- via `supabase.rpc("fn_merge_supplier", ...)` from
-- `merge-repository.ts::mergeSupplierAtomic`.
--
-- Every table with a foreign key onto `ae_suppliers` (confirmed by a full
-- repository/schema audit — see Phase 33 investigation report) is
-- repointed from the duplicate to the survivor inside ONE transaction:
-- `ae_imported_bills.supplier_id`, `ae_bank_transactions.matched_supplier_id`,
-- `purchase_orders.supplier_id`, `goods_received_notes.supplier_id`,
-- `supplier_payments.supplier_id`, `stock_items.preferred_supplier_id`,
-- `merchants.default_supplier_id`, `bank_transaction_splits.supplier_id`,
-- `fixed_assets.supplier_id`, `opening_balance_entries.supplier_id`,
-- and (Phase 33A) `supplier_contacts.supplier_id`,
-- `supplier_addresses.supplier_id` — confirmed via their own schema
-- (0009_supplier_management.sql) to carry NO unique constraint of any
-- kind, so repointing them can never violate a uniqueness rule today.
-- Should a future migration ever add one, any violation still aborts
-- this ENTIRE function — every statement below runs inside the one
-- implicit transaction PL/pgSQL wraps a function body in, so a failure
-- on the very last statement rolls back every UPDATE that came before
-- it, not just the one that failed. No bespoke "detect a conflict, then
-- abort" logic is needed or written — Postgres provides this by
-- construction, not by this function's own code.
--
-- Repointing changes only WHICH supplier record a historical document is
-- attributed to — it never touches an amount, a GL account, a VAT code,
-- or a journal, so no accounting figure changes as a result of a merge.
--
-- Contacts/addresses are transferred, never deduplicated: if the
-- duplicate supplier has its own "primary" contact or "default" address,
-- it is repointed as-is even if the survivor already has one of its own
-- — this can leave two `is_primary`/`is_default` rows on the survivor
-- after a merge. That's a deliberate choice, not an oversight: nothing
-- in this schema enforces single-primary at the database level (no
-- unique partial index on `is_primary`/`is_default`), and inventing a
-- "which one wins" rule here would silently discard real contact
-- information a human should review instead.
--
-- The duplicate is soft-deactivated via the existing `status` column
-- (the only removal mechanism `ae_suppliers` has — there is no hard-delete
-- function anywhere in this codebase), never hard-deleted, so its own
-- historical row (and anything that still needs to reference `id`
-- directly, e.g. `party_merges.merged_party_id`) is preserved.
--
-- `security invoker` + RLS (`user_can_access_company`) means the two
-- `exists` checks below naturally return false — and the function raises,
-- touching nothing — if the calling user cannot see one of the two
-- companies' supplier rows, which is what makes cross-company merging
-- impossible without a second, duplicate authorization check here.
--
-- Phase 33A — now wired to a real, explicit-choice UI
-- (`supplier-merge-dialog.tsx` via `POST /api/companies/[companyId]/suppliers/merge`
-- → `mergeService.mergeSuppliers` → `mergeRepo.mergeSupplierAtomic`).
-- The survivor is always the id the user deliberately picked in that
-- dialog, never derived from an arbitrary heuristic — see the Phase 33A
-- report for the full interaction design.

create or replace function fn_merge_supplier(
  p_company_id uuid,
  p_survivor_id bigint,
  p_duplicate_id bigint,
  p_performed_by text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_survivor_exists boolean;
  v_duplicate_exists boolean;
  v_duplicate_name text;
  v_bills_count int;
  v_transactions_count int;
  v_purchase_orders_count int;
  v_grns_count int;
  v_payments_count int;
  v_stock_items_count int;
  v_merchants_count int;
  v_splits_count int;
  v_fixed_assets_count int;
  v_opening_balances_count int;
  v_contacts_count int;
  v_addresses_count int;
begin
  if p_survivor_id = p_duplicate_id then
    raise exception 'fn_merge_supplier: survivor and duplicate must be different suppliers';
  end if;

  select exists(select 1 from ae_suppliers where id = p_survivor_id and company_id = p_company_id) into v_survivor_exists;
  if not v_survivor_exists then
    raise exception 'fn_merge_supplier: surviving supplier % not found for this company', p_survivor_id;
  end if;

  select name from ae_suppliers where id = p_duplicate_id and company_id = p_company_id into v_duplicate_name;
  v_duplicate_exists := v_duplicate_name is not null;
  if not v_duplicate_exists then
    raise exception 'fn_merge_supplier: duplicate supplier % not found for this company', p_duplicate_id;
  end if;

  update ae_imported_bills set supplier_id = p_survivor_id
    where company_id = p_company_id and supplier_id = p_duplicate_id;
  get diagnostics v_bills_count = row_count;

  update ae_bank_transactions set matched_supplier_id = p_survivor_id
    where company_id = p_company_id and matched_supplier_id = p_duplicate_id;
  get diagnostics v_transactions_count = row_count;

  update purchase_orders set supplier_id = p_survivor_id
    where company_id = p_company_id and supplier_id = p_duplicate_id;
  get diagnostics v_purchase_orders_count = row_count;

  update goods_received_notes set supplier_id = p_survivor_id
    where company_id = p_company_id and supplier_id = p_duplicate_id;
  get diagnostics v_grns_count = row_count;

  update supplier_payments set supplier_id = p_survivor_id
    where company_id = p_company_id and supplier_id = p_duplicate_id;
  get diagnostics v_payments_count = row_count;

  update stock_items set preferred_supplier_id = p_survivor_id
    where company_id = p_company_id and preferred_supplier_id = p_duplicate_id;
  get diagnostics v_stock_items_count = row_count;

  update merchants set default_supplier_id = p_survivor_id
    where company_id = p_company_id and default_supplier_id = p_duplicate_id;
  get diagnostics v_merchants_count = row_count;

  update bank_transaction_splits set supplier_id = p_survivor_id
    where company_id = p_company_id and supplier_id = p_duplicate_id;
  get diagnostics v_splits_count = row_count;

  update fixed_assets set supplier_id = p_survivor_id
    where company_id = p_company_id and supplier_id = p_duplicate_id;
  get diagnostics v_fixed_assets_count = row_count;

  update opening_balance_entries set supplier_id = p_survivor_id
    where company_id = p_company_id and supplier_id = p_duplicate_id;
  get diagnostics v_opening_balances_count = row_count;

  -- Phase 33A — `supplier_contacts`/`supplier_addresses` have no
  -- `company_id` column of their own; scoping by `supplier_id =
  -- p_duplicate_id` is already correct because `p_duplicate_id` was just
  -- proven above to belong to `p_company_id`.
  update supplier_contacts set supplier_id = p_survivor_id
    where supplier_id = p_duplicate_id;
  get diagnostics v_contacts_count = row_count;

  update supplier_addresses set supplier_id = p_survivor_id
    where supplier_id = p_duplicate_id;
  get diagnostics v_addresses_count = row_count;

  update ae_suppliers set status = 'Inactive', modified_at = now()
    where company_id = p_company_id and id = p_duplicate_id;

  insert into party_merges (company_id, party_type, surviving_party_id, merged_party_id, merged_party_name, performed_by)
  values (p_company_id, 'Supplier', p_survivor_id, p_duplicate_id, v_duplicate_name, p_performed_by);

  return jsonb_build_object(
    'bills', v_bills_count,
    'bankTransactions', v_transactions_count,
    'purchaseOrders', v_purchase_orders_count,
    'goodsReceivedNotes', v_grns_count,
    'payments', v_payments_count,
    'stockItems', v_stock_items_count,
    'merchants', v_merchants_count,
    'bankTransactionSplits', v_splits_count,
    'fixedAssets', v_fixed_assets_count,
    'openingBalanceEntries', v_opening_balances_count,
    'supplierContacts', v_contacts_count,
    'supplierAddresses', v_addresses_count,
    'duplicateName', v_duplicate_name
  );
end;
$$;
