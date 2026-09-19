#!/usr/bin/env bash
# Phase 5N — the certification call ceiling under REAL concurrency.
#
# LOCAL / SYNTHETIC ONLY. Never run against a shared or production
# database.
#
# The companion suite `certification_call_ceiling.test.sql` runs inside one
# rolled-back transaction, which cannot prove the property that matters
# most: that two certification workers racing for the last call cannot both
# get it. A single transaction has no concurrency to test.
#
# So this fires N real connections at one run with a ceiling of C and
# asserts that EXACTLY C of them were granted a call. This is the same
# technique that proved `next_document_number()` in Phase 5J, and it is the
# only way to distinguish "the SQL looks atomic" from "the SQL is atomic".
#
#   ./supabase/tests/certification_call_ceiling.concurrency.sh
#
# It cleans up after itself.
set -euo pipefail

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_vyron-atomic-posting-local}"
WORKERS=40
CEILING=15

psql_q() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAX -c "$1"; }

ORG="5e000000-0000-4000-8000-0000000000bb"
CO="5e000000-0000-4000-8000-00000000c002"

cleanup() {
  psql_q "delete from ai_certification_runs where company_id = '$CO';" >/dev/null 2>&1 || true
  psql_q "delete from companies where id = '$CO';" >/dev/null 2>&1 || true
  psql_q "delete from organisations where id = '$ORG';" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql_q "insert into organisations (id, name) values ('$ORG', '5N concurrency org') on conflict (id) do nothing;" >/dev/null
psql_q "insert into companies (id, organisation_id, name) values ('$CO', '$ORG', '5N Concurrency Co') on conflict (id) do nothing;" >/dev/null

RUN_ID=$(psql_q "select fn_ai_certification_open_run('$CO', 'concurrency proof', $CEILING, 'test');")
echo "Opened certification run #$RUN_ID with a ceiling of $CEILING; firing $WORKERS concurrent reservations."

# Each worker is its own connection, so these genuinely race.
for _ in $(seq 1 "$WORKERS"); do
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAX \
    -c "select fn_ai_certification_reserve_call($RUN_ID) ->> 'reserved';" &
done > /tmp/cert_ceiling_results.$$ 2>/dev/null
wait

GRANTED=$(grep -c '^true$'  /tmp/cert_ceiling_results.$$ || true)
REFUSED=$(grep -c '^false$' /tmp/cert_ceiling_results.$$ || true)
USED=$(psql_q "select calls_used from ai_certification_runs where id = $RUN_ID;")
STATUS=$(psql_q "select status from ai_certification_runs where id = $RUN_ID;")
rm -f /tmp/cert_ceiling_results.$$

echo "granted=$GRANTED refused=$REFUSED calls_used=$USED status=$STATUS"

fail=0
[ "$GRANTED" -eq "$CEILING" ] || { echo "FAIL: $GRANTED calls granted against a ceiling of $CEILING"; fail=1; }
[ "$REFUSED" -eq "$((WORKERS - CEILING))" ] || { echo "FAIL: expected $((WORKERS - CEILING)) refusals, got $REFUSED"; fail=1; }
[ "$USED" -eq "$CEILING" ] || { echo "FAIL: counter reads $USED, expected $CEILING"; fail=1; }
[ "$STATUS" = "Exhausted" ] || { echo "FAIL: run status is $STATUS, expected Exhausted"; fail=1; }

if [ "$fail" -eq 0 ]; then
  echo "PASS: $WORKERS concurrent workers could not exceed a ceiling of $CEILING."
else
  exit 1
fi
