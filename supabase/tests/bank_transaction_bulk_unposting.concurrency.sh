#!/usr/bin/env bash
# Migration 0120 — Bulk Unpost under REAL concurrency.
#
# LOCAL / SYNTHETIC ONLY. Never run against a shared or production
# database. Needs 0120 applied to the target container.
#
# The companion suite `bank_transaction_bulk_unposting.test.sql` runs in one
# rolled-back transaction and cannot race anything. This fires real,
# simultaneous connections at the same posted journals and asserts:
#
#   1. SAME SELECTION, MANY RUNS — every journal is reversed exactly once and
#      every transaction is unposted exactly once, however many runs race.
#   2. OVERLAPPING SELECTIONS — two runs sharing some journals both finish
#      (no deadlock), and each shared journal is reversed exactly once.
#   3. ONE PREVIEW, MANY CLICKS — the same request key executes once.
#
# and after all of it: the ledger balances, every original journal has at
# most one reversal, and every reversal mirrors its original.
#
#   SUPABASE_DB_CONTAINER=precisia-sd0-db ./supabase/tests/bank_transaction_bulk_unposting.concurrency.sh
#
# It cleans up after itself (the synthetic company is deleted; its audit
# rows go with it through the company cascade).
set -euo pipefail
export MSYS_NO_PATHCONV=1

CONTAINER="${SUPABASE_DB_CONTAINER:-precisia-sd0-db}"
ORG="5f400000-0000-4000-8000-0000000014aa"
CO="5f400000-0000-4000-8000-0000000014a1"
UID_EDITOR="5f400000-0000-4000-8000-000000001401"

psql_q() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAX -v ON_ERROR_STOP=1 -c "$1"; }

cleanup() {
  psql_q "delete from companies where id = '$CO';" >/dev/null 2>&1 || true
  psql_q "delete from organisations where id = '$ORG';" >/dev/null 2>&1 || true
  psql_q "delete from auth.users where id = '$UID_EDITOR';" >/dev/null 2>&1 || true
  # Only ever the directory this script created (never the inherited
  # Windows TMP variable).
  case "${RACE_DIR:-}" in */up-race.*) rm -rf "$RACE_DIR" ;; esac
}
trap cleanup EXIT
cleanup
RACE_DIR="$(mktemp -d -t up-race.XXXXXX)"

# Fixture: 3 groups x 10 dates x 2 transactions, each date posted as one
# journal by the real fn_post_bank_transactions (the Post to Accounting shape).
docker exec -i "$CONTAINER" psql -U postgres -d postgres -qtAX -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into auth.users (id, email, aud, role) values ('$UID_EDITOR', 'up-race@synthetic.test', 'authenticated', 'authenticated');
insert into organisations (id, name) values ('$ORG', 'UP race org');
insert into companies (id, organisation_id, name, base_currency_code) values ('$CO', '$ORG', 'UP Race Co', 'ZAR');
insert into permission_roles (company_id, role_key, name) values ('$CO', 'up_race', 'race');
insert into role_permissions (role_id, permission_key)
  select id, k from permission_roles, unnest(array['Banking:View', 'Banking:Edit', 'GeneralLedger:Reverse']) k where role_key = 'up_race' and company_id = '$CO';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
  select '$UID_EDITOR', '$CO', id, 'up-race' from permission_roles where role_key = 'up_race' and company_id = '$CO';
insert into chart_of_accounts (company_id, account_code, description, account_type, normal_balance) values
  ('$CO', '1000', 'Bank', 'Asset', 'Debit'), ('$CO', '6100', 'Bank Charges', 'Expense', 'Debit');
insert into ae_bank_accounts (company_id, account_number, account_name, gl_account) values ('$CO', 'UP-RACE', 'Race Cheque', '1000');
insert into financial_years (company_id, year_label, start_date, end_date, status) values ('$CO', 'FY2026', '2026-03-01', '2027-02-28', 'Open');
insert into ae_bank_transactions (company_id, transaction_date, reference, description, import_description, debit, credit, bank_account, bank_account_id,
  allocation_status, suggested_gl_account, allocation_type, allocation_method, is_manual_override, source_occurrence, entry_source)
