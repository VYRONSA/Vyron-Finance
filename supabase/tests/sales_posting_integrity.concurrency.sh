#!/usr/bin/env bash
# Migration 0121 — sales posting integrity and credit-note allocation under
# REAL concurrency.
#
# LOCAL / SYNTHETIC ONLY. Never run against a shared or production
# database. Needs 0121 applied to the target container.
#
# The companion suite `sales_posting_integrity.test.sql` runs in one
# rolled-back transaction and cannot race anything. This fires real,
# simultaneous connections and asserts:
#
#   1. MANY APPROVALS, ONE JOURNAL — 20 connections each try to create a
#      live journal for the same sales document; exactly one succeeds.
#   2. MANY ALLOCATIONS, ONE CREDIT — 10 connections each try to apply the
#      whole of one credit note (different request keys); exactly one
#      succeeds and the credit is never over-applied.
#   3. ONE REQUEST, MANY CLICKS — 10 connections send the same request key;
#      exactly one allocation is written, the rest are replays.
#   4. MIXED LOAD — 30 small allocations across two credit notes and two
#      invoices; no deadlock, and every balance equals its original minus
#      the allocations recorded against it.
#
#   SUPABASE_DB_CONTAINER=supabase_db_precisia-unpost ./supabase/tests/sales_posting_integrity.concurrency.sh
#
# It cleans up after itself (the synthetic company is deleted; its
# documents, journals, allocations and audit rows go with it).
set -euo pipefail
export MSYS_NO_PATHCONV=1

CONTAINER="${SUPABASE_DB_CONTAINER:-precisia-sd0-db}"
ORG="5f400000-0000-4000-8000-0000000022aa"
CO="5f400000-0000-4000-8000-0000000022a1"
UID_EDITOR="5f400000-0000-4000-8000-000000002201"
EMAIL="sp-race@synthetic.test"

psql_q() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAX -v ON_ERROR_STOP=1 -c "$1"; }
as_editor() {
  printf "set role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\",\"email\":\"%s\"}', false); select set_config('request.jwt.claim.sub', '%s', false); %s" \
    "$UID_EDITOR" "$EMAIL" "$UID_EDITOR" "$1"
}

cleanup() {
  psql_q "delete from companies where id = '$CO';" >/dev/null 2>&1 || true
  psql_q "delete from organisations where id = '$ORG';" >/dev/null 2>&1 || true
  psql_q "delete from auth.users where id = '$UID_EDITOR';" >/dev/null 2>&1 || true
  # Only ever the directory this script created (never the inherited
  # Windows TMP variable).
  case "${RACE_DIR:-}" in */sp-race.*) rm -rf "$RACE_DIR" ;; esac
}
trap cleanup EXIT
cleanup
RACE_DIR="$(mktemp -d -t sp-race.XXXXXX)"

fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "PASS: $1"; }

docker exec -i "$CONTAINER" psql -U postgres -d postgres -qtAX -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into auth.users (id, email, aud, role) values ('$UID_EDITOR', '$EMAIL', 'authenticated', 'authenticated');
insert into organisations (id, name) values ('$ORG', 'SP race org');
insert into companies (id, organisation_id, name, base_currency_code) values ('$CO', '$ORG', 'SP race company', 'ZAR');
insert into permission_roles (company_id, role_key, name) values ('$CO', 'sp_race', 'race');
insert into role_permissions (role_id, permission_key) select id, k from permission_roles, unnest(array['Sales:View', 'Sales:Edit', 'Sales:Approve']) k where company_id = '$CO';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by) select '$UID_EDITOR', '$CO', id, 'sp-race' from permission_roles where company_id = '$CO';
insert into customers (company_id, customer_code, name) values ('$CO', 'RACE', 'Race Customer');
insert into sales_invoices (company_id, customer_id, invoice_number, document_type, invoice_date, status, subtotal, vat_amount, total, outstanding)
select '$CO', (select id from customers where company_id = '$CO'), n, t, date '2026-08-06', s, net, vat, net + vat, net + vat
from (values ('RACE-INV-J', 'Invoice', 'Submitted', 100.00, 15.00), ('RACE-CN-1', 'Credit Note', 'Posted', 434.78, 65.22), ('RACE-CN-2', 'Credit Note', 'Posted', 434.78, 65.22),
             ('RACE-INV-1', 'Invoice', 'Posted', 869.57, 130.43), ('RACE-INV-2', 'Invoice', 'Posted', 869.57, 130.43), ('RACE-CN-3', 'Credit Note', 'Posted', 86.96, 13.04)) d(n, t, s, net, vat);
SQL
doc_id() { psql_q "select id from sales_invoices where company_id = '$CO' and invoice_number = '$1';"; }
outst() { psql_q "select outstanding from sales_invoices where company_id = '$CO' and invoice_number = '$1';"; }
J=$(doc_id RACE-INV-J); CN1=$(doc_id RACE-CN-1); CN2=$(doc_id RACE-CN-2); CN3=$(doc_id RACE-CN-3); INV1=$(doc_id RACE-INV-1); INV2=$(doc_id RACE-INV-2)

