import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { setCustomerActive, updateCustomer, editRequiresElevatedPermission, ValidationError, NotFoundError } from "@/server/services/customer-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; customerId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, customerId } = await params;

  const check = await requirePermission(companyId, "Sales:Edit");
  if (!check.ok) return check.response;

  const id = Number(customerId);
  const body = await request.json();

  if (editRequiresElevatedPermission(body)) {
    const elevated = await requirePermission(companyId, "Sales:Approve");
    if (!elevated.ok) return elevated.response;
  }

  try {
    if (typeof body.isActive === "boolean") {
      const customer = await setCustomerActive(companyId, id, body.isActive);
      return NextResponse.json({ customer });
    }
    const performedBy = await getPerformedByLabel();
    const customer = await updateCustomer(companyId, id, body, performedBy, body.reason);
    return NextResponse.json({ customer });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
