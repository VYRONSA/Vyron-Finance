import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client — for use inside Client Components only
 * (login forms, session-aware UI). Requires NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY to be set (see `.env.local.example`);
 * until a real Supabase project exists, calls made with this client will
 * fail at the network layer — the UI still renders, but nothing
 * authenticates. See ARCHITECTURE.md's "Known Gap" note.
 *
 * `persistent = false` ("Remember me" left unchecked at login) makes the
 * session cookie a real browser session cookie (no `maxAge`, gone when
 * the browser closes) instead of the client's persistent default. This
 * has to happen via cookie options, not `localStorage` vs
 * `sessionStorage` — `@supabase/ssr` stores the session in cookies
 * specifically so `proxy.ts` and every server component/API route can
 * read it too; swapping storage would make the server stop seeing the
 * session entirely, not just the browser tab.
 */
export function createClient(persistent = true) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    persistent ? undefined : { cookieOptions: { maxAge: undefined } },
  );
}
