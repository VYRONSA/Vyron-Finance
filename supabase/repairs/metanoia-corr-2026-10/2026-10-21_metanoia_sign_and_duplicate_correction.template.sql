-- =====================================================================
-- REPAIR METANOIA-CORR-2026-10 — Metanoia Hospitality (Pty) Ltd
-- Credit-note sign correction, INV-3611 duplicate journal, supplier
-- credit-note signs. Plan: release-0121/PLAN-0121-release-and-correction.md
-- =====================================================================
--
-- This file is the BODY only (one DO block). It is executed inside the
-- wrappers in release-0121/ (repair-dryrun.sql rolls back, repair-apply.sql
-- commits), which set the approver first:
--   select set_config('precisia.repair_approver', '<approver name>', true);
--   select set_config('precisia.repair_approval_reference', '<approval reference>', true);
-- BOTH are required; either missing or still a __PLACEHOLDER__ stops the run before anything is read or written.
--
-- WHAT IT DOES, in ONE transaction (any failure rolls ALL of it back):
--   1. Refuses to run twice (audit marker METANOIA-CORR-2026-10) and refuses
--      unless every affected row equals the baseline captured from
--      production on 2026-10-21 (embedded below, compared field by field:
--      documents, lines, journals, journal lines, ledger rows, bills, bill
--      lines, accounts, financial year, journals per document).
--   2. Reverses the 10 sign-inverted credit-note journals and the duplicate
--      INV-3611 journal JR001436 with PRECISIA's standard reversal shape
--      (0063/0120): a new Reversal journal, every line's debit and credit
--      swapped, one mirror ledger row per original ledger row (same
--      account, date, financial year and period), original marked
--      reversed. Dated at the original journal date. Posted here, in a
--      posting batch of its own — never left Approved.
--   3. Re-signs each credit note (header and lines; quantities unchanged)
--      and posts its correct journal through the 'Customer Credit Note'
--      rule shape: DR 4100 net / DR 2200 VAT / CR 1100 gross, dated at the
--      document date, linked to the document.
--   4. Re-signs supplier credit notes 162247 / 162235 (bills 63 / 69).
--      They stay Open / Draft with no journal: nothing is approved or
--      posted.
--   5. One audit entry per document, before and after, with its journals.
--   6. Checks the result: per account and per month exactly as planned,
--      every journal balanced, one live journal per document, JR001437
--      untouched, bills unposted.
--
-- NOTHING is deleted and no existing journal, journal line or ledger row
-- is edited, apart from setting the original's reversed flag and link
-- (exactly what PRECISIA's own reversal does).

do $repair$
declare
  c_company constant uuid := '45b3d2a0-3973-4587-a043-0e05d8d9bff3';
  c_run constant text := 'METANOIA-CORR-2026-10';
  c_base constant jsonb := $baseline$__BASELINE__$baseline$::jsonb;
  c_cn_ids constant bigint[] := array[164, 163, 162, 161, 160, 159, 158, 233, 165, 495];
  c_inv3611 constant bigint := 614;
  c_dup_journal constant bigint := 1591;   -- JR001436, not linked: reverse
  c_keep_journal constant bigint := 1592;  -- JR001437, linked: keep
  c_bill_ids constant bigint[] := array[63, 69];
  -- Planned net movement (debit − credit) of everything this run posts,
  -- per FY2027 period and account (PLAN 2.4 + 2.5).
  c_expected constant jsonb := '{
    "1|1100": -30008.80, "1|2200": 3914.20, "1|4100": 26094.60,
    "3|1100": -7457.52,  "3|2200": 972.72,  "3|4100": 6484.80,
    "4|1100": -3312.00,  "4|2200": 432.00,  "4|4100": 2880.00,
    "5|1100": -637.56,   "5|2200": 83.16,   "5|4100": 554.40,
    "6|1100": -4197.50,  "6|2200": 547.50,  "6|4100": 597.20, "6|4000": 3052.80
  }'::jsonb;
  v_approver text := btrim(coalesce(current_setting('precisia.repair_approver', true), ''));
  v_reference text := btrim(coalesce(current_setting('precisia.repair_approval_reference', true), ''));
  v_actor text;
  v_live jsonb;
  v_diff text;
  v_batch bigint;
  v_doc sales_invoices;
  v_j ae_journals;
  v_line ae_journal_lines;
  v_rev bigint;
  v_new bigint;
  v_new_line bigint;
  v_number text;
  v_map jsonb := '{}'::jsonb;          -- original journal id -> reversal journal id
  v_run_journals bigint[] := '{}';
  v_label text;
  v_period int;
  v_net numeric;
  v_vat numeric;
  v_gross numeric;
  v_desc text;
  v_ref text;
  v_before jsonb;
  v_after jsonb;
  v_updated int;
  v_acc jsonb;
  v_got jsonb;
  v_check record;
