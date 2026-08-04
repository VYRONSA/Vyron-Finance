import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getStockItem, NotFoundError, setStockItemStatus, updateStockItem, ValidationError } from "@/server/services/stock-item-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; stockItemId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, stockItemId } = await params;
  const stockItem = await getStockItem(companyId, Number(stockItemId));
  if (!stockItem) return NextResponse.json({ error: "Stock item not found." }, { status: 404 });
  return NextResponse.json({ stockItem });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; stockItemId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, stockItemId } = await params;
  const id = Number(stockItemId);
  const body = await request.json();

  const check = await requirePermission(companyId, "Inventory:Edit");
  if (!check.ok) return check.response;

  try {
    switch (body.action) {
      case "set-status": {
        const stockItem = await setStockItemStatus(companyId, id, body.status);
        return NextResponse.json({ stockItem });
      }
      case "update": {
        const stockItem = await updateStockItem(companyId, id, body.fields ?? {});
        return NextResponse.json({ stockItem });
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
