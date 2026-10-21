-- =====================================================================
-- RECOVERY for METANOIA-CORR-2026-10 (counter-correction)
-- =====================================================================
--
-- Use ONLY if the applied correction must be undone. Nothing is deleted:
-- every journal the correction posted is itself reversed with the same
-- mirror shape (dated at its own date, posted in a new batch), the
-- documents and bills get their pre-correction figures back exactly as in
-- the approved baseline, and each credit note is linked to its original
-- journal again. Afterwards the ledger movement of correction + recovery
-- is zero on every account and period, so balances equal the state before
-- the correction; the full history (original, reversal, correct journal,
-- and their reversals) stays visible.
--
-- Restoring the credit notes' NEGATIVE figures conflicts with 0121's
-- `sales_invoices_sign_guard`, which exists to forbid exactly that. This
-- script disables that one trigger for its own transaction only (when the
-- trigger exists) and re-enables it before it ends; ALTER TABLE takes a
-- brief exclusive lock on sales_invoices.
--
-- Runs inside release-0121/repair-recovery-*.sql, which set the approver:
--   select set_config('precisia.repair_approver', '<approver name>', true);
--   select set_config('precisia.repair_approval_reference', '<approval reference>', true);
-- BOTH are required; either missing or still a __PLACEHOLDER__ stops the run before anything is read or written.

do $recovery$
declare
  c_company constant uuid := '45b3d2a0-3973-4587-a043-0e05d8d9bff3';
  c_run constant text := 'METANOIA-CORR-2026-10';
  c_recovery constant text := 'METANOIA-CORR-2026-10-RECOVERY';
  c_base constant jsonb := $baseline$__BASELINE__$baseline$::jsonb;
  c_cn_ids constant bigint[] := array[164, 163, 162, 161, 160, 159, 158, 233, 165, 495];
  c_inv3611 constant bigint := 614;
  c_bill_ids constant bigint[] := array[63, 69];
  v_approver text := btrim(coalesce(current_setting('precisia.repair_approver', true), ''));
  v_reference text := btrim(coalesce(current_setting('precisia.repair_approval_reference', true), ''));
  v_actor text;
  v_a record;
  v_j ae_journals;
  v_line ae_journal_lines;
  v_batch bigint;
  v_rev bigint;
  v_new_line bigint;
  v_to_reverse bigint[] := '{}';
  v_correction_journals bigint[] := '{}';
  v_run_journals bigint[] := '{}';
  v_guard boolean := exists (select 1 from pg_trigger where tgname = 'sales_invoices_sign_guard' and tgrelid = 'public.sales_invoices'::regclass);
  v_updated int;
  v_live jsonb;
