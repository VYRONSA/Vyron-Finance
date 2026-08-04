import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createSupplierContact, listSupplierContacts, ValidationError } from "@/server/services/supplier-management-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; supplierId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { supplierId } = await params;
  const contacts = await listSupplierContacts(Number(supplierId));
  return NextResponse.json({ contacts });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; supplierId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, supplierId } = await params;

  const check = await requirePermission(companyId, "Purchasing:Create");
  if (!check.ok) return check.response;

  const body = await request.json();

  try {
    const contact = await createSupplierContact(Number(supplierId), body);
    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
