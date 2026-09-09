/**
 * True once a real Supabase project's URL/anon key are set. Used to
 * distinguish "no session" (redirect to login — the real, permanent
 * behavior) from "no backend configured yet" (render protected routes
 * anyway with a Preview Mode banner, so the UI can be reviewed before a
 * Supabase project exists). This check disappears in effect the moment
 * real credentials are added — it is not an auth bypass, since there is
 * nothing to bypass until a backend exists to protect.
 */
export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
