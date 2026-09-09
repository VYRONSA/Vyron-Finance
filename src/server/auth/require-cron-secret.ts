/**
 * Authentication for the Automation Scheduler's cron-compatible route —
 * an external trigger (Vercel Cron, Supabase `pg_cron`, any scheduler)
 * has no user session, so it authenticates with a shared secret bearer
 * token instead, the same pattern Vercel's own Cron Jobs documentation
 * recommends. Genuinely new: no other route in this codebase uses
 * env-var-secret auth (every other route is `requireSession()`-gated) —
 * this one specifically has to be reachable WITHOUT a logged-in user.
 *
 * Phase 26F — also accepts `CRON_SECRET` (checked first), the exact env
 * var name Vercel's own native Cron Jobs feature reads to automatically
 * send `Authorization: Bearer <value>` on every invocation it triggers —
 * see Vercel's own "Securing Cron Jobs" docs. `AUTOMATION_CRON_SECRET`
 * remains fully supported and unchanged for any OTHER external
 * scheduler (Supabase `pg_cron`, a manual `curl`, etc.) that isn't
 * Vercel's own cron feature and so has no reason to know that name. Not
 * a second mechanism — one function, one check, now recognizing either
 * of the two secrets an operator might legitimately have configured.
 */

import { NextResponse } from "next/server";

export type CronAuthCheck = { ok: true } | { ok: false; response: NextResponse };

export function requireCronSecret(request: Request): CronAuthCheck {
  const secret = process.env.CRON_SECRET || process.env.AUTOMATION_CRON_SECRET;
  if (!secret) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No cron secret is configured. Set CRON_SECRET (for Vercel's own Cron Jobs) or AUTOMATION_CRON_SECRET (for any other external scheduler) as an environment variable to enable unattended runs." },
        { status: 501 },
      ),
    };
  }

  const header = request.headers.get("authorization");
  if (header !== `Bearer ${secret}`) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true };
}
