import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { resolveAssetFinding } from "@/server/services/asset-intelligence-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; findingId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, findingId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "Assets:Edit");
  if (!check.ok) return check.response;

  if (body.status !== "Resolved" && body.status !== "Dismissed") {
    return NextResponse.json({ error: "status must be 'Resolved' or 'Dismissed'." }, { status: 400 });
  }

  const finding = await resolveAssetFinding(companyId, Number(findingId), body.status, performedBy, body.note ?? "");
  return NextResponse.json({ finding });
}
