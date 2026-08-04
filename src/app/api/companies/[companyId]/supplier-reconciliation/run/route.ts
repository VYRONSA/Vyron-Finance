import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { generateSupplierAllocationReports } from "@/server/services/supplier-reconciliation-service";

export async function POST(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Purchasing:Edit");
  if (!check.ok) return check.response;

  const result = await generateSupplierAllocationReports(companyId);
  return NextResponse.json(result, { status: result.failedStage ? 500 : 200 });
}
