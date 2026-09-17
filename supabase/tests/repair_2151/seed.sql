-- Repair simulation (tests M, N) — LOCAL TEST DATABASE ONLY.
--
-- Builds a synthetic replica of the production facts the 2151 repair
-- checks, with the SAME ids (company 45b3d2a0-…, bank account 3 / GL 1020,
-- transaction 2151, journal 278 / JR000264, batch 272 / PB000264), so the
-- real repair and rollback files can be executed unmodified. Also seeds
-- neighbouring rows the repair must not touch (a correctly posted and
-- linked salary, an unposted transaction, a second company).
--
-- SAFETY: refuses to run if the real Metanoia company (or any row with
-- these ids) already exists — i.e. anywhere but an empty local database.

\set ON_ERROR_STOP 1

do $$
begin
  if exists (select 1 from companies where id = '45b3d2a0-3973-4587-a043-0e05d8d9bff3')
     or exists (select 1 from ae_bank_transactions where id in (2150, 2151, 2152))
     or exists (select 1 from ae_journals where id in (277, 278))
     or exists (select 1 from posting_batches where id in (271, 272))
     or exists (select 1 from ae_bank_accounts where id in (2, 3)) then
    raise exception 'SIMULATION_REFUSED: this database already has the real/replica ids. Run only on an empty local test database.';
  end if;
  if (select count(*) from companies) > 20 then
    raise exception 'SIMULATION_REFUSED: this does not look like a local test database.';
  end if;
end $$;

begin;

insert into organisations (id, name) values ('0c200000-0000-4000-8000-0000000000b1', 'SYNTHETIC replica org');
insert into companies (id, organisation_id, name) values
  ('45b3d2a0-3973-4587-a043-0e05d8d9bff3', '0c200000-0000-4000-8000-0000000000b1', 'SYNTHETIC replica of Metanoia (local test only)'),
  ('0c200000-0000-4000-8000-0000000000c2', '0c200000-0000-4000-8000-0000000000b1', 'SYNTHETIC other company (local test only)');

insert into chart_of_accounts (company_id, account_code, description, account_type, normal_balance)
select co, code, code, case when code in ('1020', '1030', '1000') then 'Asset' else 'Expense' end, 'Debit'
  from unnest(array['45b3d2a0-3973-4587-a043-0e05d8d9bff3'::uuid, '0c200000-0000-4000-8000-0000000000c2'::uuid]) co,
       unnest(array['1000', '1020', '1030', '6940']) code;

insert into ae_bank_accounts (id, company_id, account_number, account_name, gl_account) overriding system value values
  (2, '45b3d2a0-3973-4587-a043-0e05d8d9bff3', 'HANDCRAFTED-FOOD-PRODUCTS', 'HANDCRAFTED FOOD PRODUCTS', '1030'),
  (3, '45b3d2a0-3973-4587-a043-0e05d8d9bff3', 'METANOIA-HOSPITALITY', 'Metanoia Hospitality', '1020');

insert into ae_bank_transactions (id, company_id, transaction_date, reference, description, import_description, beneficiary, debit, credit, bank_account, bank_account_id,
                                  gl_account, allocation_status, suggested_gl_account, suggested_vat_code, allocation_type, rule_id, entry_source, source_occurrence, notes)
overriding system value values
  (2150, '45b3d2a0-3973-4587-a043-0e05d8d9bff3', '2026-03-27', '', 'Spend Money — Salaries', 'Spend Money — Salaries', 'Salaries', 6435, 0, 'Metanoia Hospitality', 3, '3420 - Salaries and wages', 'Suggested', '6940', 'No VAT', 'G', null, 'Imported', 3, 'Migrated from Xero. Source: Spend Money.'),
  (2151, '45b3d2a0-3973-4587-a043-0e05d8d9bff3', '2026-03-27', '', 'Spend Money — Salaries', 'Spend Money — Salaries', 'Salaries', 6435, 0, 'Metanoia Hospitality', 3, '3420 - Salaries and wages', 'Suggested', '6940', 'No VAT', 'G', null, 'Imported', 4, 'Migrated from Xero. Source: Spend Money.'),
  (2152, '45b3d2a0-3973-4587-a043-0e05d8d9bff3', '2026-03-27', '', 'Spend Money — Capitec Bank', 'Spend Money — Capitec Bank', 'Capitec Bank', 6, 0, 'Metanoia Hospitality', 3, '3030 - Bank Charges', 'Unallocated', null, null, null, null, 'Imported', 1, 'Migrated from Xero. Source: Spend Money.');

insert into posting_batches (id, company_id, batch_number, posting_date, journal_count, transaction_count, posted_by, created_at) overriding system value values
  (271, '45b3d2a0-3973-4587-a043-0e05d8d9bff3', 'PB000263', '2026-09-16', 1, 2, 'System', '2026-09-16 08:31:44.448949+00'),
  (272, '45b3d2a0-3973-4587-a043-0e05d8d9bff3', 'PB000264', '2026-09-16', 1, 2, 'System', '2026-09-16 08:31:46.214039+00');

insert into ae_journals (id, company_id, journal_number, journal_date, journal_type, description, reference, source_type, source_id, status, total_debit, total_credit, created_at, posted_at, posting_batch_id)
overriding system value values
  (277, '45b3d2a0-3973-4587-a043-0e05d8d9bff3', 'JR000263', '2026-09-16', 'Bank Transaction Automation', 'Automated from rule "Auto: Salaries → GL" — Spend Money — Salaries', '', 'bank_transaction_rule_engine', 2150, 'Posted', 6435, 6435, '2026-09-16 08:31:43.710573+00', '2026-09-16 08:31:44.448949+00', 271),
  (278, '45b3d2a0-3973-4587-a043-0e05d8d9bff3', 'JR000264', '2026-09-16', 'Bank Transaction Automation', 'Automated from rule "Auto: Salaries → GL" — Spend Money — Salaries', '', 'bank_transaction_rule_engine', 2151, 'Posted', 6435, 6435, '2026-09-16 08:31:45.467795+00', '2026-09-16 08:31:46.214039+00', 272);

insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order) values
  (277, '6940', 6435, 0, 'Spend Money — Salaries', 0), (277, '1020', 0, 6435, 'Spend Money — Salaries', 1),
  (278, '6940', 6435, 0, 'Spend Money — Salaries', 0), (278, '1020', 0, 6435, 'Spend Money — Salaries', 1);

insert into gl_transactions (company_id, journal_id, journal_line_id, account_id, posting_date, reference, description, debit, credit, financial_year_label, financial_period, posted_at, posted_by)
select j.company_id, j.id, l.id, c.id, j.journal_date, '', l.description, l.debit, l.credit, 'FY2027', 7, j.posted_at, 'System'
  from ae_journals j
  join ae_journal_lines l on l.journal_id = j.id
  join chart_of_accounts c on c.company_id = j.company_id and c.account_code = l.account_code
  where j.id in (277, 278);

-- 2150 was stamped correctly (its request was not interrupted); 2151 was not.
update ae_bank_transactions set journal_id = 277, posted_flag = true where id = 2150;

-- A second company with its own posted history.
insert into ae_bank_transactions (company_id, transaction_date, description, import_description, beneficiary, debit, credit, bank_account, allocation_status)
values ('0c200000-0000-4000-8000-0000000000c2', '2026-03-27', 'Other company payment', 'Other company payment', 'Someone', 99, 0, 'Other bank', 'Unallocated');

commit;
\echo 'seeded synthetic replica'
