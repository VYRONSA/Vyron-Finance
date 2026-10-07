import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getCapture } from "@/server/services/supplier-invoice-capture-service";
import { downloadDocumentFile, getDocument } from "@/server/repositories/document-repository";
import { contentDisposition, detectInlineFileType } from "@/server/documents/inline-file-type";

/**
 * SD-2 — the ORIGINAL supplier document of a capture, served from this
 * origin so the review screen can show it inline (the generic download
 * route returns a signed-URL JSON body, which is not a document).
 *
 * - `Purchasing:View` is checked BEFORE anything is looked up, so a 403
 *   cannot be probed into a 404.
 * - The capture and its document are read under the caller's session, so
 *   tenant isolation is the database's, not this route's.
 * - The type is detected from the file's bytes (PDF, JPEG, PNG only) — never
 *   the stored, client-declared MIME type — and sent with `nosniff`.
 * - Nothing is cached, and the response may only be framed by this app.
 * - `?download=1` serves the same bytes as an attachment.
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

  const bytes = new Uint8Array(await downloadDocumentFile(document.storagePath));
  const download = new URL(request.url).searchParams.get("download") === "1";
  const type = detectInlineFileType(bytes);

  if (!type && !download) {
    return Response.json(
      { error: "This file cannot be shown here. Download it to open it." },
      { status: 415 },
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": type ?? "application/octet-stream",
    "Content-Disposition": contentDisposition(download ? "attachment" : "inline", document.filename),
    "Content-Length": String(bytes.byteLength),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    // Only this application may frame it. Images additionally get a
    // locked-down policy; a PDF is left to the browser's own viewer, which
    // a stricter document policy can stop from rendering.
    "Content-Security-Policy":
      type === "application/pdf"
        ? "frame-ancestors 'self'"
        : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
  };
  return new Response(bytes, { headers });
}
