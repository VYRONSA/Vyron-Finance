import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { duplicateJournal, NotFoundError } from "@/server/services/journal-crud-service";
import { requirePermission } from "@/server/services/permission-service";

export async function POST(_request: Request, { params }: { params: Promise<{ companyId: string; journalId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, journalId } = await params;

  const check = await requirePermission(companyId, "GeneralLedger:Create");
  if (!check.ok) return check.response;

  try {
    const journal = await duplicateJournal(companyId, Number(journalId));
    return NextResponse.json({ journal }, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
