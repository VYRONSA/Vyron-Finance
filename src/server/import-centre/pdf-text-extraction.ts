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
 * bundler problem. Importing the worker module and assigning it here
 * fixes this.
 *
 * Both `pdf-parse` and `pdfjs-dist` are loaded lazily, inside
 * `ensurePdfjsWorker`/`extractPdfText` themselves, never at this
 * module's own top level — found live (production build only; local
 * `next dev` never reproduced it) that a static top-level import here
 * pulled `pdf-parse`'s **browser** build (14 unguarded top-level
 * `DOMMatrix` references — confirmed by inspecting the built output;
 * its Node "import"/"require" conditions have none) into the module
 * graph of any page that merely imports this file transitively, e.g.
 * the Company Dashboard via `import-service.ts`'s `listRecentImports` —
 * crashing SSR with "DOMMatrix is not defined" on a page that never
 * calls PDF parsing at all.
 *
 * `pdf-parse` is loaded via `require()` (through `createRequire`), not
 * `import()` — a second, real defect confirmed live in production even
 * after the lazy-loading fix above and `next.config.ts`'s
 * `serverExternalPackages`: Turbopack's own runtime loader for
 * externalized packages (its "externalImport" mechanism) resolved
 * `import("pdf-parse")` to the same unsafe browser-condition build
 * again at actual request time on Vercel, even though the identical
 * code path worked correctly against a local production build
 * (`next build && next start`) — an environment-specific difference in
 * how that mechanism picks package.json export conditions for a
 * dynamic ESM import specifically. `pdf-parse`'s own CommonJS/"require"
 * condition build is independently confirmed safe (its one `DOMMatrix`
 * reference sits inside a static method body, never evaluated at
 * load time), and Node's plain CJS `require()` resolution is simpler,
 * well-defined, and — verified directly — reliably picks that build.
 * `pdfjs-dist`'s worker module stays a dynamic `import()`: it's a real
 * `.mjs` file, which Node's `require()` cannot load at all
 * (`ERR_REQUIRE_ESM`), and its own load was never implicated in the
 * production failure (the error named only `pdf-parse`).
 */
import { createRequire } from "node:module";

declare global {
  var pdfjsWorker: { WorkerMessageHandler: unknown } | undefined;
}

let workerReady: Promise<void> | null = null;

function ensurePdfjsWorker(): Promise<void> {
  if (!workerReady) {
    workerReady = import("pdfjs-dist/legacy/build/pdf.worker.mjs").then(({ WorkerMessageHandler }) => {
      globalThis.pdfjsWorker = { WorkerMessageHandler };
    });
  }
  return workerReady;
}

let pdfParseModule: { PDFParse: typeof import("pdf-parse").PDFParse } | null = null;

function loadPdfParse(): { PDFParse: typeof import("pdf-parse").PDFParse } {
  if (!pdfParseModule) {
    const require = createRequire(import.meta.url);
    const loaded = require("pdf-parse") as { PDFParse: typeof import("pdf-parse").PDFParse };
    pdfParseModule = loaded;
    return loaded;
  }
  return pdfParseModule;
}

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
  await ensurePdfjsWorker();
  const { PDFParse } = loadPdfParse();
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