begin
  -- -------------------------------------------------------------------
  -- 0. Preconditions
  -- -------------------------------------------------------------------
  if v_approver = '' or v_approver like '%\_\_%' or v_reference = '' or v_reference like '%\_\_%' then
    raise exception 'PRECISIA_REPAIR_NO_APPROVER: set precisia.repair_approver AND precisia.repair_approval_reference (the accountant''s name and the approval reference) before running %.', c_run;
  end if;
  v_actor := left(v_approver || ' (approval ' || v_reference || ')', 200);
  if exists (select 1 from automation_audit_log where company_id = c_company and reason like c_run || ':%') then
    raise exception 'PRECISIA_REPAIR_ALREADY_APPLIED: % has already been applied to this company; nothing was changed.', c_run;
  end if;
  if to_regprocedure('fn_bank_unposting_next_number(uuid,text)') is null then
    raise exception 'PRECISIA_REPAIR_PREREQUISITE: fn_bank_unposting_next_number (0120) is missing.';
  end if;

  -- Lock every row this run reads or changes, lowest id first.
  perform 1 from sales_invoices where company_id = c_company and id = any(c_cn_ids || c_inv3611) order by id for update;
  perform 1 from ae_journals where company_id = c_company and id in (select (j->>'id')::bigint from jsonb_array_elements(c_base->'journals') j) order by id for update;
  perform 1 from ae_imported_bills where company_id = c_company and id = any(c_bill_ids) order by id for update;

  -- -------------------------------------------------------------------
  -- 1. Baseline: every affected row exactly as captured
  -- -------------------------------------------------------------------
  for v_check in
    select * from (values
      ('docs', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from (
          select id, company_id, customer_id, invoice_number, document_type, status, invoice_date, subtotal, vat_amount, total, outstanding, journal_id, original_invoice_id, reference
            from sales_invoices where company_id = c_company and id = any(c_cn_ids || c_inv3611)) x)),
      ('lines', (select coalesce(jsonb_agg(to_jsonb(x) order by x.invoice_id, x.line_order, x.id), '[]') from (
          select id, invoice_id, line_order, quantity, unit_price, discount, net_amount, vat_amount, line_total
            from sales_invoice_lines where invoice_id = any(c_cn_ids || c_inv3611)) x)),
      ('journals', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from (
          select id, company_id, journal_number, journal_date, journal_type, status, is_reversed, reversed_by_journal_id, reversal_of_journal_id, source_type, source_id, total_debit, total_credit, posting_batch_id, reference, description
            from ae_journals where company_id = c_company and id in (select (j->>'id')::bigint from jsonb_array_elements(c_base->'journals') j)) x)),
      ('jlines', (select coalesce(jsonb_agg(to_jsonb(x) order by x.journal_id, x.line_order, x.id), '[]') from (
          select id, journal_id, account_code, debit, credit, line_order, description
            from ae_journal_lines where journal_id in (select (j->>'id')::bigint from jsonb_array_elements(c_base->'journals') j)) x)),
      ('gl', (select coalesce(jsonb_agg(to_jsonb(x) order by x.journal_id, x.id), '[]') from (
          select id, journal_id, journal_line_id, account_id, posting_date, debit, credit, financial_year_label, financial_period, reference, description
            from gl_transactions where company_id = c_company and journal_id in (select (j->>'id')::bigint from jsonb_array_elements(c_base->'journals') j)) x)),
      ('bills', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from (
          select id, company_id, supplier_id, invoice_number, document_type, status, posting_status, journal_id, invoice_date, vat, total, outstanding, gl_account
            from ae_imported_bills where company_id = c_company and id = any(c_bill_ids)) x)),
      ('blines', (select coalesce(jsonb_agg(to_jsonb(x) order by x.bill_id, x.id), '[]') from (
          select id, bill_id, line_order, quantity, unit_cost, discount, net_amount, vat_amount, line_total, gl_account
            from ae_purchase_bill_lines where bill_id = any(c_bill_ids)) x)),
      ('accounts', (select coalesce(jsonb_agg(to_jsonb(x) order by x.account_code), '[]') from (
          select id, account_code, account_type, is_active
            from chart_of_accounts where company_id = c_company and account_code in ('1100', '2200', '4000', '4100')) x)),
      ('fy', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from (
          select id, year_label, start_date, end_date, status, lock_date from financial_years where company_id = c_company) x)),
      ('journalsBySource', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from (
          select id, journal_number, source_id, status, is_reversed
            from ae_journals where company_id = c_company and source_type = 'sales_invoice' and source_id = any(c_cn_ids || c_inv3611)) x)),
      ('existingReversals', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from (
          select id, source_id from ae_journals where company_id = c_company and source_type = 'journal_reversal'
            and source_id in (select (j->>'id')::bigint from jsonb_array_elements(c_base->'journals') j)) x))
    ) t(name, live)
  loop
    if v_check.live is distinct from c_base->v_check.name then
      select string_agg(e::text, ' | ') into v_diff
        from (select e from jsonb_array_elements(v_check.live) e except select e from jsonb_array_elements(c_base->v_check.name) e limit 3) s;
      raise exception 'PRECISIA_REPAIR_BASELINE_MISMATCH: % differs from the approved baseline (live % rows, baseline % rows). First differences: %',
        v_check.name, jsonb_array_length(v_check.live), jsonb_array_length(c_base->v_check.name), coalesce(v_diff, '(order or missing rows)');
    end if;
  end loop;

  v_acc := (select jsonb_object_agg(account_code, id) from chart_of_accounts where company_id = c_company and account_code in ('1100', '2200', '4000', '4100'));

  -- -------------------------------------------------------------------
  -- 2. One posting batch for the whole run
  -- -------------------------------------------------------------------
  insert into posting_batches (company_id, batch_number, posting_date, journal_count, transaction_count, posted_by)
  values (c_company, fn_bank_unposting_next_number(c_company, 'PB'), current_date, 0, 0, v_actor)
  returning id into v_batch;

  -- -------------------------------------------------------------------
  -- 3. Reverse the 10 credit-note journals and JR001436 (mirror shape)
  -- -------------------------------------------------------------------
  for v_j in
    select * from ae_journals
      where company_id = c_company
        and id in (select journal_id from sales_invoices where company_id = c_company and id = any(c_cn_ids)
                   union all select c_dup_journal)
      order by journal_date, id
  loop
    v_number := fn_bank_unposting_next_number(c_company, 'JR');
    insert into ae_journals (
      company_id, journal_number, journal_date, journal_type, description, reference,
      source_type, source_id, status, total_debit, total_credit, posted_at,
      submitted_by, submitted_at, approved_by, approved_at, posting_batch_id, reversal_of_journal_id
    ) values (
      c_company, v_number, v_j.journal_date, 'Reversal',
      format('Reversal of %s (%s: %s)', v_j.journal_number, c_run, case when v_j.id = c_dup_journal then 'duplicate posting of INV-3611' else 'credit note posted with inverted signs' end),
      coalesce(v_j.reference, ''), 'journal_reversal', v_j.id, 'Posted', v_j.total_credit, v_j.total_debit, now(),
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
        from gl_transactions g
        where g.company_id = c_company and g.journal_id = v_j.id and g.journal_line_id = v_line.id
        order by g.id;
    end loop;

    if (select (coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)) from gl_transactions where journal_id = v_rev)
       is distinct from (select (coalesce(sum(credit), 0), coalesce(sum(debit), 0), count(*)) from gl_transactions where journal_id = v_j.id) then
      raise exception 'PRECISIA_REPAIR_MIRROR: the reversal of % does not mirror its ledger rows.', v_j.journal_number;
    end if;

    update ae_journals set is_reversed = true, reversed_by_journal_id = v_rev
      where company_id = c_company and id = v_j.id and not is_reversed and reversed_by_journal_id is null;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'PRECISIA_REPAIR_RACE: % was reversed concurrently.', v_j.journal_number;
    end if;

    v_map := v_map || jsonb_build_object(v_j.id::text, v_rev);
    v_run_journals := v_run_journals || v_rev;
  end loop;

  -- -------------------------------------------------------------------
  -- 4. Credit notes: re-sign the document, post the correct journal, link
  -- -------------------------------------------------------------------
  for v_doc in select * from sales_invoices where company_id = c_company and id = any(c_cn_ids) order by invoice_date, id loop
    select * into v_j from ae_journals where id = v_doc.journal_id;
    select financial_year_label, financial_period into v_label, v_period from gl_transactions where journal_id = v_j.id limit 1;
    v_net := -v_doc.subtotal;
    v_vat := -v_doc.vat_amount;
    v_gross := -v_doc.total;
    if v_net <= 0 or v_vat < 0 or v_gross <= 0 or v_net + v_vat <> v_gross then
      raise exception 'PRECISIA_REPAIR_AMOUNTS: % does not re-sign to a valid credit note (net %, VAT %, gross %).', v_doc.invoice_number, v_net, v_vat, v_gross;
    end if;

    v_before := jsonb_build_object(
      'document', (select to_jsonb(x) from (select subtotal, vat_amount, total, outstanding, journal_id from sales_invoices where id = v_doc.id) x),
      'lines', (select jsonb_agg(to_jsonb(x) order by x.line_order, x.id) from (select id, line_order, quantity, unit_price, net_amount, vat_amount, line_total from sales_invoice_lines where invoice_id = v_doc.id) x));

    v_ref := coalesce(nullif(v_doc.reference, ''), v_doc.invoice_number);
    v_desc := format('Credit Note %s', v_doc.invoice_number);
    v_number := fn_bank_unposting_next_number(c_company, 'JR');
    insert into ae_journals (
      company_id, journal_number, journal_date, journal_type, description, reference,
      source_type, source_id, status, total_debit, total_credit, posted_at,
      submitted_by, submitted_at, approved_by, approved_at, posting_batch_id
    ) values (
      c_company, v_number, v_doc.invoice_date, 'Credit Note',
      format('Credit Note %s%s — sign corrected (%s, replaces %s)', v_doc.invoice_number, case when v_doc.reference <> '' then ' — ' || v_doc.reference else '' end, c_run, v_j.journal_number),
      v_ref, 'sales_invoice', v_doc.id, 'Posted', v_gross, v_gross, now(),
      v_actor, now(), v_actor, now(), v_batch
    ) returning id into v_new;

    insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order) values (v_new, '4100', v_net, 0, v_desc, 0) returning id into v_new_line;
    insert into gl_transactions (company_id, journal_id, journal_line_id, account_id, posting_date, reference, description, debit, credit, financial_year_label, financial_period, posted_by)
    values (c_company, v_new, v_new_line, (v_acc->>'4100')::bigint, v_doc.invoice_date, v_ref, v_desc, v_net, 0, v_label, v_period, v_actor);
    if v_vat > 0 then
      insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order) values (v_new, '2200', v_vat, 0, v_desc, 1) returning id into v_new_line;
      insert into gl_transactions (company_id, journal_id, journal_line_id, account_id, posting_date, reference, description, debit, credit, financial_year_label, financial_period, posted_by)
      values (c_company, v_new, v_new_line, (v_acc->>'2200')::bigint, v_doc.invoice_date, v_ref, v_desc, v_vat, 0, v_label, v_period, v_actor);
    end if;
    insert into ae_journal_lines (journal_id, account_code, debit, credit, description, line_order) values (v_new, '1100', 0, v_gross, v_desc, 2) returning id into v_new_line;
    insert into gl_transactions (company_id, journal_id, journal_line_id, account_id, posting_date, reference, description, debit, credit, financial_year_label, financial_period, posted_by)
    values (c_company, v_new, v_new_line, (v_acc->>'1100')::bigint, v_doc.invoice_date, v_ref, v_desc, 0, v_gross, v_label, v_period, v_actor);

    update sales_invoice_lines
       set unit_price = -unit_price, net_amount = -net_amount, vat_amount = -vat_amount, line_total = -line_total
     where invoice_id = v_doc.id;
    update sales_invoices
       set subtotal = -subtotal, vat_amount = -vat_amount, total = -total, outstanding = -outstanding, journal_id = v_new
     where company_id = c_company and id = v_doc.id and journal_id = v_j.id;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'PRECISIA_REPAIR_RACE: % changed while being corrected.', v_doc.invoice_number;
    end if;

    v_after := jsonb_build_object(
      'document', (select to_jsonb(x) from (select subtotal, vat_amount, total, outstanding, journal_id from sales_invoices where id = v_doc.id) x),
      'lines', (select jsonb_agg(to_jsonb(x) order by x.line_order, x.id) from (select id, line_order, quantity, unit_price, net_amount, vat_amount, line_total from sales_invoice_lines where invoice_id = v_doc.id) x));
    insert into automation_audit_log (company_id, performed_by, action_type, reason, changes, journal_ids, document_type, document_id, is_reversible)
    values (c_company, v_actor, 'SalesCreditNoteSignCorrected',
      format('%s: %s re-signed to positive figures; %s reversed by %s; correct journal %s posted (DR 4100 %s, DR 2200 %s, CR 1100 %s).',
        c_run, v_doc.invoice_number, v_j.journal_number, (select journal_number from ae_journals where id = (v_map->>v_j.id::text)::bigint), v_number,
        to_char(v_net, 'FM999999990.00'), to_char(v_vat, 'FM999999990.00'), to_char(v_gross, 'FM999999990.00')),
      jsonb_build_object('run', c_run, 'before', v_before, 'after', v_after,
        'originalJournal', v_j.id, 'reversalJournal', (v_map->>v_j.id::text)::bigint, 'correctJournal', v_new),
      array[v_j.id, (v_map->>v_j.id::text)::bigint, v_new], 'SalesInvoice', v_doc.id, true);

    v_run_journals := v_run_journals || v_new;
  end loop;

  -- -------------------------------------------------------------------
  -- 5. INV-3611: audit the reversal of the duplicate; JR001437 untouched
  -- -------------------------------------------------------------------
  insert into automation_audit_log (company_id, performed_by, action_type, reason, changes, journal_ids, document_type, document_id, is_reversible)
  values (c_company, v_actor, 'SalesInvoiceDuplicateJournalReversed',
    format('%s: INV-3611 duplicate journal JR001436 reversed by %s; linked journal JR001437 kept.', c_run, (select journal_number from ae_journals where id = (v_map->>c_dup_journal::text)::bigint)),
    jsonb_build_object('run', c_run, 'duplicateJournal', c_dup_journal, 'reversalJournal', (v_map->>c_dup_journal::text)::bigint, 'keptJournal', c_keep_journal),
    array[c_dup_journal, (v_map->>c_dup_journal::text)::bigint], 'SalesInvoice', c_inv3611, true);

  -- -------------------------------------------------------------------
  -- 6. Supplier credit notes: re-sign only (no approval, no journal)
  -- -------------------------------------------------------------------
  for v_check in select id, invoice_number from ae_imported_bills where company_id = c_company and id = any(c_bill_ids) order by id loop
    v_before := jsonb_build_object(
      'bill', (select to_jsonb(x) from (select vat, total, outstanding, status, posting_status, journal_id from ae_imported_bills where id = v_check.id) x),
      'lines', (select jsonb_agg(to_jsonb(x) order by x.id) from (select id, quantity, unit_cost, net_amount, vat_amount, line_total from ae_purchase_bill_lines where bill_id = v_check.id) x));
    update ae_purchase_bill_lines set unit_cost = -unit_cost, net_amount = -net_amount, vat_amount = -vat_amount, line_total = -line_total where bill_id = v_check.id;
    update ae_imported_bills set vat = -vat, total = -total, outstanding = -outstanding
     where company_id = c_company and id = v_check.id and status = 'Open' and posting_status = 'Draft' and journal_id is null;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'PRECISIA_REPAIR_RACE: supplier credit note % changed while being corrected.', v_check.invoice_number;
    end if;
    v_after := jsonb_build_object(
      'bill', (select to_jsonb(x) from (select vat, total, outstanding, status, posting_status, journal_id from ae_imported_bills where id = v_check.id) x),
      'lines', (select jsonb_agg(to_jsonb(x) order by x.id) from (select id, quantity, unit_cost, net_amount, vat_amount, line_total from ae_purchase_bill_lines where bill_id = v_check.id) x));
    insert into automation_audit_log (company_id, performed_by, action_type, reason, changes, journal_ids, document_type, document_id, is_reversible)
    values (c_company, v_actor, 'SupplierCreditNoteSignCorrected',
      format('%s: supplier credit note %s re-signed to positive figures; not approved, not posted.', c_run, v_check.invoice_number),
      jsonb_build_object('run', c_run, 'before', v_before, 'after', v_after), '{}', 'PurchaseBill', v_check.id, true);
  end loop;

  update posting_batches
     set journal_count = cardinality(v_run_journals),
         transaction_count = (select count(*) from gl_transactions where journal_id = any(v_run_journals))
   where id = v_batch;

  -- -------------------------------------------------------------------
  -- 7. Postconditions
  -- -------------------------------------------------------------------
  if cardinality(v_run_journals) <> 21 or exists (
      select 1 from ae_journals where id = any(v_run_journals) and (status <> 'Posted' or is_reversed or posting_batch_id <> v_batch)) then
    raise exception 'PRECISIA_REPAIR_POST: expected 21 Posted journals in batch %.', v_batch;
  end if;
  if exists (select 1 from gl_transactions where journal_id = any(v_run_journals) group by journal_id having sum(debit) <> sum(credit)) then
    raise exception 'PRECISIA_REPAIR_POST: a correction journal is unbalanced.';
  end if;
  select coalesce(jsonb_object_agg(k, v), '{}') into v_got from (
    select g.financial_period || '|' || a.account_code as k, sum(g.debit - g.credit) as v
      from gl_transactions g join chart_of_accounts a on a.id = g.account_id
      where g.journal_id = any(v_run_journals)
      group by g.financial_period, a.account_code
      having sum(g.debit - g.credit) <> 0) s;
  if v_got <> c_expected then
    raise exception 'PRECISIA_REPAIR_POST: ledger movement % differs from the plan %.', v_got, c_expected;
  end if;
  if exists (select 1 from sales_invoices where company_id = c_company and id = any(c_cn_ids)
               and (subtotal < 0 or vat_amount < 0 or total < 0 or outstanding < 0
                    or journal_id not in (select unnest(v_run_journals)))) then
    raise exception 'PRECISIA_REPAIR_POST: a credit note is not positive or not linked to its correct journal.';
  end if;
  if exists (select 1 from sales_invoice_lines where invoice_id = any(c_cn_ids) and (unit_price < 0 or net_amount < 0 or vat_amount < 0 or line_total < 0)) then
    raise exception 'PRECISIA_REPAIR_POST: a credit-note line is still negative.';
  end if;
  if exists (select source_id from ae_journals where company_id = c_company and source_type = 'sales_invoice' and source_id = any(c_cn_ids || c_inv3611)
               and not is_reversed and status not in ('Rejected', 'Cancelled') group by source_id having count(*) <> 1) then
    raise exception 'PRECISIA_REPAIR_POST: a document does not have exactly one live journal.';
  end if;
  if (select journal_id from sales_invoices where id = c_inv3611) <> c_keep_journal
     or (select (status, is_reversed, posting_batch_id) from ae_journals where id = c_keep_journal) is distinct from ('Posted'::text, false, 944::bigint) then
    raise exception 'PRECISIA_REPAIR_POST: INV-3611 or JR001437 changed.';
  end if;
  if exists (select 1 from ae_imported_bills where id = any(c_bill_ids) and (status <> 'Open' or posting_status <> 'Draft' or journal_id is not null or vat < 0 or total < 0)) then
    raise exception 'PRECISIA_REPAIR_POST: a supplier credit note is not positive or was approved/posted.';
  end if;
  if (select count(*) from automation_audit_log where company_id = c_company and reason like c_run || ':%') <> 13 then
    raise exception 'PRECISIA_REPAIR_POST: expected 13 audit entries.';
  end if;

  raise notice '% applied: batch %, % journals, ledger movement %', c_run, v_batch, cardinality(v_run_journals), v_got;
end;
$repair$;
