/**
 * Migration 0100 — the repository half of atomic Banking Rule posting:
 * the two RPC wrappers pass exactly the arguments the database functions
 * take and normalise their answers; the journal lookup is batched and
 * company-scoped; and the database's double-post guard reads as "not
 * linked" to Generate Journal instead of crashing it. The database
 * behaviour itself is tested in supabase/tests/atomic_rule_engine_posting.test.sql.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fakeRef } = vi.hoisted(() => ({ fakeRef: { current: undefined as unknown } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeRef.current }));
vi.mock("@/server/auth/require-session", () => ({ getPerformedByLabel: async () => "System" }));

import { isRuleEngineJournalGuardError, linkTransactionToJournal, listRuleEngineJournalsForTransactions } from "./journal-repository";
import { postRuleEngineJournalAtomic, recoverRuleEngineJournalLink } from "./posting-repository";
import {
  applyRuleActions,
  buildRuleClaim,
  countUnprocessedTransactions,
  listRuleEngineRecoveryCandidates,
  listRuleEngineWorklistPage,
  ruleEngineWorklistCursorAfter,
} from "./transaction-explorer-repository";
import { listTransactionIdsWithOpenException } from "./banking-exception-repository";

type Call = { method: string; args: unknown[] };

/** Records the builder chain and resolves with whatever `respond` returns. */
function fakeSupabase(respond: (calls: Call[]) => { data: unknown; error: unknown }) {
  const queries: Call[][] = [];
  function builderFor(calls: Call[]) {
    queries.push(calls);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "update", "eq", "is", "in", "returns"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(respond(calls)).then(resolve, reject);
    return builder;
  }
  const rpc = vi.fn((name: string, params: unknown) => builderFor([{ method: "rpc", args: [name, params] }]));
  const from = (table: string) => builderFor([{ method: "from", args: [table] }]);
  return { client: { from, rpc }, queries, rpc };
}

describe("postRuleEngineJournalAtomic / recoverRuleEngineJournalLink", () => {
  const journal = {
    journalDate: "2026-09-16",
    journalType: "Bank Transaction Automation",
    description: "Automated",
    reference: "",
    financialYearLabel: "FY2027",
    financialPeriod: 7,
    lines: [
      { accountCode: "6940", debit: 6435, credit: 0, description: "Salaries" },
      { accountCode: "1020", debit: 0, credit: 6435, description: "Salaries" },
    ],
  };

  it("calls fn_post_rule_engine_journal with this one transaction and normalises the answer", async () => {
    const fake = fakeSupabase(() => ({ data: { outcome: "posted", transactionId: 2151, journalId: "900", journalNumber: "JR000900", batchId: 800, batchNumber: "PB000800", journalStatus: "Posted" }, error: null }));
    fakeRef.current = fake.client;

    const claim = { ruleId: 153, ruleName: "Salaries", matchedRuleIds: [153], suggestedGlAccount: "6940", allocationStatus: "Suggested" };
    const outcome = await postRuleEngineJournalAtomic("co_1", 2151, journal, "System", "2026-09-16", claim);

    expect(fake.rpc).toHaveBeenCalledWith("fn_post_rule_engine_journal", {
      p_company_id: "co_1",
      p_transaction_id: 2151,
      p_journal: journal,
      p_posted_by: "System",
      p_posting_date: "2026-09-16",
      p_claim: claim,
    });
    expect(outcome).toEqual({ outcome: "posted", transactionId: 2151, journalId: 900, journalNumber: "JR000900", journalStatus: "Posted", batchId: 800, batchNumber: "PB000800", reason: null });
  });

  it("calls fn_recover_rule_engine_journal_link and fills absent fields with null", async () => {
    const fake = fakeSupabase(() => ({ data: { outcome: "no_journal", transactionId: 7 }, error: null }));
    fakeRef.current = fake.client;

    const outcome = await recoverRuleEngineJournalLink("co_1", 7, "Scheduler (cron)");

    expect(fake.rpc).toHaveBeenCalledWith("fn_recover_rule_engine_journal_link", { p_company_id: "co_1", p_transaction_id: 7, p_performed_by: "Scheduler (cron)" });
    expect(outcome).toEqual({ outcome: "no_journal", transactionId: 7, journalId: null, journalNumber: null, journalStatus: null, batchId: null, batchNumber: null, reason: null });
  });

  it("throws database errors (validation or outage) to the caller — nothing is swallowed here", async () => {
    fakeRef.current = fakeSupabase(() => ({ data: null, error: { message: "VYRON_RULE_POST_UNBALANCED: debit 1 <> credit 2." } })).client;
    await expect(postRuleEngineJournalAtomic("co_1", 1, journal, "System", "2026-09-16", {})).rejects.toMatchObject({ message: expect.stringContaining("UNBALANCED") });
  });
});

