import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { listAssignmentsForCompany, assignUserRole, ValidationError, NotFoundError } from "@/server/services/permission-service";
import { findUserByEmail } from "@/server/services/user-invite-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  // Finding #124 (RC-16) — who has which role is org access-control
  // structure, gated the same as granting a role below it.
  const check = await requirePermission(companyId, "ManageUsers");
  if (!check.ok) return check.response;

  const assignments = await listAssignmentsForCompany(companyId);
  return NextResponse.json({ assignments });
}

/** Real user -> role assignment — the ONE place a user's access in this
 * company is granted. Gated by ManageUsers so only someone already
 * entitled to manage users can grant a role to another. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "ManageUsers");
  if (!check.ok) return check.response;

  const body = await request.json();
  const performedBy = await getPerformedByLabel();
  try {
    // Finding #121 (RC-16/E13) — the client sends an email now, not a
    // raw auth.users.id; `userId` stays accepted for backward
    // compatibility with any existing direct API caller.
    let userId: string | undefined = body.userId;
    if (!userId && body.email) {
      const member = await findUserByEmail(body.email);
      if (!member) return NextResponse.json({ error: `No user found with email ${body.email}.` }, { status: 404 });
      userId = member.userId;
    }
    if (!userId) return NextResponse.json({ error: "userId or email is required." }, { status: 400 });

    const assignment = await assignUserRole(companyId, userId, Number(body.roleId), performedBy);
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
