import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createSupplierContact, listSupplierContacts, ValidationError, NotFoundError } from "@/server/services/supplier-management-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; supplierId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, supplierId } = await params;
  try {
    const contacts = await listSupplierContacts(companyId, Number(supplierId));
    return NextResponse.json({ contacts });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; supplierId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, supplierId } = await params;

  const check = await requirePermission(companyId, "Purchasing:Create");
  if (!check.ok) return check.response;

  const body = await request.json();

  try {
    const contact = await createSupplierContact(companyId, Number(supplierId), body);
    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
