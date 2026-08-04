import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getDownloadUrl, NotFoundError } from "@/server/services/document-service";
import { getDocumentOr404 } from "@/server/services/document-lookup";
import { DOCUMENT_PERMISSION_MODULE } from "@/server/documents/types";

/** A short-lived (5 minute) signed Storage URL — never a public/guessable
 * one — generated only after the same `requirePermission()` check every
 * other document action uses. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; documentId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, documentId } = await params;
  const document = await getDocumentOr404(companyId, Number(documentId));
  if (document instanceof NextResponse) return document;

  const check = await requirePermission(companyId, `${DOCUMENT_PERMISSION_MODULE[document.entityType]}:View`);
  if (!check.ok) return check.response;

  try {
    const url = await getDownloadUrl(companyId, document.id);
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
