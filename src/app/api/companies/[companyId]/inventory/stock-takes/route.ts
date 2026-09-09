import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createStockTake, listStockTakes, NotFoundError, ValidationError } from "@/server/services/stock-take-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const stockTakes = await listStockTakes(companyId);
  return NextResponse.json({ stockTakes });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Inventory:Create");
  if (!check.ok) return check.response;

  try {
    const stockTake = await createStockTake(companyId, body);
    return NextResponse.json({ stockTake }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
