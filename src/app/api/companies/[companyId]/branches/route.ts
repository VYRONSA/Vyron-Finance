import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createBranch, listBranches, ValidationError } from "@/server/services/org-master-data-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const branches = await listBranches(companyId);
  return NextResponse.json({ branches });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Settings:Create");
  if (!check.ok) return check.response;

  try {
    const branch = await createBranch(companyId, body);
    return NextResponse.json({ branch }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
