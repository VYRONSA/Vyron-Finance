/**
 * Phase 29B — forensic review found `applyMatchResults`/`applyAllocationResults`
 * had NO protection against overwriting a transaction another workflow had
 * already genuinely decided (manual allocation, accepted/automatic AI
 * allocation, Banking Rule match) — only `journal_id IS NULL` and company
 * scoping. This is the first test file in this codebase to mock the
 * Supabase client directly, specifically because the actual safety
 * mechanism here IS the SQL WHERE clause itself — a pure-function test of
 * the protection predicate alone cannot prove the repository's real
 * `.eq()/.is()/.or()` chain matches that predicate's semantics. The fake
 * below is a genuine (if narrowly-scoped) in-memory simulator — it
 * evaluates filters against real row state, not just a call-spy — so a
 * bug in the actual WHERE-clause construction would be caught here.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// `vi.mock` factories are hoisted above every import in this file and
// cannot close over an ordinary outer `let`/`const` (TDZ at hoist time) —
// `vi.hoisted` creates the mutable box the factory is allowed to
// reference; each test reassigns `fakeRef.current` in `beforeEach`.
const { fakeRef } = vi.hoisted(() => ({ fakeRef: { current: undefined as unknown } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeRef.current }));

// ---------------------------------------------------------------------
// Minimal, narrowly-scoped in-memory Supabase fake. Supports exactly the
// query shapes this repository's applyMatchResults/applyAllocationResults/
// getBankTransactionsByIds use: .select()/.update()/.insert() as entry
// points, .eq()/.is()/.in()/.or() as AND-combined filters (.or()'s own
// string is parsed as a real OR-of-clauses, not just recorded), and
// .select() after .update() for the RETURNING-style read of affected rows.
// ---------------------------------------------------------------------
type Row = Record<string, unknown>;

function parseOrString(str: string): { col: string; op: "is" | "in"; val?: unknown; vals?: string[] }[] {
  const clauses: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of str) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      clauses.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) clauses.push(current);
  return clauses.map((clause) => {
    const [col, op, ...rest] = clause.split(".");
    const valueStr = rest.join(".");
    if (op === "is") return { col: col!, op: "is" as const, val: valueStr === "null" ? null : valueStr };
    if (op === "in") {
      const inner = valueStr.slice(1, -1);
      const vals = inner.split(",").map((v) => v.replace(/^"|"$/g, ""));
      return { col: col!, op: "in" as const, vals };
    }
    throw new Error(`unsupported or-clause op in test fake: ${op}`);
  });
}

type Filter =
  | { type: "eq"; col: string; val: unknown }
  | { type: "is"; col: string; val: unknown }
  | { type: "in"; col: string; vals: unknown[] }
  | { type: "or"; clauses: ReturnType<typeof parseOrString> };

class FakeQuery implements PromiseLike<{ data: Row[] | null; error: null }> {
  private filters: Filter[] = [];
  private selectCols: string | null = null;

  constructor(
    private table: Map<number, Row>,
    private mode: "select" | "update" | "insert",
    private payload: Row | null,
    private insertLog?: Row[],
  ) {}

  eq(col: string, val: unknown) {
    this.filters.push({ type: "eq", col, val });
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push({ type: "is", col, val });
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push({ type: "in", col, vals });
    return this;
  }
  or(str: string) {
    this.filters.push({ type: "or", clauses: parseOrString(str) });
    return this;
  }
  select(cols: string) {
    this.selectCols = cols;
    return this;
  }
  returns<T>() {
    return this as unknown as FakeQuery & PromiseLike<{ data: T; error: null }>;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      if (f.type === "eq" || f.type === "is") return row[f.col] === f.val;
      if (f.type === "in") return f.vals.includes(row[f.col]);
      return f.clauses.some((c) => (c.op === "is" ? row[c.col] === c.val : c.vals!.includes(row[c.col] as string)));
    });
  }

  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let result: { data: Row[] | null; error: null };
    if (this.mode === "insert") {
      this.insertLog!.push(this.payload!);
      result = { data: null, error: null };
    } else if (this.mode === "select") {
      result = { data: [...this.table.values()].filter((r) => this.matches(r)), error: null };
    } else {
      const matched = [...this.table.entries()].filter(([, r]) => this.matches(r));
      for (const [, row] of matched) Object.assign(row, this.payload);
      const cols = this.selectCols ? this.selectCols.split(",").map((c) => c.trim()) : null;
      result = {
        data: matched.map(([, row]) => (cols ? Object.fromEntries(cols.map((c) => [c, row[c]])) : { ...row })),
        error: null,
      };
    }
    return Promise.resolve(onfulfilled ? onfulfilled(result) : (result as unknown as TResult1));
  }
}

function makeFakeSupabase(seedRows: Row[]) {
  const table = new Map(seedRows.map((r) => [r.id as number, { ...r }]));
  const matchHistory: Row[] = [];
  const allocationHistory: Row[] = [];
  function from(name: string) {
    if (name === "ae_match_history") return { insert: (row: Row) => new FakeQuery(table, "insert", row, matchHistory) };
    if (name === "ae_allocation_history") return { insert: (row: Row) => new FakeQuery(table, "insert", row, allocationHistory) };
    return {
      select: (cols: string) => new FakeQuery(table, "select", null).select(cols),
      update: (patch: Row) => new FakeQuery(table, "update", patch),
    };
  }
  return { from, table, matchHistory, allocationHistory };
}

import { applyMatchResults, applyAllocationResults } from "./supplier-reconciliation-repository";
import {
  isSupplierReconAccountingProtected,
  hasMatchResultChanged,
  hasAllocationResultChanged,
  matchResultToUpdate,
  matchResultEnrichmentUpdate,
  allocationResultToUpdate,
} from "@/server/accounting/mappers";
import type { AllocationResult, BankTransactionRecord, MatchResult } from "@/server/accounting/types";

let fake: ReturnType<typeof makeFakeSupabase>;

const COMPANY = "company-a";

function row(overrides: Partial<Record<string, unknown>> = {}): Row {
  return {
    id: 1, company_id: COMPANY, transaction_date: "2026-08-01", reference: "", description: "ABC SUPPLIES", beneficiary: "ABC Supplies",
    debit: 1000, credit: 0, balance: null, bank_account: "Cheque", bank_account_id: 1, gl_account: "", vat: null, notes: "",
    import_batch: "", source_filename: "", created_at: "2026-08-01T00:00:00.000Z", allocation_status: "Unallocated",
    matched_supplier_id: null, matched_bill_id: null, confidence_score: null, rules_triggered: [], match_reason: "",
    required_action: null, suggested_gl_account: null, suggested_vat_code: null, allocation_method: null, allocation_reason: "",
    is_manual_override: false, review_status: null, reviewed_by: null, reviewed_at: null, review_note: null, journal_id: null,
    matched_customer_id: null, matched_merchant_id: null, rule_id: null, allocation_type: null, allocation_notes: "",
    entry_source: "Imported", capture_status: null, cashbook_batch_id: null, reconciliation_id: null, reversal_of_transaction_id: null, is_split: false,
    ...overrides,
  };
}

function matchResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    bankTransactionId: 1, status: "Matched", matchedSupplierId: 42, matchedBillId: 7, confidence: 90,
    rulesTriggered: ["Exact Supplier Name"], reason: "Exact Supplier Name matched.", paymentType: "Full Payment",
    requiredAction: null, candidateBillIds: [7],
    ...overrides,
  };
}

function allocationResult(overrides: Partial<AllocationResult> = {}): AllocationResult {
  return {
    bankTransactionId: 1, status: "Allocated", supplierId: 42, glAccount: "5000", vatCode: "STD",
    confidence: 90, allocationMethod: "Matched Bill", allocationReason: "Matched to bill.", requiredAction: null,
    ...overrides,
  };
}

beforeEach(() => {
  fake = fakeRef.current = makeFakeSupabase([]);
});

// -----------------------------------------------------------------------
// Pure predicates — the single source of truth the WHERE clauses mirror.
// -----------------------------------------------------------------------
describe("isSupplierReconAccountingProtected (Phase 29B)", () => {
  it("false for a genuinely untouched transaction", () => {
    expect(isSupplierReconAccountingProtected({ isManualOverride: false, ruleId: null, allocationMethod: null })).toBe(false);
  });
  it("false for a transaction Supplier Reconciliation's own Allocation Engine already touched", () => {
    expect(isSupplierReconAccountingProtected({ isManualOverride: false, ruleId: null, allocationMethod: "Matched Bill" })).toBe(false);
    expect(isSupplierReconAccountingProtected({ isManualOverride: false, ruleId: null, allocationMethod: "Supplier Default" })).toBe(false);
  });
  it("true for a manually allocated / accepted-AI transaction", () => {
    expect(isSupplierReconAccountingProtected({ isManualOverride: true, ruleId: null, allocationMethod: "Manual" })).toBe(true);
  });
  it("true for an automatic AI allocation (Future AI)", () => {
    expect(isSupplierReconAccountingProtected({ isManualOverride: false, ruleId: null, allocationMethod: "Future AI" })).toBe(true);
  });
  it("true for a Banking Rule allocation (rule_id set)", () => {
    expect(isSupplierReconAccountingProtected({ isManualOverride: false, ruleId: 5, allocationMethod: null })).toBe(true);
  });
});

describe("hasMatchResultChanged / hasAllocationResultChanged (Phase 29B — no-op guard)", () => {
  it("Matching: false when nothing differs — a genuine no-op re-run", () => {
    const previous: Pick<BankTransactionRecord, "allocationStatus" | "matchedSupplierId" | "matchedBillId" | "confidenceScore" | "requiredAction"> = {
      allocationStatus: "Matched", matchedSupplierId: 42, matchedBillId: 7, confidenceScore: 90, requiredAction: null,
    };
    expect(hasMatchResultChanged(previous, matchResult())).toBe(false);
  });
  it("Matching: true when the matched bill changed", () => {
    const previous = { allocationStatus: "Matched" as const, matchedSupplierId: 42, matchedBillId: 7, confidenceScore: 90, requiredAction: null };
    expect(hasMatchResultChanged(previous, matchResult({ matchedBillId: 8 }))).toBe(true);
  });
  it("Allocation: false when nothing differs", () => {
    const previous = { allocationStatus: "Allocated" as const, suggestedGlAccount: "5000", suggestedVatCode: "STD", allocationMethod: "Matched Bill" as const, requiredAction: null };
    expect(hasAllocationResultChanged(previous, allocationResult())).toBe(false);
  });
  it("Allocation: true when the GL account changed", () => {
    const previous = { allocationStatus: "Allocated" as const, suggestedGlAccount: "6000", suggestedVatCode: "STD", allocationMethod: "Matched Bill" as const, requiredAction: null };
    expect(hasAllocationResultChanged(previous, allocationResult())).toBe(true);
  });
});

describe("allocation_type mapping (Phase 29B, Section 6)", () => {
  it("Matching sets allocation_type = 'S' when a supplier is identified", () => {
    expect(matchResultToUpdate(matchResult()).allocation_type).toBe("S");
  });
  it("Matching leaves allocation_type untouched (absent) when Unmatched", () => {
    expect("allocation_type" in matchResultToUpdate(matchResult({ status: "Unmatched", matchedSupplierId: null, matchedBillId: null }))).toBe(false);
  });
  it("Matching's enrichment-only update never includes allocation_type", () => {
    expect("allocation_type" in matchResultEnrichmentUpdate(matchResult())).toBe(false);
  });
  it("Allocation sets allocation_type = 'G' when a GL account is derived — GL wins over Supplier", () => {
    expect((allocationResultToUpdate(allocationResult()) as { allocation_type?: string }).allocation_type).toBe("G");
  });
  it("Allocation falls back to 'S' when only a supplier is known (no GL derivable)", () => {
    expect((allocationResultToUpdate(allocationResult({ glAccount: null })) as { allocation_type?: string }).allocation_type).toBe("S");
  });
  it("Allocation leaves allocation_type untouched when nothing is known", () => {
    expect("allocation_type" in allocationResultToUpdate(allocationResult({ glAccount: null, supplierId: null, status: "Unallocated" }))).toBe(false);
  });
});

// -----------------------------------------------------------------------
// applyMatchResults — the real WHERE-clause protection, end to end.
// -----------------------------------------------------------------------
describe("applyMatchResults (Phase 29B — overwrite protection)", () => {
  it("1/2/3/4/5/6. cannot overwrite a manually allocated / accepted-AI / automatic-AI / Rule / Find&Recode / existing-supplier transaction's accounting status", async () => {
    const protectedCases: [string, Row][] = [
      ["manually allocated", row({ allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true, matched_supplier_id: 99 })],
      ["accepted AI", row({ allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true, suggested_gl_account: "6100" })],
      ["automatic AI allocation", row({ allocation_status: "Allocated", allocation_method: "Future AI", is_manual_override: false })],
      ["Banking Rule allocation", row({ allocation_status: "Allocated", allocation_method: null, rule_id: 5, is_manual_override: false })],
      ["Find & Recode", row({ allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true })],
      ["existing supplier allocation", row({ allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true, matched_supplier_id: 99 })],
    ];
    for (const [, seed] of protectedCases) {
      fake = fakeRef.current = makeFakeSupabase([seed]);
      await applyMatchResults(COMPANY, [matchResult({ bankTransactionId: seed.id as number, status: "Matched" })]);
      const after = fake.table.get(seed.id as number)!;
      expect(after.allocation_status).toBe(seed.allocation_status); // never downgraded/overwritten
      expect(after.allocation_method).toBe(seed.allocation_method);
    }
  });

  it("7. cannot modify a posted transaction (journal_id set), even if otherwise genuinely unallocated", async () => {
    fake = fakeRef.current = makeFakeSupabase([row({ journal_id: 555 })]);
    await applyMatchResults(COMPANY, [matchResult()]);
    const after = fake.table.get(1)!;
    expect(after.allocation_status).toBe("Unallocated");
    expect(after.matched_supplier_id).toBeNull();
    expect(fake.matchHistory).toHaveLength(0);
  });

  it("8. CAN still process a genuinely unallocated transaction — the ordinary, unprotected case", async () => {
    fake = fakeRef.current = makeFakeSupabase([row()]);
    await applyMatchResults(COMPANY, [matchResult()]);
    const after = fake.table.get(1)!;
    expect(after.allocation_status).toBe("Matched");
    expect(after.matched_supplier_id).toBe(42);
    expect(after.matched_bill_id).toBe(7);
    expect(after.allocation_type).toBe("S");
    expect(fake.matchHistory).toHaveLength(1);
  });

  it("9. legitimate enrichment: GL already allocated (Manual/AI/Rule), supplier NULL → Matching identifies the supplier WITHOUT touching accounting status", async () => {
    fake = fakeRef.current = makeFakeSupabase([row({ allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true, suggested_gl_account: "5000", allocation_type: "G", matched_supplier_id: null })]);
    await applyMatchResults(COMPANY, [matchResult({ status: "Matched" })]);
    const after = fake.table.get(1)!;
    // Enrichment applied:
    expect(after.matched_supplier_id).toBe(42);
    expect(after.matched_bill_id).toBe(7);
    // Accounting decision fully preserved:
    expect(after.allocation_status).toBe("Allocated");
    expect(after.allocation_method).toBe("Manual");
    expect(after.suggested_gl_account).toBe("5000");
    expect(after.allocation_type).toBe("G"); // NOT overwritten to 'S'
    expect(fake.matchHistory).toHaveLength(1);
    expect(fake.matchHistory[0]!.new_status).toBe("Allocated"); // recorded honestly — no status change occurred
  });

  it("an already-identified (human-assigned) supplier is never replaced by the enrichment path either", async () => {
    fake = fakeRef.current = makeFakeSupabase([row({ allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true, matched_supplier_id: 99 })]);
    await applyMatchResults(COMPANY, [matchResult({ matchedSupplierId: 42 })]);
    expect(fake.table.get(1)!.matched_supplier_id).toBe(99); // untouched — still the human's supplier
    expect(fake.matchHistory).toHaveLength(0);
  });

  it("11. GL result → allocation_type 'S' for a genuinely unallocated transaction matched to a supplier", async () => {
    fake = fakeRef.current = makeFakeSupabase([row()]);
    await applyMatchResults(COMPANY, [matchResult()]);
    expect(fake.table.get(1)!.allocation_type).toBe("S");
  });

  it("14. running the identical match result twice does not create duplicate history", async () => {
    fake = fakeRef.current = makeFakeSupabase([row()]);
    await applyMatchResults(COMPANY, [matchResult()]);
    expect(fake.matchHistory).toHaveLength(1);
    await applyMatchResults(COMPANY, [matchResult()]); // identical result, second run
    expect(fake.matchHistory).toHaveLength(1); // no duplicate
  });

  it("15. a protected transaction remains byte-for-byte unchanged when Matching finds nothing new to enrich", async () => {
    const seed = row({ allocation_status: "Allocated", allocation_method: "Future AI", is_manual_override: false, matched_supplier_id: 99, suggested_gl_account: "6100" });
    fake = fakeRef.current = makeFakeSupabase([seed]);
    await applyMatchResults(COMPANY, [matchResult({ matchedSupplierId: 42 })]); // different supplier found
    expect(fake.table.get(1)!).toEqual(seed); // completely untouched — already has a supplier
  });
});

// -----------------------------------------------------------------------
// applyAllocationResults — the real WHERE-clause protection, end to end.
// -----------------------------------------------------------------------
describe("applyAllocationResults (Phase 29B — overwrite protection)", () => {
  it("1/2/3/4. cannot overwrite manually allocated / accepted-AI / automatic-AI / Rule-allocated transactions at all", async () => {
    const cases: Row[] = [
      row({ allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true, suggested_gl_account: "6100" }),
      row({ allocation_status: "Allocated", allocation_method: "Future AI", is_manual_override: false, suggested_gl_account: "6940" }),
      row({ allocation_status: "Allocated", allocation_method: null, rule_id: 5, is_manual_override: false, suggested_gl_account: "6800" }),
    ];
    for (const seed of cases) {
      fake = fakeRef.current = makeFakeSupabase([seed]);
      await applyAllocationResults(COMPANY, [allocationResult({ glAccount: "9999" })]);
      expect(fake.table.get(1)!.suggested_gl_account).toBe(seed.suggested_gl_account); // never overwritten
      expect(fake.allocationHistory).toHaveLength(0);
    }
  });

  it("7. cannot modify a posted transaction", async () => {
    fake = fakeRef.current = makeFakeSupabase([row({ journal_id: 555 })]);
    await applyAllocationResults(COMPANY, [allocationResult()]);
    expect(fake.table.get(1)!.suggested_gl_account).toBeNull();
    expect(fake.allocationHistory).toHaveLength(0);
  });

  it("8/9/10. CAN process a genuinely unallocated transaction and set the correct allocation_type", async () => {
    fake = fakeRef.current = makeFakeSupabase([row()]);
    await applyAllocationResults(COMPANY, [allocationResult()]);
    const after = fake.table.get(1)!;
    expect(after.allocation_status).toBe("Allocated");
    expect(after.suggested_gl_account).toBe("5000");
    expect(after.allocation_type).toBe("G"); // 12. GL result → G
    expect(after.allocation_method).toBe("Matched Bill");
    expect(fake.allocationHistory).toHaveLength(1);
  });

  it("13. customer/supplier-only allocation result → allocation_type 'S' (no GL derivable)", async () => {
    fake = fakeRef.current = makeFakeSupabase([row({ matched_supplier_id: 42 })]);
    await applyAllocationResults(COMPANY, [allocationResult({ glAccount: null, vatCode: null, status: "Suggested", allocationMethod: null })]);
    expect(fake.table.get(1)!.allocation_type).toBe("S");
  });

  it("CAN re-run and refine its OWN prior allocation (allocation_method already 'Matched Bill'/'Supplier Default')", async () => {
    fake = fakeRef.current = makeFakeSupabase([row({ allocation_status: "Allocated", allocation_method: "Supplier Default", suggested_gl_account: "5000" })]);
    await applyAllocationResults(COMPANY, [allocationResult({ glAccount: "5100", allocationMethod: "Matched Bill" })]);
    expect(fake.table.get(1)!.suggested_gl_account).toBe("5100");
  });

  it("14. running the identical allocation result twice does not create duplicate history", async () => {
    fake = fakeRef.current = makeFakeSupabase([row()]);
    await applyAllocationResults(COMPANY, [allocationResult()]);
    expect(fake.allocationHistory).toHaveLength(1);
    await applyAllocationResults(COMPANY, [allocationResult()]);
    expect(fake.allocationHistory).toHaveLength(1);
  });

  it("preserves the established audit vocabulary — allocation_method recorded in history is exactly 'Matched Bill'/'Supplier Default', never renamed", async () => {
    fake = fakeRef.current = makeFakeSupabase([row()]);
    await applyAllocationResults(COMPANY, [allocationResult({ allocationMethod: "Supplier Default" })]);
    expect(fake.allocationHistory[0]!.allocation_method).toBe("Supplier Default");
  });
});

// -----------------------------------------------------------------------
// Company isolation — verified structurally: every fake call includes an
// explicit company_id filter, matching the real repository's own
// unconditional `.eq("company_id", companyId)` on every query.
// -----------------------------------------------------------------------
describe("company isolation (Phase 29B)", () => {
  it("applyMatchResults never touches a transaction belonging to a different company", async () => {
    fake = fakeRef.current = makeFakeSupabase([row({ id: 1, company_id: "company-OTHER" })]);
    await applyMatchResults(COMPANY, [matchResult({ bankTransactionId: 1 })]);
    expect(fake.table.get(1)!.allocation_status).toBe("Unallocated"); // untouched — wrong company
  });

  it("applyAllocationResults never touches a transaction belonging to a different company", async () => {
    fake = fakeRef.current = makeFakeSupabase([row({ id: 1, company_id: "company-OTHER" })]);
    await applyAllocationResults(COMPANY, [allocationResult({ bankTransactionId: 1 })]);
    expect(fake.table.get(1)!.suggested_gl_account).toBeNull();
  });
});
