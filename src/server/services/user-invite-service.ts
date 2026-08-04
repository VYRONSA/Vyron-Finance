import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { assignUserRole, ValidationError } from "@/server/services/permission-service";
import type { UserRoleAssignment } from "@/server/permissions/types";

export class AdminNotConfiguredError extends Error {}

/**
 * The Invite User workflow the RC1 Phase 7.5 directive named as a real
 * gap: before this, granting a user access meant an admin already knew
 * their raw `auth.users.id` (roles-permissions-tab.tsx's "Assign Role"
 * panel) — there was no way to bring a genuinely NEW person onto a
 * company. This creates the Supabase auth user via the Admin API
 * (Supabase sends the actual invite email using the project's own
 * configured SMTP/template) and assigns the given role in the same
 * step, so the invited user lands with real access the moment they
 * accept — never a two-step "invited but unassigned" state.
 */
export async function inviteUserToCompany(
  companyId: string,
  email: string,
  roleId: number,
  performedBy: string,
  redirectTo: string,
): Promise<UserRoleAssignment> {
  if (!isSupabaseAdminConfigured()) {
    throw new AdminNotConfiguredError("Inviting users requires SUPABASE_SERVICE_ROLE_KEY to be set — see .env.local.example.");
  }
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    throw new ValidationError("A valid email address is required.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(trimmedEmail, { redirectTo });
  if (error || !data?.user) {
    throw new ValidationError(error?.message ?? "Could not invite this user.");
  }

  return assignUserRole(companyId, data.user.id, roleId, performedBy);
}
