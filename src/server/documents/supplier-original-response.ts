/**
 * SD-3B — the ONE way a person is served a supplier document's original:
 * the invoice-capture viewer today, the supplier-statement viewer from
 * SD-3C. Extracted from the SD-2 capture route so both share the same
 * checks, headers and audit — there is no second download mechanism.
 *
 * The caller (a route) must already have:
 *   - checked `Purchasing:View` for the company in the path, BEFORE any
 *     lookup;
 *   - found the capture/statement and its document under the caller's own
 *     session, so tenant isolation is the database's.
 *
 * This then, in order:
 *   1. reads the file server-side (0113 stops clients reading it from
 *      Storage directly) — nothing has been sent yet;
 *   2. decides what would be served: inline only as PDF, JPEG or PNG,
 *      detected from the bytes, never the stored client-declared type;
 *      `?download=1` as an attachment of any type;
 *   3. writes the permanent audit row (view or download). If that write
 *      fails or is refused, NOTHING is served — fail closed — and the user
 *      is told why in plain text;
 *   4. returns the file with `nosniff`, `no-store` and a frame policy that
 *      lets only this application frame it.
 *
 * A file that cannot be shown inline is refused (415) before anything is
 * recorded, because nothing was shown.
 */
import { contentDisposition, detectInlineFileType } from "@/server/documents/inline-file-type";
import {
  readSupplierOriginalBytes,
  recordSupplierDocumentAccess,
  type SupplierOriginalSubject,
} from "@/server/repositories/supplier-document-access-repository";

export type ServableOriginal = { id: number; filename: string; storagePath: string };

/** Shown in the viewer frame, a new tab or instead of a download. */
export const AUDIT_UNAVAILABLE_MESSAGE =
  "The original document was not shown because this access could not be recorded. " +
  "Every view and download of a supplier original is recorded. Please try again; if it keeps happening, contact your administrator.";

function plainText(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function serveSupplierOriginal(input: {
  request: Request;
  companyId: string;
  document: ServableOriginal;
  subject: SupplierOriginalSubject;
}): Promise<Response> {
  const { request, companyId, document, subject } = input;
  const download = new URL(request.url).searchParams.get("download") === "1";

  const bytes = await readSupplierOriginalBytes(document.storagePath);
  const type = detectInlineFileType(bytes);

  if (!type && !download) {
    return Response.json({ error: "This file cannot be shown here. Download it to open it." }, { status: 415 });
  }

  try {
    await recordSupplierDocumentAccess({ companyId, documentId: document.id, subject, action: download ? "download" : "view" });
  } catch (error) {
    // Never the file, and never the database's message (it can name ids).
    console.error("Supplier original refused: the access could not be recorded.", {
      companyId,
      documentId: document.id,
      subject,
      code: (error as { code?: unknown } | null)?.code ?? null,
    });
    return plainText(AUDIT_UNAVAILABLE_MESSAGE, 503);
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
