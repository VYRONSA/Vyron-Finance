import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { setSupplierActive, updateSupplier, editRequiresElevatedPermission, ValidationError, NotFoundError } from "@/server/services/supplier-management-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; supplierId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, supplierId } = await params;

  const check = await requirePermission(companyId, "Purchasing:Edit");
  if (!check.ok) return check.response;

  const id = Number(supplierId);
  const body = await request.json();

  if (editRequiresElevatedPermission(body)) {
    const elevated = await requirePermission(companyId, "Purchasing:Approve");
    if (!elevated.ok) return elevated.response;
  }

  try {
    if (typeof body.isActive === "boolean") {
      const supplier = await setSupplierActive(companyId, id, body.isActive);
      return NextResponse.json({ supplier });
    }
    const performedBy = await getPerformedByLabel();
    const supplier = await updateSupplier(companyId, id, body, performedBy, body.reason);
    return NextResponse.json({ supplier });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
