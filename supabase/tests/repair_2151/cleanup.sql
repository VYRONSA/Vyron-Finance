-- Repair simulation — removes the synthetic replica. LOCAL TEST DATABASE ONLY.
\set ON_ERROR_STOP 1
begin;
do $$
begin
  if (select name from companies where id = '45b3d2a0-3973-4587-a043-0e05d8d9bff3') is distinct from 'SYNTHETIC replica of Metanoia (local test only)' then
    raise exception 'CLEANUP_REFUSED: company 45b3d2a0-… is not the synthetic replica.';
  end if;
end $$;
delete from gl_transactions where company_id in ('45b3d2a0-3973-4587-a043-0e05d8d9bff3', '0c200000-0000-4000-8000-0000000000c2');
delete from companies where id in ('45b3d2a0-3973-4587-a043-0e05d8d9bff3', '0c200000-0000-4000-8000-0000000000c2');
delete from organisations where id = '0c200000-0000-4000-8000-0000000000b1';
commit;
\echo 'removed synthetic replica'
