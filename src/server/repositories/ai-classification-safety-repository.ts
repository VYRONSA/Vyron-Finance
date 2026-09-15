/**
 * Repository for the AI classification safety layer (migration 0099):
 * the per-request gate (queue hold, shared circuit breaker, per-company
 * daily fuse), the attempt log with per-transaction queue state, and sweep
 * candidate selection.
 *
 * Every call goes through a service-role-only database function with the
 * service-role client, whatever the caller's context (the unattended
 * scheduler, an import, or a signed-in user's "Classify with AI"): the
 * circuit breaker is shared across all companies and must never be
 * writable by a company user. Callers are server code that has already
 * established the company context. If the service role is not configured,
 * or the gate answers with anything unexpected, this throws — and callers
 * treat that as "do not send anything".
 */

import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import {
  AI_CLASSIFICATION_PROVIDER,
  AI_PROVIDER_CIRCUIT_SCOPE,
  AI_PROVIDER_DAILY_REQUEST_CAP,
  type AttemptOutcome,
  type AttemptSource,
  type CircuitSignal,
  type ProviderUsage,
} from "@/server/ai/transaction-classification/safety-policy";

function serviceClient() {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("AI classification safety store is not configured (SUPABASE_SERVICE_ROLE_KEY is missing).");
  }
  return createAdminClient();
}

/** allow/probe: send exactly one request (a daily-fuse slot is reserved).
 * held: skip this transaction (automatic paths: cooldown, human review, resolved).
 * circuit_open / daily_cap: send nothing more in this batch. */
export type GateDecision = "allow" | "probe" | "held" | "circuit_open" | "daily_cap";
const GATE_DECISIONS: ReadonlySet<string> = new Set<GateDecision>(["allow", "probe", "held", "circuit_open", "daily_cap"]);

export type GateResult = {
  decision: GateDecision;
  circuitState: "open" | "closed" | null;
  openReason: string | null;
  nextProbeAt: string | null;
  /** Requests reserved today BEFORE this one (null when the gate did not look). */
  requestsToday: number | null;
  dailyCap: number;
  queueState: string | null;
};

/** Called before EVERY provider request, for one transaction. */
export async function gateAiProviderRequest(
  companyId: string,
  transactionId: number,
  source: AttemptSource,
  nowIso: string,
  dailyCap: number = AI_PROVIDER_DAILY_REQUEST_CAP,
): Promise<GateResult> {
  const { data, error } = await serviceClient().rpc("fn_ai_classification_gate", {
    p_company_id: companyId,
    p_transaction_id: transactionId,
    p_source: source,
    p_now: nowIso,
    p_daily_cap: dailyCap,
    p_scope: AI_PROVIDER_CIRCUIT_SCOPE,
  });
  if (error) throw error;
  const r = (data ?? null) as Record<string, unknown> | null;
  const decision = r?.decision;
  // Fail closed: only a recognised decision is ever acted on.
  if (!r || typeof decision !== "string" || !GATE_DECISIONS.has(decision)) {
    throw new Error("AI classification gate returned no recognisable decision; nothing will be sent.");
  }
  const circuit = r.circuit_state;
  return {
    decision: decision as GateDecision,
    circuitState: circuit === "open" ? "open" : circuit === "closed" ? "closed" : null,
    openReason: (r.open_reason as string | null) ?? null,
    nextProbeAt: (r.next_probe_at as string | null) ?? null,
    requestsToday: r.requests_today === null || r.requests_today === undefined ? null : Number(r.requests_today),
    dailyCap: Number(r.daily_cap ?? dailyCap),
    queueState: (r.queue_state as string | null) ?? null,
  };
}

export type NewAiClassificationAttempt = {
  companyId: string;
  transactionId: number;
  taskRunId: number | null;
  source: AttemptSource;
  outcome: AttemptOutcome;
  providerRequestMade: boolean;
  model: string | null;
  errorCategory: string | null;
  httpStatus: number | null;
  /** Must already be sanitized (`sanitizeProviderMessage`). */
  providerMessage: string | null;
  usage: ProviderUsage | null;
  durationMs: number;
  performedBy: string;
  circuitSignal: CircuitSignal;
  /** Must be the same timestamp the gate was called with (same UTC day). */
  nowIso: string;
  /** This request was the open circuit's probe (only a probe's failure moves the backoff). */
  probe: boolean;
};

export type RecordedAttempt = {
  queueState: string;
  nextEligibleAt: string | null;
  circuitState: "open" | "closed";
  openReason: string | null;
  nextProbeAt: string | null;
};

/** Records the attempt, updates the transaction's queue state, counts the
 * internal provider request (or gives back an unused daily reservation)
 * and moves the circuit breaker — atomically. */
export async function recordAiClassificationAttempt(input: NewAiClassificationAttempt): Promise<RecordedAttempt> {
  const { data, error } = await serviceClient().rpc("fn_ai_classification_record_attempt", {
    p_company_id: input.companyId,
    p_transaction_id: input.transactionId,
    p_task_run_id: input.taskRunId,
    p_source: input.source,
    p_outcome: input.outcome,
    p_provider_request_made: input.providerRequestMade,
    p_model: input.model,
    p_error_category: input.errorCategory,
    p_http_status: input.httpStatus,
    p_provider_message: input.providerMessage,
    p_usage: input.usage,
    p_duration_ms: Math.max(0, Math.round(input.durationMs)),
    p_performed_by: input.performedBy,
    p_circuit_signal: input.circuitSignal,
    p_now: input.nowIso,
    p_scope: AI_PROVIDER_CIRCUIT_SCOPE,
    p_probe: input.probe,
  });
  if (error) throw error;
  const r = data as Record<string, unknown>;
  return {
    queueState: String(r.queue_state),
    nextEligibleAt: (r.next_eligible_at as string | null) ?? null,
    circuitState: r.circuit_state === "open" ? "open" : "closed",
    openReason: (r.open_reason as string | null) ?? null,
    nextProbeAt: (r.next_probe_at as string | null) ?? null,
  };
}

/** The next sweep batch: never-attempted first, then least recently
 * attempted, then oldest — excluding cooldown, needs-human-review and
 * resolved. */
export async function listAiClassificationSweepCandidates(companyId: string, limit: number, nowIso: string): Promise<{ transactionIds: number[]; hasMore: boolean }> {
  const { data, error } = await serviceClient().rpc("fn_ai_classification_candidates", {
    p_company_id: companyId,
    p_limit: limit + 1,
    p_now: nowIso,
  });
  if (error) throw error;
  const rows = (data ?? []) as { transaction_id: number | string }[];
  const ids = rows.map((r) => Number(r.transaction_id));
  return { transactionIds: ids.slice(0, limit), hasMore: ids.length > limit };
}

/** Explicit "Retry AI" for one transaction — never called automatically. */
export async function resetAiClassificationQueueState(companyId: string, transactionId: number): Promise<boolean> {
  const { data, error } = await serviceClient().rpc("fn_ai_classification_reset_queue_state", { p_company_id: companyId, p_transaction_id: transactionId });
  if (error) throw error;
  return data === true;
}

export async function getAiProviderCircuitStatus(): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceClient().rpc("fn_ai_provider_circuit_status", { p_scope: AI_PROVIDER_CIRCUIT_SCOPE });
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

export const AI_PROVIDER_NAME = AI_CLASSIFICATION_PROVIDER;
