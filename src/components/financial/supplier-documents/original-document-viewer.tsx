"use client";

/**
 * SD-2 — the ORIGINAL supplier document, shown inline beside the review.
 *
 * Served by `/api/.../invoice-capture/[captureId]/original`, a same-origin
 * route that checks Purchasing:View, reads the stored file under the
 * caller's session and serves it only as PDF, JPEG or PNG (detected from the
 * bytes). The stored original is never altered — it is retained as
 * accounting evidence (0112). This replaces the old "View original" link,
 * which opened a JSON body instead of the document.
 *
 * SD-3B — every view (the frame, the image, "Open in new tab") and every
 * download is recorded permanently by that route BEFORE the file is sent.
 * If it cannot be recorded the route sends no file, only a plain-text
 * explanation, which the PDF frame and a new tab show as is; an image
 * cannot render text, so it shows the message below instead.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconEye, IconEyeOff, IconFileText } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export type ViewerDocument = { id: number; filename: string; mimeType: string; sizeBytes: number } | null;

function kindOf(document: NonNullable<ViewerDocument>): "pdf" | "image" | "other" {
  const type = document.mimeType.toLowerCase();
  const name = document.filename.toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type === "image/jpeg" || type === "image/jpg" || type === "image/png" || /\.(jpe?g|png)$/.test(name)) return "image";
  return "other";
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function OriginalDocumentViewer({ companyId, captureId, document }: { companyId: string; captureId: number; document: ViewerDocument }) {
  const [shown, setShown] = useState(true);
  const [failed, setFailed] = useState(false);
  const src = `/api/companies/${companyId}/purchasing/invoice-capture/${captureId}/original`;

  if (!document) {
    return (
      <section aria-label="Original document" className="rounded-vf-lg border border-vf-paper-border bg-vf-paper p-5 shadow-vf-paper-sm">
        <p className="text-sm text-vf-ink-soft">The original document could not be found.</p>
      </section>
    );
  }

  const kind = kindOf(document);

  return (
    <section
      aria-label="Original document"
      className="flex min-w-0 flex-col overflow-hidden rounded-vf-lg border border-vf-paper-border bg-vf-paper shadow-vf-paper-sm xl:sticky xl:top-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-vf-paper-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <IconFileText className="h-4 w-4 shrink-0 text-vf-ink-faint" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-vf-ink" title={document.filename}>
              {document.filename}
            </p>
            <p className="text-xs text-vf-ink-faint">
              Original as received · {sizeLabel(document.sizeBytes)} · kept unchanged · views and downloads are recorded
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="subtle" size="sm" className="xl:hidden" onClick={() => setShown((s) => !s)} aria-expanded={shown}>
            {shown ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
            {shown ? "Hide document" : "Show document"}
          </Button>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-vf-red-600 underline-offset-2 hover:underline"
          >
            Open in new tab
          </a>
          <a href={`${src}?download=1`} className="text-sm font-medium text-vf-red-600 underline-offset-2 hover:underline">
            Download original
          </a>
        </div>
      </header>

      <div className={cn("bg-vf-paper-alt", !shown && "hidden xl:block")}>
        {kind === "pdf" && (
          <iframe
            src={src}
            title={`Original document: ${document.filename}`}
            className="block h-[70vh] min-h-[420px] w-full border-0 xl:h-[calc(100vh-9rem)]"
          />
        )}
        {kind === "image" &&
          (failed ? (
            <p role="alert" className="p-5 text-sm text-vf-danger">
              The image could not be shown. Every view of a supplier original is recorded, and the original is not
              shown when that is not possible. Try again, or use “Download original”.
            </p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a private, same-origin, permission-checked file; not an optimisable public asset
            <img
              src={src}
              alt={`Original document: ${document.filename}`}
              onError={() => setFailed(true)}
              className="mx-auto block max-h-[70vh] w-auto max-w-full object-contain xl:max-h-[calc(100vh-9rem)]"
            />
          ))}
        {kind === "other" && (
          <p className="p-5 text-sm text-vf-ink-soft">
            This file type cannot be shown here. Use “Download original” to open it.
          </p>
        )}
      </div>
    </section>
  );
}
