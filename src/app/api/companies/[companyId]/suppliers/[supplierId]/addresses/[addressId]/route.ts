import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { deleteSupplierAddress } from "@/server/services/supplier-management-service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string; supplierId: string; addressId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, addressId } = await params;

  const check = await requirePermission(companyId, "Purchasing:Edit");
  if (!check.ok) return check.response;

  await deleteSupplierAddress(Number(addressId));
  return NextResponse.json({ ok: true });
}