describe("listRuleEngineJournalsForTransactions", () => {
  beforeEach(() => {
    fakeRef.current = undefined;
  });

  it("returns an empty map without querying when there is nothing to look up", async () => {
    const fake = fakeSupabase(() => ({ data: [], error: null }));
    fakeRef.current = fake.client;
    expect((await listRuleEngineJournalsForTransactions("co_1", [])).size).toBe(0);
    expect(fake.queries).toHaveLength(0);
  });

  it("queries only this company's Banking Rule journals, in chunks, and keys them by transaction", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    const fake = fakeSupabase((calls) => {
      const inCall = calls.find((c) => c.method === "in");
      const chunk = (inCall?.args[1] as number[]) ?? [];
      return { data: chunk.filter((id) => id % 100 === 0).map((id) => ({ id: id + 10_000, journal_number: `JR${id}`, status: "Posted", is_reversed: null, source_id: String(id) })), error: null };
    });
    fakeRef.current = fake.client;

    const result = await listRuleEngineJournalsForTransactions("co_1", [...ids, 1, 2]);

    expect(fake.queries).toHaveLength(3);
    for (const calls of fake.queries) {
      expect(calls).toEqual(expect.arrayContaining([
        { method: "from", args: ["ae_journals"] },
        { method: "eq", args: ["company_id", "co_1"] },
        { method: "eq", args: ["source_type", "bank_transaction_rule_engine"] },
      ]));
      expect((calls.find((c) => c.method === "in")!.args[1] as number[]).length).toBeLessThanOrEqual(200);
    }
    expect([...result.keys()]).toEqual([100, 200, 300, 400]);
    expect(result.get(300)).toEqual({ id: 10_300, journalNumber: "JR300", status: "Posted", isReversed: false, sourceId: 300 });
  });
});

describe("linkTransactionToJournal — the 0100 trigger refusal", () => {
  it("recognises the guard error", () => {
    expect(isRuleEngineJournalGuardError({ message: "VYRON_RULE_ENGINE_JOURNAL_EXISTS: bank transaction 2151 ..." })).toBe(true);
    expect(isRuleEngineJournalGuardError({ message: "duplicate key" })).toBe(false);
    expect(isRuleEngineJournalGuardError(null)).toBe(false);
  });

  it("reports the refusal as not linked", async () => {
    fakeRef.current = fakeSupabase(() => ({ data: null, error: { code: "P0001", message: "VYRON_RULE_ENGINE_JOURNAL_EXISTS: bank transaction 2151 is already carried by Banking Rule journal JR000264 (Posted)" } })).client;
    await expect(linkTransactionToJournal("co_1", 2151, 500)).resolves.toBe(false);
  });

  it("still throws any other error", async () => {
    fakeRef.current = fakeSupabase(() => ({ data: null, error: { message: "permission denied" } })).client;
    await expect(linkTransactionToJournal("co_1", 2151, 500)).rejects.toMatchObject({ message: "permission denied" });
  });

  it("links normally, guarded by journal_id IS NULL and the company", async () => {
    const fake = fakeSupabase(() => ({ data: [{ id: 1 }], error: null }));
    fakeRef.current = fake.client;
    await expect(linkTransactionToJournal("co_1", 1, 500)).resolves.toBe(true);
    expect(fake.queries[0]).toEqual(expect.arrayContaining([
      { method: "update", args: [{ journal_id: 500 }] },
      { method: "eq", args: ["company_id", "co_1"] },
      { method: "is", args: ["journal_id", null] },
    ]));
  });
});

