import { NextResponse } from "next/server";
import { requireSession, getCurrentUserId } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { renamePreset, deletePreset, ValidationError } from "@/server/services/find-and-recode-preset-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; presetId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, presetId } = await params;
  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  const userId = await getCurrentUserId();
  const body = await request.json();

  try {
    const preset = await renamePreset(companyId, userId, Number(presetId), body.name);
    return NextResponse.json({ preset });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string; presetId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, presetId } = await params;
  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  const userId = await getCurrentUserId();
  await deletePreset(companyId, userId, Number(presetId));
  return NextResponse.json({ ok: true });
}
