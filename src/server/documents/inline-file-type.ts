/**
 * SD-2 — which stored files may be shown INLINE, decided from their bytes.
 *
 * A document's stored `mime_type` is whatever the uploading browser declared
 * (the generic upload route has no allowlist). Echoing it on an inline,
 * same-origin response would let an uploaded HTML or SVG file run as this
 * application. So the type is read from the file's own signature, and only
 * three kinds are ever served inline: PDF, JPEG and PNG — the formats
 * supplier invoices are captured in. Everything else is refused.
 */

export type InlineFileType = "application/pdf" | "image/jpeg" | "image/png";

export function detectInlineFileType(bytes: Uint8Array): InlineFileType | null {
  // "%PDF-" — allowed to follow a short preamble, as the PDF spec permits
  // (some generators emit a BOM or whitespace before the header).
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) {
      return "application/pdf";
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

/** A Content-Disposition value safe for any file name (RFC 6266 / 5987). */
export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "document";
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename || "document")}`;
}
