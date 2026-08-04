/**
 * Authoritative session check for API routes. `proxy.ts`'s optimistic
 * gate only covers page navigations under `/platform` and `/company`
 * (its matcher never sees `/api/**`), so every API route under
 * `/api/companies/[companyId]/**` needs its own check — this is that
 * check, shared so it's written once. Row Level Security is still the
 * real authorization boundary (see supabase/migrations/*.sql); this only
 * turns an unauthenticated request into a clean 401 instead of an
 * RLS-driven empty result.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

export type SessionCheck = { ok: true } | { ok: false; response: NextResponse };

export async function requireSession(): Promise<SessionCheck> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No Supabase project is configured. This route is only reachable in production once real credentials exist." },
        { status: 501 },
      ),
    };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true };
}

/** Best-effort human-readable identity for audit-history `performed_by`
 * columns (`ae_match_history`, `ae_allocation_history`,
 * `ae_transaction_review_history`, ...) — falls back to "System" rather
 * than throwing, since attribution is a nice-to-have, not a gate. */
export async function getPerformedByLabel(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as { email?: string; sub?: string } | undefined;
  return claims?.email ?? claims?.sub ?? "System";
}

/** The signed-in user's auth id (JWT `sub`) — required, throws if called
 * without a session (callers sit behind `requireSession()` already). Used
 * by `company-service.ts`'s organisation-bootstrap flow to insert
 * `organisation_members.user_id`. */
export async function getCurrentUserId(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = (data?.claims as { sub?: string } | undefined)?.sub;
  if (!sub) throw new Error("No authenticated user.");
  return sub;
}

/** The signed-in user's email, or `null` if the claim genuinely has
 * none (some auth providers don't guarantee one) — a real absence, not
 * defaulted to a placeholder string. Used by `company-service.ts` to
 * seed a new `billing_accounts.billing_email` from a real value rather
 * than requiring it as a separate, easy-to-forget input on company
 * creation. */
export async function getCurrentUserEmail(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims as { email?: string } | undefined)?.email ?? null;
}
