#!/usr/bin/env bash
# METANOIA-CORR-2026-10 — tests against the LOCAL replica database `repair_test`
# (container supabase_db_precisia-unpost). NEVER point this at production.
# Uses the exact wrapper files that would run in production.
set -uo pipefail
export MSYS_NO_PATHCONV=1
C="${SUPABASE_DB_CONTAINER:-supabase_db_precisia-unpost}"
DB=repair_test
DIR="$(cd "$(dirname "$0")" && pwd)"
CO="'45b3d2a0-3973-4587-a043-0e05d8d9bff3'"
APPROVER="Local test approver (TEST ONLY)"
PASS=0; FAIL=0

[ "$(docker exec "$C" psql -U postgres -d $DB -tAX -c "select current_database()")" = "repair_test" ] || { echo "not the replica database"; exit 2; }
q() { docker exec -i "$C" psql -U postgres -d $DB -tAX -v ON_ERROR_STOP=1 -c "$1"; }
run_file() { docker exec -i "$C" psql -U postgres -d $DB -v ON_ERROR_STOP=1 -tAX < "$1" 2>&1; }
run_text() { docker exec -i "$C" psql -U postgres -d $DB -v ON_ERROR_STOP=1 -tAX 2>&1; }
ok() { if [ "$1" = "true" ]; then PASS=$((PASS+1)); echo "PASS: $2"; else FAIL=$((FAIL+1)); echo "FAIL: $2 ${3:-}"; fi; }
REFERENCE="TEST-REF-001"
with_approver() { sed -e "s/__APPROVER_NAME__/$APPROVER/" -e "s/__APPROVAL_REFERENCE__/$REFERENCE/" "$1"; }

SNAP="select md5(string_agg(t, '|' order by t)) from (
  select 'si' || to_jsonb(s)::text t from sales_invoices s where company_id = $CO
  union all select 'sil' || to_jsonb(l)::text from sales_invoice_lines l where invoice_id in (select id from sales_invoices where company_id = $CO)
  union all select 'j' || (to_jsonb(j) - 'created_at')::text from ae_journals j where company_id = $CO
  union all select 'jl' || (to_jsonb(l) - 'created_at')::text from ae_journal_lines l where journal_id in (select id from ae_journals where company_id = $CO)
  union all select 'gl' || to_jsonb(g)::text from gl_transactions g where company_id = $CO
  union all select 'pb' || to_jsonb(p)::text from posting_batches p where company_id = $CO
  union all select 'b' || to_jsonb(b)::text from ae_imported_bills b where company_id = $CO
  union all select 'bl' || to_jsonb(l)::text from ae_purchase_bill_lines l where company_id = $CO
  union all select 'a' || to_jsonb(a)::text from automation_audit_log a where company_id = $CO) x;"
# Original 12 journals' lines and ledger rows (must never be edited) and JR001437 in full.
ORIG="select md5(string_agg(t, '|' order by t)) from (
  select 'jl' || (to_jsonb(l) - 'created_at')::text t from ae_journal_lines l where journal_id in (1050,1080,1223,1343,1346,1347,1359,1369,1375,1546,1591,1592)
  union all select 'gl' || to_jsonb(g)::text from gl_transactions g where journal_id in (1050,1080,1223,1343,1346,1347,1359,1369,1375,1546,1591,1592)
  union all select 'keep' || (to_jsonb(j) - 'created_at')::text from ae_journals j where id = 1592
  union all select 'noise' || (to_jsonb(j) - 'created_at')::text from ae_journals j where id in (1383, 1384, 1700)) x"
LEDGER="select coalesce(jsonb_object_agg(k, v), '{}') from (select 'P' || g.financial_period || ' ' || a.account_code k, sum(g.debit - g.credit) v
  from gl_transactions g join chart_of_accounts a on a.id = g.account_id where g.company_id = $CO group by 1) s;"

S0=$(q "$SNAP"); O0=$(q "$ORIG"); L0=$(q "$LEDGER")
echo "baseline snapshot $S0"

