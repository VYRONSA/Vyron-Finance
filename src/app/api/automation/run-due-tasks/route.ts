import { NextResponse } from "next/server";
import { requireCronSecret } from "@/server/auth/require-cron-secret";
import { runDueTasks } from "@/server/services/scheduler-service";
import { listAllCompanyIds } from "@/server/repositories/company-repository";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { runWithServerExecutionContext } from "@/lib/supabase/execution-context";

/**
 * Cron-compatible entry point for unattended Scheduler execution — an
 * external trigger (Vercel Cron / Supabase `pg_cron` / any scheduler)
 * calls this, authenticating with `AUTOMATION_CRON_SECRET` (see
 * `require-cron-secret.ts`) instead of a user session, since a cron job
 * has none.
 *
 * Phase 26F — this used to run `runDueTasks` through the ordinary
 * session-scoped Supabase client, which meant a genuinely unattended
 * call (no browser session, no `auth.uid()`) reached the database but
 * saw every RLS-protected query return empty — the route would report
 * `{"outcome": {"processed": 0, ...}}` and look like a healthy no-op run
 * forever, never actually doing anything. This closes that gap the
 * SAME way the inbound bank-statement webhook already solved the
 * identical problem (Phase 21D): the whole call runs inside
 * `runWithServerExecutionContext` with a service-role admin client
 * (`createAdminClient()`), so every EXISTING, UNMODIFIED session-scoped
 * repository call `runDueTasks` makes (transaction classification,
 * Banking Rules, bank sync, communications, billing) now actually sees
 * and writes real rows — no second execution path, no second Supabase
 * client convention, the exact same mechanism already proven in
 * production for the webhook pipeline.
 *
 * `companyId` (POST body only — a GET request, per Vercel Cron's own
 * fixed contract, carries no body) still runs exactly one company (the
 * original contract, unchanged). Omitting it now processes EVERY
 * company on the platform, one after another — this is what makes a
 * single external cron trigger a genuine "run the whole platform's
 * scheduler," not something that only ever reaches one hardcoded
 * company. `listAllCompanyIds()` is the one legitimate cross-tenant
 * enumeration in this codebase, used only here.
 *
 * Two exported handlers, one shared implementation: Vercel's own Cron
 * Jobs feature (`vercel.json`) always sends a GET request to the
 * configured path — it has no mechanism to send a POST body — so `GET`
 * is the real entry point Vercel's cron actually reaches, and it always
 * runs every company (no way for a bodyless GET to name just one). POST
 * remains for any other external scheduler or manual/scripted
 * invocation that wants to target exactly one company via a JSON body —
 * unchanged from before this phase.
 */
async function handleRunDueTasks(request: Request, requestedCompanyId: string | null) {
  const auth = requireCronSecret(request);
  if (!auth.ok) return auth.response;

  if (!isSupabaseAdminConfigured()) {
    // Honest failure — never a fabricated success. Retryable: once
    // SUPABASE_SERVICE_ROLE_KEY is set, the identical trigger succeeds.
    return NextResponse.json(
      { error: "Unattended Scheduler execution is not fully configured (SUPABASE_SERVICE_ROLE_KEY is missing)." },
      { status: 501 },
    );
  }

  const nowIso = new Date().toISOString();
  const adminClient = createAdminClient();

  return runWithServerExecutionContext(adminClient, async () => {
    if (requestedCompanyId) {
      const outcome = await runDueTasks(requestedCompanyId, nowIso, "Scheduler (cron)");
      return NextResponse.json({ outcome });
    }

    const companyIds = await listAllCompanyIds();
    const results: Record<string, Awaited<ReturnType<typeof runDueTasks>>> = {};
    for (const companyId of companyIds) {
      results[companyId] = await runDueTasks(companyId, nowIso, "Scheduler (cron)");
    }
    return NextResponse.json({ companiesProcessed: companyIds.length, results });
  });
}

/** The actual target Vercel Cron (or any GET-only trigger) hits — always
 * every company, since a GET request has no body to name just one. */
export async function GET(request: Request) {
  return handleRunDueTasks(request, null);
}

/** Preserved for any external scheduler or manual invocation that wants
 * a JSON body naming exactly one company — unchanged contract. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const requestedCompanyId = typeof body.companyId === "string" ? body.companyId : null;
  return handleRunDueTasks(request, requestedCompanyId);
}
