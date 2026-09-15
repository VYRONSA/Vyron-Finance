// @vitest-environment node
/**
 * Migration 0099 — end-to-end regression scenarios for the AI
 * classification safety layer: the REAL classification service, sweep
 * queue, gate, attempt recording and circuit breaker, running against a
 * LOCAL Supabase stack, with a fake provider. No AI provider request is
 * ever made (the `ai` package's generateObject is replaced with a thrower
 * as a second guard).
 *
 * Skipped unless AI_SAFETY_LOCAL_SUPABASE_URL (http://127.0.0.1 or
 * localhost only) and AI_SAFETY_LOCAL_SERVICE_ROLE_KEY are set. It creates
 * synthetic companies and transactions, and deletes them afterwards.
 *
 * The scheduler's cadence is simulated with the real `nextTaskRunAt`, on a
 * simulated clock, so days of sweeps run in seconds. The concurrency tests
 * fire genuinely parallel requests through PostgREST's connection pool.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: () => {
      throw new Error("A real AI provider call was attempted in a local scenario test.");
    },
  };
});

import { runWithServerExecutionContext } from "@/lib/supabase/execution-context";
import { __setTransactionClassificationProviderForTests } from "@/server/ai/transaction-classification/classification-engine";
import type { RawTransactionClassification, TransactionClassificationEvidence } from "@/server/ai/transaction-classification/types";
import { AIProviderError } from "@/server/ai/types";
import type { AutomationTask } from "@/server/automation/types";
import { nextTaskRunAt } from "./scheduler-service";
import { classifyTransactionsWithAiManual, runAutomaticAiClassificationSweep, type AutomaticClassificationSweepOutcome } from "./transaction-classification-service";

const LOCAL_URL = process.env.AI_SAFETY_LOCAL_SUPABASE_URL ?? "";
const LOCAL_KEY = process.env.AI_SAFETY_LOCAL_SERVICE_ROLE_KEY ?? "";
const enabled = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(LOCAL_URL) && LOCAL_KEY.length > 0;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.parse("2032-02-02T00:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const SWEEP_TASK = { taskType: "AiClassificationSweep" } as AutomationTask;
const SCOPE = "transaction-classification";

type Behaviour = (evidence: TransactionClassificationEvidence) => Promise<RawTransactionClassification>;

const provider = {
  calls: [] as { companyId: string; transactionId: number }[],
  behaviour: (async () => ({ accountCode: null, confidence: 0, explanation: "no match", usage: null })) as Behaviour,
  async classify(evidence: TransactionClassificationEvidence): Promise<RawTransactionClassification> {
    this.calls.push({ companyId: evidence.companyId, transactionId: evidence.transactionId });
    return this.behaviour(evidence);
  },
};

const noConfidence: Behaviour = async () => ({ accountCode: null, confidence: 0, explanation: "Synthetic: nothing fits.", usage: null });
const suggest: Behaviour = async (e) => ({
  accountCode: e.candidateAccounts[0]?.accountCode ?? null,
  confidence: 90,
  explanation: "Synthetic suggestion.",
  usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
});

type Pass = { at: number; next: number; outcome: AutomaticClassificationSweepOutcome; asked: number[] };

describe.skipIf(!enabled)("AI classification safety — local end-to-end scenarios (migration 0099)", () => {
  let admin: SupabaseClient;
  const orgId = randomUUID();
  const northwood = randomUUID();
  const metanoia = randomUUID();
  const circuitCo = randomUUID();
  const fuseA = randomUUID();
  const fuseB = randomUUID();
  const raceCo = randomUUID();
  const allCompanies = [northwood, metanoia, circuitCo, fuseA, fuseB, raceCo];
  const ids: Record<string, number[]> = {};
  const savedEnv = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };

  async function insertTransactions(companyId: string, count: number, label: string): Promise<number[]> {
    const rows = Array.from({ length: count }, (_, i) => ({
      company_id: companyId,
      transaction_date: iso(Date.parse("2024-01-01T00:00:00.000Z") + (i + 1) * DAY).slice(0, 10),
      description: `SYN ${label} ${i + 1}`,
      beneficiary: `SYN ${label} ${i + 1}`,
      debit: 100 + i,
      credit: 0,
    }));
    const { data, error } = await admin.from("ae_bank_transactions").insert(rows).select("id, transaction_date").order("transaction_date");
    if (error) throw error;
    return (data as { id: number }[]).map((r) => Number(r.id));
  }

  async function sweep(companyId: string, atMs: number): Promise<Pass> {
    const before = provider.calls.length;
    const outcome = await runWithServerExecutionContext(admin, () => runAutomaticAiClassificationSweep(companyId, "System", { nowIso: iso(atMs) }));
    const asked = provider.calls.slice(before).map((c) => c.transactionId);
    return { at: atMs, next: Date.parse(nextTaskRunAt(SWEEP_TASK, iso(atMs), outcome)), outcome, asked };
  }

  /** Runs the sweep the way the scheduler would: each run schedules the next. */
  async function simulate(companyId: string, fromMs: number, untilMs: number): Promise<Pass[]> {
    const passes: Pass[] = [];
    let t = fromMs;
    while (t < untilMs && passes.length < 5000) {
      const pass = await sweep(companyId, t);
      passes.push(pass);
      t = pass.next;
    }
    return passes;
  }

  const askedIn = (passes: Pass[]) => passes.flatMap((p) => p.asked);

  async function count(table: string, filters: Record<string, unknown>): Promise<number> {
    let q = admin.from(table).select("*", { count: "exact", head: true });
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v as string);
    const { count: n, error } = await q;
    if (error) throw error;
    return n ?? 0;
  }

  async function circuitStatus(): Promise<Record<string, unknown>> {
    const { data, error } = await admin.rpc("fn_ai_provider_circuit_status", { p_scope: SCOPE });
    if (error) throw error;
    return data as Record<string, unknown>;
  }

  /** One raw gate call, as the service makes it. */
  async function gate(companyId: string, transactionId: number, atMs: number): Promise<string> {
    const { data, error } = await admin.rpc("fn_ai_classification_gate", {
      p_company_id: companyId, p_transaction_id: transactionId, p_source: "manual", p_now: iso(atMs), p_daily_cap: 100, p_scope: SCOPE,
    });
    if (error) throw error;
    return (data as { decision: string }).decision;
  }

  async function record(companyId: string, transactionId: number, atMs: number, signal: string, outcome: string, probe: boolean) {
    const { error } = await admin.rpc("fn_ai_classification_record_attempt", {
      p_company_id: companyId, p_transaction_id: transactionId, p_task_run_id: null, p_source: "manual", p_outcome: outcome,
      p_provider_request_made: true, p_model: "synthetic", p_error_category: signal === "auth" ? "unauthorized" : null,
      p_http_status: signal === "auth" ? 401 : null, p_provider_message: null, p_usage: null, p_duration_ms: 1, p_performed_by: "test",
      p_circuit_signal: signal, p_now: iso(atMs), p_scope: SCOPE, p_probe: probe,
    });
    if (error) throw error;
  }

  const tally = (decisions: string[]) => decisions.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d]: (acc[d] ?? 0) + 1 }), {});

  /** Runs the calls with `width` in flight at once — far more than the
   * database connection pool, so they genuinely race inside Postgres,
   * without exhausting the local HTTP sockets. */
  async function inParallel<T>(calls: (() => Promise<T>)[], width = 40): Promise<T[]> {
    const results: T[] = new Array(calls.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(width, calls.length) }, async () => {
      while (next < calls.length) {
        const i = next++;
        results[i] = await calls[i]!();
      }
    }));
    return results;
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = LOCAL_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_KEY;
    admin = createClient(LOCAL_URL, LOCAL_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    __setTransactionClassificationProviderForTests(provider);

    expect((await circuitStatus()).state).toBe("closed");

    const org = await admin.from("organisations").insert({ id: orgId, name: "AI safety scenario (synthetic)" });
    if (org.error) throw org.error;
    const cos = await admin.from("companies").insert(allCompanies.map((id, i) => ({ id, organisation_id: orgId, name: `Synthetic scenario company ${i + 1}` })));
    if (cos.error) throw cos.error;
    const coa = await admin.from("chart_of_accounts").insert(
      allCompanies.map((company_id) => ({ company_id, account_code: "6100", description: "Bank Charges", account_type: "Expense", normal_balance: "Debit" })),
    );
    if (coa.error) throw coa.error;

    ids.northwood = await insertTransactions(northwood, 73, "Northwood");
    ids.metanoia = await insertTransactions(metanoia, 101, "Metanoia");
    ids.circuit = await insertTransactions(circuitCo, 5, "Circuit");
    ids.fuseA = await insertTransactions(fuseA, 1, "FuseA");
    ids.fuseB = await insertTransactions(fuseB, 1, "FuseB");
    ids.race = await insertTransactions(raceCo, 40, "Race");
  }, 120_000);

  afterAll(async () => {
    __setTransactionClassificationProviderForTests(null);
    if (admin) {
      await admin.from("companies").delete().in("id", allCompanies);
      await admin.from("organisations").delete().eq("id", orgId);
    }
    if (savedEnv.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = savedEnv.url;
    if (savedEnv.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = savedEnv.key;
  }, 120_000);

  it("historical loop: 73 eligible Northwood rows, the 20 oldest always no-confidence -> 20 calls, cooldown, advance, bounded", async () => {
    const stuck = new Set(ids.northwood.slice(0, 20));
    provider.behaviour = async (e) => (stuck.has(e.transactionId) ? noConfidence(e) : suggest(e));

    const week = await simulate(northwood, T0, T0 + 7 * DAY);
    const [first, second, third, fourth] = week;

    // First pass = exactly the 20 old stuck transactions, all no-confidence.
    expect(first!.asked).toEqual(ids.northwood.slice(0, 20));
    expect(first!.outcome).toMatchObject({ providerRequests: 20, noConfidentSuggestion: 20, progress: false, hasMoreEligible: true });
    // No progress -> the normal hour, never the 2-minute loop.
    expect(first!.next - first!.at).toBe(HOUR);

    // The next pass advances to other rows; real progress earns the 2-minute reschedule.
    expect(second!.asked).toHaveLength(20);
    expect(second!.asked.some((id) => stuck.has(id))).toBe(false);
    expect(second!.outcome.progress).toBe(true);
    expect(second!.next - second!.at).toBe(2 * MINUTE);
    expect(third!.asked).toHaveLength(20);
    expect(fourth!.asked).toHaveLength(13);
    expect(fourth!.outcome.hasMoreEligible).toBe(false);
    expect(fourth!.next - fourth!.at).toBe(HOUR);

    // Bounded: every row asked once in the week; the stuck 20 never re-requested.
    const asked = askedIn(week);
    expect(asked).toHaveLength(73);
    expect(new Set(asked).size).toBe(73);
    // A 2-minute reschedule only ever followed a pass that saved something.
    for (const pass of week) {
      if (pass.next - pass.at === 2 * MINUTE) expect(pass.outcome.progress).toBe(true);
    }

    // Database: every request recorded and counted; the queue reflects it.
    expect(await count("ai_classification_attempts", { company_id: northwood, provider_request_made: true })).toBe(73);
    expect(await count("usage_events", { company_id: northwood, metric_key: "ai_provider_requests" })).toBe(73);
    expect(await count("ai_classification_queue_state", { company_id: northwood, state: "cooldown" })).toBe(20);
    expect(await count("ai_classification_queue_state", { company_id: northwood, state: "resolved" })).toBe(53);

    // After the cooldown the 20 are asked once more, then wait for a human — nothing after that.
    const later = await simulate(northwood, week.at(-1)!.next, T0 + 21 * DAY);
    const askedLater = askedIn(later);
    expect(askedLater.sort((a, b) => a - b)).toEqual([...stuck].sort((a, b) => a - b));
    expect(await count("ai_classification_queue_state", { company_id: northwood, state: "needs_human_review" })).toBe(20);
    expect(askedIn(later.filter((p) => p.at >= T0 + 9 * DAY))).toHaveLength(0);
    // The old behaviour asked 20 every 2 minutes: 14,400 requests a day.
    expect(asked.length + askedLater.length).toBe(93);
  }, 300_000);

  it("Metanoia: 101 eligible rows -> at most 101 first-pass requests (100/day safety fuse, then 1), independent of Northwood", async () => {
    provider.behaviour = noConfidence;

    const passes = await simulate(metanoia, T0, T0 + 3 * DAY);
    const dayOne = askedIn(passes.filter((p) => p.at < T0 + DAY));
    const firstPass = askedIn(passes);

    expect(dayOne).toHaveLength(100);
    expect(firstPass).toHaveLength(101);
    expect(new Set(firstPass).size).toBe(101);
    const capped = passes.find((p) => p.outcome.stoppedReason === "daily_cap");
    expect(capped?.outcome).toMatchObject({ requestsToday: 100, dailyCap: 100, providerRequests: 0 });
    // Northwood's 73 on the same simulated day did not count against Metanoia's fuse.
    expect(passes.every((p) => p.next - p.at !== 2 * MINUTE)).toBe(true);
    expect(await count("ai_classification_queue_state", { company_id: metanoia, state: "cooldown" })).toBe(101);
    expect(await count("usage_events", { company_id: metanoia, metric_key: "ai_provider_requests" })).toBe(101);
  }, 300_000);

  it("circuit breaker: a 401 stops after ONE call and opens the shared circuit; zero calls while open (any company, any path); the probe closes it", async () => {
    const t1 = T0 + 40 * DAY;
    provider.behaviour = async () => {
      throw new AIProviderError("missing-api-key", "VYRON AI is not configured.", null, {
        httpStatus: 401,
        providerMessage: "Unauthorized: invalid credentials Bearer synthetic-scenario-token-0123456789abcdef",
      });
    };

    const failing = await sweep(circuitCo, t1);
    expect(failing.asked).toHaveLength(1);
    expect(failing.outcome).toMatchObject({ stoppedReason: "provider_failure", errorCategory: "unauthorized", httpStatus: 401, circuitState: "open" });
    expect(failing.next - failing.at).toBe(HOUR);
    expect(await circuitStatus()).toMatchObject({ state: "open", open_reason: "unauthorized" });

    // While open: nothing is sent — not by the sweep, not by another company's manual request.
    const whileOpen = await sweep(circuitCo, t1 + 10 * MINUTE);
    expect(whileOpen.asked).toHaveLength(0);
    expect(whileOpen.outcome.stoppedReason).toBe("circuit_open");
    const callsBefore = provider.calls.length;
    const manual = await runWithServerExecutionContext(admin, () => classifyTransactionsWithAiManual(metanoia, [ids.metanoia[0]!], "Synthetic Accountant", 20, { nowIso: iso(t1 + 20 * MINUTE) }));
    expect(provider.calls.length).toBe(callsBefore);
    expect(manual.skipped).toEqual([{ transactionId: ids.metanoia[0], reason: "AI classification is temporarily unavailable." }]);

    // The provider recovers; the next scheduled run (1 hour later) is the probe, which closes the circuit.
    provider.behaviour = suggest;
    const probe = await sweep(circuitCo, failing.next);
    expect(probe.asked).toHaveLength(5);
    expect(probe.outcome).toMatchObject({ circuitState: "closed", providerRequests: 5, classified: 5 });
    expect(await circuitStatus()).toMatchObject({ state: "closed", consecutive_timeouts: 0, consecutive_provider_failures: 0 });

    // X. The failure was recorded with its details, without the token.
    const { data, error } = await admin
      .from("ai_classification_attempts")
      .select("error_category, http_status, provider_message, provider_request_made")
      .eq("company_id", circuitCo)
      .eq("outcome", "provider_error");
    if (error) throw error;
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ error_category: "unauthorized", http_status: 401, provider_request_made: true });
    expect(String(data![0]!.provider_message)).toContain("Unauthorized");
    expect(String(data![0]!.provider_message)).not.toContain("synthetic-scenario-token");
  }, 300_000);

  it("concurrency: 150 simultaneous gate calls for one company allow exactly 100 — and two companies at once each get exactly 100", async () => {
    const day = T0 + 60 * DAY;
    // Both companies' calls interleaved and racing together.
    const calls = Array.from({ length: 300 }, (_, i) => {
      const [companyId, transactionId] = i % 2 === 0 ? [fuseA, ids.fuseA[0]!] : [fuseB, ids.fuseB[0]!];
      return async () => ({ companyId, decision: await gate(companyId, transactionId, day) });
    });
    const results = await inParallel(calls);

    expect(tally(results.filter((r) => r.companyId === fuseA).map((r) => r.decision))).toEqual({ allow: 100, daily_cap: 50 });
    expect(tally(results.filter((r) => r.companyId === fuseB).map((r) => r.decision))).toEqual({ allow: 100, daily_cap: 50 });
  }, 300_000);

  it("concurrency: when a probe is due, exactly ONE of 25 simultaneous callers gets it; a failed probe backs off; a successful one closes the circuit", async () => {
    const tp = T0 + 61 * DAY;
    await record(fuseA, ids.fuseA[0]!, tp, "auth", "provider_error", false);
    expect(await circuitStatus()).toMatchObject({ state: "open", probe_backoff_seconds: 3600 });

    const burst = async (atMs: number) => tally(await Promise.all(Array.from({ length: 25 }, () => gate(fuseB, ids.fuseB[0]!, atMs))));
    expect(await burst(tp + 30 * MINUTE)).toEqual({ circuit_open: 25 });
    expect(await burst(tp + HOUR)).toEqual({ probe: 1, circuit_open: 24 });

    await record(fuseB, ids.fuseB[0]!, tp + HOUR + 5_000, "auth", "provider_error", true);
    expect(await circuitStatus()).toMatchObject({ state: "open", probe_backoff_seconds: 7200 });
    expect(await burst(tp + 2 * HOUR)).toEqual({ circuit_open: 25 });
    expect(await burst(tp + 3 * HOUR + 5_000)).toEqual({ probe: 1, circuit_open: 24 });

    await record(fuseB, ids.fuseB[0]!, tp + 3 * HOUR + 10_000, "success", "no_confidence", true);
    expect(await circuitStatus()).toMatchObject({ state: "closed", probe_backoff_seconds: 3600 });

    // The 48 losers reserved nothing (or gave it back): only the 2 probes count today.
    const rest = await inParallel(Array.from({ length: 120 }, () => () => gate(fuseB, ids.fuseB[0]!, tp + 4 * HOUR)));
    expect(tally(rest)).toEqual({ allow: 98, daily_cap: 22 });
  }, 300_000);

  it("concurrency: the scheduler's sweep and a manual 'Classify with AI' racing near the fuse never exceed 100 requests between them", async () => {
    const day = T0 + 62 * DAY;
    // 90 of today's requests already used.
    const used = await inParallel(Array.from({ length: 90 }, () => () => gate(raceCo, ids.race[0]!, day)));
    expect(tally(used)).toEqual({ allow: 90 });

    provider.behaviour = suggest;
    const before = provider.calls.filter((c) => c.companyId === raceCo).length;
    const [sweepOutcome, manualOutcome] = await Promise.all([
      runWithServerExecutionContext(admin, () => runAutomaticAiClassificationSweep(raceCo, "System", { nowIso: iso(day + MINUTE) })),
      runWithServerExecutionContext(admin, () => classifyTransactionsWithAiManual(raceCo, ids.race.slice(20, 40), "Synthetic Accountant", 20, { nowIso: iso(day + MINUTE) })),
    ]);
    const sent = provider.calls.filter((c) => c.companyId === raceCo).length - before;

    expect(sent).toBe(10);
    expect(sweepOutcome.providerRequests + manualOutcome.classified).toBe(10);
    expect(await count("usage_events", { company_id: raceCo, metric_key: "ai_provider_requests" })).toBe(10);
  }, 300_000);
});
