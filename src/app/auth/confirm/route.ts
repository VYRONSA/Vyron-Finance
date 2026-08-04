import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

/**
 * Supabase's own documented server-side token-exchange endpoint for
 * email links (password recovery, invite-accept, email verification) —
 * Supabase's Auth Email Templates must point their `ConfirmationURL` at
 * this route (`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=...`)
 * instead of the default hosted verify link; a one-time dashboard
 * configuration step, not a code or database change. `type` selects
 * which flow completes: `recovery`/`invite` land the user on
 * /reset-password to set a password before anything else works;
 * `email`/`signup` land them straight in the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(`${origin}/login`);
  }

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const destination = next ?? (type === "recovery" || type === "invite" ? "/reset-password" : "/platform");
      return NextResponse.redirect(`${origin}${destination}`);
    }
  }

  const failureUrl = new URL("/login", origin);
  failureUrl.searchParams.set("error", "That link is invalid or has expired. Request a new one.");
  return NextResponse.redirect(failureUrl);
}
