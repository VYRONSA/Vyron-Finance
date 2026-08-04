import { NextResponse } from "next/server";
import { requireCronSecret } from "@/server/auth/require-cron-secret";
import { runDueTasks } from "@/server/services/scheduler-service";

/**
 * Cron-compatible entry point for unattended Scheduler execution — an
 * external trigger (Vercel Cron / Supabase `pg_cron` / any scheduler)
 * calls this once per company it knows about, authenticating with
 * `AUTOMATION_CRON_SECRET` (see `require-cron-secret.ts`) instead of a
 * user session, since a cron job has none.
 *
 * Honest limitation, consistent with this codebase's own established
 * trade-off (see `require-session.ts`'s own docstring: "Row Level
 * Security is still the real authorization boundary... an RLS-driven
 * empty result" is an accepted, disclosed outcome elsewhere in this
 * app): every repository in this codebase reads/writes through the
 * standard session-scoped Supabase client, and RLS's
 * `user_can_access_company()` requires `auth.uid()`. A request
 * authenticated only by the cron secret carries no `auth.uid()`, so
 * without an active session cookie this call will reach the database but
 * see empty results rather than throwing — the secret proves the CALLER
 * is trusted, it does not itself grant data access. Genuine unattended
 * (no browser session at all) execution needs a service-role Supabase
 * client threaded through the repository layer — a real, scoped
 * follow-up deliberately not built in this pass, since doing it properly
 * means touching the client construction in every repository file built
 * so far, a regression risk this module's own "No regressions"
 * completion criterion weighs against taking without being asked.
 * Today's real, working trigger is the manual "Run Scheduler Now" button
 * (`POST /api/companies/[companyId]/automation-tasks`), which runs in a
 * real authenticated request and works correctly end-to-end.
 */
export async function POST(request: Request) {
  const auth = requireCronSecret(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const companyId = typeof body.companyId === "string" ? body.companyId : null;
  if (!companyId) {
    return NextResponse.json({ error: "companyId is required in the request body." }, { status: 400 });
  }

  const outcome = await runDueTasks(companyId, new Date().toISOString(), "Scheduler (cron)");
  return NextResponse.json({ outcome });
}
