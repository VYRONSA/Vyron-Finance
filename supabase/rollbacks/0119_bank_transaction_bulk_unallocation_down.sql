-- Rollback for 0119_bank_transaction_bulk_unallocation.sql.
--
-- REFUSES once any bulk unallocation has run: the run audit is a permanent
-- record and is never deleted to make a rollback possible, and dropping
-- `retained_gl_account` would erase the GL accounts those runs kept for
-- review. Before any run it removes everything 0119 added; no other object
-- is touched.

begin;

do $$
begin
  if exists (select 1 from bank_unallocation_runs)
     or exists (select 1 from ae_bank_transactions where retained_gl_account is not null) then
    raise exception '0119 rollback refused: bulk unallocation audit records or retained GL accounts exist (they are permanent)';
  end if;
end $$;

drop function if exists fn_bulk_unallocate_bank_transactions(uuid, uuid, date, date, bigint, jsonb);
drop function if exists fn_preview_bank_unallocation(uuid, date, date, bigint, int);
drop function if exists fn_bank_unallocation_exclusion(ae_bank_transactions);

drop table if exists bank_unallocation_run_items;
drop table if exists bank_unallocation_runs;
drop function if exists fn_bank_unallocation_audit_immutable();
drop function if exists fn_bank_unallocation_runs_stamp();

alter table ae_bank_transactions drop column if exists retained_gl_account;

commit;
