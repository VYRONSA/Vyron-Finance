import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getServerExecutionContextClient } from "./execution-context";

/**
 * Server-side Supabase client — for Server Components, Server Actions,
 * and Route Handlers. A new client must be created per request (never
 * shared/cached across requests — see `@supabase/ssr`'s own warning).
 *
 * `cookies()` is async in this Next.js version, so this helper is async
 * too. `setAll` can throw when called from a Server Component that
 * can't itself write cookies (only Server Actions/Route Handlers can);
 * `proxy.ts` is what actually keeps the session refreshed in that case.
 *
 * Phase 21D — checks `getServerExecutionContextClient()` first. For
 * every normal request this is `undefined` and behavior is completely
 * unchanged from before; it is only ever non-`undefined` inside the one
 * explicit `runWithServerExecutionContext()` call the inbound webhook
 * pipeline makes (see `@/lib/supabase/execution-context.ts`'s own
 * docstring for the full reasoning).
 */
export async function createClient() {
  const contextClient = getServerExecutionContextClient();
  if (contextClient) return contextClient;

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — proxy.ts refreshes the
            // session instead; safe to ignore here.
          }
        },
      },
    },
  );
}
