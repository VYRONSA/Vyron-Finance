import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { cancelDelivery, getDelivery, ValidationError } from "@/server/services/delivery-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; deliveryId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, deliveryId } = await params;
  const delivery = await getDelivery(companyId, Number(deliveryId));
  if (!delivery) return NextResponse.json({ error: "Delivery not found." }, { status: 404 });
  return NextResponse.json({ delivery });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; deliveryId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, deliveryId } = await params;
  const id = Number(deliveryId);
  const body = await request.json();

  const check = await requirePermission(companyId, "Sales:Edit");
  if (!check.ok) return check.response;

  try {
    switch (body.action) {
      case "cancel": {
        const delivery = await cancelDelivery(companyId, id);
        return NextResponse.json({ delivery });
      }
      default:
        return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