# T1 dry run
out=$(run_file "$DIR/repair-dryrun.sql")
ok "$(echo "$out" | grep -q 'METANOIA-CORR-2026-10 applied' && echo true)" "T1 dry run completes the whole correction (all postconditions pass)" "$(echo "$out" | grep -E 'ERROR' | head -2)"
ok "$([ "$(q "$SNAP")" = "$S0" ] && echo true)" "T1 dry run changes nothing"

# T2 no approver
out=$(run_file "$DIR/repair-apply.sql")
ok "$(echo "$out" | grep -q PRECISIA_REPAIR_NO_APPROVER && echo true)" "T2 apply refuses to run without an approver"
ok "$([ "$(q "$SNAP")" = "$S0" ] && echo true)" "T2 nothing written"
out=$(sed -e "s/__APPROVER_NAME__/$APPROVER/" "$DIR/repair-apply.sql" | run_text)
ok "$(echo "$out" | grep -q PRECISIA_REPAIR_NO_APPROVER && [ "$(q "$SNAP")" = "$S0" ] && echo true)" "T2 approver name without an approval reference is refused, nothing written"
out=$(sed -e "s/__APPROVAL_REFERENCE__/$REFERENCE/" "$DIR/repair-apply.sql" | run_text)
ok "$(echo "$out" | grep -q PRECISIA_REPAIR_NO_APPROVER && [ "$(q "$SNAP")" = "$S0" ] && echo true)" "T2 approval reference without an approver name is refused, nothing written"
out=$(run_file "$DIR/repair-baseline-check.sql")
ok "$(echo "$out" | awk -F'|' 'NF>=5{n++; if($2!="t"||$5!="f")bad=1} END{print (n==11&&!bad)?"true":""}')" "B1 read-only baseline check: all 11 sets match, not yet applied" "$out"
q "update sales_invoice_lines set net_amount = net_amount + 0.01 where id = 1094" >/dev/null
out=$(run_file "$DIR/repair-baseline-check.sql")
ok "$(echo "$out" | awk -F'|' '$1=="lines"&&$2=="f"{f=1} $1!="lines"&&$2!="t"{bad=1} END{print (f&&!bad)?"true":""}')" "B2 baseline check names exactly the changed set (lines) after a one-cent change" "$out"
q "update sales_invoice_lines set net_amount = net_amount - 0.01 where id = 1094" >/dev/null
ok "$([ "$(q "$SNAP")" = "$S0" ] && echo true)" "B3 baseline check writes nothing"

# T3 altered baseline: each alteration aborts the whole run
tamper() { # $1 label, $2 alter sql, $3 revert sql, $4 expected error
  q "$2" >/dev/null; local st; st=$(q "$SNAP")
  out=$(with_approver "$DIR/repair-apply.sql" | run_text)
  ok "$(echo "$out" | grep -q "$4" && [ "$(q "$SNAP")" = "$st" ] && echo true)" "T3 $1: refused, nothing written" "$(echo "$out" | grep ERROR | head -1)"
  q "$3" >/dev/null
}
tamper "a credit-note line differs by one cent" "update sales_invoice_lines set net_amount = net_amount + 0.01 where id = 1094" "update sales_invoice_lines set net_amount = net_amount - 0.01 where id = 1094" "BASELINE_MISMATCH: lines"
tamper "a ledger row differs" "update gl_transactions set debit = debit - 0.01 where id = 4518" "update gl_transactions set debit = debit + 0.01 where id = 4518" "BASELINE_MISMATCH: gl"
tamper "JR001437 (the journal to keep) changed" "update ae_journals set description = description || ' x' where id = 1592" "update ae_journals set description = left(description, length(description) - 2) where id = 1592" "BASELINE_MISMATCH: journals"
tamper "a supplier credit note was approved" "update ae_imported_bills set posting_status = 'Approved' where id = 63" "update ae_imported_bills set posting_status = 'Draft' where id = 63" "BASELINE_MISMATCH: bills"
tamper "an extra journal exists for CN-3607" "insert into ae_journals (id, company_id, journal_number, journal_date, source_type, source_id, status) overriding system value values (8888, $CO, 'X-1', '2026-08-06', 'sales_invoice', 495, 'Cancelled')" "delete from ae_journals where id = 8888" "BASELINE_MISMATCH: journalsBySource"
tamper "JR001436 already reversed elsewhere" "update ae_journals set is_reversed = true where id = 1591" "alter table ae_journals disable trigger user; update ae_journals set is_reversed = false where id = 1591; alter table ae_journals enable trigger user" "BASELINE_MISMATCH: journals"
tamper "the financial year was locked" "update financial_years set lock_date = '2026-09-30' where company_id = $CO" "update financial_years set lock_date = null where company_id = $CO" "BASELINE_MISMATCH: fy"
ok "$([ "$(q "$SNAP")" = "$S0" ] && echo true)" "T3 replica back to the baseline after the alterations"

