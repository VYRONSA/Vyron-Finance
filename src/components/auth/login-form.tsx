"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { AuthError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { PasswordInput } from "@/components/ui/password-input";
import { PIconArrowRight, PIconLock, PIconMail } from "@/components/ui/precisia-icons";

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

// PRECISIA rebrand — presentation only. The sign-in flow below (Supabase
// signInWithPassword, "remember me" session persistence, `next` redirect,
// friendly error mapping) is unchanged.
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

  // Layout follows the owner's "New Login Page" reference card: fields
  // with placeholders (their labels stay in the DOM for assistive tech),
  // "Remember me" and "Forgot password?" on one row, the Sign In button,
  // a rule, then the help link. From 1024px each part sits at the
  // reference card's own coordinates (rem = reference px / 16, card
  // origin 831,141).
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 lg:static" noValidate>
      <div className="relative lg:absolute lg:top-[20rem] lg:left-[3.625rem] lg:h-[3.5625rem] lg:w-[27.1875rem]">
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <PIconMail className="pointer-events-none absolute top-1/2 left-[1rem] z-10 h-[1.5rem] w-[1.5rem] -translate-y-1/2 text-[#c9d0d8]" />
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-[3.5625rem] w-full rounded-[0.5rem] border border-[#34414f] bg-[#19212a] pr-4 pl-[3.25rem] text-[1.06rem] text-white outline-none placeholder:text-[#b9c0c8] focus:border-[#2f8cff]"
          placeholder="Email address"
        />
      </div>

      <div className="relative lg:absolute lg:top-[24.5625rem] lg:left-[3.625rem] lg:h-[3.5625rem] lg:w-[27.1875rem]">
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <PIconLock className="pointer-events-none absolute top-1/2 left-[1rem] z-10 h-[1.5rem] w-[1.5rem] -translate-y-1/2 text-[#c9d0d8]" />
        <PasswordInput
          id="password"
          name="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="h-[3.5625rem] w-full rounded-[0.5rem] border border-[#34414f] bg-[#19212a] pr-12 pl-[3.25rem] text-[1.06rem] text-white outline-none placeholder:text-[#b9c0c8] focus:border-[#2f8cff]"
        />
      </div>

      <div className="flex items-center justify-between lg:absolute lg:top-[29.5rem] lg:left-[3.625rem] lg:h-[1.4375rem] lg:w-[27.1875rem]">
        <label className="flex items-center gap-[0.6rem] text-[1.03rem] text-[#e6e9ee]">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-[1.4375rem] w-[1.4375rem] rounded accent-[#0f77fe]"
          />
          Remember me
        </label>
        <Link href="/forgot-password" className="text-[1rem] font-medium text-[#2d8cf0] hover:underline">
          Forgot password?
        </Link>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="flex h-[3.625rem] w-full items-center justify-center gap-[0.6rem] rounded-[0.5rem] bg-[#0f77fe] text-[1.06rem] font-semibold text-white transition-colors duration-150 ease-vf-out hover:bg-[#2a86ff] disabled:opacity-70 lg:absolute lg:top-[32.75rem] lg:left-[3.625rem] lg:w-[27.1875rem]"
      >
        {loading ? "Signing in…" : "Sign In"}
        {!loading && <PIconArrowRight className="h-[1.1rem] w-[1.1rem]" aria-hidden />}
      </button>

      {error && (
        <p role="alert" className="rounded-lg border border-[#f0474f]/40 bg-[#2a1216] px-3.5 py-2.5 text-sm text-[#ffb4b8] lg:absolute lg:top-[37rem] lg:left-[3.625rem] lg:z-20 lg:w-[27.1875rem]">
          {error}
        </p>
      )}

      <div aria-hidden className="h-px w-full bg-white/10 lg:absolute lg:top-[38rem] lg:left-[3.625rem] lg:w-[27.1875rem]" />

      <div className="flex items-center gap-[1.3rem] lg:absolute lg:top-[39.45rem] lg:left-[3.875rem]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-[2.2rem] w-[2.2rem] text-[#e6e9ee]" aria-hidden>
          <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
          <rect x="3" y="14" width="4" height="6" rx="1.5" />
          <rect x="17" y="14" width="4" height="6" rx="1.5" />
          <path d="M20 20a3 3 0 0 1-3 2h-3" />
        </svg>
        <p className="text-[1rem] leading-[1.5rem] text-[#dfe3e8]">
          Need help?
          <br />
          <Link href="/#contact" className="font-semibold text-[#2d8cf0] hover:underline">
            Contact Support
          </Link>
        </p>
      </div>
    </form>
  );
}
