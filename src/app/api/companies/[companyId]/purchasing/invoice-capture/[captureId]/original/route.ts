import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getCapture } from "@/server/services/supplier-invoice-capture-service";
import { getDocument } from "@/server/repositories/document-repository";
import { serveSupplierOriginal } from "@/server/documents/supplier-original-response";

/**
 * SD-2 — the ORIGINAL supplier document of a capture, served from this
 * origin so the review screen can show it inline (the generic download
 * route returns a signed-URL JSON body, which is not a document).
 *
 * - `Purchasing:View` is checked BEFORE anything is looked up, so a 403
 *   cannot be probed into a 404.
 * - The capture and its document are read under the caller's session, so
 *   tenant isolation is the database's, not this route's.
 * - SD-3B — served through `serveSupplierOriginal`: every view and every
 *   `?download=1` is recorded permanently BEFORE the file is returned, and
 *   nothing is returned if it cannot be recorded.
 *
 * The stored file itself is never modified; it is retained (0112).
 */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string; captureId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, captureId } = await params;
  const check = await requirePermission(companyId, "Purchasing:View");
  if (!check.ok) return check.response;

  const id = Number(captureId);
  if (!Number.isInteger(id)) return Response.json({ error: "Unknown invoice." }, { status: 400 });

  const capture = await getCapture(companyId, id);
  if (!capture) return Response.json({ error: "Unknown invoice." }, { status: 404 });
  const document = await getDocument(companyId, capture.document_id);
  if (!document) return Response.json({ error: "The original document could not be found." }, { status: 404 });

  return serveSupplierOriginal({
    request,
    companyId,
    document: { id: document.id, filename: document.filename, storagePath: document.storagePath },
    subject: { kind: "capture", captureId: capture.id },
  });
}
