// @vitest-environment node
/**
 * Migration 0100 — end-to-end scenarios for atomic Banking Rule posting:
 * the REAL rule engine, posting functions, Bank Posting and Generate
 * Journal, running against a LOCAL Supabase stack through PostgREST.
 *
 * Skipped unless RULE_POSTING_LOCAL_SUPABASE_URL (http://127.0.0.1 or
 * localhost only) and RULE_POSTING_LOCAL_SERVICE_ROLE_KEY are set. It
 * creates synthetic companies and deletes them afterwards.
 *
 * The concurrency checks fire genuinely parallel requests, so they race
 * inside Postgres on separate connections — the case the SQL test file
 * (one session) cannot cover.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { runWithServerExecutionContext } from "@/lib/supabase/execution-context";
import { postRuleEngineJournalAtomic, type RuleEngineJournalInput } from "@/server/repositories/posting-repository";
import { linkTransactionToJournal } from "@/server/repositories/journal-repository";
import { getTransactionsByIds } from "@/server/repositories/transaction-explorer-repository";
import { listActiveBankingRules } from "@/server/repositories/banking-rule-repository";
import { processTransaction, runRuleEngine, type RuleEnginePostingContext } from "./rule-processing-service";
import { postBankTransactions } from "./bank-posting-service";
import { generateJournalFromTransactions } from "./journal-service";
import { approveAndPostCashbookEntry } from "./cashbook-service";

const LOCAL_URL = process.env.RULE_POSTING_LOCAL_SUPABASE_URL ?? "";
const LOCAL_KEY = process.env.RULE_POSTING_LOCAL_SERVICE_ROLE_KEY ?? "";
const enabled = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(LOCAL_URL) && LOCAL_KEY.length > 0;

const RULE_SOURCE = "bank_transaction_rule_engine";

describe.skipIf(!enabled)("Atomic Banking Rule posting — local end-to-end scenarios (migration 0100)", () => {
  let admin: SupabaseClient;
  const orgId = randomUUID();
  const metanoia = randomUUID();
  const northwood = randomUUID();
  const bounded = randomUUID();
  const starve = randomUUID();
  const paged = randomUUID();
  const cashbook = randomUUID();
  const retry = randomUUID();
  const allCompanies = [metanoia, northwood, bounded, starve, paged, cashbook, retry];
  const bankAccount: Record<string, number> = {};
  const accountId: Record<string, Record<string, number>> = {};
  let serial = 0;
  const savedEnv = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };

  const asService = <T>(fn: () => Promise<T>) => runWithServerExecutionContext(admin, fn);

  async function must<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }

  async function insertTransactions(companyId: string, count: number, overrides: Record<string, unknown> = {}): Promise<number[]> {
    const rows = Array.from({ length: count }, () => {
      serial++;
      return {
        company_id: companyId,
        transaction_date: "2026-03-27",
        description: `SYN salary ${serial}`,
        import_description: `SYN salary ${serial}`,
        beneficiary: "Salaries",
        debit: 6435,
        credit: 0,
        bank_account: "Synthetic bank",
        bank_account_id: bankAccount[companyId],
        ...overrides,
      };
    });
    const data = await must(admin.from("ae_bank_transactions").insert(rows).select("id").order("id"));
    return (data as { id: number }[]).map((r) => Number(r.id));
  }

  /** The production failure state: a Posted Banking Rule journal with its
   * batch and ledger rows, and the transaction left unlinked. */
  async function legacyInterruptedPost(companyId: string, transactionId: number): Promise<number> {
    serial++;
    const batch = (await must(admin.from("posting_batches").insert({ company_id: companyId, batch_number: `PBSYN${serial}`, posting_date: "2026-09-16", journal_count: 1, transaction_count: 2, posted_by: "System" }).select("id").single())) as { id: number };
    const journal = (await must(admin.from("ae_journals").insert({
      company_id: companyId, journal_number: `JRSYN${serial}`, journal_date: "2026-09-16", journal_type: "Bank Transaction Automation",
      description: "legacy", reference: "", source_type: RULE_SOURCE, source_id: transactionId, status: "Posted",
      total_debit: 6435, total_credit: 6435, posted_at: new Date().toISOString(), posting_batch_id: batch.id,
    }).select("id").single())) as { id: number };
    const lines = (await must(admin.from("ae_journal_lines").insert([
      { journal_id: journal.id, account_code: "6940", debit: 6435, credit: 0, description: "legacy", line_order: 0 },
      { journal_id: journal.id, account_code: "1020", debit: 0, credit: 6435, description: "legacy", line_order: 1 },
    ]).select("id, account_code, debit, credit"))) as { id: number; account_code: string; debit: number; credit: number }[];
    await must(admin.from("gl_transactions").insert(lines.map((l) => ({
      company_id: companyId, journal_id: journal.id, journal_line_id: l.id, account_id: accountId[companyId]![l.account_code],
      posting_date: "2026-09-16", reference: "", description: "legacy", debit: l.debit, credit: l.credit, financial_year_label: "FY2027", financial_period: 7, posted_by: "System",
    }))));
    // The rule had already claimed it before the request died.
    await must(admin.from("ae_bank_transactions").update({ rule_id: ruleId[companyId], allocation_status: "Suggested", suggested_gl_account: "6940", allocation_type: "G" }).eq("id", transactionId));
    return Number(journal.id);
  }

  const ruleId: Record<string, number> = {};

  async function journalsFor(transactionIds: number[]) {
    return (await must(admin.from("ae_journals").select("id, source_id, journal_number, posting_batch_id, status").eq("source_type", RULE_SOURCE).in("source_id", transactionIds))) as {
      id: number; source_id: number; journal_number: string; posting_batch_id: number; status: string;
    }[];
  }

  async function companyFingerprint(companyId: string): Promise<string> {
    const [txns, journals, batches, gl] = await Promise.all([
      must(admin.from("ae_bank_transactions").select("*").eq("company_id", companyId).order("id")),
      must(admin.from("ae_journals").select("*, ae_journal_lines(*)").eq("company_id", companyId).order("id")),
      must(admin.from("posting_batches").select("*").eq("company_id", companyId).order("id")),
      must(admin.from("gl_transactions").select("*").eq("company_id", companyId).order("id")),
    ]);
    return JSON.stringify({ txns, journals, batches, gl });
  }

  async function inParallel<T>(calls: (() => Promise<T>)[]): Promise<T[]> {
    return Promise.all(calls.map((call) => call()));
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = LOCAL_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_KEY;
    admin = createClient(LOCAL_URL, LOCAL_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    await must(admin.from("organisations").insert({ id: orgId, name: "Rule posting scenario (synthetic)" }));
    await must(admin.from("companies").insert(allCompanies.map((id, i) => ({ id, organisation_id: orgId, name: `Synthetic rule-posting company ${i + 1}`, financial_year_start_month: 3 }))));
    for (const companyId of allCompanies) {
      const accounts = (await must(admin.from("chart_of_accounts").insert(
        ["1000", "1020", "2100", "6940"].map((code) => ({ company_id: companyId, account_code: code, description: code, account_type: code === "6940" ? "Expense" : "Asset", normal_balance: "Debit" })),
      ).select("id, account_code"))) as { id: number; account_code: string }[];
      accountId[companyId] = Object.fromEntries(accounts.map((a) => [a.account_code, Number(a.id)]));
      await must(admin.from("financial_years").insert({ company_id: companyId, year_label: "FY-SYN", start_date: "2000-01-01", end_date: "2999-12-31", status: "Open", is_current: true }));
      const account = (await must(admin.from("ae_bank_accounts").insert({ company_id: companyId, account_number: `SYN-${companyId.slice(0, 8)}`, account_name: "Synthetic bank", gl_account: "1020" }).select("id").single())) as { id: number };
      bankAccount[companyId] = Number(account.id);
      const rule = (await must(admin.from("banking_rules").insert({ company_id: companyId, rule_type: "GL", name: "Auto: Salaries → GL", domain: "Banking", is_active: true, priority: 1 }).select("id").single())) as { id: number };
      ruleId[companyId] = Number(rule.id);
      await must(admin.from("banking_rule_conditions").insert({ rule_id: rule.id, field: "beneficiary", operator: "equals", value: "Salaries" }));
      // The retry company's rule posts to an account the database does not
      // have yet (see the M1 scenario).
      await must(admin.from("banking_rule_actions").insert({ rule_id: rule.id, action_type: "set_gl_account", target_text: companyId === retry ? "6950" : "6940" }));
    }
    // Cashbook Payment posting rule (as seed_company_defaults defines it).
    const postingRule = (await must(admin.from("posting_rules").insert({ company_id: cashbook, event_type: "Cashbook Payment", description: "synthetic" }).select("id").single())) as { id: number };
    await must(admin.from("posting_rule_lines").insert([
      { posting_rule_id: postingRule.id, line_order: 0, side: "Debit", role: "dynamic_expense", fixed_account_code: null, amount_source: "net" },
      { posting_rule_id: postingRule.id, line_order: 1, side: "Debit", role: "vat_input", fixed_account_code: "2100", amount_source: "vat" },
      { posting_rule_id: postingRule.id, line_order: 2, side: "Credit", role: "bank_account", fixed_account_code: null, amount_source: "gross" },
    ]));
  }, 120_000);

  afterAll(async () => {
    if (admin) {
      await admin.from("gl_transactions").delete().in("company_id", allCompanies);
      await admin.from("companies").delete().in("id", allCompanies);
      await admin.from("organisations").delete().eq("id", orgId);
    }
    if (savedEnv.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = savedEnv.url;
    if (savedEnv.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = savedEnv.key;
  }, 120_000);

  let northwoodBaseline = "";

  it("A + I: a sweep posts each transaction atomically — journal, lines, batch, GL and link — and only in its own company", async () => {
    const nwIds = await insertTransactions(northwood, 3);
    const nwOutcome = await asService(() => runRuleEngine(northwood, "Scheduler (cron)"));
    expect(nwOutcome.autoPosted).toBe(3);
    northwoodBaseline = await companyFingerprint(northwood);

    const ids = await insertTransactions(metanoia, 6);
    const outcome = await asService(() => runRuleEngine(metanoia, "Scheduler (cron)"));

    expect(outcome).toMatchObject({ autoPosted: 6, recovered: 0, postingErrors: 0, remaining: 0, stoppedEarly: false });
    const journals = await journalsFor(ids);
    expect(journals).toHaveLength(6);
    expect(new Set(journals.map((j) => j.source_id)).size).toBe(6);
    expect(new Set(journals.map((j) => j.posting_batch_id)).size).toBe(6);
    const txns = (await must(admin.from("ae_bank_transactions").select("id, journal_id, posted_flag, posting_batch_id, rule_id").in("id", ids))) as { id: number; journal_id: number; posted_flag: boolean; posting_batch_id: number; rule_id: number }[];
    for (const t of txns) {
      const j = journals.find((x) => x.source_id === t.id)!;
      expect(t).toMatchObject({ journal_id: j.id, posted_flag: true, posting_batch_id: j.posting_batch_id, rule_id: ruleId[metanoia] });
    }
    const gl = (await must(admin.from("gl_transactions").select("journal_id, debit, credit, posting_date").in("journal_id", journals.map((j) => j.id)))) as { journal_id: number; debit: number; credit: number; posting_date: string }[];
    expect(gl).toHaveLength(12);
    // L1: journal, ledger and batch all carry the run date, as before.
    const today = new Date().toISOString().slice(0, 10);
    expect(new Set(gl.map((r) => r.posting_date))).toEqual(new Set([today]));
    const batchDates = (await must(admin.from("posting_batches").select("posting_date").in("id", journals.map((j) => j.posting_batch_id)))) as { posting_date: string }[];
    expect(new Set(batchDates.map((b) => b.posting_date))).toEqual(new Set([today]));
    expect(gl.reduce((s, r) => s + Number(r.debit), 0)).toBe(6 * 6435);
    expect(gl.reduce((s, r) => s + Number(r.credit), 0)).toBe(6 * 6435);
    expect(await companyFingerprint(northwood)).toBe(northwoodBaseline);
    expect(nwIds).toHaveLength(3);
  }, 120_000);

  it("F: twenty parallel posting calls for ONE transaction create exactly one journal, one batch and two GL rows", async () => {
    const [id] = await insertTransactions(metanoia, 1, { rule_id: null });
    const journal: RuleEngineJournalInput = {
      journalDate: new Date().toISOString().slice(0, 10), journalType: "Bank Transaction Automation", description: "parallel", reference: "",
      financialYearLabel: "FY-SYN", financialPeriod: 1,
      lines: [{ accountCode: "6940", debit: 6435, credit: 0, description: "parallel" }, { accountCode: "1020", debit: 0, credit: 6435, description: "parallel" }],
    };

    const claim = { ruleId: ruleId[metanoia], ruleName: "Auto: Salaries → GL", matchedRuleIds: [ruleId[metanoia]], suggestedGlAccount: "6940", allocationStatus: "Suggested", performedBy: "parallel" };
    const outcomes = await inParallel(Array.from({ length: 20 }, () => () => asService(() => postRuleEngineJournalAtomic(metanoia, id!, journal, "System", journal.journalDate, claim))));

    expect(outcomes.filter((o) => o.outcome === "posted")).toHaveLength(1);
    expect(outcomes.filter((o) => o.outcome === "already_linked")).toHaveLength(19);
    const journals = await journalsFor([id!]);
    expect(journals).toHaveLength(1);
    const gl = (await must(admin.from("gl_transactions").select("id").eq("journal_id", journals[0]!.id))) as unknown[];
    expect(gl).toHaveLength(2);
    const batches = (await must(admin.from("posting_batches").select("id").eq("id", journals[0]!.posting_batch_id))) as unknown[];
    expect(batches).toHaveLength(1);
    expect(new Set(outcomes.map((o) => o.journalId))).toEqual(new Set([journals[0]!.id]));
    // The claim was written once, by the call that posted.
    const history = (await must(admin.from("ae_allocation_history").select("id").eq("transaction_id", id!))) as unknown[];
    const applications = (await must(admin.from("banking_rule_applications").select("id").eq("bank_transaction_id", id!))) as unknown[];
    expect([history.length, applications.length]).toEqual([1, 1]);
  }, 120_000);

  it("F: three concurrent sweeps over the same 25 transactions post each exactly once", async () => {
    const ids = await insertTransactions(metanoia, 25);

    const runs = await inParallel([0, 1, 2].map(() => () => asService(() => runRuleEngine(metanoia, "Scheduler (cron)"))));

    expect(runs.reduce((sum, r) => sum + r.autoPosted, 0)).toBe(25);
    expect(runs.reduce((sum, r) => sum + r.postingErrors, 0)).toBe(0);
    const journals = await journalsFor(ids);
    expect(journals).toHaveLength(25);
    expect(new Set(journals.map((j) => j.source_id)).size).toBe(25);
    expect(new Set(journals.map((j) => j.journal_number)).size).toBe(25);
    const unlinked = (await must(admin.from("ae_bank_transactions").select("id").in("id", ids).or("journal_id.is.null,posted_flag.eq.false"))) as unknown[];
    expect(unlinked).toHaveLength(0);
  }, 180_000);

  it("D/E: a sweep recovers the production failure state by linking — no second journal, batch or GL row — and audits it", async () => {
    const [id] = await insertTransactions(metanoia, 1);
    const journalId = await legacyInterruptedPost(metanoia, id!);
    const before = await journalsFor([id!]);
    const glBefore = (await must(admin.from("gl_transactions").select("id").eq("company_id", metanoia))) as unknown[];
    const batchesBefore = (await must(admin.from("posting_batches").select("id").eq("company_id", metanoia))) as unknown[];

    const outcome = await asService(() => runRuleEngine(metanoia, "Scheduler (cron)"));

    expect(outcome).toMatchObject({ recovered: 1, autoPosted: 0, postingErrors: 0 });
    const txn = (await must(admin.from("ae_bank_transactions").select("journal_id, posted_flag, posting_batch_id, posted_at").eq("id", id!).single())) as Record<string, unknown>;
    expect(txn).toEqual({ journal_id: journalId, posted_flag: true, posting_batch_id: null, posted_at: null });
    expect(await journalsFor([id!])).toEqual(before);
    expect((await must(admin.from("gl_transactions").select("id").eq("company_id", metanoia))) as unknown[]).toHaveLength(glBefore.length);
    expect((await must(admin.from("posting_batches").select("id").eq("company_id", metanoia))) as unknown[]).toHaveLength(batchesBefore.length);
    const audit = (await must(admin.from("automation_audit_log").select("action_type, performed_by, journal_ids, changes").eq("company_id", metanoia).eq("document_id", id!))) as { action_type: string; performed_by: string; journal_ids: number[]; changes: Record<string, unknown> }[];
    expect(audit).toEqual([{ action_type: "RuleEngineJournalLinkRecovered", performed_by: "Scheduler (cron)", journal_ids: [journalId], changes: expect.objectContaining({ before: { journal_id: null, posted_flag: false } }) }]);

    const again = await asService(() => runRuleEngine(metanoia, "Scheduler (cron)"));
    expect(again.recovered).toBe(0);
    expect(await journalsFor([id!])).toEqual(before);
  }, 120_000);

  it("G + H: Bank Posting and Generate Journal refuse the failure-state transaction; the database refuses any other link", async () => {
    const [covered] = await insertTransactions(metanoia, 1);
    await legacyInterruptedPost(metanoia, covered!);
    const [free] = await insertTransactions(metanoia, 1, { beneficiary: "Somebody else", suggested_gl_account: "6940", allocation_status: "Allocated", allocation_type: "G" });
    const ledgerBefore = await journalsFor([covered!]);

    const posting = await asService(() => postBankTransactions(metanoia, [covered!, free!]));
    expect(posting.posted.map((p) => p.transactionId)).toEqual([free]);
    expect(posting.alreadyPosted).toEqual([expect.objectContaining({ transactionId: covered, reason: expect.stringContaining("Banking Rule journal") })]);

    const [txn] = await asService(() => getTransactionsByIds(metanoia, [covered!]));
    const generated = await asService(() => generateJournalFromTransactions(metanoia, [txn!], new Map([[bankAccount[metanoia]!, { glAccount: "1020", accountNumber: "SYN" }]])));
    expect(generated.journal).toBeNull();
    expect(generated.skipped).toEqual([expect.objectContaining({ transactionId: covered })]);

    const bankJournalId = posting.journals[0]!.id;
    expect(await asService(() => linkTransactionToJournal(metanoia, covered!, bankJournalId))).toBe(false);

    const after = (await must(admin.from("ae_bank_transactions").select("journal_id, posted_flag").eq("id", covered!).single())) as Record<string, unknown>;
    expect(after).toEqual({ journal_id: null, posted_flag: false });
    expect(await journalsFor([covered!])).toEqual(ledgerBefore);
  }, 120_000);

  it("J: bounded sweeps stop at their limit and the next run continues — every transaction posted exactly once", async () => {
    const ids = await insertTransactions(bounded, 12);

    const first = await asService(() => runRuleEngine(bounded, "Scheduler (cron)", { maxPostings: 5 }));
    const second = await asService(() => runRuleEngine(bounded, "Scheduler (cron)", { maxPostings: 5 }));
    const third = await asService(() => runRuleEngine(bounded, "Scheduler (cron)", { maxPostings: 5 }));

    expect([first.autoPosted, second.autoPosted, third.autoPosted]).toEqual([5, 5, 2]);
    expect([first.stoppedEarly, second.stoppedEarly, third.stoppedEarly]).toEqual([true, true, false]);
    expect(first.remaining).toBe(7);
    const journals = await journalsFor(ids);
    expect(journals).toHaveLength(12);
    expect(new Set(journals.map((j) => j.source_id)).size).toBe(12);
  }, 120_000);

  it("J: an expired time budget starts nothing", async () => {
    const ids = await insertTransactions(bounded, 3);
    const outcome = await asService(() => runRuleEngine(bounded, "Scheduler (cron)", { deadlineAtMs: Date.now() - 1 }));
    expect(outcome).toMatchObject({ processed: 0, stoppedEarly: true, stopReason: "time-budget", remaining: 3, intelligenceSkipped: true });
    expect(await journalsFor(ids)).toHaveLength(0);
  }, 60_000);

  it("H1: matched transactions behind more than 150 unmatched claimable ones are posted in the same bounded run", async () => {
    await insertTransactions(starve, 200, { beneficiary: "Unknown payee", transaction_date: "2026-09-01" });
    const matched = await insertTransactions(starve, 3, { transaction_date: "2026-03-01" });
    // The Northwood legacy shape: a rule classified it long ago ("Suggested"), nobody posted it.
    const [legacy] = await insertTransactions(starve, 1, { transaction_date: "2026-08-21", rule_id: ruleId[starve], allocation_status: "Suggested", suggested_gl_account: "6940", allocation_type: "G" });
    const legacyBefore = await must(admin.from("ae_bank_transactions").select("*").eq("id", legacy!).single());

    const outcome = await asService(() => runRuleEngine(starve, "Scheduler (cron)", { maxPostings: 150 }));

    expect(outcome).toMatchObject({ autoPosted: 3, postingAttempts: 3, awaitingReview: 1, postingErrors: 0, stoppedEarly: false, remaining: 0, processed: 204 });
    expect(await must(admin.from("ae_bank_transactions").select("*").eq("id", legacy!).single())).toEqual(legacyBefore);
    expect(await journalsFor([legacy!])).toEqual([]);
    expect((await journalsFor(matched)).map((j) => j.source_id).sort()).toEqual([...matched].sort());
    const exceptions = (await must(admin.from("banking_exceptions").select("id").eq("company_id", starve).eq("exception_type", "UnknownMerchant").eq("status", "Open"))) as unknown[];
    expect(exceptions).toHaveLength(200);

    // A second run re-evaluates everything, posts nothing new and inserts no duplicate exception.
    const again = await asService(() => runRuleEngine(starve, "Scheduler (cron)", { maxPostings: 150 }));
    expect(again).toMatchObject({ autoPosted: 0, processed: 201, awaitingReview: 1, stoppedEarly: false });
    expect(await journalsFor([legacy!])).toEqual([]);
    expect((await must(admin.from("banking_exceptions").select("id").eq("company_id", starve).eq("exception_type", "UnknownMerchant"))) as unknown[]).toHaveLength(200);
  }, 300_000);

  it("M2: through the real API (1,000-row limit), a sweep reaches the tail of 1,100+ unposted rows — a matched row and a recovery", async () => {
    await insertTransactions(paged, 1_100, { beneficiary: "Unknown payee", transaction_date: "2026-08-01" });
    const [oldestMatched] = await insertTransactions(paged, 1, { transaction_date: "2019-01-01" });
    const [oldestRecovery] = await insertTransactions(paged, 1, { transaction_date: "2018-01-01" });
    const journalId = await legacyInterruptedPost(paged, oldestRecovery!);

    // What a single un-paged request returns: the old worklist's view.
    const onePage = (await must(admin.from("ae_bank_transactions").select("id").eq("company_id", paged).is("journal_id", null).order("transaction_date", { ascending: false }))) as { id: number }[];
    expect(onePage.length).toBeLessThanOrEqual(1_000);
    expect(onePage.map((r) => r.id)).not.toContain(oldestMatched);

    const outcome = await asService(() => runRuleEngine(paged, "Scheduler (cron)"));

    expect(outcome).toMatchObject({ autoPosted: 1, recovered: 1, postingErrors: 0, stoppedEarly: false, remaining: 0, processed: 1_102 });
    expect((await journalsFor([oldestMatched!])).map((j) => j.source_id)).toEqual([oldestMatched]);
    const recovered = (await must(admin.from("ae_bank_transactions").select("journal_id, posted_flag").eq("id", oldestRecovery!).single())) as Record<string, unknown>;
    expect(recovered).toEqual({ journal_id: journalId, posted_flag: true });
  }, 300_000);

  it("H2: a sweep never claims or posts a Manual Cashbook entry; the Cashbook posts it once; an entry a rule journal already carries is refused before anything is written", async () => {
    const [manual] = await insertTransactions(cashbook, 1, { entry_source: "Manual", capture_status: "Submitted", debit: 100, gl_account: "6940", description: "SYN cashbook salary" });

    const sweep = await asService(() => runRuleEngine(cashbook, "Scheduler (cron)"));
    expect(sweep).toMatchObject({ autoPosted: 0, postingAttempts: 0 });
    const untouched = (await must(admin.from("ae_bank_transactions").select("rule_id, journal_id, posted_flag, allocation_status, suggested_gl_account").eq("id", manual!).single())) as Record<string, unknown>;
    expect(untouched).toEqual({ rule_id: null, journal_id: null, posted_flag: false, allocation_status: "Unallocated", suggested_gl_account: null });
    expect(await journalsFor([manual!])).toEqual([]);

    const posted = await asService(() => approveAndPostCashbookEntry(cashbook, manual!));
    expect(posted).toMatchObject({ captureStatus: "Posted", journalId: expect.any(Number) });
    const cashbookJournals = (await must(admin.from("ae_journals").select("id, status, source_type").eq("company_id", cashbook))) as { id: number; status: string; source_type: string }[];
    expect(cashbookJournals).toEqual([{ id: posted.journalId, status: "Posted", source_type: "cashbook_entry" }]);
    const gl = (await must(admin.from("gl_transactions").select("debit, credit").eq("journal_id", posted.journalId!))) as { debit: number; credit: number }[];
    expect(gl.reduce((s, r) => s + Number(r.debit), 0)).toBe(100);
    expect(gl.reduce((s, r) => s + Number(r.credit), 0)).toBe(100);
    const after = await asService(() => runRuleEngine(cashbook, "Scheduler (cron)"));
    expect(after).toMatchObject({ autoPosted: 0, postingAttempts: 0 });

    // A Manual entry a Banking Rule already posted (before this change).
    const [taken] = await insertTransactions(cashbook, 1, { entry_source: "Manual", capture_status: "Submitted", debit: 6435, gl_account: "6940", description: "SYN taken by a rule" });
    await legacyInterruptedPost(cashbook, taken!);
    const before = await companyFingerprint(cashbook);
    await expect(asService(() => approveAndPostCashbookEntry(cashbook, taken!))).rejects.toThrow(/Banking Rule journal/);
    expect(await companyFingerprint(cashbook)).toBe(before);
  }, 180_000);

  it("M1: a posting the database refuses leaves the transaction unclaimed; the next sweep posts it exactly once", async () => {
    const [id] = await insertTransactions(retry, 1);
    const rules = await asService(() => listActiveBankingRules(retry, "Banking"));
    const staleContext: RuleEnginePostingContext = {
      financialYears: [{ id: 0, companyId: retry, yearLabel: "FY-SYN", startDate: "2000-01-01", endDate: "2999-12-31", status: "Open", isCurrent: true, createdAt: "", lockDate: null, reopenedAt: null } as unknown as RuleEnginePostingContext["financialYears"][number]],
      financialYearStartMonth: 3,
      accountCodes: new Set(["1020", "6950"]), // 6950 is not in the database's chart yet
      postedBy: "System",
    };
    const [txn] = await asService(() => getTransactionsByIds(retry, [id!]));
    const refused = await asService(() => processTransaction(retry, txn!, rules, new Map([[bankAccount[retry]!, { glAccount: "1020", accountNumber: "SYN" }]]), "Scheduler (cron)", { ruleEngineJournal: null, postingContext: staleContext }));

    expect(refused).toMatchObject({ autoPosted: false, notPostedReason: expect.stringContaining("VYRON_RULE_POST_NO_ACCOUNT"), postingAttempted: true });
    const row = (await must(admin.from("ae_bank_transactions").select("rule_id, suggested_gl_account, allocation_status, journal_id, posted_flag").eq("id", id!).single())) as Record<string, unknown>;
    expect(row).toEqual({ rule_id: null, suggested_gl_account: null, allocation_status: "Unallocated", journal_id: null, posted_flag: false });
    expect((await must(admin.from("ae_allocation_history").select("id").eq("transaction_id", id!))) as unknown[]).toHaveLength(0);
    expect(await journalsFor([id!])).toEqual([]);

    await must(admin.from("chart_of_accounts").insert({ company_id: retry, account_code: "6950", description: "6950", account_type: "Expense", normal_balance: "Debit" }));
    const first = await asService(() => runRuleEngine(retry, "Scheduler (cron)"));
    const second = await asService(() => runRuleEngine(retry, "Scheduler (cron)"));
    expect([first.autoPosted, second.autoPosted]).toEqual([1, 0]);
    const journals = await journalsFor([id!]);
    expect(journals).toHaveLength(1);
    const posted = (await must(admin.from("ae_bank_transactions").select("rule_id, suggested_gl_account, journal_id, posted_flag").eq("id", id!).single())) as Record<string, unknown>;
    expect(posted).toEqual({ rule_id: ruleId[retry], suggested_gl_account: "6950", journal_id: journals[0]!.id, posted_flag: true });
  }, 120_000);

  it("I/L: nothing in the other companies' scenarios changed Northwood", async () => {
    expect(northwoodBaseline).not.toBe("");
    expect(await companyFingerprint(northwood)).toBe(northwoodBaseline);
  }, 60_000);
});
