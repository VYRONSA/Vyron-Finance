"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { AuthError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";

/** Finding #067/#177 (RC-15) — the raw Supabase SDK error message used
 * to render directly to the user (implementation details like
 * "AuthApiError: ..." or provider-internal wording). Maps the known,
 * common sign-in failure codes to plain language; anything unrecognized
 * falls back to one generic, still-actionable message rather than
 * leaking the SDK's own text. */
function friendlyAuthErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      return "That email and password combination doesn't match our records.";
    case "email_not_confirmed":
      return "Please confirm your email address before signing in — check your inbox for the confirmation link.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many sign-in attempts. Please wait a moment and try again.";
    case "user_banned":
      return "This account has been suspended. Contact support for help.";
    default:
      return "We couldn't sign you in. Check your email and password and try again.";
  }
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(searchParams.get("error"));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient(remember);
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        setError(friendlyAuthErrorMessage(authError));
        return;
      }

      router.push(searchParams.get("next") ?? "/platform");
      router.refresh();
    } catch {
      // No Supabase project is configured yet in this environment — see
      // ARCHITECTURE.md's "Known Gap" note. The form itself is real;
      // this only fires until real credentials exist.
      setError(
        "Couldn't reach the authentication service. If you're seeing this in development, check that NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-vf-ink">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-vf-paper-border bg-vf-paper px-3.5 py-2.5 text-vf-ink outline-none focus:border-vf-red-500"
          placeholder="you@company.com"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="password" className="block text-sm font-medium text-vf-ink">
            Password
          </label>
          <Link href="/forgot-password" className="text-xs font-medium text-vf-red-600 hover:underline">
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-vf-ink-soft">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="h-4 w-4 rounded border-vf-paper-border accent-vf-red-600"
        />
        Remember me on this device
      </label>

      {error && (
        <p role="alert" className="rounded-lg border border-vf-danger/25 bg-vf-danger/8 px-3.5 py-2.5 text-sm text-vf-danger">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign In"}
      </Button>

      <p className="text-center text-sm text-vf-ink-faint">
        Need help?{" "}
        <Link href="/#contact" className="font-medium text-vf-red-600 hover:underline">
          Contact support
        </Link>
      </p>
    </form>
  );
}