# T4 apply
out=$(with_approver "$DIR/repair-apply.sql" | run_text)
ok "$(echo "$out" | grep -q 'METANOIA-CORR-2026-10 applied' && echo true)" "T4 apply succeeds with an approver" "$(echo "$out" | grep ERROR | head -2)"
echo "$out" | grep -E '^\{' > "$DIR/repair-test-apply-summary.json" || true
S1=$(q "$SNAP"); L1=$(q "$LEDGER")

# T5 independent verification of the applied state
v() { local r; r=$(q "$1" 2>&1); ok "$([ "$r" = t ] && echo true)" "$2" "$r"; }
v "select bool_and(ok) from (values
  (164, 1008.90, 151.34, 1160.24, 0.00), (163, 4693.95, 704.09, 5398.04, 0.00), (162, 1162.80, 174.42, 1337.22, 0.00),
  (161, 324.90, 48.74, 373.64, 0.00), (160, 4693.95, 704.09, 5398.04, 0.00), (159, 1162.80, 174.42, 1337.22, 0.00),
  (158, 3242.40, 486.36, 3728.76, 0.00), (233, 1440.00, 216.00, 1656.00, 10.00), (165, 277.20, 41.58, 318.78, 0.00), (495, 298.60, 44.79, 343.39, 343.39)) e(id, n, vt, g, o)
  cross join lateral (select s.subtotal = e.n and s.vat_amount = e.vt and s.total = e.g and s.outstanding = e.o as ok from sales_invoices s where s.id = e.id) x" \
  "T5 every credit note now carries the planned positive net, VAT, total and outstanding (CN-3406 10.00, CN-3607 343.39)"
v "select bool_and(x.ok) from sales_invoices s cross join lateral (
     select (select jsonb_agg(jsonb_build_array(account_code, debit, credit) order by line_order) from ae_journal_lines where journal_id = s.journal_id)
          = jsonb_build_array(jsonb_build_array('4100', s.subtotal, 0), jsonb_build_array('2200', s.vat_amount, 0), jsonb_build_array('1100', 0, s.total)) as ok) x
   where s.id in (164,163,162,161,160,159,158,233,165,495)" \
  "T5 each credit note is linked to a new journal: DR 4100 net / DR 2200 VAT / CR 1100 gross"
v "select bool_and(j.status = 'Posted' and not j.is_reversed and j.journal_date = s.invoice_date and j.source_type = 'sales_invoice' and j.source_id = s.id) from sales_invoices s join ae_journals j on j.id = s.journal_id where s.id in (164,163,162,161,160,159,158,233,165,495)" \
  "T5 ... Posted, unreversed, dated at the credit-note date, sourced to the credit note"