select '$CO', date '2026-03-01' + (g * 10 + d), 'R' || g || '-' || d || '-' || n, 'race g' || g || ' d' || d || ' n' || n, 'race', 10 + n, 0,
       'UP-RACE', (select id from ae_bank_accounts where account_number = 'UP-RACE'), 'Allocated', '6100', 'G', 'Manual', true, 1, 'Imported'
  from generate_series(1, 3) g, generate_series(0, 9) d, generate_series(1, 2) n;
do \$\$
declare
  v_date date;
  v_ids bigint[];
  v_lines jsonb;
begin
  for v_date in select distinct transaction_date from ae_bank_transactions where company_id = '$CO' order by 1 loop
    select array_agg(id order by id),
           jsonb_agg(l order by id)
      into v_ids, v_lines
      from (select t.id, jsonb_build_array(
              jsonb_build_object('transactionId', t.id, 'accountCode', '6100', 'debit', t.debit, 'credit', 0, 'description', t.description),
              jsonb_build_object('transactionId', t.id, 'accountCode', '1000', 'debit', 0, 'credit', t.debit, 'description', t.description)) l
            from ae_bank_transactions t where t.company_id = '$CO' and t.transaction_date = v_date) x;
    select jsonb_agg(e) into v_lines from jsonb_array_elements(v_lines) a, jsonb_array_elements(a.value) e;
    perform fn_post_bank_transactions('$CO', v_ids, jsonb_build_array(jsonb_build_object(
      'journalNumber', fn_bank_unposting_next_number('$CO', 'JR'), 'journalDate', v_date, 'journalType', 'Bank Transactions',
      'description', 'race ' || v_date, 'reference', '', 'financialYearLabel', 'FY2026', 'financialPeriod', 1,
      'transactionIds', to_jsonb(v_ids), 'lines', v_lines)), fn_bank_unposting_next_number('$CO', 'PB'), v_date, 'up-race');
  end loop;
end \$\$;
SQL

POSTED=$(psql_q "select count(*) from ae_bank_transactions where company_id = '$CO' and posted_flag;")
JOURNALS=$(psql_q "select count(*) from ae_journals where company_id = '$CO' and source_type = 'bank_transactions_post';")
echo "Fixture: $POSTED posted transactions on $JOURNALS journals."

# The previewed items for group g, days d_from..d_to — captured ONCE, before
# a race starts, exactly as the screen captures its preview. (Re-reading them
# inside each racing call would see rows another run already unposted.)
items_sql() { echo "(select jsonb_agg(jsonb_build_object('id', id, 'journalId', journal_id, 'glAccount', suggested_gl_account) order by id) from ae_bank_transactions where company_id = '$CO' and description like 'race g$1 %' and (transaction_date - date '2026-03-01') - $1 * 10 between $2 and $3)"; }

# One call as the signed-in user, in its own connection and transaction.
call_as_user() { # $1 request key, $2 items sql
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAX -c "
    begin;
    set local role authenticated;
    select set_config('request.jwt.claims', '{\"sub\":\"$UID_EDITOR\",\"role\":\"authenticated\",\"email\":\"up-race@synthetic.test\"}', true);
    select set_config('request.jwt.claim.sub', '$UID_EDITOR', true);
    select 'RESULT ' || (fn_bulk_unpost_bank_transactions('$CO', '$1', date '2026-03-01', date '2026-12-31', null, $2) - 'items')::text;
    commit;" 2>&1 | grep -E "RESULT|ERROR" || true
}

new_key() { psql_q "select gen_random_uuid();"; }
preview_items() { echo "'$(psql_q "select $(items_sql "$1" "$2" "$3")")'::jsonb"; }
ITEMS_1=$(preview_items 1 0 9)
ITEMS_2A=$(preview_items 2 0 6)
ITEMS_2B=$(preview_items 2 3 9)
ITEMS_3=$(preview_items 3 0 9)

