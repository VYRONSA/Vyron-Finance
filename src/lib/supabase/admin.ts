import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — server-only, NEVER imported from a
 * Client Component or anything bundled to the browser. This is the one
 * client in the codebase allowed to bypass RLS and call the Auth Admin
 * API (`auth.admin.*` — inviteUserByEmail, createUser, listUsers), used
 * exclusively for the RC1 Phase 7.5 Invite User and first-administrator
 * bootstrap flows. Everything else in this app uses the anon-key client
 * (`@/lib/supabase/server`, `@/lib/supabase/client`) so RLS stays the
 * real authorization boundary — this client exists only where Supabase
 * itself requires elevated privilege (creating an auth user), never as
 * a shortcut around a permission check the app should be doing itself.
 */
export function isSupabaseAdminConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
