import { NextResponse } from "next/server";
import { requireSession, getCurrentUserId } from "@/server/auth/require-session";
import { getEffectiveRole } from "@/server/services/permission-service";
import { resolveEffectivePermissions } from "@/server/permissions/permission-engine";

/** The signed-in user's own role + effective (inherited) permission set
 * in this company — the ONE source client UI reads from to show/hide
 * actions. Client-side use of this is display-only convenience; the
 * real enforcement happens server-side via `requirePermission()` on
 * every mutating route regardless of what this endpoint returns. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const userId = await getCurrentUserId();
  const resolved = await getEffectiveRole(userId, companyId);
  if (!resolved) return NextResponse.json({ role: null, permissions: [] });

  const permissions = [...resolveEffectivePermissions(resolved.role, resolved.allRoles)];
  return NextResponse.json({ role: resolved.role, permissions });
}
