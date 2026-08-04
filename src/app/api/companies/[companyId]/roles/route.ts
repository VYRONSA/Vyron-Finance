import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getRolesWithGrants, createCustomRole, ValidationError } from "@/server/services/permission-service";

/** Every role visible to this company (its own system + custom roles,
 * plus platform-scope roles), each with its resolved permission grants
 * and approval limits — the ONE Permission Engine's own data, not a
 * per-page recomputation. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const roles = await getRolesWithGrants(companyId);
  return NextResponse.json({ roles });
}

/** "Support Custom Roles" — a company with ManageUsers can create its
 * own role, starting with zero permissions (assigned via PATCH). */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "ManageUsers");
  if (!check.ok) return check.response;

  const body = await request.json();
  const performedBy = await getPerformedByLabel();
  try {
    const role = await createCustomRole(companyId, body.name, body.description ?? "", performedBy);
    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
