import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createCustomerAddress, listCustomerAddresses, ValidationError } from "@/server/services/customer-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; customerId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { customerId } = await params;
  const addresses = await listCustomerAddresses(Number(customerId));
  return NextResponse.json({ addresses });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; customerId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, customerId } = await params;

  const check = await requirePermission(companyId, "Sales:Create");
  if (!check.ok) return check.response;

  const body = await request.json();

  try {
    const address = await createCustomerAddress(Number(customerId), body);
    return NextResponse.json({ address }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
