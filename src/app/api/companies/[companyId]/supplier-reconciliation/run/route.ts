import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { generateSupplierAllocationReports } from "@/server/services/supplier-reconciliation-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Purchasing:Edit");
  if (!check.ok) return check.response;

  // Finding #155 — optional scope; an empty/absent body runs unscoped
  // (every open bill/transaction), exactly as before.
  const body = await request.json().catch(() => ({}));
  const scope = {
    dateFrom: typeof body.dateFrom === "string" && body.dateFrom ? body.dateFrom : undefined,
    dateTo: typeof body.dateTo === "string" && body.dateTo ? body.dateTo : undefined,
    supplierId: typeof body.supplierId === "number" ? body.supplierId : undefined,
  };

  const result = await generateSupplierAllocationReports(companyId, scope);
  return NextResponse.json(result, { status: result.failedStage ? 500 : 200 });
}