# 1. Twenty simultaneous journal creations for one document.
for i in $(seq 1 20); do
  psql_q "insert into ae_journals (company_id, journal_number, journal_date, journal_type, source_type, source_id, status) values ('$CO', 'RACE-J$i', date '2026-08-10', 'Invoice', 'sales_invoice', $J, 'Approved');" >"$RACE_DIR/j$i.out" 2>&1 &
done
wait
live=$(psql_q "select count(*) from ae_journals where company_id = '$CO' and source_type = 'sales_invoice' and source_id = $J;")
refused=$(grep -l PRECISIA_SALES_JOURNAL_EXISTS "$RACE_DIR"/j*.out | wc -l)
[ "$live" = "1" ] && [ "$refused" = "19" ] || fail "1: expected 1 journal and 19 refusals, got $live journal(s), $refused refusal(s)"
pass "1 twenty simultaneous approvals of one document: exactly one journal, nineteen refused"

# 2. Ten simultaneous allocations of the whole of RACE-CN-1 (500.00), different keys.
for i in $(seq 1 10); do
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAX -c "$(as_editor "select fn_allocate_sales_credit_note('$CO', $CN1, $INV1, 500.00, gen_random_uuid());")" >"$RACE_DIR/a$i.out" 2>&1 &
done
wait
won=$(grep -l '"replayed": false' "$RACE_DIR"/a*.out | wc -l)
over=$(grep -l PRECISIA_CN_ALLOCATION_OVER "$RACE_DIR"/a*.out | wc -l)
[ "$won" = "1" ] && [ "$over" = "9" ] || fail "2: expected 1 allocation and 9 over-allocation refusals, got $won / $over"
[ "$(outst RACE-CN-1)" = "0.00" ] && [ "$(outst RACE-INV-1)" = "500.00" ] || fail "2: balances CN $(outst RACE-CN-1) INV $(outst RACE-INV-1)"
pass "2 ten simultaneous full allocations of one credit note: one applied, nine refused, never over-applied"

# 3. Ten simultaneous sends of ONE request.
KEY=$(psql_q "select gen_random_uuid();")
for i in $(seq 1 10); do
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAX -c "$(as_editor "select fn_allocate_sales_credit_note('$CO', $CN3, $INV2, 100.00, '$KEY');")" >"$RACE_DIR/k$i.out" 2>&1 &
done
wait
rows=$(psql_q "select count(*) from sales_credit_note_allocations where company_id = '$CO' and request_key = '$KEY';")
replays=$(grep -l '"replayed": true' "$RACE_DIR"/k*.out | wc -l)
firsts=$(grep -l '"replayed": false' "$RACE_DIR"/k*.out | wc -l)
[ "$rows" = "1" ] && [ "$firsts" = "1" ] && [ "$replays" = "9" ] || fail "3: expected 1 row, 1 first and 9 replays, got $rows / $firsts / $replays"
[ "$(outst RACE-CN-3)" = "0.00" ] && [ "$(outst RACE-INV-2)" = "900.00" ] || fail "3: balances CN $(outst RACE-CN-3) INV $(outst RACE-INV-2)"
pass "3 one request sent ten times at once: one allocation, nine replays, applied once"

# 4. Mixed load: 30 allocations of 10.00 across RACE-CN-2 x RACE-INV-1/RACE-INV-2.
for i in $(seq 1 30); do
  target=$([ $((i % 2)) = 0 ] && echo "$INV1" || echo "$INV2")
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAX -c "$(as_editor "select fn_allocate_sales_credit_note('$CO', $CN2, $target, 10.00, gen_random_uuid());")" >"$RACE_DIR/m$i.out" 2>&1 &
done
wait
grep -l -i deadlock "$RACE_DIR"/m*.out >/dev/null 2>&1 && fail "4: deadlock detected"
consistent=$(psql_q "
  select bool_and(d.total - coalesce(a.applied, 0) = d.outstanding)
    from sales_invoices d
    left join (
      select credit_note_id as doc_id, sum(amount) as applied from sales_credit_note_allocations where company_id = '$CO' group by credit_note_id
      union all
      select invoice_id, sum(amount) from sales_credit_note_allocations where company_id = '$CO' group by invoice_id
    ) a on a.doc_id = d.id
    where d.company_id = '$CO' and d.status = 'Posted';")
[ "$consistent" = "t" ] || fail "4: some balance is not its total minus its allocations"
[ "$(outst RACE-CN-2)" = "200.00" ] || fail "4: RACE-CN-2 outstanding $(outst RACE-CN-2), expected 200.00"
audits=$(psql_q "select count(*) from automation_audit_log where company_id = '$CO' and action_type = 'SalesCreditNoteAllocated';")
allocs=$(psql_q "select count(*) from sales_credit_note_allocations where company_id = '$CO';")
[ "$audits" = "$allocs" ] || fail "4: $allocs allocations but $audits audit entries"
pass "4 thirty mixed allocations: no deadlock; every balance = total - its allocations; one audit entry per allocation ($allocs)"

echo "ALL CONCURRENCY CHECKS PASSED"
