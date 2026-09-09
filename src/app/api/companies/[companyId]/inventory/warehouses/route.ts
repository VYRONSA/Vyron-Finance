import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createWarehouse, listWarehouses, ValidationError } from "@/server/services/warehouse-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const warehouses = await listWarehouses(companyId);
  return NextResponse.json({ warehouses });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Inventory:Create");
  if (!check.ok) return check.response;

  try {
    const warehouse = await createWarehouse(companyId, body);
    return NextResponse.json({ warehouse }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
