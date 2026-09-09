/**
 * Phase 33 — `mergeSupplierAtomic` calls a real Postgres function
 * (`fn_merge_supplier`, migration 0090) via `.rpc()`. The function body's
 * own transactional/atomicity guarantees can only be proven against a
 * real Postgres instance (same documented limitation as every other
 * atomic RPC repository call in this codebase — none have a direct
 * SQL-transaction test). This file proves the one thing a unit test
 * legitimately CAN prove: the repository calls `.rpc()` with the exact
 * function name and parameter shape the migration defines, propagates a
 * DB-level error rather than swallowing it, and correctly unwraps the
 * jsonb result the function returns.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { fakeRef } = vi.hoisted(() => ({ fakeRef: { current: undefined as unknown } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeRef.current }));

import { getSupplierLinkedRecordCount, mergeSupplierAtomic } from "./merge-repository";

function fakeSupabase(rpcImpl: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>) {
  return { rpc: vi.fn(rpcImpl) };
}

/** Minimal chainable fake for `.from(table).select(..., {count}).eq(...).eq(...)`
 * — records every `.eq()` filter applied so a test can assert exactly
 * which table/column/value combination was queried, and resolves with a
 * caller-supplied count per table. */
function fakeCountableSupabase(countByTable: Record<string, number>, errorTable?: string) {
  const calls: { table: string; filters: [string, unknown][] }[] = [];
  const from = vi.fn((table: string) => {
    const filters: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      then: (resolve: (v: { count: number | null; error: unknown }) => void) => {
        calls.push({ table, filters: [...filters] });
        if (table === errorTable) return resolve({ count: null, error: new Error(`boom on ${table}`) });
        resolve({ count: countByTable[table] ?? 0, error: null });
      },
    };
    return builder;
  });
  return { supabase: { from }, calls };
}

describe("mergeSupplierAtomic", () => {
  beforeEach(() => {
    fakeRef.current = undefined;
  });

  it("calls fn_merge_supplier with the exact parameter shape the migration defines", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        bills: 1, bankTransactions: 2, purchaseOrders: 0, goodsReceivedNotes: 0, payments: 0,
        stockItems: 0, merchants: 0, bankTransactionSplits: 0, fixedAssets: 0, openingBalanceEntries: 0,
        duplicateName: "Dup Supplier Co",
      },
      error: null,
    }));
    fakeRef.current = { rpc };

    const result = await mergeSupplierAtomic("co_1", 10, 20, "alice@vyron.test");

    expect(rpc).toHaveBeenCalledWith("fn_merge_supplier", {
      p_company_id: "co_1",
      p_survivor_id: 10,
      p_duplicate_id: 20,
      p_performed_by: "alice@vyron.test",
    });
    expect(result.duplicateName).toBe("Dup Supplier Co");
    expect(result.bills).toBe(1);
    expect(result.bankTransactions).toBe(2);
  });

  it("throws the underlying database error rather than swallowing it (e.g. the function's own RAISE EXCEPTION for a cross-company or self-merge attempt)", async () => {
    fakeRef.current = fakeSupabase(async () => ({ data: null, error: new Error("fn_merge_supplier: survivor and duplicate must be different suppliers") }));
    await expect(mergeSupplierAtomic("co_1", 10, 10, "System")).rejects.toThrow("fn_merge_supplier: survivor and duplicate must be different suppliers");
  });
});

// Phase 33A — the "Number of linked records" figure the merge dialog
// shows for each candidate before the user picks a survivor.
describe("getSupplierLinkedRecordCount", () => {
  beforeEach(() => {
    fakeRef.current = undefined;
  });

  it("sums counts across every table fn_merge_supplier itself repoints, read-only", async () => {
    const { supabase, calls } = fakeCountableSupabase({
      ae_imported_bills: 2, ae_bank_transactions: 5, purchase_orders: 1, goods_received_notes: 1,
      supplier_payments: 3, stock_items: 0, merchants: 0, bank_transaction_splits: 0,
      fixed_assets: 0, opening_balance_entries: 0, supplier_contacts: 2, supplier_addresses: 1,
    });
    fakeRef.current = supabase;

    const total = await getSupplierLinkedRecordCount("co_1", 42);

    expect(total).toBe(2 + 5 + 1 + 1 + 3 + 2 + 1); // = 15
    const tables = calls.map((c) => c.table).sort();
    expect(tables).toEqual(
      ["ae_bank_transactions", "ae_imported_bills", "bank_transaction_splits", "fixed_assets", "goods_received_notes", "merchants", "opening_balance_entries", "purchase_orders", "stock_items", "supplier_addresses", "supplier_contacts", "supplier_payments"].sort(),
    );
  });

  it("scopes every company-scoped table by both company_id and supplier id", async () => {
    const { supabase, calls } = fakeCountableSupabase({ ae_imported_bills: 1 });
    fakeRef.current = supabase;
    await getSupplierLinkedRecordCount("co_1", 42);
    const bills = calls.find((c) => c.table === "ae_imported_bills");
    expect(bills?.filters).toEqual([
      ["company_id", "co_1"],
      ["supplier_id", 42],
    ]);
  });

  it("propagates a database error rather than silently returning 0", async () => {
    const { supabase } = fakeCountableSupabase({}, "ae_bank_transactions");
    fakeRef.current = supabase;
    await expect(getSupplierLinkedRecordCount("co_1", 42)).rejects.toThrow("boom on ae_bank_transactions");
  });
});
