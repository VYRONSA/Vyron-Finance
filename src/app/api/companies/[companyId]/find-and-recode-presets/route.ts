import { NextResponse } from "next/server";
import { requireSession, getCurrentUserId } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { listPresets, savePreset, ValidationError } from "@/server/services/find-and-recode-preset-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const userId = await getCurrentUserId();
  const presets = await listPresets(companyId, userId);
  return NextResponse.json({ presets });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  const userId = await getCurrentUserId();
  const body = await request.json();

  try {
    const preset = await savePreset(companyId, userId, body.name, body.filters);
    return NextResponse.json({ preset }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
