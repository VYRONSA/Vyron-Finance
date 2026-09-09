import { NextResponse } from "next/server";
import { getPerformedByLabel, requireSession } from "@/server/auth/require-session";
import { finalizeStockTake, getStockTake, NotFoundError, ValidationError } from "@/server/services/stock-take-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; stockTakeId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, stockTakeId } = await params;
  const stockTake = await getStockTake(companyId, Number(stockTakeId));
  if (!stockTake) return NextResponse.json({ error: "Stock take not found." }, { status: 404 });
  return NextResponse.json({ stockTake });
}

/** `finalize` performs the real, automatic variance-posting chain — see
 * `stock-take-service.ts::finalizeStockTake`. */
export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; stockTakeId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, stockTakeId } = await params;
  const id = Number(stockTakeId);
  const body = await request.json();

  const check = await requirePermission(companyId, "Inventory:Edit");
  if (!check.ok) return check.response;

  try {
    switch (body.action) {
      case "finalize": {
        const performedBy = await getPerformedByLabel();
        const result = await finalizeStockTake(companyId, id, performedBy);
        return NextResponse.json(result);
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
