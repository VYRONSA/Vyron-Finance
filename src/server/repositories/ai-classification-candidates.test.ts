/**
 * `listAiClassificationEligibleTransactions` is how the
 * `AiClassificationSweep` automation finds its own work — it is not
 * handed a caller-supplied id list. So the human-review hold has to be
 * part of THIS query, not only of the pure eligibility check that runs
 * afterwards: a held transaction must never become a candidate, never
 * reach the AI provider, and never be counted in `hasMoreEligible`.
 *
 * The fake below records the real filter chain the repository builds
 * (the same purpose-built-fake approach `import-repository.test.ts`
 * established) rather than asserting on a predicate a second time.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { fakeRef } = vi.hoisted(() => ({ fakeRef: { current: undefined as unknown } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeRef.current }));

import { listAiClassificationEligibleTransactions } from "./transaction-explorer-repository";

type Filter = { op: string; column: string; value: unknown };

function makeFakeSupabase() {
  const filters: Filter[] = [];
  let table = "";
  let appliedLimit: number | null = null;

  const builder = {
    select: () => builder,
    eq(column: string, value: unknown) {
      filters.push({ op: "eq", column, value });
      return builder;
    },
    is(column: string, value: unknown) {
      filters.push({ op: "is", column, value });
      return builder;
    },
    order: () => builder,
    limit(n: number) {
      appliedLimit = n;
      return builder;
    },
    returns: async () => ({ data: [], error: null }),
  };

  return {
    from(name: string) {
      table = name;
      return builder;
    },
    _filters: filters,
    _table: () => table,
    _limit: () => appliedLimit,
  };
}

let fake: ReturnType<typeof makeFakeSupabase>;

beforeEach(() => {
  fake = makeFakeSupabase();
  fakeRef.current = fake as never;
});

function has(op: string, column: string, value: unknown): boolean {
  return fake._filters.some((f) => f.op === op && f.column === column && f.value === value);
}

describe("listAiClassificationEligibleTransactions — the sweep's candidate query", () => {
  it("excludes transactions held for human review, in SQL", async () => {
    await listAiClassificationEligibleTransactions("co_1", 20);

    expect(has("eq", "review_hold", false)).toBe(true);
    expect(has("is", "review_status", null)).toBe(true);
    expect(has("is", "required_action", null)).toBe(true);
  });

  it("still scopes to one company and keeps every pre-existing exclusion", async () => {
    await listAiClassificationEligibleTransactions("co_1", 20);

    expect(fake._table()).toBe("ae_bank_transactions");
    expect(has("eq", "company_id", "co_1")).toBe(true);
    expect(has("eq", "allocation_status", "Unallocated")).toBe(true);
    expect(has("is", "suggested_gl_account", null)).toBe(true);
    expect(has("is", "rule_id", null)).toBe(true);
    expect(has("is", "matched_supplier_id", null)).toBe(true);
    expect(has("is", "matched_customer_id", null)).toBe(true);
    expect(has("is", "matched_merchant_id", null)).toBe(true);
    expect(has("is", "journal_id", null)).toBe(true);
    expect(has("eq", "is_manual_override", false)).toBe(true);
  });

  it("never queries across companies — the guard cannot leak between tenants", async () => {
    await listAiClassificationEligibleTransactions("co_northwood", 20);

    const companyFilters = fake._filters.filter((f) => f.column === "company_id");
    expect(companyFilters).toEqual([{ op: "eq", column: "company_id", value: "co_northwood" }]);
  });

  it("respects the batch limit it was given", async () => {
    await listAiClassificationEligibleTransactions("co_1", 20);
    expect(fake._limit()).toBe(20);
  });
});
