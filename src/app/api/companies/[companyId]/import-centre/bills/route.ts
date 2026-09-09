import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { importBillsCsv, ValidationError } from "@/server/services/import-service";
import { requirePermission } from "@/server/services/permission-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  const check = await requirePermission(companyId, "Purchasing:Create");
  if (!check.ok) return check.response;

  try {
    const { batch, exceptions } = await importBillsCsv(companyId, file);
    return NextResponse.json({ batch, exceptions }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