begin
  if v_approver = '' or v_approver like '%\_\_%' or v_reference = '' or v_reference like '%\_\_%' then
    raise exception 'PRECISIA_RECOVERY_NO_APPROVER: set precisia.repair_approver AND precisia.repair_approval_reference (the accountant''s name and the approval reference) before running %.', c_recovery;
  end if;
  v_actor := left(v_approver || ' (approval ' || v_reference || ')', 200);
  if (select count(*) from automation_audit_log where company_id = c_company and reason like c_run || ':%') <> 13 then
    raise exception 'PRECISIA_RECOVERY_NOT_APPLIED: % has not been applied (or not completely); nothing to recover.', c_run;
  end if;
  if exists (select 1 from automation_audit_log where company_id = c_company and reason like c_recovery || ':%') then
    raise exception 'PRECISIA_RECOVERY_ALREADY_APPLIED: % has already been applied; nothing was changed.', c_recovery;
  end if;

  perform 1 from sales_invoices where company_id = c_company and id = any(c_cn_ids || c_inv3611) order by id for update;
  perform 1 from ae_imported_bills where company_id = c_company and id = any(c_bill_ids) order by id for update;

  -- The correction's journals, from its own audit entries.
  for v_a in select document_type, document_id, journal_ids from automation_audit_log
              where company_id = c_company and reason like c_run || ':%' and cardinality(journal_ids) > 0 order by id loop
    if v_a.document_type = 'SalesInvoice' and v_a.document_id = any(c_cn_ids) then
      -- [original, reversal, correct]
      v_to_reverse := v_to_reverse || v_a.journal_ids[2] || v_a.journal_ids[3];
      v_correction_journals := v_correction_journals || v_a.journal_ids[3];
      if (select journal_id from sales_invoices where id = v_a.document_id) <> v_a.journal_ids[3] then
        raise exception 'PRECISIA_RECOVERY_STATE: credit note % is no longer linked to its correction journal.', v_a.document_id;
      end if;
    elsif v_a.document_id = c_inv3611 then
      v_to_reverse := v_to_reverse || v_a.journal_ids[2];
    end if;
  end loop;
  if cardinality(v_to_reverse) <> 21 or exists (select 1 from ae_journals where id = any(v_to_reverse) and (status <> 'Posted' or is_reversed)) then
    raise exception 'PRECISIA_RECOVERY_STATE: the 21 correction journals are not all Posted and unreversed.';
  end if;

  insert into posting_batches (company_id, batch_number, posting_date, journal_count, transaction_count, posted_by)
  values (c_company, fn_bank_unposting_next_number(c_company, 'PB'), current_date, 0, 0, v_actor)
  returning id into v_batch;

  for v_j in select * from ae_journals where id = any(v_to_reverse) order by journal_date, id loop
    insert into ae_journals (
      company_id, journal_number, journal_date, journal_type, description, reference,
      source_type, source_id, status, total_debit, total_credit, posted_at,
      submitted_by, submitted_at, approved_by, approved_at, posting_batch_id, reversal_of_journal_id
    ) values (
      c_company, fn_bank_unposting_next_number(c_company, 'JR'), v_j.journal_date, 'Reversal',
      format('Reversal of %s (%s)', v_j.journal_number, c_recovery), coalesce(v_j.reference, ''),
      'journal_reversal', v_j.id, 'Posted', v_j.total_credit, v_j.total_debit, now(),
      v_actor, now(), v_actor, now(), v_batch, v_j.id
    ) returning id into v_rev;
    for v_line in select * from ae_journal_lines where journal_id = v_j.id order by line_order, id loop
      insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order)
      values (v_rev, v_line.account_code, v_line.credit, v_line.debit, v_line.description, v_line.line_order)
      returning id into v_new_line;
      insert into gl_transactions (company_id, journal_id, journal_line_id, account_id, posting_date, reference, description,
                                   debit, credit, financial_year_label, financial_period, posted_by)
      select c_company, v_rev, v_new_line, g.account_id, g.posting_date, g.reference, g.description,
             g.credit, g.debit, g.financial_year_label, g.financial_period, v_actor
        from gl_transactions g where g.journal_id = v_j.id and g.journal_line_id = v_line.id order by g.id;
    end loop;
    update ae_journals set is_reversed = true, reversed_by_journal_id = v_rev where id = v_j.id and not is_reversed;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then raise exception 'PRECISIA_RECOVERY_RACE: % was reversed concurrently.', v_j.journal_number; end if;
    v_run_journals := v_run_journals || v_rev;
  end loop;

  -- Documents and bills back to the approved baseline, exactly.
  if v_guard then execute 'alter table sales_invoices disable trigger sales_invoices_sign_guard'; end if;
  update sales_invoices s
     set subtotal = (b->>'subtotal')::numeric, vat_amount = (b->>'vat_amount')::numeric, total = (b->>'total')::numeric,
         outstanding = (b->>'outstanding')::numeric, journal_id = (b->>'journal_id')::bigint
    from jsonb_array_elements(c_base->'docs') b
   where s.company_id = c_company and s.id = (b->>'id')::bigint and s.id = any(c_cn_ids);
  update sales_invoice_lines l
     set unit_price = (b->>'unit_price')::numeric, net_amount = (b->>'net_amount')::numeric,
         vat_amount = (b->>'vat_amount')::numeric, line_total = (b->>'line_total')::numeric
    from jsonb_array_elements(c_base->'lines') b
   where l.id = (b->>'id')::bigint and l.invoice_id = any(c_cn_ids);
  if v_guard then execute 'alter table sales_invoices enable trigger sales_invoices_sign_guard'; end if;
  update ae_imported_bills x set vat = (b->>'vat')::numeric, total = (b->>'total')::numeric, outstanding = (b->>'outstanding')::numeric
    from jsonb_array_elements(c_base->'bills') b where x.company_id = c_company and x.id = (b->>'id')::bigint;
  update ae_purchase_bill_lines l
     set unit_cost = (b->>'unit_cost')::numeric, net_amount = (b->>'net_amount')::numeric, vat_amount = (b->>'vat_amount')::numeric, line_total = (b->>'line_total')::numeric
    from jsonb_array_elements(c_base->'blines') b where l.id = (b->>'id')::bigint;

  update posting_batches set journal_count = cardinality(v_run_journals),
         transaction_count = (select count(*) from gl_transactions where journal_id = any(v_run_journals)) where id = v_batch;

  insert into automation_audit_log (company_id, performed_by, action_type, reason, changes, journal_ids, document_type, document_id, is_reversible)
  values (c_company, v_actor, 'MetanoiaCorrectionReversed',
    format('%s: %s reversed; documents and supplier credit notes restored to the approved baseline.', c_recovery, c_run),
    jsonb_build_object('run', c_recovery, 'reversedJournals', to_jsonb(v_to_reverse), 'recoveryJournals', to_jsonb(v_run_journals), 'batch', v_batch),
    v_run_journals, 'SalesInvoice', null, false);

  -- Postconditions: documents equal the baseline; correction + recovery move nothing.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') into v_live from (
    select id, company_id, customer_id, invoice_number, document_type, status, invoice_date, subtotal, vat_amount, total, outstanding, journal_id, original_invoice_id, reference
      from sales_invoices where company_id = c_company and id = any(c_cn_ids || c_inv3611)) x;
  if v_live <> c_base->'docs' then raise exception 'PRECISIA_RECOVERY_POST: documents differ from the baseline.'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.invoice_id, x.line_order, x.id), '[]') into v_live from (
    select id, invoice_id, line_order, quantity, unit_price, discount, net_amount, vat_amount, line_total from sales_invoice_lines where invoice_id = any(c_cn_ids || c_inv3611)) x;
  if v_live <> c_base->'lines' then raise exception 'PRECISIA_RECOVERY_POST: lines differ from the baseline.'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') into v_live from (
    select id, company_id, supplier_id, invoice_number, document_type, status, posting_status, journal_id, invoice_date, vat, total, outstanding, gl_account
      from ae_imported_bills where company_id = c_company and id = any(c_bill_ids)) x;
  if v_live <> c_base->'bills' then raise exception 'PRECISIA_RECOVERY_POST: supplier credit notes differ from the baseline.'; end if;
  if exists (
    select 1 from gl_transactions g
     where g.journal_id = any(v_to_reverse || v_run_journals)   -- all 21 correction journals + their 21 reversals
     group by g.account_id, g.financial_period having sum(g.debit - g.credit) <> 0) then
    raise exception 'PRECISIA_RECOVERY_POST: correction + recovery do not net to zero on every account and period.';
  end if;

  raise notice '% applied: batch %, % reversal journals', c_recovery, v_batch, cardinality(v_run_journals);
end;
$recovery$;
