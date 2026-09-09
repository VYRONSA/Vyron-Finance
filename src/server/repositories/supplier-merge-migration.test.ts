/**
 * Phase 33/33A — this codebase has no local Postgres/pgTAP harness (same
 * documented limitation `general-ledger/types.test.ts`'s migration-0088
 * tests already establish), so `fn_merge_supplier`'s real transactional
 * behavior cannot be exercised directly. What CAN be proven — and is,
 * here — is a static, textual check of the migration file itself: every
 * table this function is supposed to repoint genuinely appears with the
 * right column, no SET clause ever touches an amount/GL/VAT/journal
 * column, the duplicate (not the survivor) is the one deactivated, and
 * the audit row records survivor/duplicate in the right slots. A future
 * edit that widened this function to touch an unintended column, or
 * swapped survivor/duplicate in the audit insert, would fail one of
 * these checks.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const migrationSql = readFileSync(join(process.cwd(), "supabase/migrations/0090_atomic_supplier_merge.sql"), "utf8");

function updateStatementFor(table: string): string {
  const marker = `update ${table} set`;
  const start = migrationSql.indexOf(marker);
  expect(start, `expected to find "${marker}" in the migration`).toBeGreaterThan(-1);
  const end = migrationSql.indexOf(";", start);
  return migrationSql.slice(start, end);
}

describe("migration 0090 — fn_merge_supplier repoints every known FK table (Phase 33A)", () => {
  const repointedTables: [string, string][] = [
    ["ae_imported_bills", "supplier_id"],
    ["ae_bank_transactions", "matched_supplier_id"],
    ["purchase_orders", "supplier_id"],
    ["goods_received_notes", "supplier_id"],
    ["supplier_payments", "supplier_id"],
    ["stock_items", "preferred_supplier_id"],
    ["merchants", "default_supplier_id"],
    ["bank_transaction_splits", "supplier_id"],
    ["fixed_assets", "supplier_id"],
    ["opening_balance_entries", "supplier_id"],
    ["supplier_contacts", "supplier_id"],
    ["supplier_addresses", "supplier_id"],
  ];

  it.each(repointedTables)("repoints %s.%s from the duplicate to the survivor", (table, column) => {
    const statement = updateStatementFor(table);
    expect(statement).toContain(`${column} = p_survivor_id`);
    expect(statement).toMatch(new RegExp(`where[\\s\\S]*${column}\\s*=\\s*p_duplicate_id`, "i"));
  });

  it("repoints exactly 12 tables — no more, no fewer", () => {
    const updateCount = (migrationSql.match(/\bupdate\s+(ae_imported_bills|ae_bank_transactions|purchase_orders|goods_received_notes|supplier_payments|stock_items|merchants|bank_transaction_splits|fixed_assets|opening_balance_entries|supplier_contacts|supplier_addresses)\s+set\b/gi) ?? []).length;
    expect(updateCount).toBe(12);
  });

  // Part 5 / test #33 — "no accounting amounts change." Every repoint
  // statement's SET clause must ONLY ever assign a `*_id`-shaped column
  // — never an amount, GL account, VAT code, or journal reference.
  it.each(repointedTables)("the SET clause for %s touches only the supplier-reference column — never an amount, GL account, VAT code, or journal", (table, column) => {
    const statement = updateStatementFor(table);
    const setClause = statement.slice(statement.indexOf("set") + 3, statement.toLowerCase().indexOf("where"));
    expect(setClause).toContain(`${column} = p_survivor_id`);
    expect(setClause).not.toMatch(/\b(debit|credit|amount|total|outstanding|vat|gl_account|journal_id|cost|price)\b\s*=/i);
  });

  it("deactivates the DUPLICATE supplier, never the survivor", () => {
    const statement = updateStatementFor("ae_suppliers");
    expect(statement).toContain("status = 'Inactive'");
    expect(statement).toMatch(/where[\s\S]*id\s*=\s*p_duplicate_id/i);
    expect(statement).not.toMatch(/where[\s\S]*id\s*=\s*p_survivor_id/i);
  });

  it("the party_merges audit insert records survivor and duplicate in the correct columns, not swapped", () => {
    const insertStart = migrationSql.indexOf("insert into party_merges");
    const insertStatement = migrationSql.slice(insertStart, migrationSql.indexOf(";", insertStart));
    // Column list and value list must be in the same relative order:
    // surviving_party_id -> p_survivor_id, merged_party_id -> p_duplicate_id.
    const columnList = insertStatement.slice(insertStatement.indexOf("("), insertStatement.indexOf(")"));
    const valueList = insertStatement.slice(insertStatement.indexOf("values") + 6);
    const survivingIdx = columnList.split(",").findIndex((c) => c.trim() === "surviving_party_id");
    const mergedIdx = columnList.split(",").findIndex((c) => c.trim() === "merged_party_id");
    const values = valueList.replace(/[()]/g, "").split(",").map((v) => v.trim());
    expect(values[survivingIdx]).toBe("p_survivor_id");
    expect(values[mergedIdx]).toBe("p_duplicate_id");
  });

  it("rejects a self-merge before touching any table", () => {
    expect(migrationSql).toMatch(/if\s+p_survivor_id\s*=\s*p_duplicate_id\s+then/i);
    const guardIdx = migrationSql.search(/if\s+p_survivor_id\s*=\s*p_duplicate_id\s+then/i);
    const firstUpdateIdx = migrationSql.indexOf("update ae_imported_bills");
    expect(guardIdx).toBeLessThan(firstUpdateIdx);
  });

  it("every repoint statement is scoped to company_id (except the two child tables that have none of their own, documented inline)", () => {
    for (const [table] of repointedTables) {
      if (table === "supplier_contacts" || table === "supplier_addresses") continue;
      const statement = updateStatementFor(table);
      expect(statement).toMatch(/where[\s\S]*company_id\s*=\s*p_company_id/i);
    }
  });

  it("runs as one PL/pgSQL function (security invoker, no explicit BEGIN/COMMIT needed — the function body IS the transaction)", () => {
    expect(migrationSql).toMatch(/language plpgsql/i);
    expect(migrationSql).toMatch(/security invoker/i);
  });
});
