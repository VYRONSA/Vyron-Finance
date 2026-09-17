/**
 * Phase 53 — Banking Rule precedence over unconfirmed AI suggestions.
 *
 * Phase 52's forensic investigation proved a permanent-lock defect: once
 * the AI Classification Sweep (`fn_apply_ai_classification`, migration
 * 0087) stamped an unconfirmed guess on a transaction, `applyRuleActions`'s
 * original guard (`allocation_status = 'Unallocated' AND suggested_gl_account
 * IS NULL`, unconditionally) meant NO Banking Rule created afterwards
 * could ever claim it — not on the next import, not on any future
 * `RuleEngineRun` recovery pass. Required precedence: BANKING RULE >
 * UNCONFIRMED AI SUGGESTION > UNALLOCATED, while HUMAN CONFIRMED
 * (`is_manual_override = true`) / POSTED (`journal_id IS NOT NULL`) still
 * beat everything automatic.
 *
 * This exercises the REAL `applyRuleActions` and `applyAiClassification`
 * (unmocked, imported directly from `transaction-explorer-repository.ts`)
 * against a small in-memory Postgres/PostgREST double — the same "isolated
 * test fixture" seam Phase 49A established
 * (`find-and-recode.integration.test.tsx`: mock ONLY `createClient` from
 * `@/lib/supabase/server`, run the real repository code against fake
 * rows). No production database is touched. `applyAiClassification`'s fake
 * RPC handler mirrors `fn_apply_ai_classification`'s actual SQL guard
 * (migration 0087_ai_classification_allocation_type.sql) field-for-field,
 * not a guess — this is what makes the "Rule first -> AI cannot overwrite
 * it" race tests below a genuine proof rather than a tautology against a
 * hand-waved fake.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function makeFakeSupabase(tables: Tables) {
  function parseClause(clause: string): (row: Row) => boolean {
    const firstDot = clause.indexOf(".");
    const secondDot = clause.indexOf(".", firstDot + 1);
    const col = clause.slice(0, firstDot);
    const op = clause.slice(firstDot + 1, secondDot);
    let val: string | null = clause.slice(secondDot + 1);
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (op === "is") return (row) => (row[col] ?? null) === (val === "null" ? null : val);
    if (op === "eq") return (row) => row[col] === val;
    throw new Error(`banking-rule-precedence fake: unsupported or() operator "${op}"`);
  }
  function splitTopLevel(expr: string): string[] {
    const terms: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of expr) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        terms.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    if (cur) terms.push(cur);
    return terms;
  }
  function parseOrTerm(term: string): (row: Row) => boolean {
    const andMatch = term.match(/^and\((.*)\)$/);
    if (andMatch) {
      const subFilters = splitTopLevel(andMatch[1]).map(parseClause);
      return (row) => subFilters.every((f) => f(row));
    }
    return parseClause(term);
  }

  function query(table: string) {
    let mode: "select" | "update" | "insert" = "select";
    let updatePayload: Row | null = null;
    let insertRows: Row[] = [];
    const filters: ((row: Row) => boolean)[] = [];
    let single = false;

    const builder = {
      select() {
        return builder;
      },
      update(payload: Row) {
        mode = "update";
        updatePayload = payload;
        return builder;
      },
      insert(payload: Row | Row[]) {
        mode = "insert";
        insertRows = Array.isArray(payload) ? payload : [payload];
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      is(col: string, val: unknown) {
        filters.push((r) => (r[col] ?? null) === val);
        return builder;
      },
      or(expr: string) {
        const termFilters = splitTopLevel(expr).map(parseOrTerm);
        filters.push((r) => termFilters.some((f) => f(r)));
        return builder;
      },
      maybeSingle() {
        single = true;
        return builder;
      },
      select_id() {
        return builder;
      },
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        if (mode === "insert") {
          tables[table] = tables[table] ?? [];
          tables[table].push(...insertRows);
          resolve({ data: insertRows, error: null });
          return;
        }
        const rows = tables[table] ?? [];
        const matched = rows.filter((r) => filters.every((f) => f(r)));
        if (mode === "update") {
          for (const row of matched) Object.assign(row, updatePayload);
          resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
          return;
        }
        if (single) {
          resolve({ data: matched[0] ?? null, error: null });
          return;
        }
        resolve({ data: matched, error: null });
      },
    };
    return builder;
  }

  // Mirrors `fn_apply_ai_classification`'s real SQL WHERE clause
  // (migration 0087_ai_classification_allocation_type.sql lines 52-68)
  // field-for-field, so a test proving "AI can never re-claim a
  // Rule-owned transaction" is verifying the actual production guard,
  // not a stand-in.
  // Mirrors migration 0100's `fn_claim_bank_transaction_for_rule` (and its
  // `fn_bank_transaction_is_claimable_by_rule` guard) field-for-field — the
  // single write `applyRuleActions` makes since 0100. The real function is
  // exercised in supabase/tests/atomic_rule_engine_posting.test.sql.
  function claimForRule(params: Record<string, unknown>): { data: unknown; error: unknown } {
    const claim = params.p_claim as Record<string, unknown>;
    const has = (key: string) => Object.prototype.hasOwnProperty.call(claim, key);
    const settable = ["matchedMerchantId", "matchedSupplierId", "matchedCustomerId", "suggestedGlAccount", "suggestedVatCode", "ruleId", "allocationStatus"];
    if (!settable.some(has)) return { data: true, error: null };
    const ruleIds = [...((claim.matchedRuleIds as number[] | undefined) ?? []), ...(has("ruleId") ? [claim.ruleId as number] : [])];
    const rules = tables["banking_rules"] ?? [];
    if (ruleIds.some((id) => !rules.some((r) => r.id === id && r.company_id === params.p_company_id))) {
      return { data: null, error: { message: "VYRON_RULE_CLAIM_RULE_MISMATCH: every rule must belong to the company." } };
    }
    const row = (tables["ae_bank_transactions"] ?? []).find(
      (r) =>
        r.company_id === params.p_company_id &&
        r.id === params.p_transaction_id &&
        (r.journal_id ?? null) === null &&
        r.is_manual_override === false &&
        (r.rule_id ?? null) === null &&
        (r.matched_supplier_id ?? null) === null &&
        (r.matched_customer_id ?? null) === null &&
        (r.matched_merchant_id ?? null) === null &&
        r.review_hold === false &&
        r.entry_source !== "Manual" &&
        ((r.allocation_status === "Unallocated" && (r.suggested_gl_account ?? null) === null) || r.allocation_method === "Future AI"),
    );
    if (!row) return { data: false, error: null };
    if (has("matchedMerchantId")) row.matched_merchant_id = claim.matchedMerchantId;
    if (has("matchedSupplierId")) row.matched_supplier_id = claim.matchedSupplierId;
    if (has("matchedCustomerId")) row.matched_customer_id = claim.matchedCustomerId;
    if (has("suggestedGlAccount")) row.suggested_gl_account = claim.suggestedGlAccount;
    if (has("suggestedVatCode")) row.suggested_vat_code = claim.suggestedVatCode;
    if (has("ruleId")) row.rule_id = claim.ruleId;
    if (has("allocationStatus")) row.allocation_status = claim.allocationStatus;
    if (has("matchedSupplierId")) row.allocation_type = "S";
    else if (has("matchedCustomerId")) row.allocation_type = "C";
    else if (has("suggestedGlAccount")) row.allocation_type = "G";
    if (has("ruleId")) row.allocation_method = null;
    tables["ae_allocation_history"] = tables["ae_allocation_history"] ?? [];
    tables["ae_allocation_history"].push({
      company_id: params.p_company_id,
      transaction_id: params.p_transaction_id,
      new_status: claim.allocationStatus,
      is_manual_override: false,
      performed_by: params.p_performed_by,
      allocation_reason: `Resolved by rule "${(claim.ruleName as string) || "Unnamed rule"}"`,
    });
    tables["banking_rule_applications"] = tables["banking_rule_applications"] ?? [];
    for (const ruleId of (claim.matchedRuleIds as number[] | undefined) ?? []) {
      tables["banking_rule_applications"].push({ company_id: params.p_company_id, rule_id: ruleId, bank_transaction_id: params.p_transaction_id });
    }
    return { data: true, error: null };
  }

  function rpc(name: string, params: Record<string, unknown>) {
    return {
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        if (name === "fn_claim_bank_transaction_for_rule") {
          resolve(claimForRule(params));
          return;
        }
        if (name !== "fn_apply_ai_classification") throw new Error(`banking-rule-precedence fake: unsupported rpc "${name}"`);
        const rows = tables["ae_bank_transactions"] ?? [];
        const row = rows.find(
          (r) =>
            r.company_id === params.p_company_id &&
            r.id === params.p_transaction_id &&
            (r.journal_id ?? null) === null &&
            r.allocation_status === "Unallocated" &&
            (r.suggested_gl_account ?? null) === null &&
            (r.rule_id ?? null) === null &&
            (r.matched_supplier_id ?? null) === null &&
            (r.matched_customer_id ?? null) === null &&
            (r.matched_merchant_id ?? null) === null &&
            r.is_manual_override === false,
        );
        if (!row) {
          resolve({ data: { claimed: false }, error: null });
          return;
        }
        row.suggested_gl_account = params.p_suggested_gl_account;
        row.allocation_status = params.p_target_status ?? "Suggested";
        row.allocation_method = "Future AI";
        row.allocation_type = "G";
        row.is_manual_override = false;
        tables["ae_allocation_history"] = tables["ae_allocation_history"] ?? [];
        tables["ae_allocation_history"].push({
          company_id: params.p_company_id,
          transaction_id: params.p_transaction_id,
          new_status: row.allocation_status,
          allocation_method: "Future AI",
          is_manual_override: false,
          performed_by: params.p_performed_by,
        });
        resolve({ data: { claimed: true }, error: null });
      },
    };
  }

  return { from: (table: string) => query(table), rpc };
}

const COMPANY = "co_1";

function txnRow(overrides: Row = {}): Row {
  return {
    id: 791,
    company_id: COMPANY,
    allocation_status: "Unallocated",
    allocation_method: null,
    allocation_type: null,
    suggested_gl_account: null,
    suggested_vat_code: null,
    matched_supplier_id: null,
    matched_customer_id: null,
    matched_merchant_id: null,
    rule_id: null,
    is_manual_override: false,
    journal_id: null,
    // Migration 0094 — the real column defaults to false, and
    // `applyRuleActions` now filters on it, so the fake row must carry
    // it too or every rule application silently matches nothing.
    review_hold: false,
    entry_source: "Imported",
    ...overrides,
  };
}

let currentTables: Tables;
let fakeSupabase: ReturnType<typeof makeFakeSupabase>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fakeSupabase),
}));

let applyRuleActions: typeof import("./transaction-explorer-repository").applyRuleActions;
let applyAiClassification: typeof import("./transaction-explorer-repository").applyAiClassification;

beforeEach(async () => {
  currentTables = {
    ae_bank_transactions: [txnRow()],
    ae_allocation_history: [],
    banking_rules: [8, 9, 103, 106, 200].map((id) => ({ id, company_id: COMPANY })),
  };
  fakeSupabase = makeFakeSupabase(currentTables);
  vi.resetModules();
  const repo = await import("./transaction-explorer-repository");
  applyRuleActions = repo.applyRuleActions;
  applyAiClassification = repo.applyAiClassification;
});

function row(): Row {
  return currentTables.ae_bank_transactions[0];
}

describe("Phase 53 — applyRuleActions: BANKING RULE > UNCONFIRMED AI SUGGESTION > UNALLOCATED", () => {
  it("1. Rule matches an untouched (Unallocated) transaction -> allocated (GL rule, baseline unchanged behaviour)", async () => {
    const applied = await applyRuleActions(COMPANY, 791, { suggestedGlAccount: "6940", ruleId: 106, allocationStatus: "Suggested" }, "Auto: GL rule", "System");
    expect(applied).toBe(true);
    expect(row()).toMatchObject({ suggested_gl_account: "6940", rule_id: 106, allocation_status: "Suggested", allocation_type: "G", allocation_method: null });
    expect(currentTables.ae_allocation_history).toHaveLength(1);
    expect(currentTables.ae_allocation_history[0]).toMatchObject({ allocation_reason: 'Resolved by rule "Auto: GL rule"' });
  });

  it("2. Rule matches a transaction carrying an unconfirmed AI suggestion (Future AI) -> the Banking Rule replaces it (the Phase 52 permanent-lock fix)", async () => {
    currentTables.ae_bank_transactions[0] = txnRow({
      allocation_status: "Suggested",
      allocation_method: "Future AI",
      suggested_gl_account: "6940", // AI's generic guess, e.g. "Purchases"
      is_manual_override: false,
    });

    const applied = await applyRuleActions(COMPANY, 791, { matchedSupplierId: 636, ruleId: 106, allocationStatus: "Allocated" }, "Auto: Three Streams Cut002 -> Supplier", "System");

    expect(applied).toBe(true);
    expect(row()).toMatchObject({
      matched_supplier_id: 636,
      rule_id: 106,
      allocation_status: "Allocated",
      allocation_type: "S",
      // stale "Future AI" tag cleared — a rule-owned row must not still claim to be an AI suggestion
      allocation_method: null,
    });
    const latestHistory = currentTables.ae_allocation_history.at(-1);
    expect(latestHistory).toMatchObject({ allocation_reason: 'Resolved by rule "Auto: Three Streams Cut002 -> Supplier"', new_status: "Allocated" });
  });

  it("9. Supplier rule replaces an unconfirmed AI GL suggestion", async () => {
    currentTables.ae_bank_transactions[0] = txnRow({ allocation_status: "Suggested", allocation_method: "Future AI", suggested_gl_account: "6940" });
    const applied = await applyRuleActions(COMPANY, 791, { matchedSupplierId: 636, ruleId: 9, allocationStatus: "Allocated" }, "Fish -> Supplier", "System");
    expect(applied).toBe(true);
    expect(row()).toMatchObject({ matched_supplier_id: 636, allocation_type: "S", allocation_status: "Allocated", allocation_method: null });
  });

  it("10. GL rule replaces an unconfirmed AI GL suggestion (a different, more specific GL code winning over AI's generic guess)", async () => {
    currentTables.ae_bank_transactions[0] = txnRow({ allocation_status: "Suggested", allocation_method: "Future AI", suggested_gl_account: "9999" });
    const applied = await applyRuleActions(COMPANY, 791, { suggestedGlAccount: "6100", ruleId: 103, allocationStatus: "Suggested" }, "Auto: FNB Card -> GL", "System");
    expect(applied).toBe(true);
    expect(row()).toMatchObject({ suggested_gl_account: "6100", allocation_type: "G", allocation_method: null });
  });

  it("11. Customer rule replaces an unconfirmed AI GL suggestion", async () => {
    currentTables.ae_bank_transactions[0] = txnRow({ allocation_status: "Suggested", allocation_method: "Future AI", suggested_gl_account: "6940" });
    const applied = await applyRuleActions(COMPANY, 791, { matchedCustomerId: 55, ruleId: 200, allocationStatus: "Allocated" }, "Auto: Acme -> Customer", "System");
    expect(applied).toBe(true);
    expect(row()).toMatchObject({ matched_customer_id: 55, allocation_type: "C", allocation_status: "Allocated", allocation_method: null });
  });

  it("12. VAT behaviour is unaffected — a rule setting GL + VAT together over an AI suggestion writes both atomically, unchanged shape", async () => {
    currentTables.ae_bank_transactions[0] = txnRow({ allocation_status: "Suggested", allocation_method: "Future AI", suggested_gl_account: "6940", suggested_vat_code: null });
    const applied = await applyRuleActions(COMPANY, 791, { suggestedGlAccount: "6100", suggestedVatCode: "STD", ruleId: 103, allocationStatus: "Suggested" }, "Auto: FNB Card -> GL+VAT", "System");
    expect(applied).toBe(true);
    expect(row()).toMatchObject({ suggested_gl_account: "6100", suggested_vat_code: "STD", allocation_type: "G" });
  });

  it("4. A human-confirmed manual allocation is never overwritten, even when a rule now matches", async () => {
    currentTables.ae_bank_transactions[0] = txnRow({ allocation_status: "Allocated", allocation_type: "S", matched_supplier_id: 636, allocation_method: "Manual", is_manual_override: true });
    const applied = await applyRuleActions(COMPANY, 791, { matchedSupplierId: 999, ruleId: 106, allocationStatus: "Allocated" }, "Auto: Three Streams Cut002 -> Supplier", "System");
    expect(applied).toBe(false);
    expect(row()).toMatchObject({ matched_supplier_id: 636, is_manual_override: true, allocation_method: "Manual" });
    expect(currentTables.ae_allocation_history).toHaveLength(0);
  });

  it("5. A posted transaction (journal_id set) is never overwritten, even when a rule now matches", async () => {
    currentTables.ae_bank_transactions[0] = txnRow({ journal_id: 900, allocation_status: "Allocated", allocation_type: "G", suggested_gl_account: "6100" });
    const applied = await applyRuleActions(COMPANY, 791, { suggestedGlAccount: "6940", ruleId: 106, allocationStatus: "Suggested" }, "Auto: GL rule", "System");
    expect(applied).toBe(false);
    expect(row()).toMatchObject({ journal_id: 900, suggested_gl_account: "6100" });
    expect(currentTables.ae_allocation_history).toHaveLength(0);
  });

  it("does not re-fight a transaction ALREADY owned by a different Banking Rule (rule_id already set, out of scope for this precedence rule)", async () => {
    currentTables.ae_bank_transactions[0] = txnRow({ allocation_status: "Suggested", allocation_type: "G", suggested_gl_account: "6100", rule_id: 8, allocation_method: null });
    const applied = await applyRuleActions(COMPANY, 791, { suggestedGlAccount: "6940", ruleId: 106, allocationStatus: "Suggested" }, "Auto: newer rule", "System");
    expect(applied).toBe(false);
    expect(row()).toMatchObject({ rule_id: 8, suggested_gl_account: "6100" });
  });

  it("does not silently override a Supplier Reconciliation Matching Engine identification (matched_supplier_id set, allocation_method 'Supplier Default', not an AI suggestion — unrelated subsystem, must stay out of scope)", async () => {
    currentTables.ae_bank_transactions[0] = txnRow({ allocation_status: "Allocated", allocation_type: "S", matched_supplier_id: 42, allocation_method: "Supplier Default", is_manual_override: false });
    const applied = await applyRuleActions(COMPANY, 791, { matchedSupplierId: 636, ruleId: 106, allocationStatus: "Allocated" }, "Auto: Three Streams Cut002 -> Supplier", "System");
    expect(applied).toBe(false);
    expect(row()).toMatchObject({ matched_supplier_id: 42, allocation_method: "Supplier Default" });
  });
});

describe("Migration 0100 — the claim is one database write", () => {
  it("records the matched rules' applications with the classification", async () => {
    const applied = await applyRuleActions(COMPANY, 791, { suggestedGlAccount: "6940", ruleId: 106, allocationStatus: "Suggested" }, "Auto: GL rule", "System", [106, 9]);
    expect(applied).toBe(true);
    expect(currentTables.banking_rule_applications).toEqual([
      { company_id: COMPANY, rule_id: 106, bank_transaction_id: 791 },
      { company_id: COMPANY, rule_id: 9, bank_transaction_id: 791 },
    ]);
  });

  it("never classifies a Manual Cashbook entry (H2), even one carrying only an AI suggestion", async () => {
    currentTables.ae_bank_transactions[0] = txnRow({ entry_source: "Manual", allocation_status: "Suggested", allocation_method: "Future AI", suggested_gl_account: "6940" });
    const applied = await applyRuleActions(COMPANY, 791, { suggestedGlAccount: "6100", ruleId: 106, allocationStatus: "Suggested" }, "Auto: GL rule", "System", [106]);
    expect(applied).toBe(false);
    expect(row()).toMatchObject({ suggested_gl_account: "6940", rule_id: null, allocation_method: "Future AI" });
    expect(currentTables.ae_allocation_history).toHaveLength(0);
  });

  it("does not classify a transaction on review hold (migration 0094, unchanged)", async () => {
    currentTables.ae_bank_transactions[0] = txnRow({ review_hold: true });
    await expect(applyRuleActions(COMPANY, 791, { suggestedGlAccount: "6940", ruleId: 106, allocationStatus: "Suggested" }, "Auto: GL rule", "System")).resolves.toBe(false);
  });

  it("surfaces a rule from another company as an error", async () => {
    await expect(applyRuleActions(COMPANY, 791, { suggestedGlAccount: "6940", ruleId: 5555, allocationStatus: "Suggested" }, "Foreign", "System")).rejects.toMatchObject({ message: expect.stringContaining("RULE_MISMATCH") });
    expect(row()).toMatchObject({ rule_id: null });
  });
});

describe("Phase 53 — race/ordering: correct regardless of which automatic process reaches the transaction first", () => {
  it("6. Rule first -> AI Classification Sweep can never subsequently overwrite it (fn_apply_ai_classification's own unchanged guard requires rule_id IS NULL)", async () => {
    const applied = await applyRuleActions(COMPANY, 791, { suggestedGlAccount: "6940", ruleId: 106, allocationStatus: "Suggested" }, "Auto: Three Streams Cut002 -> Supplier", "System");
    expect(applied).toBe(true);
    expect(row().rule_id).toBe(106);

    await applyAiClassification(COMPANY, 791, { suggestedGlAccount: "9999", confidence: 90, explanation: "AI guess", modelUsed: "test-model", targetStatus: "Suggested" }, "System").catch((e) => e);

    // AI's own claim was rejected (rule_id was no longer null) — the rule's
    // resolution is untouched.
    expect(row()).toMatchObject({ suggested_gl_account: "6940", rule_id: 106, allocation_method: null });
  });

  it("7. AI first -> the Rule Engine can subsequently take ownership (the exact permanent-lock scenario Phase 52 found live in production)", async () => {
    await applyAiClassification(COMPANY, 791, { suggestedGlAccount: "6940", confidence: 55, explanation: "generic guess", modelUsed: "test-model", targetStatus: "Suggested" }, "System");
    expect(row()).toMatchObject({ allocation_method: "Future AI", suggested_gl_account: "6940", rule_id: null });

    const applied = await applyRuleActions(COMPANY, 791, { matchedSupplierId: 636, ruleId: 106, allocationStatus: "Allocated" }, "Auto: Three Streams Cut002 -> Supplier", "System");

    expect(applied).toBe(true);
    expect(row()).toMatchObject({ matched_supplier_id: 636, rule_id: 106, allocation_type: "S", allocation_status: "Allocated", allocation_method: null });
  });
});
