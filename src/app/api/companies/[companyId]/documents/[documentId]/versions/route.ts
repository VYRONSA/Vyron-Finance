import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { listVersionsForGroup } from "@/server/services/document-service";
import { getDocumentOr404 } from "@/server/services/document-lookup";
import { DOCUMENT_PERMISSION_MODULE } from "@/server/documents/types";

/** Every version of this one logical document, most recent first — "no
 * duplicate versioning logic," resolved by `document-engine.ts`'s own
 * group semantics rather than a second implementation. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; documentId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, documentId } = await params;
  const document = await getDocumentOr404(companyId, Number(documentId));
  if (document instanceof NextResponse) return document;

  const check = await requirePermission(companyId, `${DOCUMENT_PERMISSION_MODULE[document.entityType]}:View`);
  if (!check.ok) return check.response;

  const groupId = document.documentGroupId ?? document.id;
  const versions = await listVersionsForGroup(companyId, groupId);
  return NextResponse.json({ versions });
}
