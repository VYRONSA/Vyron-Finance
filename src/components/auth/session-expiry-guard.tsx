"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

/**
 * Master Implementation Tracker — Epic E11, Finding #210 (RC-9). There
 * is no shared client API wrapper in this codebase (every component
 * calls `fetch` directly against `/api/**`), so a 401 from an expired
 * session previously just rendered as a generic inline "Request failed
 * (401)" — the user was stuck on a dead form with no path back to
 * signing in. Patching `window.fetch` once here, rather than migrating
 * ~85 call sites, is the smallest change that gives real, app-wide
 * coverage. Scoped to same-origin `/api/**` requests only, so a
 * Supabase Auth 401 (e.g. a wrong password) is never mistaken for a
 * session expiry.
 */
export function SessionExpiryGuard() {
  const router = useRouter();

  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);
      if (response.status === 401) {
        const input = args[0];
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith("/api/")) {
          router.push(`/login?error=${encodeURIComponent(SESSION_EXPIRED_MESSAGE)}`);
        }
      }
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [router]);

  return null;
}
