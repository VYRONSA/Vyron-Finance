import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listGeneratedDocuments } from "@/server/services/recurring-template-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; templateId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, templateId } = await params;
  const documents = await listGeneratedDocuments(companyId, Number(templateId));
  return NextResponse.json({ documents });
}
