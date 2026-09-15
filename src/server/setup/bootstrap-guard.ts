import { createHash, timingSafeEqual } from "node:crypto";
import { countRecentPlatformEvents, recordPlatformSecurityEvent } from "@/server/repositories/platform-security-event-repository";
import type { EventSeverity } from "@/server/operations/types";

/**
 * P0 security remediation — the gate in front of platform bootstrap.
 *
 * Before: `POST /api/setup/bootstrap` was open to anyone on the internet
 * and created a confirmed `platform_super_administrator`. Now:
 *
 *  - OFF by default: unless `PLATFORM_BOOTSTRAP_ENABLED` is exactly
 *    "true", the route and `/setup` answer 404 and reveal nothing.
 *  - When enabled, every call must carry `PLATFORM_BOOTSTRAP_SECRET` in
 *    the `x-vyron-bootstrap-secret` header (never a URL), compared in
 *    constant time. A secret shorter than 32 characters is treated as
 *    not configured, so a weak secret can never enable the route.
 *  - `BOOTSTRAP_OWNER_EMAIL` is REQUIRED and is the only address that can
 *    be invited, so even a leaked secret can only ever send the invitation
 *    to the owner's own mailbox.
 *  - Failed attempts are rate limited per client and globally, and
 *    invitations per hour, from the recorded security events themselves —
 *    durable across serverless instances. If a limit cannot be checked,
 *    the route fails closed.
 *  - Every attempt is recorded as a `PlatformBootstrapAttempt` event in
 *    `system_events` (the existing security-event mechanism). The secret,
 *    any password and tokens are never recorded, logged or returned.
 */

export const BOOTSTRAP_SECRET_HEADER = "x-vyron-bootstrap-secret";
export const MIN_BOOTSTRAP_SECRET_LENGTH = 32;
export const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
export const MAX_FAILURES_PER_CLIENT = 5;
export const MAX_FAILURES_GLOBAL = 20;
/** Successful invitations (first send, re-sends, corrections) per hour —
 * bounds how many emails even a valid secret can trigger. */
export const MAX_INVITATIONS_PER_HOUR = 5;
/** Probes of the disabled route are recorded too, capped per hour so an
 * anonymous caller cannot turn a 404 into unbounded database writes. */
export const MAX_DISABLED_PROBE_EVENTS_PER_HOUR = 50;

type Env = Record<string, string | undefined>;

export function isPlatformBootstrapEnabled(env: Env = process.env): boolean {
  return env.PLATFORM_BOOTSTRAP_ENABLED === "true";
}

export type SecretCheck = "ok" | "missing" | "invalid" | "not_configured";

/** Constant-time: both sides are hashed to a fixed length first, so
 * neither the comparison nor an early length mismatch leaks timing. */
export function verifyBootstrapSecret(provided: string | null, env: Env = process.env): SecretCheck {
  const expected = env.PLATFORM_BOOTSTRAP_SECRET ?? "";
  if (expected.length < MIN_BOOTSTRAP_SECRET_LENGTH) return "not_configured";
  if (!provided) return "missing";
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b) ? "ok" : "invalid";
}

/** The configured owner address, trimmed and lower-cased; null if unset
 * or not an address (bootstrap then refuses to run). */
export function configuredOwnerEmail(env: Env = process.env): string | null {
  const owner = env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase() ?? "";
  return owner.includes("@") ? owner : null;
}

/** Email addresses are case-insensitive, so the comparison is on the
 * trimmed, lower-cased address; otherwise it must match exactly. Always
 * false when no owner address is configured. */
export function ownerEmailAllowed(email: string, env: Env = process.env): boolean {
  const owner = configuredOwnerEmail(env);
  return owner !== null && email.trim().toLowerCase() === owner;
}

export type RequestContext = { clientIp: string; userAgent: string };

export function requestContext(request: Request): RequestContext {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    clientIp: forwarded || request.headers.get("x-real-ip")?.trim() || "unknown",
    userAgent: (request.headers.get("user-agent") ?? "").slice(0, 160),
  };
}

export function emailDomain(email: string): string | undefined {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).trim().toLowerCase().slice(0, 100) : undefined;
}

export type RateLimit = "ok" | "limited" | "unavailable";

export async function checkBootstrapRateLimit(ctx: RequestContext, now: number = Date.now()): Promise<RateLimit> {
  try {
    const since = new Date(now - RATE_LIMIT_WINDOW_MS).toISOString();
    const [fromClient, overall] = await Promise.all([
      countRecentPlatformEvents("PlatformBootstrapAttempt", since, { outcome: "failure", clientIp: ctx.clientIp }),
      countRecentPlatformEvents("PlatformBootstrapAttempt", since, { outcome: "failure" }),
    ]);
    return fromClient >= MAX_FAILURES_PER_CLIENT || overall >= MAX_FAILURES_GLOBAL ? "limited" : "ok";
  } catch {
    return "unavailable";
  }
}

export async function checkInvitationRateLimit(now: number = Date.now()): Promise<RateLimit> {
  try {
    const since = new Date(now - 60 * 60_000).toISOString();
    return (await countRecentPlatformEvents("PlatformBootstrapAttempt", since, { outcome: "success" })) >= MAX_INVITATIONS_PER_HOUR ? "limited" : "ok";
  } catch {
    return "unavailable";
  }
}

export type BootstrapOutcome = "success" | "failure" | "rejected_disabled";

function severityFor(outcome: BootstrapOutcome, reason: string): EventSeverity {
  if (outcome === "success") return "critical";
  if (reason.startsWith("secret_") || reason.endsWith("rate_limited") || reason === "owner_email_mismatch") return "high";
  return "warning";
}

/** Never throws — an audit write must not change the response. Rate
 * limiting does not depend on this succeeding: it fails closed on its own
 * read. Only the outcome, a reason category and safe request context are
 * recorded — never the secret, a password or any token. */
export async function recordBootstrapAttempt(ctx: RequestContext, outcome: BootstrapOutcome, reason: string, extra: { emailDomain?: string } = {}): Promise<void> {
  try {
    await recordPlatformSecurityEvent({
      eventType: "PlatformBootstrapAttempt",
      severity: severityFor(outcome, reason),
      actor: null,
      detail: `Platform bootstrap ${outcome}: ${reason}`,
      metadata: { outcome, reason, clientIp: ctx.clientIp, userAgent: ctx.userAgent, ...(extra.emailDomain ? { emailDomain: extra.emailDomain } : {}) },
    });
  } catch {
    // Observability must never break the security decision itself.
  }
}

export async function recordDisabledProbe(ctx: RequestContext, now: number = Date.now()): Promise<void> {
  try {
    const since = new Date(now - 60 * 60_000).toISOString();
    if ((await countRecentPlatformEvents("PlatformBootstrapAttempt", since, { outcome: "rejected_disabled" })) >= MAX_DISABLED_PROBE_EVENTS_PER_HOUR) return;
  } catch {
    return;
  }
  await recordBootstrapAttempt(ctx, "rejected_disabled", "disabled");
}
