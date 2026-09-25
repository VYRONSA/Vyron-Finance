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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col" noValidate>
      <label htmlFor="email" className="mb-2.5 block text-[0.98rem] font-medium text-white">
        Email address
      </label>
      <div className="relative">
        <PIconMail className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-[#c9d4e3]" />
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="pc-input h-14 pr-4 pl-13 text-[0.95rem]"
          placeholder="name@yourcompany.co.za"
        />
      </div>

      <div className="mt-7 mb-2.5 flex items-center justify-between">
        <label htmlFor="password" className="block text-[0.98rem] font-medium text-white">
          Password
        </label>
        <Link href="/forgot-password" className="text-[0.82rem] font-medium text-[#1fb0f6] hover:underline">
          Forgot password?
        </Link>
      </div>
      <div className="relative">
        <PIconLock className="pointer-events-none absolute top-1/2 left-4 z-10 h-5 w-5 -translate-y-1/2 text-[#c9d4e3]" />
        <PasswordInput
          id="password"
          name="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="pc-input h-14 rounded-[10px] border-[rgba(120,146,170,0.55)] bg-[rgba(8,25,40,0.75)] pr-12 pl-13 text-[0.95rem] text-white focus:border-[#2f9bff]"
        />
      </div>

      <label className="mt-6 flex items-center gap-3 text-[0.95rem] text-[#dbe4f1]">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="h-5 w-5 rounded accent-[#0886fe]"
        />
        Remember me on this device
      </label>

      {error && (
        <p role="alert" className="mt-5 rounded-lg border border-[#f0474f]/40 bg-[#f0474f]/10 px-3.5 py-2.5 text-sm text-[#ffb4b8]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-8 flex h-16 w-full items-center justify-center gap-3 rounded-[16px] bg-gradient-to-r from-[#0096fa] via-[#1a8cff] to-[#0079fc] text-[1.05rem] font-semibold text-white shadow-[0_16px_40px_-12px_rgba(0,140,255,0.8),inset_0_1px_0_rgba(255,255,255,0.25)] transition-[transform,box-shadow] duration-150 ease-vf-out hover:-translate-y-px disabled:opacity-70"
      >
        {loading ? "Signing in…" : "Sign In"}
        {!loading && <PIconArrowRight className="h-5 w-5" aria-hidden />}
      </button>

      <p className="mt-10 text-center text-[0.98rem] text-[#dbe4f1]">
        Need help?{" "}
        <Link href="/#contact" className="font-medium text-[#1fb0f6] hover:underline">
          Contact support
        </Link>
      </p>
    </form>
  );
}
