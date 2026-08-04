/**
 * Authentication for the Automation Scheduler's cron-compatible route —
 * an external trigger (Vercel Cron, Supabase `pg_cron`, any scheduler)
 * has no user session, so it authenticates with a shared secret bearer
 * token instead, the same pattern Vercel's own Cron Jobs documentation
 * recommends. Genuinely new: no other route in this codebase uses
 * env-var-secret auth (every other route is `requireSession()`-gated) —
 * this one specifically has to be reachable WITHOUT a logged-in user.
 */

import { NextResponse } from "next/server";

export type CronAuthCheck = { ok: true } | { ok: false; response: NextResponse };

export function requireCronSecret(request: Request): CronAuthCheck {
  const secret = process.env.AUTOMATION_CRON_SECRET;
  if (!secret) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "AUTOMATION_CRON_SECRET is not configured. Set it as an environment variable and have your external scheduler send it as a Bearer token to enable unattended runs." },
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
