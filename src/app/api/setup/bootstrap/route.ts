import { NextResponse } from "next/server";
import { ValidationError } from "@/server/services/permission-service";
import {
  AdminNotConfiguredError,
  AlreadyBootstrappedError,
  bootstrapPlatformSuperAdministrator,
  platformBootstrapStatus,
} from "@/server/services/bootstrap-service";
import {
  BOOTSTRAP_SECRET_HEADER,
  checkBootstrapRateLimit,
  checkInvitationRateLimit,
  configuredOwnerEmail,
  emailDomain,
  isPlatformBootstrapEnabled,
  ownerEmailAllowed,
  recordBootstrapAttempt,
  recordDisabledProbe,
  requestContext,
  verifyBootstrapSecret,
  type RequestContext,
} from "@/server/setup/bootstrap-guard";

/**
 * Platform bootstrap — invitation of the first Platform Super Administrator.
 *
 * P0 security remediation: this route used to be open to anyone. It is now
 * OFF unless `PLATFORM_BOOTSTRAP_ENABLED` is exactly "true" (production
 * leaves it unset); when enabled every call needs the bootstrap secret in a
 * header and `BOOTSTRAP_OWNER_EMAIL` must be configured — the only address
 * that can be invited. See `src/server/setup/bootstrap-guard.ts` and
 * `src/server/services/bootstrap-service.ts`. While disabled it answers
 * 404 — the same as a route that does not exist — and reveals nothing.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: HEADERS });
const notFound = () => reply({ error: "Not found." }, 404);

/** Rate limit, then the configuration, then the secret. Returns the refusal, or null to proceed. */
async function refuse(request: Request, ctx: RequestContext): Promise<NextResponse | null> {
  const limit = await checkBootstrapRateLimit(ctx);
  if (limit === "limited") {
    await recordBootstrapAttempt(ctx, "failure", "rate_limited");
    return reply({ error: "Too many attempts. Try again later." }, 429);
  }
  if (limit === "unavailable") return reply({ error: "Platform bootstrap is temporarily unavailable." }, 503);

  const secret = verifyBootstrapSecret(request.headers.get(BOOTSTRAP_SECRET_HEADER));
  if (secret === "not_configured" || configuredOwnerEmail() === null) {
    await recordBootstrapAttempt(ctx, "failure", secret === "not_configured" ? "secret_not_configured" : "owner_email_not_configured");
    return reply({ error: "Platform bootstrap is not configured." }, 503);
  }
  if (secret !== "ok") {
    await recordBootstrapAttempt(ctx, "failure", secret === "missing" ? "secret_missing" : "secret_invalid");
    return reply({ error: "Not authorised." }, 401);
  }
  return null;
}

export async function GET(request: Request) {
  if (!isPlatformBootstrapEnabled()) return notFound();
  const ctx = requestContext(request);
  const refusal = await refuse(request, ctx);
  if (refusal) return refusal;
  return reply({ status: await platformBootstrapStatus() }, 200);
}

export async function POST(request: Request) {
  const ctx = requestContext(request);
  if (!isPlatformBootstrapEnabled()) {
    await recordDisabledProbe(ctx);
    return notFound();
  }
  const refusal = await refuse(request, ctx);
  if (refusal) return refusal;

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    await recordBootstrapAttempt(ctx, "failure", "invalid_body");
    return reply({ error: "Invalid request." }, 400);
  }
  const email = String(body?.email ?? "");
  const domain = emailDomain(email);

  if (!ownerEmailAllowed(email)) {
    await recordBootstrapAttempt(ctx, "failure", "owner_email_mismatch", { emailDomain: domain });
    return reply({ error: "This email address is not permitted to bootstrap the platform." }, 403);
  }

  const invitations = await checkInvitationRateLimit();
  if (invitations !== "ok") {
    if (invitations === "limited") await recordBootstrapAttempt(ctx, "failure", "invitation_rate_limited", { emailDomain: domain });
    return invitations === "limited"
      ? reply({ error: "Too many invitations. Try again later." }, 429)
      : reply({ error: "Platform bootstrap is temporarily unavailable." }, 503);
  }

  try {
    // The same landing as every other invitation (`/api/companies/[companyId]/users/invite`):
    // the invitee confirms, then sets their own password.
    const redirectTo = `${new URL(request.url).origin}/auth/confirm?type=invite&next=/reset-password`;
    const { outcome } = await bootstrapPlatformSuperAdministrator({ email, redirectTo });
    await recordBootstrapAttempt(ctx, "success", outcome, { emailDomain: domain });
    return reply({ invited: true, outcome, status: "pending_verification" }, outcome === "reissued" ? 200 : 201);
  } catch (error) {
    if (error instanceof ValidationError) {
      await recordBootstrapAttempt(ctx, "failure", "validation", { emailDomain: domain });
      return reply({ error: error.message }, 400);
    }
    if (error instanceof AlreadyBootstrappedError) {
      await recordBootstrapAttempt(ctx, "failure", "already_completed", { emailDomain: domain });
      return reply({ error: error.message }, 409);
    }
    await recordBootstrapAttempt(ctx, "failure", error instanceof AdminNotConfiguredError ? "not_configured" : "error", { emailDomain: domain });
    if (error instanceof AdminNotConfiguredError) return reply({ error: error.message }, 501);
    return reply({ error: "Platform bootstrap could not be completed." }, 500);
  }
}