v "select bool_and(o.is_reversed and r.status = 'Posted' and r.journal_type = 'Reversal' and r.reversal_of_journal_id = o.id and r.journal_date = o.journal_date
     and (select jsonb_agg(jsonb_build_array(account_code, debit, credit) order by line_order, id) from ae_journal_lines where journal_id = r.id)
       = (select jsonb_agg(jsonb_build_array(account_code, credit, debit) order by line_order, id) from ae_journal_lines where journal_id = o.id)
     and (select jsonb_agg(jsonb_build_array(account_id, posting_date, debit, credit, financial_year_label, financial_period) order by journal_line_id) from gl_transactions where journal_id = r.id)
       = (select jsonb_agg(jsonb_build_array(g.account_id, g.posting_date, g.credit, g.debit, g.financial_year_label, g.financial_period) order by m.id)
            from gl_transactions g join ae_journal_lines ol on ol.id = g.journal_line_id
            join ae_journal_lines m on m.journal_id = r.id and m.line_order = ol.line_order and m.account_code = ol.account_code where g.journal_id = o.id))
   from ae_journals o join ae_journals r on r.id = o.reversed_by_journal_id where o.id in (1050,1080,1223,1343,1346,1347,1359,1369,1375,1546,1591)" \
  "T5 all 11 wrong journals (10 credit notes + JR001436) are reversed by an exact mirror, same date, same period, posted"
v "select '$O0' = ($ORIG)" "T5 no original journal line or ledger row was edited; JR001437, JR001233, JR001234 and the unrelated journal untouched"
v "select (select journal_id from sales_invoices where id = 614) = 1592 and (select count(*) from ae_journals where source_type = 'sales_invoice' and source_id = 614 and not is_reversed) = 1" \
  "T5 INV-3611 keeps JR001437 as its only live journal"
v "select (select jsonb_object_agg(k, v) from (select 'P' || g.financial_period || ' ' || a.account_code k, sum(g.debit - g.credit) v from gl_transactions g join chart_of_accounts a on a.id = g.account_id
     where g.company_id = $CO and g.journal_id in (select id from ae_journals where posting_batch_id = (select posting_batch_id from ae_journals where id = (select journal_id from sales_invoices where id = 495))) group by 1 having sum(g.debit - g.credit) <> 0) s)
   = '{\"P1 1100\": -30008.80, \"P1 2200\": 3914.20, \"P1 4100\": 26094.60, \"P3 1100\": -7457.52, \"P3 2200\": 972.72, \"P3 4100\": 6484.80, \"P4 1100\": -3312.00, \"P4 2200\": 432.00, \"P4 4100\": 2880.00, \"P5 1100\": -637.56, \"P5 2200\": 83.16, \"P5 4100\": 554.40, \"P6 1100\": -4197.50, \"P6 2200\": 547.50, \"P6 4100\": 597.20, \"P6 4000\": 3052.80}'::jsonb" \
  "T5 ledger movement per month and account equals the plan exactly"
v "select sum(debit) = sum(credit) from gl_transactions where company_id = $CO" "T5 whole ledger still balances (total debits = total credits)"
v "select (select jsonb_agg(jsonb_build_array(id, vat, total, outstanding, status, posting_status, journal_id) order by id) from ae_imported_bills where company_id = $CO)
   = '[[63, 70.94, 543.85, 0, \"Open\", \"Draft\", null], [69, 187.48, 1437.35, 0, \"Open\", \"Draft\", null]]'::jsonb
   and (select bool_and(unit_cost > 0 and net_amount > 0 and vat_amount > 0 and line_total > 0) from ae_purchase_bill_lines where bill_id in (63, 69))" \
  "T5 supplier credit notes positive and still Open / Draft with no journal (not approved, not posted)"
v "select (select jsonb_agg(journal_number order by id) from ae_journals where company_id = $CO and status = 'Approved') = '[\"JR001233\", \"JR001234\"]'::jsonb" \
  "T5 no Approved journal left behind; JR001233 / JR001234 untouched"
v "select (select count(*) from posting_batches where company_id = $CO) = 13 and (select (journal_count, transaction_count) from posting_batches where id = (select posting_batch_id from ae_journals where id = (select journal_id from sales_invoices where id = 495))) = (21, 63)" \
  "T5 one new posting batch: 21 journals, 63 ledger rows"
