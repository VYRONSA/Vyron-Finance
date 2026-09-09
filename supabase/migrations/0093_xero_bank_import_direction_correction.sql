-- =====================================================================
-- Correction of a VYRON import-mapping defect — NOT an accounting
-- adjustment to the client's Xero figures.
-- =====================================================================
--
-- WHAT WAS WRONG
--
-- Xero's "Account Transactions by date" report states Debit/Credit from
-- the BANK ACCOUNT's own ledger perspective, where the bank is an asset:
-- its Debit column is money ARRIVING, its Credit column is money LEAVING.
-- VYRON's `ae_bank_transactions` uses the opposite, cashbook convention —
-- `debit` is a payment OUT, `credit` is a receipt IN. That is not a
-- matter of opinion in this codebase; it is enforced by
-- `cashbook-service.ts::captureCashbookReceipt` (a receipt writes to
-- `credit`), by `cashbook-repository.ts` (`direction = 'Receipts'`
-- filters `credit > 0`), and by
-- `journal-service.ts::buildJournalLinesForTransaction` (a row with a
-- `debit` CREDITS the bank GL account).
--
-- `xero-bank-transactions-parser.ts` carried Xero's column names straight
-- through to fields carrying VYRON's meaning, so every row imported by
-- that path has its direction reversed. The parser itself is already
-- fixed (its fields are now named `moneyIn`/`moneyOut`, which are
-- unambiguous in both conventions, and are mapped explicitly at the
-- import boundary in `xero-import-service.ts`). This migration repairs
-- the rows that were written before that fix.
--
-- EVIDENCE, measured on the live data in scope (480 rows, all belonging
-- to one company, all carrying this one source filename):
--
--   Xero source type        in `debit`   in `credit`
--   Receivable Payment           108           0     (money in)
--   Receivable Overpayment       107           0     (money in)
--   Receive Money                  1           0     (money in)
--   Payable Payment                0          42     (money out)
--   Payable Overpayment            0          77     (money out)
--   Spend Money                    6         139     (money out, and 6
--                                                     refunds coming back in)
--
-- Every money-in row sits in `debit` and every money-out row in `credit`
-- — the exact inversion. Note the 6 "Spend Money" rows on the money-in
-- side: those are refunds, where Xero itself put the value in its Debit
-- column. That is why the correction below is a uniform column swap and
-- is NOT driven by source type: the source file's COLUMNS carry the
-- direction, and reading them by column is the whole fix.
--
-- WHAT THIS MIGRATION DOES, AND DOES NOT, DO
--
-- Does:    exchange `debit` and `credit` on the affected rows, so the
--          amount Xero recorded as arriving is represented in VYRON as
--          arriving.
-- Does not: change any amount, date, reference, description, allocation,
--          VAT value, GL account, or row count. Nothing is added, merged,
--          removed or netted off. Every apparent duplicate stays a
--          separate row. `import_description` — the immutable identity
--          snapshot from migration 0089 — is untouched.
--
-- The client's Xero figures are unchanged. Their VYRON REPRESENTATION is
-- corrected to mean what Xero actually said.
--
-- WHY THE UNIQUE CONSTRAINT IS DROPPED AND REBUILT
--
-- `ae_bank_transactions_natural_key` includes `debit` and `credit`, and
-- it is not deferrable, so it is evaluated row by row mid-statement. The
-- data in scope contains a genuine matched pair — R1.00 out to Capitec
-- Bank and R1.00 back in, on 2026-06-26, sharing a description — whose
-- keys momentarily coincide while the swap is in flight, even though the
-- swap as a whole is a bijection and produces no duplicate key at all
-- (verified: 0 colliding keys after the swap). Dropping and re-adding the
-- constraint inside this migration's transaction is what lets a correct
-- operation complete; the constraint is restored identically, so the
-- table ends this migration with exactly the protection it started with.
--
-- SCOPE
--
-- Keyed on `source_filename`, not on a hardcoded company id: the defect
-- belongs to one import code path, and this names that path. Verified
-- before writing: exactly 480 rows carry this filename, all in one
-- company, none of them posted, journaled, reconciled, or manually
-- captured.

do $$
declare
  v_source_filename constant text := 'Metanoia_Hospitality__Pty__Ltd_-_Bank_transactions_by_date.xlsx';
  v_in_scope int;
  v_unsafe int;
  v_before_debit numeric(14, 2);
  v_before_credit numeric(14, 2);
  v_after_debit numeric(14, 2);
  v_after_credit numeric(14, 2);
  v_swapped int;
begin
  select count(*) into v_in_scope from ae_bank_transactions where source_filename = v_source_filename;
  if v_in_scope = 0 then
    raise notice 'No rows carry source_filename %; nothing to correct.', v_source_filename;
    return;
  end if;

  -- Refuse to touch anything already carried into the accounting
  -- records. Correcting a row that has already produced GL entries would
  -- silently desynchronise the ledger from its source, which is exactly
  -- the class of problem this migration exists to end, not to create.
  select count(*) into v_unsafe
    from ae_bank_transactions
    where source_filename = v_source_filename
      and (posted_flag = true or journal_id is not null or reconciliation_id is not null or entry_source <> 'Imported');
  if v_unsafe > 0 then
    raise exception 'Refusing to correct import direction: % of % rows are already posted, journaled, reconciled, or manually captured. Reverse those first.', v_unsafe, v_in_scope;
  end if;

  -- A swap only means anything if exactly one side carries a value.
  select count(*) into v_unsafe
    from ae_bank_transactions
    where source_filename = v_source_filename
      and ((debit <> 0 and credit <> 0) or (debit = 0 and credit = 0));
  if v_unsafe > 0 then
    raise exception 'Refusing to correct import direction: % rows have both sides or neither side populated.', v_unsafe;
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_before_debit, v_before_credit
    from ae_bank_transactions where source_filename = v_source_filename;

  alter table ae_bank_transactions drop constraint ae_bank_transactions_natural_key;

  -- One statement: the right-hand side is evaluated against the OLD row,
  -- so this is a true exchange rather than two sequential assignments.
  update ae_bank_transactions
    set debit = credit, credit = debit
    where source_filename = v_source_filename;
  get diagnostics v_swapped = row_count;

  alter table ae_bank_transactions
    add constraint ae_bank_transactions_natural_key
    unique (company_id, bank_account, transaction_date, reference, debit, credit, import_description, source_occurrence);

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_after_debit, v_after_credit
    from ae_bank_transactions where source_filename = v_source_filename;

  -- The correction is an exchange, so the totals must have exchanged
  -- exactly. Any drift means an amount changed, which is the one thing
  -- this migration must never do.
  if v_swapped <> v_in_scope then
    raise exception 'Expected to correct % rows but corrected %.', v_in_scope, v_swapped;
  end if;
  if v_after_debit <> v_before_credit or v_after_credit <> v_before_debit then
    raise exception 'Totals did not exchange exactly: before (dr %, cr %), after (dr %, cr %).', v_before_debit, v_before_credit, v_after_debit, v_after_credit;
  end if;

  raise notice 'Corrected import direction on % rows. Debit total % -> %, credit total % -> %. No amount changed.',
    v_swapped, v_before_debit, v_after_debit, v_before_credit, v_after_credit;
end;
$$;
