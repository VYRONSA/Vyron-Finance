import { NextResponse } from "next/server";
import { verifyResendWebhookRequest, MissingWebhookSecretError, InvalidWebhookSignatureError } from "@/server/inbound-email/webhook-verification";
import { processResendInboundEmail } from "@/server/services/inbound-bank-statement-email-service";
import type { EmailReceivedEvent } from "resend";

/**
 * Phase 21C — Resend inbound webhook receiver. Deliberately OUTSIDE
 * `/api/companies/[companyId]/**` — the companyId isn't known from the
 * URL, only from the verified payload's recipient address. No
 * `requireSession()` here: this is a server-to-server webhook with no
 * user session to check. Tenant isolation instead comes from: a
 * verified signature (this route never trusts an unverified payload) +
 * recipient resolution + the stored company identity + an explicit
 * `companyId` threaded through every downstream call — see
 * `inbound-bank-statement-email-service.ts`.
 *
 * The raw request body is read with `request.text()` BEFORE anything
 * else touches it — Resend/Svix signature verification is sensitive to
 * the exact byte content, so it is never re-serialized JSON.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  let payload;
  try {
    payload = verifyResendWebhookRequest(rawBody, { svixId, svixTimestamp, svixSignature });
  } catch (error) {
    if (error instanceof MissingWebhookSecretError) {
      // Not "pretend it works" — an honest 500 rather than silently
      // accepting (and losing) a real statement.
      return NextResponse.json({ error: "Inbound email processing is not configured." }, { status: 500 });
    }
    if (error instanceof InvalidWebhookSignatureError) {
      return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
    }
    throw error;
  }

  // Only the one event type this route exists for is processed — any
  // other Resend event this endpoint might receive (e.g. if the same
  // webhook were ever subscribed to more event types) is acknowledged,
  // never treated as a failure worth retrying.
  if (payload.type !== "email.received") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Guaranteed non-null here — verification above would have thrown
  // `InvalidWebhookSignatureError` otherwise.
  const providerEventId = svixId!;

  const outcome = await processResendInboundEmail(payload as EmailReceivedEvent, providerEventId);

  if (outcome.status === "failed") {
    // A transient failure (attachment download, a temporary DB/import
    // error) — a non-2xx response so Resend's own retry schedule gets
    // another chance, rather than silently losing the statement.
    return NextResponse.json({ ok: false, status: outcome.status, error: outcome.reason }, { status: 502 });
  }

  // "processed" / "already-processed" / "rejected" are all outcomes
  // this system has fully and correctly handled — retrying the exact
  // same event would never change any of them, so Resend should not
  // keep redelivering.
  return NextResponse.json({ ok: true, status: outcome.status });
}
