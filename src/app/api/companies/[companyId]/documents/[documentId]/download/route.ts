import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getDownloadUrl, NotFoundError } from "@/server/services/document-service";
import { getDocumentOr404 } from "@/server/services/document-lookup";
import { DOCUMENT_PERMISSION_MODULE } from "@/server/documents/types";
import { isAuditedSupplierOriginal } from "@/server/repositories/supplier-document-access-repository";

/** A short-lived (5 minute) signed Storage URL — never a public/guessable
 * one — generated only after the same `requirePermission()` check every
 * other document action uses.
 *
 * SD-3B — not for a supplier original (the document behind an invoice
 * capture or, from SD-3C, a supplier statement). Every view and download of
 * those is recorded permanently, which a signed URL handed to the browser
 * cannot do, so they are opened from Supplier Documents instead. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; documentId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, documentId } = await params;
  const document = await getDocumentOr404(companyId, Number(documentId));
  if (document instanceof NextResponse) return document;

  const check = await requirePermission(companyId, `${DOCUMENT_PERMISSION_MODULE[document.entityType]}:View`);
  if (!check.ok) return check.response;

  if (await isAuditedSupplierOriginal(document.id)) {
    return NextResponse.json(
      { error: "This is the original of a supplier document. Open it from Supplier Documents, where every view and download is recorded." },
      { status: 409 },
    );
  }

  try {
    const url = await getDownloadUrl(companyId, document.id);
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
