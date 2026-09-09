import { NextResponse } from "next/server";
import { requireCronSecret } from "@/server/auth/require-cron-secret";
import { pollBankStatementImapMailbox } from "@/server/services/inbound-bank-statement-email-service";

/**
 * Phase 21K — cron-compatible entry point for the Virtualmin/Postfix
 * shared-mailbox IMAP poll. Deliberately OUTSIDE
 * `/api/companies/[companyId]/**` and deliberately NOT modeled as an
 * `automation_tasks` row the way every other scheduled activity is
 * (`BankSync`/`RuleEngineRun`/`CommunicationQueue`/etc., see
 * `scheduler-service.ts`) — `automation_tasks.company_id` is `not null`
 * by schema design, and the mailbox this polls is shared across every
 * company (tenant identity is resolved per-message, from the
 * recipient, never from which mailbox a message landed in — see
 * `recipient-resolution.ts`). Forcing this into the per-company task
 * model would mean N companies each independently polling the SAME
 * mailbox on their own cadence, racing to move/mark the same IMAP
 * objects — a real duplicate-processing risk, not just an architectural
 * mismatch. This route instead mirrors the ALREADY-established
 * precedent for exactly this shape of problem in this codebase: the
 * Resend inbound webhook route (`/api/webhooks/resend/bank-statements`)
 * is also deliberately outside the company-scoped API surface, using
 * the same `AUTOMATION_CRON_SECRET` bearer-token pattern
 * `/api/automation/run-due-tasks` already established for unattended,
 * no-user-session execution.
 *
 * Concurrency: no separate poll-run lock exists (and none was added —
 * see the Phase 21K completion report for why one isn't required for
 * correctness). Two overlapping invocations of this route both listing
 * and attempting the SAME IMAP UID collide on the SAME
 * `(provider, provider_event_id)` unique-constraint insert inside
 * `processInboundEmailMessage()` — the identical, already-proven
 * mechanism that already protects Resend's own at-least-once webhook
 * redelivery today. The loser's insert returns `already-processed` and
 * it moves on without re-running the import.
 *
 * The response body intentionally carries only aggregate counts — never
 * a recipient address, sender, subject, filename, or any other
 * message-level content, per this phase's own audit/observability
 * requirement (never leak customer-sensitive data, credentials, or raw
 * provider errors in an API response).
 */
export async function POST(request: Request) {
  const auth = requireCronSecret(request);
  if (!auth.ok) return auth.response;

  try {
    const outcome = await pollBankStatementImapMailbox();
    return NextResponse.json({ ok: true, outcome });
  } catch {
    // A connection/authentication failure against the real IMAP server —
    // genuinely failed, but never echo the raw error (which can include
    // the configured host/port or a low-level socket/auth message) back
    // in the response; the caller's own scheduler/monitoring should
    // treat a non-2xx here as "retry on the next scheduled run," exactly
    // like the Resend webhook route's own `failed` -> 502 convention.
    return NextResponse.json({ ok: false, error: "Could not complete the bank statement mailbox poll." }, { status: 502 });
  }
}
