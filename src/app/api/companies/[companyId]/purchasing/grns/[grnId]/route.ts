import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { cancelGoodsReceivedNote, getGoodsReceivedNote, ValidationError } from "@/server/services/goods-received-note-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; grnId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, grnId } = await params;
  const grn = await getGoodsReceivedNote(companyId, Number(grnId));
  if (!grn) return NextResponse.json({ error: "Goods received note not found." }, { status: 404 });
  return NextResponse.json({ grn });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; grnId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, grnId } = await params;
  const id = Number(grnId);
  const body = await request.json();

  const check = await requirePermission(companyId, "Purchasing:Edit");
  if (!check.ok) return check.response;

  try {
    switch (body.action) {
      case "cancel": {
        const grn = await cancelGoodsReceivedNote(companyId, id);
        return NextResponse.json({ grn });
      }
      default:
        return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
