-- Down script for 0121_sales_posting_integrity_and_credit_note_allocation.sql.
--
-- Run the APPLICATION rollback first: the allocation action calls
-- `fn_allocate_sales_credit_note` over RPC, and the importer/approval
-- changes expect the guards below.
--
-- What this removes: the three guards (one live journal per sales
-- document, no re-linking, non-negative sales documents) and the
-- allocation function. Removing the guards changes no data; it only
-- re-opens the races and the sign defect they close.
--
-- ALLOCATIONS ALREADY MADE ARE NOT UNDONE. Each allocation moved two
-- `outstanding` balances. Dropping the table would erase the only record
-- of why those balances moved, so this script REFUSES to drop a table
-- that holds rows. To roll back after allocations exist, first reverse
-- each one through an approved correction (restore both outstanding
-- balances from the audit entry's `outstandingBefore` values, recording
-- the correction), then run this script.

do $$
begin
  if exists (select 1 from sales_credit_note_allocations) then
    raise exception 'PRECISIA_0121_ROLLBACK_REFUSED: sales_credit_note_allocations holds rows; reverse them through an approved correction first.';
  end if;
end;
$$;

drop function if exists fn_allocate_sales_credit_note(uuid, bigint, bigint, numeric, uuid);
drop function if exists fn_credit_note_available(numeric, numeric);
drop table if exists sales_credit_note_allocations;

drop trigger if exists sales_invoices_sign_guard on sales_invoices;
drop function if exists fn_guard_sales_invoice_sign();

drop trigger if exists sales_invoices_journal_link_guard on sales_invoices;
drop function if exists fn_guard_sales_invoice_journal_link();

drop trigger if exists ae_journals_sales_invoice_single_live on ae_journals;
drop function if exists fn_guard_sales_invoice_journal();
drop function if exists fn_sales_journal_is_live(text, boolean);
