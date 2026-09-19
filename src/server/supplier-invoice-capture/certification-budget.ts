/**
 * Phase 5N — the certification call ceiling, from the application side.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE DAILY BUDGET
 *
 * `ai_provider_scope_budgets` answers "how much AI may this company use in
 * a day" — 200 requests for supplier-invoice-extraction. A certification
 * run asks a different question: "how many provider calls may THIS
 * EXPERIMENT make in total before a human looks at the results again".
 *
 * Raising the daily budget to accommodate a certification run would be
 * exactly the wrong move. It would leave production more exposed
 * afterwards, and a temporary allowance that nobody remembers to lower is
 * how a safety limit quietly stops being one. So the daily budget is
 * untouched at 200, and this is an ADDITIONAL, run-scoped limit.
 *
 * BOTH APPLY. A certification call must fit inside the daily budget AND
 * inside the run's ceiling. Whichever binds first refuses, and neither can
 * be satisfied by exhausting the other.
 *
 * THIS IS NOT BILLING. It is operational protection for an unattended
 * experiment. It must never be shown to a customer, counted as customer
 * usage, or presented as a charge — see `fn_record_usage_event`, which is
 * the customer-facing metering path and is not touched by any of this.
 *
 * THE COUNTER LIVES IN POSTGRES, NOT IN THIS PROCESS. An in-memory counter
 * cannot bound parallel certification workers, and a certification harness
 * that fans out is exactly the thing this must bound. The atomicity proof
 * is `supabase/tests/certification_call_ceiling.concurrency.sh`: 40
 * concurrent connections against a ceiling of 15 granted exactly 15.
 */

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * The narrowest thing this module needs: something that can call an RPC.
 *
 * Structural rather than a Supabase type, so a certification run can inject
 * a client built for its own environment — and so tests can inject a fake
 * without a database.
 */
/**
 * A read-only query builder, narrowed to the three methods the precheck
 * uses. There is deliberately no `insert`, `update`, `delete` or `upsert`
 * on this type: a precheck that could write would not be a precheck, and
 * the absence is enforced by the type rather than by care.
 */
export type CertificationReadQuery = {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): CertificationReadQuery;
  eq(column: string, value: string): CertificationReadQuery;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
} & PromiseLike<{ data: unknown; error: unknown; count?: number | null }>;

export type CertificationDb = {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  /** Reading only — see `CertificationReadQuery`. */
  from(table: string): CertificationReadQuery;
};

/**
 * Builds the certification database client from DEDICATED environment
 * variables.
 *
 * DELIBERATELY NOT `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
 * Those are the application's own names, and if they ever point at
 * production — in a shell, a CI job, a copied `.env` — a certification run
 * would open a run, reserve calls and write attempt rows in the production
 * database. Distinct names make that impossible by construction rather than
 * by discipline: certification reaches a database only when someone has
 * deliberately named a certification one.
 *
 * Returns null when either variable is absent, so the caller fails closed
 * rather than guessing.
 */
export function createCertificationDb(env: Record<string, string | undefined> = process.env): CertificationDb | null {
  const url = env.VYRON_CERTIFICATION_SUPABASE_URL?.trim();
  const key = env.VYRON_CERTIFICATION_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as CertificationDb;
}

export type CertificationReservation = {
  reserved: boolean;
  callsUsed: number;
  callCeiling: number;
  status: "Open" | "Exhausted" | "Closed" | "Missing";
  /** Operator-facing sentence. Empty when the call was granted. */
  reason: string;
};

/**
 * Opens a certification run. Deliberate, labelled and recorded.
 *
 * At most one run may be Open per company — enforced by a unique index, so
 * "open a second one" cannot be used to quietly double an allowance while
 * the first is still going.
 */
export async function openCertificationRun(
  companyId: string,
  label: string,
  callCeiling: number,
  openedBy: string,
  db?: CertificationDb,
): Promise<number> {
  const supabase = db ?? (await createClient());
  const { data, error } = await supabase.rpc("fn_ai_certification_open_run", {
    p_company_id: companyId,
    p_label: label,
    p_call_ceiling: callCeiling,
    p_opened_by: openedBy,
  });
  if (error) throw error;
  return data as number;
}

/**
 * Claims one provider call from the run's ceiling.
 *
 * FAIL-CLOSED IN EVERY DIRECTION. A refusal, an exhausted run, a closed
 * run, a run that does not exist, and a database error all produce
 * `reserved: false`. There is no path through this function that returns
 * `true` without the database having incremented the counter, which is the
 * only thing that makes the ceiling real.
 *
 * Note the catch: a thrown database error becomes a refusal rather than an
 * exception. That is deliberate. If the ceiling cannot be consulted, the
 * safe answer is "no call", not "proceed and hope".
 */
export async function reserveCertificationCall(runId: number, db?: CertificationDb): Promise<CertificationReservation> {
  try {
    const supabase = db ?? (await createClient());
    const { data, error } = await supabase.rpc("fn_ai_certification_reserve_call", { p_run_id: runId });
    if (error) throw error;

    const row = data as Record<string, unknown>;
    return {
      reserved: row.reserved === true,
      callsUsed: Number(row.calls_used ?? 0),
      callCeiling: Number(row.call_ceiling ?? 0),
      status: (row.status as CertificationReservation["status"]) ?? "Missing",
      reason: String(row.reason ?? ""),
    };
  } catch {
    // Not "assume it is fine". If the ceiling cannot be consulted, there
    // is no ceiling, and a run with no ceiling must not make calls.
    return {
      reserved: false,
      callsUsed: 0,
      callCeiling: 0,
      status: "Missing",
      reason: "The certification call ceiling could not be read. No provider call was made.",
    };
  }
}

/** Ends a run. Does NOT reset the counter — what a run spent outlives it. */
export async function closeCertificationRun(runId: number, db?: CertificationDb): Promise<void> {
  const supabase = db ?? (await createClient());
  const { error } = await supabase.rpc("fn_ai_certification_close_run", { p_run_id: runId });
  if (error) throw error;
}