v "select (select jsonb_object_agg(action_type, n) from (select action_type, count(*) n from automation_audit_log where company_id = $CO group by 1) s)
   = '{\"SalesCreditNoteSignCorrected\": 10, \"SalesInvoiceDuplicateJournalReversed\": 1, \"SupplierCreditNoteSignCorrected\": 2}'::jsonb
   and (select bool_and(performed_by = '$APPROVER (approval $REFERENCE)' and changes ? 'before' or action_type = 'SalesInvoiceDuplicateJournalReversed') from automation_audit_log where company_id = $CO)" \
  "T5 13 audit entries (10 + 1 + 2) by the approver, with before/after"
v "select (select count(*) from ae_journals where company_id = $CO) = 15 + 21" "T5 history preserved: 15 journals before, 36 after (nothing deleted)"

# T6 repeat execution
out=$(with_approver "$DIR/repair-apply.sql" | run_text)
ok "$(echo "$out" | grep -q PRECISIA_REPAIR_ALREADY_APPLIED && [ "$(q "$SNAP")" = "$S1" ] && echo true)" "T6 running apply again is refused and changes nothing"
out=$(run_file "$DIR/repair-dryrun.sql")
ok "$(echo "$out" | grep -q PRECISIA_REPAIR_ALREADY_APPLIED && [ "$(q "$SNAP")" = "$S1" ] && echo true)" "T6 the dry run also refuses after apply"

# T7 0121 guards still hold on the corrected data
v "select (select tgenabled from pg_trigger where tgname = 'sales_invoices_sign_guard') = 'O'" "T7 0121 sign guard enabled"
out=$(q "insert into ae_journals (company_id, journal_number, journal_date, source_type, source_id, status) values ($CO, 'X-2', '2026-08-06', 'sales_invoice', 495, 'Approved')" 2>&1)
ok "$(echo "$out" | grep -q PRECISIA_SALES_JOURNAL_EXISTS && echo true)" "T7 a second live journal for a corrected credit note is still refused"

# T8 recovery (counter-correction)
out=$(run_file "$DIR/repair-recovery-dryrun.sql")
ok "$(echo "$out" | grep -q 'RECOVERY applied' && [ "$(q "$SNAP")" = "$S1" ] && echo true)" "T8 recovery dry run completes and changes nothing" "$(echo "$out" | grep ERROR | head -1)"
out=$(with_approver "$DIR/repair-recovery-apply.sql" | run_text)
ok "$(echo "$out" | grep -q 'RECOVERY applied' && echo true)" "T8 recovery apply succeeds" "$(echo "$out" | grep ERROR | head -2)"
ok "$([ "$(q "$LEDGER")" = "$L0" ] && echo true)" "T8 after recovery every account and period balance equals the pre-correction balance"
v "select (select count(*) from ae_journals where company_id = $CO) = 15 + 21 + 21" "T8 recovery deletes nothing: 15 + 21 correction + 21 recovery journals"
v "select bool_and(total < 0) from sales_invoices where id in (164,163,162,161,160,159,158,233,165,495)" "T8 credit notes back to their recorded (negative) figures"
v "select (select tgenabled from pg_trigger where tgname = 'sales_invoices_sign_guard') = 'O'" "T8 sign guard re-enabled after recovery"
S2=$(q "$SNAP")
out=$(with_approver "$DIR/repair-recovery-apply.sql" | run_text)
ok "$(echo "$out" | grep -q PRECISIA_RECOVERY_ALREADY_APPLIED && [ "$(q "$SNAP")" = "$S2" ] && echo true)" "T8 recovery cannot run twice"
out=$(with_approver "$DIR/repair-apply.sql" | run_text)
ok "$(echo "$out" | grep -q PRECISIA_REPAIR_ALREADY_APPLIED && [ "$(q "$SNAP")" = "$S2" ] && echo true)" "T8 the correction cannot be silently re-run after recovery (a new run id is required)"

echo "ledger before: $L0"
echo "ledger after correction: $L1"
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
