import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createWarehouseLocation, listWarehouseLocations, ValidationError } from "@/server/services/warehouse-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; warehouseId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { warehouseId } = await params;
  const locations = await listWarehouseLocations(Number(warehouseId));
  return NextResponse.json({ locations });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; warehouseId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, warehouseId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Inventory:Create");
  if (!check.ok) return check.response;

  try {
    const location = await createWarehouseLocation(Number(warehouseId), body);
    return NextResponse.json({ location }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
