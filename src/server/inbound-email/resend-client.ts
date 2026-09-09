import { Resend } from "resend";

/** Phase 21C — the ONE place `RESEND_API_KEY` is read. Fails honestly
 * (never silently no-ops, never fabricates a working client) when the
 * key isn't configured — same posture as `NoOpEmailSender`/
 * `isSupabaseAdminConfigured()` elsewhere in this codebase. */
export class ResendNotConfiguredError extends Error {}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new ResendNotConfiguredError("RESEND_API_KEY is not configured.");
  return new Resend(apiKey);
}
