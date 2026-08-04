import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { ValidationError } from "@/server/services/permission-service";

export class AdminNotConfiguredError extends Error {}
export class AlreadyBootstrappedError extends Error {}

/**
 * First-run setup (RC1 Phase 7.5, Part 11 — "the application can be
 * accessed by a new installation without manual database
 * intervention"). Every table this needs is seeded by migration
 * `0025_rbac_platform.sql` (the 4 platform roles, `platform_super_administrator`
 * among them) the moment migrations run — there is no row left to
 * insert by hand except the one this creates: the actual person who
 * holds that role. Runs entirely on the service-role client (`@/lib/supabase/admin`)
 * because there is, by definition, no authenticated session yet — RLS's
 * own insert policy on `user_role_assignments` only allows
 * company-scoped rows from a normal session (`company_id is not null`),
 * so a platform-scope row can only ever be created this way, not
 * silently allowed through a gap.
 */
export async function hasPlatformSuperAdministrator(): Promise<boolean> {
  if (!isSupabaseAdminConfigured()) return false;
  const admin = createAdminClient();
  const { data: role } = await admin
    .from("permission_roles")
    .select("id")
    .eq("role_key", "platform_super_administrator")
    .is("company_id", null)
    .single<{ id: number }>();
  if (!role) return false;

  const { count } = await admin
    .from("user_role_assignments")
    .select("id", { count: "exact", head: true })
    .eq("role_id", role.id);
  return (count ?? 0) > 0;
}

export async function bootstrapPlatformSuperAdministrator(email: string, password: string): Promise<{ userId: string }> {
  if (!isSupabaseAdminConfigured()) {
    throw new AdminNotConfiguredError("First-run setup requires SUPABASE_SERVICE_ROLE_KEY to be set — see .env.local.example.");
  }
  if (await hasPlatformSuperAdministrator()) {
    throw new AlreadyBootstrappedError("A Platform Super Administrator already exists. Sign in instead.");
  }

  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !trimmedEmail.includes("@")) throw new ValidationError("A valid email address is required.");
  if (password.length < 8) throw new ValidationError("Password must be at least 8 characters.");

  const admin = createAdminClient();

  const { data: role, error: roleError } = await admin
    .from("permission_roles")
    .select("id")
    .eq("role_key", "platform_super_administrator")
    .is("company_id", null)
    .single<{ id: number }>();
  if (roleError || !role) throw new ValidationError("The platform_super_administrator role is not seeded — run migration 0025 first.");

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: trimmedEmail,
    password,
    email_confirm: true,
  });
  if (createError || !created?.user) throw new ValidationError(createError?.message ?? "Could not create this user.");

  const { error: assignError } = await admin
    .from("user_role_assignments")
    .insert({ user_id: created.user.id, company_id: null, role_id: role.id, assigned_by: "First-run setup" });
  if (assignError) throw new ValidationError(assignError.message);

  return { userId: created.user.id };
}
