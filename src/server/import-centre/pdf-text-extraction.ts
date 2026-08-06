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

/**
 * PDF Bank Statement Import — Product Review Board's Final Outstanding
 * Requirement, "Unsupported PDFs" section: a rejected upload must say
 * *why*, not a bare "Unsupported file type." `reason` is the taxonomy
 * `import-service.ts` maps onto the Board's own listed explanations.
 */
export class PdfExtractionError extends Error {
  constructor(
    public reason: "encrypted" | "corrupted" | "scanned-image",
    message: string,
  ) {
    super(message);
  }
}

const MIN_EXTRACTABLE_TEXT_LENGTH = 20;

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const parser = new PDFParse({ data: Buffer.from(buffer) });
  let result: { text: string };
  try {
    result = await parser.getText();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password|encrypt/i.test(message)) {
      throw new PdfExtractionError("encrypted", "This PDF is password protected and can't be read. Remove the password and upload it again.");
    }
    throw new PdfExtractionError("corrupted", "This PDF could not be read — the file may be corrupted or isn't a valid PDF.");
  } finally {
    try {
      await parser.destroy();
    } catch {
      // Destroying an already-failed parser is best-effort — never let
      // cleanup mask the real extraction error above.
    }
  }

  // A text-based statement always has far more than 20 characters of
  // real text; a scanned/image-only PDF has none at all (pdf-parse only
  // ever reads an embedded text layer — it doesn't OCR).
  if (!result.text || result.text.trim().length < MIN_EXTRACTABLE_TEXT_LENGTH) {
    throw new PdfExtractionError(
      "scanned-image",
      "No extractable text was found in this PDF — it appears to be a scanned image rather than a text-based statement, which this importer can't read yet.",
    );
  }

  return result.text;
}
