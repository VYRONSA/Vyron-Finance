import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { ValidationError } from "@/server/services/permission-service";
import { inviteUserToCompany, AdminNotConfiguredError } from "@/server/services/user-invite-service";
import { checkUsageLimit } from "@/server/billing-platform/engine/licensing-engine";
import { publishBillingEvent } from "@/server/billing-platform/events/billing-event-bus";

/** Invite a genuinely new person onto this company by email — creates
 * their Supabase auth user (Supabase sends the real invite email) and
 * assigns the given role in one step. Gated the same as direct role
 * assignment (roles/assignments/route.ts): only someone who can already
 * manage users can bring another one in. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "ManageUsers");
  if (!check.ok) return check.response;

  const limitCheck = await checkUsageLimit(companyId, "max_users");
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.reason ?? "Your plan's user limit has been reached." }, { status: 403 });
  }

  const body = await request.json();
  const performedBy = await getPerformedByLabel();
  const origin = new URL(request.url).origin;

  try {
    const assignment = await inviteUserToCompany(
      companyId,
      String(body.email ?? ""),
      Number(body.roleId),
      performedBy,
      `${origin}/auth/confirm?type=invite&next=/reset-password`,
    );
    await publishBillingEvent(companyId, "SeatIncreased", { invitedEmail: String(body.email ?? ""), roleId: Number(body.roleId) });
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof AdminNotConfiguredError) return NextResponse.json({ error: error.message }, { status: 501 });
    throw error;
  }
}
