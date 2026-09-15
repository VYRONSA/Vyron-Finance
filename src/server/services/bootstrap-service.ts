import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { ValidationError } from "@/server/services/permission-service";

export class AdminNotConfiguredError extends Error {}
export class AlreadyBootstrappedError extends Error {}

/**
 * First-run invitation of the one Platform Super Administrator.
 *
 * P0 security remediation. The route in front of this is off by default,
 * secret-gated and restricted to the configured owner address
 * (`src/server/setup/bootstrap-guard.ts`). This service:
 *
 *  - INVITES the address through Supabase: Supabase emails the link and
 *    the invitee sets their own password from it. No request ever carries
 *    or chooses the administrator's password, and the account cannot sign
 *    in until the invitation is accepted, whatever the project's
 *    "Confirm email" setting (the previous version skipped verification
 *    entirely with `email_confirm: true`);
 *  - assigns the role ONLY through `complete_platform_bootstrap()`
 *    (migration 0097): one transaction, serialised by an advisory lock,
 *    which accepts only a fresh invitation (not verified, no password,
 *    never signed in) — never an account created any other way;
 *  - treats bootstrap as complete only once the invited administrator has
 *    verified. Until then the pending invitation can be re-sent, or moved
 *    to a corrected owner address; once complete, nothing changes it.
 */

export type BootstrapStatus = "not_started" | "pending_verification" | "completed";
export type BootstrapOutcome = "invited" | "reissued" | "rebound";

const ALREADY = "Platform bootstrap has already been completed.";

export async function platformBootstrapStatus(): Promise<BootstrapStatus> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("platform_bootstrap_status");
  if (error) throw error;
  if (data === "not_started" || data === "pending_verification" || data === "completed") return data;
  throw new Error("Unexpected platform bootstrap status.");
}

export async function bootstrapPlatformSuperAdministrator(input: { email: string; redirectTo: string }): Promise<{ outcome: BootstrapOutcome }> {
  if (!isSupabaseAdminConfigured()) {
    throw new AdminNotConfiguredError("Platform bootstrap needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new ValidationError("A valid email address is required.");

  if ((await platformBootstrapStatus()) === "completed") throw new AlreadyBootstrappedError(ALREADY);

  const admin = createAdminClient();
  // For an address with no account this creates one (no password) and
  // emails the invitation; for the still-pending invitee it re-sends it.
  // Supabase refuses an address whose account is already verified.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: input.redirectTo });
  if (error || !data?.user) {
    const code = (error as { code?: string; status?: number } | null)?.code;
    const status = (error as { status?: number } | null)?.status;
    if (code === "email_exists" || status === 422) {
      throw new ValidationError("This address already has an account. Use a dedicated address for the platform administrator.");
    }
    throw new Error("The invitation could not be sent.");
  }

  const { data: result, error: rpcError } = await admin.rpc("complete_platform_bootstrap", { target_user_id: data.user.id, target_email: email });
  if (rpcError) {
    if (rpcError.message?.startsWith("bootstrap_account_not_eligible")) {
      throw new ValidationError(
        "This address already has an account that was not created by setup (for example a self-registered, unverified sign-up). Remove that account in Supabase Auth, then run setup again.",
      );
    }
    throw new Error("Platform bootstrap could not be completed.");
  }

  const { outcome, previous_user_id: previousUserId } = (result ?? {}) as { outcome?: string; previous_user_id?: string };
  // Only reachable if the administrator verified between the status check
  // above and this call. The invited account is then deliberately left in
  // place (it holds no role): deleting by id here could never be proven not
  // to be the administrator's own account.
  if (outcome === "already_completed") throw new AlreadyBootstrappedError(ALREADY);
  if (outcome === "rebound" && previousUserId) {
    // The previous invitee never verified and no longer holds the role.
    await admin.auth.admin.deleteUser(previousUserId).catch(() => {});
  }
  if (outcome === "invited" || outcome === "reissued" || outcome === "rebound") return { outcome };
  throw new Error("Platform bootstrap could not be completed.");
}