describe("the Banking Rule claim (migration 0100, M1 / H2)", () => {
  it("buildRuleClaim sends only the fields the rule resolved, plus the rule and the matched rules", () => {
    expect(buildRuleClaim({ suggestedGlAccount: "6940", suggestedVatCode: undefined, ruleId: 153, allocationStatus: "Suggested", matchedSupplierId: undefined }, "Salaries", [153, 9])).toEqual({
      ruleName: "Salaries",
      matchedRuleIds: [153, 9],
      suggestedGlAccount: "6940",
      ruleId: 153,
      allocationStatus: "Suggested",
    });
    expect(buildRuleClaim({ ruleId: 1 }, "R", [1], "Scheduler (cron)")).toEqual({ ruleName: "R", matchedRuleIds: [1], ruleId: 1, performedBy: "Scheduler (cron)" });
  });

  it("applyRuleActions is one fn_claim_bank_transaction_for_rule call and reports the database's answer", async () => {
    const fake = fakeSupabase(() => ({ data: true, error: null }));
    fakeRef.current = fake.client;
    await expect(applyRuleActions("co_1", 7, { ruleId: 3, suggestedGlAccount: "6100", allocationStatus: "Suggested" }, "Fees", "System", [3])).resolves.toBe(true);
    expect(fake.rpc).toHaveBeenCalledWith("fn_claim_bank_transaction_for_rule", {
      p_company_id: "co_1",
      p_transaction_id: 7,
      p_claim: { ruleName: "Fees", matchedRuleIds: [3], ruleId: 3, suggestedGlAccount: "6100", allocationStatus: "Suggested" },
      p_performed_by: "System",
    });
    // No separate table writes any more.
    expect(fake.queries.every((calls) => calls[0]!.method === "rpc")).toBe(true);

    fakeRef.current = fakeSupabase(() => ({ data: false, error: null })).client;
    await expect(applyRuleActions("co_1", 7, { ruleId: 3 }, "Fees", "System")).resolves.toBe(false);
  });

  it("applyRuleActions with nothing to write makes no call (unchanged)", async () => {
    const fake = fakeSupabase(() => ({ data: true, error: null }));
    fakeRef.current = fake.client;
    await expect(applyRuleActions("co_1", 7, {}, "Fees", "System")).resolves.toBe(true);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("applyRuleActions throws database errors", async () => {
    fakeRef.current = fakeSupabase(() => ({ data: null, error: { message: "VYRON_RULE_CLAIM_RULE_MISMATCH: every rule must belong to company co_1." } })).client;
    await expect(applyRuleActions("co_1", 7, { ruleId: 3 }, "Fees", "System")).rejects.toMatchObject({ message: expect.stringContaining("RULE_MISMATCH") });
  });
});

describe("the paged worklist (migration 0100, M2)", () => {
  it("asks for one keyset page of this company's worklist, capped at the API's 1,000 rows", async () => {
    const fake = fakeSupabase(() => ({ data: [], error: null }));
    fakeRef.current = fake.client;
    await listRuleEngineWorklistPage("co_1", { claimableOnly: true, after: null, limit: 5000 });
    await listRuleEngineWorklistPage("co_1", { claimableOnly: false, after: { sortDate: "2026-03-27", id: 2151 }, limit: 500 });
    expect(fake.rpc).toHaveBeenNthCalledWith(1, "fn_list_rule_engine_worklist", { p_company_id: "co_1", p_claimable_only: true, p_after_sort_date: null, p_after_id: null, p_limit: 1000 });
    expect(fake.rpc).toHaveBeenNthCalledWith(2, "fn_list_rule_engine_worklist", { p_company_id: "co_1", p_claimable_only: false, p_after_sort_date: "2026-03-27", p_after_id: 2151, p_limit: 500 });
    expect(fake.queries[0]).toEqual(expect.arrayContaining([{ method: "select", args: [expect.stringContaining("matched_supplier")] }]));
  });

  it("maps the page's rows like every other transaction read", async () => {
    fakeRef.current = fakeSupabase(() => ({ data: [{ id: 5, company_id: "co_1", transaction_date: null, debit: "10.00", credit: "0", journal_id: null, entry_source: "Imported", matched_supplier: null }], error: null })).client;
    const [row] = await listRuleEngineWorklistPage("co_1", { claimableOnly: false, after: null, limit: 10 });
    expect(row).toMatchObject({ id: 5, companyId: "co_1", debit: 10, journalId: null });
  });

  it("the cursor carries the last row's date (a missing date sorts as infinity) and id", () => {
    expect(ruleEngineWorklistCursorAfter({ id: 9, transactionDate: "2026-03-27" })).toEqual({ sortDate: "2026-03-27", id: 9 });
    expect(ruleEngineWorklistCursorAfter({ id: 9, transactionDate: null as unknown as string })).toEqual({ sortDate: "infinity", id: 9 });
  });

  it("lists recovery candidates directly and never asks for a non-positive page", async () => {
    const fake = fakeSupabase(() => ({ data: [], error: null }));
    fakeRef.current = fake.client;
    await expect(listRuleEngineRecoveryCandidates("co_1", 0)).resolves.toEqual([]);
    expect(fake.rpc).not.toHaveBeenCalled();
    await listRuleEngineRecoveryCandidates("co_1", 150);
    expect(fake.rpc).toHaveBeenCalledWith("fn_list_rule_engine_recovery_candidates", { p_company_id: "co_1", p_limit: 150 });
  });

  it("counts the company's unposted transactions without fetching them", async () => {
    const fake = fakeSupabase(() => ({ data: null, error: null, count: 1091 }) as { data: unknown; error: unknown });
    fakeRef.current = fake.client;
    await expect(countUnprocessedTransactions("co_1")).resolves.toBe(1091);
    expect(fake.queries[0]).toEqual(expect.arrayContaining([
      { method: "from", args: ["ae_bank_transactions"] },
      { method: "select", args: ["id", { count: "exact", head: true }] },
      { method: "eq", args: ["company_id", "co_1"] },
      { method: "is", args: ["journal_id", null] },
    ]));
  });

  it("looks open exceptions up in company-scoped chunks", async () => {
    const fake = fakeSupabase((calls) => {
      const chunk = calls.find((c) => c.method === "in")!.args[1] as number[];
      return { data: chunk.filter((id) => id % 50 === 0).map((id) => ({ bank_transaction_id: String(id) })), error: null };
    });
    fakeRef.current = fake.client;
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    const result = await listTransactionIdsWithOpenException("co_1", "UnknownMerchant", ids);
    expect(fake.queries).toHaveLength(3);
    expect(fake.queries[0]).toEqual(expect.arrayContaining([
      { method: "eq", args: ["company_id", "co_1"] },
      { method: "eq", args: ["exception_type", "UnknownMerchant"] },
      { method: "eq", args: ["status", "Open"] },
    ]));
    expect([...result].sort((a, b) => a - b)).toEqual([50, 100, 150, 200, 250, 300, 350, 400, 450]);
  });
});
