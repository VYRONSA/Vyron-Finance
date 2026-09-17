#!/usr/bin/env bash
# Repair simulation for production transaction 2151 / JR000264 (tests M, N).
#
# LOCAL TEST DATABASE ONLY (with migration 0100 applied). Runs the REAL
# repair and rollback files, unmodified, against a synthetic replica with
# the production ids, and proves:
#   M. the approved repair changes exactly one row (journal_id, posted_flag
#      of 2151), writes one audit entry, and leaves every journal, line,
#      batch, GL row and other transaction byte-identical;
#   N. the rollback restores the original state exactly (audit entries are
#      kept); and every guard refuses — changing nothing — when approval is
#      missing or wrong, when the facts no longer hold, or on a second run.
#
# Usage (psql reading the file on stdin, e.g. inside the local container):
#   PSQL="docker exec -i supabase_db_<project> psql -U postgres" supabase/tests/repair_2151/run.sh
set -euo pipefail

: "${PSQL:?Set PSQL to a psql command for a LOCAL test database}"
case "$PSQL" in
  *supabase.co*|*pooler.supabase.com*|*gnvhzckxryuttsqnvriv*|*--linked*)
    echo "REFUSED: PSQL points at a remote database." >&2
    exit 1
    ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
REPAIR="$HERE/../../repairs/2026-09-16_link_txn_2151_to_jr000264.sql"
ROLLBACK="$HERE/../../repairs/2026-09-16_link_txn_2151_to_jr000264_rollback.sql"
APPROVE="set vyron.repair_approval = 'LINK-2151-TO-JR000264'"
APPROVE_ROLLBACK="set vyron.repair_approval = 'ROLLBACK-LINK-2151-TO-JR000264'"
OPERATOR="set vyron.repair_operator = 'simulation'"

pass=0
ok() { echo "PASS: $1"; pass=$((pass + 1)); }
fail() { echo "FAIL: $1" >&2; exit 1; }

sql() { $PSQL -X -q -v ON_ERROR_STOP=1 -f - < "$1"; }
sql_with() { local file="$1"; shift; $PSQL -X -q -v ON_ERROR_STOP=1 "$@" -f - < "$file"; }
cmd() { $PSQL -X -q -t -A -v ON_ERROR_STOP=1 -c "$1"; }
state() { $PSQL -X -q -f - < "$HERE/state.sql" | tr -d '\r'; }
field() { echo "$1" | tr ' ' '\n' | grep "^$2=" | cut -d= -f2; }

# Runs a repair/rollback that must be refused; checks nothing changed.
expect_refused() {
  local label="$1" expect_text="$2" file="$3"; shift 3
  local before after out
  before="$(state)"
  if out="$(sql_with "$file" "$@" 2>&1)"; then
    fail "$label — it was not refused: $out"
  fi
  echo "$out" | grep -q "$expect_text" || fail "$label — unexpected error: $out"
  after="$(state)"
  [ "$before" = "$after" ] || fail "$label — state changed: $before -> $after"
  ok "$label (refused with $expect_text, nothing changed)"
}

trap 'sql "$HERE/cleanup.sql" >/dev/null 2>&1 || true' EXIT

sql "$HERE/seed.sql" >/dev/null
S0="$(state)"
[ "$(field "$S0" LINK)" = "null/false" ] || fail "seed: 2151 should start unlinked ($S0)"
[ "$(field "$S0" AUDIT)" = "0/0" ] || fail "seed: no audit entries expected ($S0)"
ok "seeded the replica: 2151 unlinked, JR000264 Posted"

expect_refused "M: repair without approval" "REPAIR_NOT_APPROVED" "$REPAIR"
expect_refused "M: repair with the wrong approval" "REPAIR_NOT_APPROVED" "$REPAIR" -c "set vyron.repair_approval = 'yes'"
expect_refused "N: rollback before any repair" "ROLLBACK_CHECK" "$ROLLBACK" -c "$APPROVE_ROLLBACK"

# Facts that must hold — each tampered, refused, restored.
tamper() {
  local label="$1" break_sql="$2" restore_sql="$3" expect_text="$4"
  cmd "$break_sql" >/dev/null
  expect_refused "M: repair when $label" "$expect_text" "$REPAIR" -c "$APPROVE"
  cmd "$restore_sql" >/dev/null
  [ "$(state)" = "$S0" ] || fail "restoring after '$label' did not return to the seeded state"
}
tamper "journal 278 is not Posted" "update ae_journals set status = 'Approved' where id = 278" "update ae_journals set status = 'Posted' where id = 278" "is Approved, not Posted"
tamper "journal 278 was reversed" "update ae_journals set is_reversed = true where id = 278" "update ae_journals set is_reversed = false where id = 278" "has been reversed"
tamper "the amount differs" "update ae_journals set total_debit = 6436 where id = 278" "update ae_journals set total_debit = 6435 where id = 278" "totals are not"
tamper "a GL row is missing" "update gl_transactions set journal_id = 277 where journal_id = 278 and debit > 0" "update gl_transactions set journal_id = 278 where journal_line_id in (select id from ae_journal_lines where journal_id = 278)" "GL row per line"
# Flagging 2151 posted without its journal is no longer possible at all:
# migration 0100's guard refuses it (so is linking it to any other journal).
before="$(state)"
if out="$(cmd "update ae_bank_transactions set posted_flag = true where id = 2151" 2>&1)"; then fail "0100 guard: flagging 2151 posted was allowed"; fi
echo "$out" | grep -q "VYRON_RULE_ENGINE_JOURNAL_EXISTS" || fail "0100 guard: unexpected error: $out"
if out="$(cmd "update ae_bank_transactions set journal_id = 277 where id = 2151" 2>&1)"; then fail "0100 guard: linking 2151 to another journal was allowed"; fi
[ "$(state)" = "$before" ] || fail "0100 guard: state changed"
ok "0100 guard: 2151 cannot be flagged posted or linked to another journal by any other path"
tamper "another transaction references journal 278" "update ae_bank_transactions set journal_id = 278 where id = 2152" "update ae_bank_transactions set journal_id = null where id = 2152" "REPAIR_CHECK"

