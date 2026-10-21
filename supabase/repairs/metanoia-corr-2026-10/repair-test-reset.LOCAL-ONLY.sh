#!/usr/bin/env bash
# Rebuilds the LOCAL disposable replica database `repair_test` from scratch:
# schema-only copy of the local QA database (no data), migration 0121, replica fixture.
# Never touches production or the QA database's data.
set -euo pipefail
export MSYS_NO_PATHCONV=1
C="${SUPABASE_DB_CONTAINER:-supabase_db_precisia-unpost}"
DIR="$(cd "$(dirname "$0")" && pwd)"
MIG="$DIR/../../migrations/0121_sales_posting_integrity_and_credit_note_allocation.sql"
docker exec "$C" psql -U postgres -d postgres -qtAX -c "drop database if exists repair_test;" -c "create database repair_test;"
docker exec "$C" pg_dump -U postgres -d postgres -s -n public -n auth -n extensions -f /tmp/precisia_schema_rt.sql
docker exec "$C" psql -U postgres -d repair_test -q -f /tmp/precisia_schema_rt.sql -o /tmp/precisia_restore_rt.log >/dev/null 2>&1 || true
docker exec "$C" truncate -s 0 /tmp/precisia_schema_rt.sql
docker exec -i "$C" psql -U postgres -d repair_test -v ON_ERROR_STOP=1 -qtAX < "$MIG" >/dev/null 2>&1
docker exec -i "$C" psql -U postgres -d repair_test -v ON_ERROR_STOP=1 -qtAX < "$DIR/repair-test-fixture.LOCAL-ONLY.sql"
docker exec "$C" psql -U postgres -d repair_test -tAX -c "select 'replica ready: ' || (select count(*) from sales_invoices) || ' documents, ' || (select count(*) from ae_journals) || ' journals, ' || (select count(*) from gl_transactions) || ' ledger rows, 0121 triggers ' || (select count(*) from pg_trigger where tgname in ('ae_journals_sales_invoice_single_live','sales_invoices_journal_link_guard','sales_invoices_sign_guard'));"
