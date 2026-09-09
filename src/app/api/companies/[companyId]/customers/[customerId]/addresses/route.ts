import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createCustomerAddress, listCustomerAddresses, ValidationError, NotFoundError } from "@/server/services/customer-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; customerId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, customerId } = await params;
  try {
    const addresses = await listCustomerAddresses(companyId, Number(customerId));
    return NextResponse.json({ addresses });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; customerId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, customerId } = await params;

  const check = await requirePermission(companyId, "Sales:Create");
  if (!check.ok) return check.response;

  const body = await request.json();

  try {
    const address = await createCustomerAddress(companyId, Number(customerId), body);
    return NextResponse.json({ address }, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
