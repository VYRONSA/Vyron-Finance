-- RC2 Phase 2 — a second, genuinely evidence-based index finding,
-- discovered not by static analysis but by hitting the actual problem:
-- cleaning up this certification's own synthetic load-test data (200,000
-- rows in `ae_bank_transactions`) hit a real Postgres statement timeout
-- on a plain `DELETE ... WHERE company_id = ...`. Root cause: Postgres
-- must check every self-referencing foreign key for rows pointing at
-- each deleted row (to enforce `ON DELETE SET NULL`/`RESTRICT`), and
-- without an index on the referencing column, that check is a full
-- table scan per row deleted — turning a bulk delete quadratic.
-- `ae_bank_transactions_reversal_idx` (added ad hoc to unblock the
-- cleanup itself) proved this immediately: the same delete that had
-- been timing out completed once the index existed.
--
-- This is a different justification from migration 0037's `company_id`
-- indexes (direct query-filter evidence) — self-referencing
-- reversal/parent columns matter for FK-cascade-check performance on
-- bulk writes/deletes, not for `.eq(...)` read filtering, so they were
-- correctly excluded from 0037's narrower, read-pattern-based scope.
-- Both are genuine, evidence-based, not premature: found by actually
-- doing an operation that needed them, not by guessing.
create index if not exists ae_bank_transactions_reversal_idx on ae_bank_transactions (reversal_of_transaction_id);
create index if not exists ae_journals_reversal_of_journal_id_idx on ae_journals (reversal_of_journal_id);
create index if not exists ae_journals_reversed_by_journal_id_idx on ae_journals (reversed_by_journal_id);
create index if not exists vat_returns_amended_return_id_idx on vat_returns (amended_return_id);
create index if not exists permission_roles_parent_role_id_idx on permission_roles (parent_role_id);
