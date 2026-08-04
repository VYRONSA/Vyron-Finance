import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

/**
 * Session refresh + optimistic auth gate for the Platform Workspace and
 * Financial Workspace (Part 6 — "existing business logic must not
 * handle authentication"; this is the one place that does). Renamed
 * from `middleware.ts` per Next.js 16's own convention. Per Next's own
 * guidance, this is *optimistic only* — it redirects obviously
 * unauthenticated requests away, but the authoritative check still
 * happens server-side in each protected layout via `getClaims()`.
 *
 * Skipped entirely while no Supabase project is configured, matching
 * each protected layout's own Preview Mode branch — otherwise this runs
 * first and redirects to /login before the layout's branch is reached.
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims);

  const isProtected =
    request.nextUrl.pathname.startsWith("/platform") ||
    request.nextUrl.pathname.startsWith("/company");

  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Skip static assets and image optimization requests so the proxy
     * only runs where it can actually matter (page navigations, RSC
     * fetches) — matches Next.js's own recommended default matcher.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
