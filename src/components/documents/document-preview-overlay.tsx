"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/hooks/use-focus-trap";

/** Phase 20C — the ONE print-ready overlay shared by every customer-
 * facing document (Invoice, Customer Statement, and any future document
 * type). Reuses the exact `@media print` visibility-hack already
 * established in `trial-balance-tab.tsx` (the only prior print
 * implementation in this codebase), generalized into one component so
 * no future document reinvents it. Overlay chrome (backdrop, focus
 * trap, Escape-to-close) mirrors `transaction-detail-panel.tsx`'s own
 * `role="dialog"` pattern — the only existing full-screen overlay
 * precedent in this app.
 *
 * When printed, only the element with id `document-preview-printable`
 * (this component's own content wrapper) is visible — the application
 * shell, sidebar, and this overlay's own header bar (`no-print`) are
 * hidden, so the printed page shows only the document itself. */
export function DocumentPreviewOverlay({
  title,
  onClose,
  children,
  downloadHref,
  headerExtra,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Phase 24A — when supplied, renders a "Download PDF" action next to
   * Print/Close. A plain `<a download>` to the server PDF route, not a
   * client-side fetch — the browser's own native download handling
   * (works for any file size, survives a slow Chromium cold start
   * without any client-side loading-state plumbing needed here). Omitted
   * entirely (no button) when the caller has no PDF route to offer —
   * same "never show a capability that doesn't exist" convention this
   * component's sibling documents already follow for their own fields. */
  downloadHref?: string;
  /** Phase 24B — a slot for a self-contained action (here: "Send Email"
   * and its own confirm panel) that needs more room than a single button
   * — rendered as its own row below the title bar, still inside the
   * `no-print` header area so it never appears on a printed/PDF page.
   * Omitted entirely when not supplied. */
  headerExtra?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, panelRef);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/50 p-4 sm:p-8 print:relative print:inset-auto print:z-auto print:overflow-visible print:bg-transparent print:p-0">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #document-preview-printable, #document-preview-printable * { visibility: visible; }
          #document-preview-printable { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>

      <button
        type="button"
        aria-label={`Close ${title}`}
        className="fixed inset-0 z-0 print:hidden"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative z-10 flex h-fit w-full max-w-[860px] flex-col gap-0 self-start rounded-vf-md bg-vf-paper shadow-2xl print:max-w-none print:rounded-none print:shadow-none"
      >
        <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-vf-md border-b border-vf-paper-border bg-vf-paper px-5 py-3 print:hidden">
          <p className="text-sm font-medium text-vf-ink">{title}</p>
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => window.print()}>
              Print
            </Button>
            {downloadHref && (
              // A plain anchor, deliberately NOT `next/link` — this is a
              // real file download (`Content-Disposition: attachment`
              // from the server), and Next's client-side router would
              // otherwise try to soft-navigate this same-origin URL as a
              // page transition rather than letting the browser handle it
              // natively.
              <a
                href={downloadHref}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-vf-paper-border px-5 py-2 text-[0.88rem] font-semibold tracking-[0.01em] text-vf-ink-soft shadow-vf-paper-sm transition-[transform,box-shadow,background-color,border-color,color] duration-150 ease-vf-out hover:-translate-y-px hover:border-vf-red-500 hover:text-vf-red-600 hover:shadow-vf-paper-md active:translate-y-0 active:scale-[0.985] active:shadow-vf-paper-sm"
              >
                Download PDF
              </a>
            )}
            <Button variant="subtle" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        {headerExtra && (
          <div className="no-print border-b border-vf-paper-border bg-vf-paper px-5 py-3 print:hidden">{headerExtra}</div>
        )}

        <div id="document-preview-printable">{children}</div>
      </div>
    </div>
  );
}
