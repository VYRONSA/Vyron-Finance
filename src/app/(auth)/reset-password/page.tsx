import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { BrandMark } from "@/components/ui/brand-mark";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

export const metadata: Metadata = {
  title: "Set Password — VYRON FINANCE",
};

/** Landed on only via /auth/confirm after a valid recovery/invite email
 * link — that route already exchanged the token for a real (short-lived,
 * password-update-only) session, so this page just needs to confirm one
 * exists before showing the form; no token handling happens here. */
export default async function ResetPasswordPage() {
  const configured = isSupabaseConfigured();
  const hasSession = configured ? Boolean((await (await createClient()).auth.getClaims()).data?.claims) : false;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-vf-canvas px-6 py-16">
      <Card className="w-full max-w-sm">
        <CardContent className="p-8 sm:p-10">
          <Link href="/" className="mb-8 flex items-center gap-2.5 font-display text-lg text-vf-ink">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-vf-charcoal">
              <BrandMark className="h-4 w-4" />
            </span>
            VYRON FINANCE
          </Link>

          <h1 className="text-2xl font-medium text-vf-ink">Choose a new password</h1>
          <p className="mt-1.5 text-sm text-vf-ink-soft">
            {hasSession
              ? "You're almost in — set a password to finish."
              : "This link has expired or was already used."}
          </p>

          <div className="mt-8">
            {hasSession ? (
              <SetPasswordForm mode="reset" />
            ) : (
              <Link
                href="/forgot-password"
                className="inline-flex w-full items-center justify-center rounded-lg bg-vf-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-vf-red-700"
              >
                Request a new link
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
