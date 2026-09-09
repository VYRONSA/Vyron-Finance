import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getWarehouse, NotFoundError, setDefaultWarehouse, setWarehouseActive, updateWarehouse, ValidationError } from "@/server/services/warehouse-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; warehouseId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, warehouseId } = await params;
  const warehouse = await getWarehouse(companyId, Number(warehouseId));
  if (!warehouse) return NextResponse.json({ error: "Warehouse not found." }, { status: 404 });
  return NextResponse.json({ warehouse });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; warehouseId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, warehouseId } = await params;
  const id = Number(warehouseId);
  const body = await request.json();

  const check = await requirePermission(companyId, "Inventory:Edit");
  if (!check.ok) return check.response;

  try {
    switch (body.action) {
      case "set-default": {
        const warehouse = await setDefaultWarehouse(companyId, id);
        return NextResponse.json({ warehouse });
      }
      case "set-active": {
        const warehouse = await setWarehouseActive(companyId, id, Boolean(body.isActive));
        return NextResponse.json({ warehouse });
      }
      case "update": {
        const warehouse = await updateWarehouse(companyId, id, body.fields ?? {});
        return NextResponse.json({ warehouse });
      }
      default:
        return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
