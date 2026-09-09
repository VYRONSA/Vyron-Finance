import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createSupplier, listSuppliers, ValidationError } from "@/server/services/supplier-management-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const suppliers = await listSuppliers(companyId);
  return NextResponse.json({ suppliers });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Purchasing:Create");
  if (!check.ok) return check.response;

  const body = await request.json();

  try {
    const supplier = await createSupplier(companyId, body);
    return NextResponse.json({ supplier }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
