import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { setSupplierActive, updateSupplier, ValidationError } from "@/server/services/supplier-management-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; supplierId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, supplierId } = await params;

  const check = await requirePermission(companyId, "Purchasing:Edit");
  if (!check.ok) return check.response;

  const id = Number(supplierId);
  const body = await request.json();

  try {
    if (typeof body.isActive === "boolean") {
      const supplier = await setSupplierActive(companyId, id, body.isActive);
      return NextResponse.json({ supplier });
    }
    const supplier = await updateSupplier(companyId, id, body);
    return NextResponse.json({ supplier });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
