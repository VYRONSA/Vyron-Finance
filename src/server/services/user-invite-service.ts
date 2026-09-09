import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { assignUserRole, ValidationError } from "@/server/services/permission-service";
import { listAssignmentsForCompany } from "@/server/repositories/permission-repository";
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

export type CompanyMember = { userId: string; email: string };

/** Finding #121 (RC-16/E13) — "Assign an existing user by ID" used to
 * require an admin to already know the target's raw `auth.users.id`, a
 * value genuinely nobody can know without querying the database
 * directly. This resolves the one thing an admin actually does know —
 * the person's email — via the same Admin API the rest of this file
 * already uses. `listUsers` has no email-filter parameter (Supabase
 * Admin API limitation), so this scans one bounded page — the same
 * documented-limit convention as this codebase's `LIST_CAP` pattern,
 * not a claim of searching every user on the platform. Returns `null`
 * (not an error) for "not found," matching this file's own established
 * no-throw-for-absence convention. */
const USER_LOOKUP_PAGE_SIZE = 1000;

export async function findUserByEmail(email: string): Promise<CompanyMember | null> {
  if (!isSupabaseAdminConfigured()) return null;
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) return null;

  const admin = createAdminClient();
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: USER_LOOKUP_PAGE_SIZE });
  const match = data?.users.find((u) => u.email?.toLowerCase() === trimmedEmail);
  return match?.email ? { userId: match.id, email: match.email } : null;
}

/** Finding #158 — Send Query's recipient was always a free-text email,
 * even though `CommunicationRecipient.type` already has a first-class
 * `"User"` variant. This platform's real users are Supabase Auth users
 * (`auth.users`, UUID ids) with no second, numeric-id "users" table —
 * this is the one place their email is resolved for a real company
 * member, via the same Admin API `inviteUserToCompany` above already
 * uses. Returns `[]` (not an error) when the Admin API isn't configured
 * — same non-fatal shape as everywhere else in this platform a real
 * capability degrades gracefully in a preview/no-service-role
 * environment, so callers can safely fall back to a manual email field. */
export async function listCompanyMembersWithEmail(companyId: string): Promise<CompanyMember[]> {
  if (!isSupabaseAdminConfigured()) return [];

  const assignments = await listAssignmentsForCompany(companyId);
  const userIds = [...new Set(assignments.map((a) => a.userId))];
  const admin = createAdminClient();

  const members = await Promise.all(
    userIds.map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      return data?.user?.email ? { userId, email: data.user.email } : null;
    }),
  );
  return members.filter((m): m is CompanyMember => m !== null);
}
