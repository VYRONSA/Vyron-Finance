import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { deleteDocument, NotFoundError } from "@/server/services/document-service";
import { getDocumentOr404 } from "@/server/services/document-lookup";
import { DOCUMENT_PERMISSION_MODULE } from "@/server/documents/types";

export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string; documentId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, documentId } = await params;
  const document = await getDocumentOr404(companyId, Number(documentId));
  if (document instanceof NextResponse) return document;

  const check = await requirePermission(companyId, `${DOCUMENT_PERMISSION_MODULE[document.entityType]}:Delete`);
  if (!check.ok) return check.response;

  try {
    await deleteDocument(companyId, document.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
