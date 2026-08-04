import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createGoodsReceivedNote, listGoodsReceivedNotes, ValidationError } from "@/server/services/goods-received-note-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const grns = await listGoodsReceivedNotes(companyId);
  return NextResponse.json({ grns });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Purchasing:Create");
  if (!check.ok) return check.response;

  try {
    const grn = await createGoodsReceivedNote(companyId, body);
    return NextResponse.json({ grn }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
