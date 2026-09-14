import type { ReactElement } from "react";
import { PDF_FONT_FACES, PDF_STYLESHEET } from "./pdf-assets.generated";

/** Print rules layered over the app stylesheet. The app's `<body>` is the
 * dark workspace canvas — a document is white paper. The `--font-*`
 * variables normally come from next/font on `<html>`; here they name the
 * @font-face families embedded in `PDF_FONT_FACES`. */
const PRINT_BASE_CSS = `
:root { --font-inter: "Inter"; --font-plex-mono: "IBM Plex Mono"; --font-source-serif: "Source Serif 4"; }
html, body { background: #fff !important; margin: 0; }
body { font-family: var(--font-sans); color: var(--color-ink); -webkit-font-smoothing: antialiased; }
`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * A document as ONE self-contained HTML page: the markup rendered on the
 * server, the compiled stylesheet and fonts inline, images as data: URIs —
 * nothing for the PDF browser to fetch. `element` must be a hook-free,
 * non-"use client" document body (`components/documents/print/*`,
 * `ReportDocument`): route handlers run in the React Server Components
 * layer, where a client component cannot be rendered to HTML.
 */
export async function renderPrintHtml(element: ReactElement, title: string): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const markup = renderToStaticMarkup(element);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PDF_FONT_FACES}\n${PDF_STYLESHEET}\n${PRINT_BASE_CSS}</style></head><body>${markup}</body></html>`;
}