# M — the approved repair.
out="$(sql_with "$REPAIR" -c "$APPROVE" -c "$OPERATOR" 2>&1)" || fail "M: approved repair failed: $out"
echo "$out" | grep -q "REPAIRED: transaction 2151 linked to journal 278 (JR000264); 1 row updated" || fail "M: no REPAIRED notice: $out"
S1="$(state)"
[ "$(field "$S1" LINK)" = "278/true" ] || fail "M: 2151 not linked ($S1)"
[ "$(field "$S1" LEDGER)" = "$(field "$S0" LEDGER)" ] || fail "M: ledger changed"
[ "$(field "$S1" OTHERS)" = "$(field "$S0" OTHERS)" ] || fail "M: another transaction changed"
[ "$(field "$S1" T2151)" = "$(field "$S0" T2151)" ] || fail "M: 2151 changed beyond journal_id/posted_flag"
[ "$(field "$S1" AUDIT)" = "1/0" ] || fail "M: expected one repair audit entry ($S1)"
ok "M: exactly one row changed (2151 -> 278/true); journals, lines, batches, GL rows and all other transactions byte-identical; one audit entry"
[ "$(cmd "select performed_by || '|' || (changes->'before'->>'posted_flag') || '|' || (changes->'after'->>'journal_id') from automation_audit_log where document_id = 2151 and action_type = 'RuleEngineJournalLinkRepair'")" = "simulation|false|278" ] || fail "M: audit entry content"
ok "M: the audit entry names the operator and the before/after values"
[ "$(cmd "select fn_recover_rule_engine_journal_link('45b3d2a0-3973-4587-a043-0e05d8d9bff3', 2151, 'check')->>'outcome'")" = "already_linked" ] || fail "M: rule engine does not see the repaired link"
ok "M: the rule engine now reports 2151 as already linked (it will not touch it)"

expect_refused "M: running the repair a second time" "nothing to repair" "$REPAIR" -c "$APPROVE"
expect_refused "N: rollback without approval" "ROLLBACK_NOT_APPROVED" "$ROLLBACK"

# N — rollback.
out="$(sql_with "$ROLLBACK" -c "$APPROVE_ROLLBACK" -c "$OPERATOR" 2>&1)" || fail "N: rollback failed: $out"
echo "$out" | grep -q "ROLLED BACK: transaction 2151 unlinked from journal 278; 1 row updated" || fail "N: no ROLLED BACK notice: $out"
S2="$(state)"
[ "$(field "$S2" LINK)" = "null/false" ] || fail "N: 2151 not restored ($S2)"
for f in LEDGER OTHERS T2151; do
  [ "$(field "$S2" "$f")" = "$(field "$S0" "$f")" ] || fail "N: $f differs from the original state"
done
[ "$(field "$S2" AUDIT)" = "1/1" ] || fail "N: expected the repair and rollback audit entries ($S2)"
ok "N: rollback restored the original state exactly (both audit entries kept)"
expect_refused "N: rolling back twice" "ROLLBACK_CHECK" "$ROLLBACK" -c "$APPROVE_ROLLBACK"

# The repair can be re-applied after a rollback — this time exactly as the
# procedure says: by uncommenting the approval lines inside the file.
APPROVED_COPY="$(mktemp)"
sed -e "s/^-- set local vyron.repair_approval/set local vyron.repair_approval/" -e "s/^-- set local vyron.repair_operator = 'name of the approving person'/set local vyron.repair_operator = 'simulation (file approval)'/" "$REPAIR" > "$APPROVED_COPY"
grep -q "^set local vyron.repair_approval = 'LINK-2151-TO-JR000264';" "$APPROVED_COPY" || fail "could not prepare the approved copy"
out="$(sql "$APPROVED_COPY" 2>&1)" || fail "M: re-applying after rollback (approval inside the file) failed: $out"
rm -f "$APPROVED_COPY"
[ "$(field "$(state)" LINK)" = "278/true" ] || fail "M: re-apply did not link"
[ "$(cmd "select setting from pg_settings where name = 'vyron.repair_approval'" 2>/dev/null)" = "" ] || fail "M: approval leaked out of the transaction"
ok "M: the repair can be applied again after a rollback, with the approval uncommented inside the file (set local — it does not outlive the transaction)"

sql "$HERE/cleanup.sql" >/dev/null
trap - EXIT
[ "$(cmd "select count(*) from companies where id = '45b3d2a0-3973-4587-a043-0e05d8d9bff3'")" = "0" ] || fail "cleanup left the replica behind"
ok "cleanup removed the synthetic replica"

echo "repair_2151 simulation: $pass checks passed"