fail=0
check() { if [ "$1" = "$2" ]; then echo "PASS: $3 ($1)"; else echo "FAIL: $3 (got $1, want $2)"; fail=1; fi; }

# 1. Same selection, 8 simultaneous runs, group 1 (10 journals, 20 transactions).
for _ in $(seq 1 8); do call_as_user "$(new_key)" "$ITEMS_1" & done > "$RACE_DIR/s1" ; wait
check "$(grep -c 'RESULT' "$RACE_DIR/s1")" 8 "S1 all 8 racing runs completed (no error, no deadlock)"
grep 'ERROR' "$RACE_DIR/s1" | sed 's/^/  S1 error: /' || true
check "$(grep -o '"unposted": [0-9]*' "$RACE_DIR/s1" | awk '{s+=$2} END {print s}')" 20 "S1 20 transactions unposted in total across all runs (each exactly once)"
check "$(psql_q "select count(*) from ae_journals r join ae_journals o on o.id = r.reversal_of_journal_id where o.company_id = '$CO' and o.journal_date between '2026-03-11' and '2026-03-20';")" 10 "S1 exactly 10 reversal journals for the 10 journals"

# 2. Overlapping selections: run A takes days 0-6, run B days 3-9 of group 2, simultaneously, 4 times each.
for _ in 1 2 3 4; do
  call_as_user "$(new_key)" "$ITEMS_2A" &
  call_as_user "$(new_key)" "$ITEMS_2B" &
done > "$RACE_DIR/s2"; wait
check "$(grep -c 'RESULT' "$RACE_DIR/s2")" 8 "S2 all 8 overlapping runs completed (no deadlock)"
check "$(grep -c 'ERROR' "$RACE_DIR/s2" || true)" 0 "S2 no run errored"
grep 'ERROR' "$RACE_DIR/s2" | sed 's/^/  S2 error: /' || true
check "$(grep -o '"unposted": [0-9]*' "$RACE_DIR/s2" | awk '{s+=$2} END {print s}')" 20 "S2 20 transactions unposted in total (shared journals once)"

# 3. One preview key, 6 simultaneous clicks, group 3.
KEY="5f400000-0000-4000-8000-0000000014ff"
for _ in $(seq 1 6); do call_as_user "$KEY" "$ITEMS_3" & done > "$RACE_DIR/s3"; wait
check "$(grep -c 'RESULT' "$RACE_DIR/s3")" 1 "S3 the same request key executed exactly once"
check "$(grep -c 'PRECISIA_UNALLOCATION_DUPLICATE' "$RACE_DIR/s3")" 5 "S3 the other 5 clicks were refused as duplicates"

# Global invariants.
check "$(psql_q "select count(*) from ae_bank_transactions where company_id = '$CO' and (posted_flag or journal_id is not null);")" 0 "Z1 every transaction is unposted"
check "$(psql_q "select count(*) from (select reversal_of_journal_id from ae_journals where company_id = '$CO' and reversal_of_journal_id is not null group by 1 having count(*) > 1) d;")" 0 "Z2 no journal has more than one reversal"
check "$(psql_q "select count(*) from ae_journals where company_id = '$CO' and source_type = 'journal_reversal';")" 30 "Z3 30 reversal journals for 30 journals"
check "$(psql_q "select coalesce(sum(debit) - sum(credit), 0) from gl_transactions where company_id = '$CO';")" "0.00" "Z4 the ledger balances"
check "$(psql_q "select count(*) from (select c.account_code, sum(g.debit - g.credit) n from gl_transactions g join chart_of_accounts c on c.id = g.account_id where g.company_id = '$CO' group by 1 having sum(g.debit - g.credit) <> 0) x;")" 0 "Z5 every account nets to zero (each posting reversed exactly once)"
check "$(psql_q "select count(*) from bank_unallocation_run_items where company_id = '$CO' and outcome = 'unposted';")" 60 "Z6 the audit records exactly 60 unposted items"

[ "$fail" -eq 0 ] && echo "ALL CONCURRENCY CHECKS PASSED" || { echo "CONCURRENCY CHECKS FAILED"; exit 1; }
