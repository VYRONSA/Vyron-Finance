import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { setCostCentreActive } from "@/server/services/org-master-data-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; costCentreId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, costCentreId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Settings:Edit");
  if (!check.ok) return check.response;

  const costCentre = await setCostCentreActive(companyId, Number(costCentreId), body.isActive);
  return NextResponse.json({ costCentre });
}
