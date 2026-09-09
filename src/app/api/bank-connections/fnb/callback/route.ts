import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { completeBankConnectionAuthorization, ValidationError } from "@/server/bank-connectivity/bank-connectivity-service";

/**
 * "FNB redirects to VYRON callback -> VYRON exchanges authorization code
 * server-side -> Tokens securely stored" (brief, Part 6). Deliberately
 * NOT nested under `/api/companies/[companyId]/**` — the whole point of
 * this route is that `companyId` is NOT yet known from the URL; it's
 * recovered from the single-use `state` token
 * (`bank-connectivity-service.ts::completeBankConnectionAuthorization`),
 * which is the actual CSRF defense (brief: "Use state protection against
 * CSRF"). This route still requires a real session — the browser
 * completing this redirect must be the same signed-in VYRON user who
 * started the connect flow — and, after recovering `companyId`,
 * independently re-checks that THIS session still has `Banking:Edit` on
 * that exact company before persisting anything, exactly the same
 * `requirePermission()` gate every other bank-connectivity route uses
 * (brief, Part 17: "Never allow /api/companies/companyA to be queried by
 * a user who only has access to companyB").
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  if (providerError) {
    return NextResponse.redirect(new URL(`/platform?bankConnectionError=${encodeURIComponent(providerError)}`, url.origin));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL("/platform?bankConnectionError=missing_code_or_state", url.origin));
  }

  try {
    const { companyId, redirectAfter } = await completeBankConnectionAuthorization(state, code, new Date().toISOString());

    const check = await requirePermission(companyId, "Banking:Edit");
    if (!check.ok) {
      return NextResponse.redirect(new URL("/platform?bankConnectionError=unauthorized", url.origin));
    }

    // `redirectAfter` was supplied by VYRON itself when the flow started
    // (bank-connections POST route) — still only ever trusted as a
    // same-origin relative path, never an absolute/external URL.
    const destination = redirectAfter && redirectAfter.startsWith("/") ? redirectAfter : `/company/${companyId}/bank-accounts`;
    return NextResponse.redirect(new URL(`${destination}?bankConnected=1`, url.origin));
  } catch (error) {
    const message = error instanceof ValidationError ? error.message : "connection_failed";
    return NextResponse.redirect(new URL(`/platform?bankConnectionError=${encodeURIComponent(message)}`, url.origin));
  }
}
