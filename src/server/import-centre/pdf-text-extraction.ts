/**
 * Pilot Review Round 1, Phase 9 — real PDF text extraction (`pdf-parse`,
 * a genuine dependency added for this, not a placeholder). This is the
 * one piece of the PDF pipeline that doesn't depend on knowing any
 * individual bank's layout: extracting a PDF's raw text works the same
 * way regardless of which bank produced it, which is what makes bank
 * *detection* buildable today even though bank-specific *parsing* isn't
 * yet (see `bank-statement-adapter-registry.ts`'s module docstring).
 *
 * `pdf-parse` wraps `pdfjs-dist`, which in Node.js always runs its
 * worker logic on the main thread via a "fake worker" — by design, not
 * a bug in this codebase — that dynamically `import()`s the worker
 * module's `WorkerMessageHandler` at runtime with a webpack/vite-ignore
 * comment. Next.js's server bundler doesn't honour that comment, so the
 * dynamic import resolves to a chunk path that doesn't exist at
 * runtime, and every extraction failed with "Setting up fake worker
 * failed" — found live while verifying this feature. pdfjs-dist's own
 * fake-worker loader checks `globalThis.pdfjsWorker.WorkerMessageHandler`
 * FIRST and skips the dynamic import entirely when it's already set —
 * this is pdfjs-dist's own documented escape hatch for exactly this
 * bundler problem. Importing the worker module normally (a static
 * import, which Next bundles like any other dependency) and assigning
 * it here fixes this without any Next.js config changes.
 */
import { PDFParse } from "pdf-parse";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";

declare global {
  var pdfjsWorker: { WorkerMessageHandler: typeof WorkerMessageHandler } | undefined;
}

globalThis.pdfjsWorker = { WorkerMessageHandler };

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const parser = new PDFParse({ data: Buffer.from(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}
