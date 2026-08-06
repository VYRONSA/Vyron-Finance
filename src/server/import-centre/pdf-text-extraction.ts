/**
 * Pilot Review Round 1, Phase 9 — real PDF text extraction. This is the
 * one piece of the PDF pipeline that doesn't depend on knowing any
 * individual bank's layout: extracting a PDF's raw text works the same
 * way regardless of which bank produced it, which is what makes bank
 * *detection* buildable today even though bank-specific *parsing* isn't
 * yet (see `bank-statement-adapter-registry.ts`'s module docstring).
 *
 * Calls `pdfjs-dist` directly (`getDocument`/`page.getTextContent`),
 * not the `pdf-parse` npm package this originally used. `pdf-parse`
 * wraps `pdfjs-dist` behind a package.json "exports" map with three
 * competing conditions ("browser"/"import"/"require") for its bare `.`
 * specifier — its browser build alone has 14 unguarded top-level
 * `DOMMatrix` references (confirmed by inspecting the built output; the
 * "import"/"require" conditions' own builds are safe). Every attempt to
 * force the safe condition — lazy `import()`, `serverExternalPackages`,
 * even switching to `require()` via `createRequire` — kept crashing
 * production specifically (never reproduced against a local `next
 * build && next start`) with "DOMMatrix is not defined", because
 * Turbopack's own runtime loader for `serverExternalPackages`-listed
 * packages resolves that ambiguous specifier to the browser condition
 * on Vercel regardless of whether the calling code uses `import()` or
 * `require()` (confirmed live against the actual deployed API both
 * ways — see VR-022 in the Pilot Issue Register for the full trace).
 * `pdf-parse`'s own subpath exports don't offer an unambiguous
 * alternative either (`./node` exists but doesn't export its `PDFParse`
 * class at all, only header-reading helpers).
 *
 * `pdfjs-dist/legacy/build/pdf.mjs`/`pdf.worker.mjs` are DEEP,
 * unambiguous import paths with no competing "browser" condition to
 * mis-resolve — and this worker import specifically has been reliably
 * safe in every single reproduction this round, local and production
 * (the crash always named `pdf-parse`, never this). Extraction is
 * reimplemented here to match `pdf-parse`'s own algorithm and default
 * parameters exactly (`lineThreshold: 4.6`, `cellSeparator: '\t'`,
 * `lineEnforce: true`, the `-- N of Total --` page-join marker) — this
 * codebase's FNB parsers were built and tuned against that exact text
 * shape (tab-separated columns, specific line-break heuristics), and
 * changing it would risk silently breaking every regex in both.
 *
 * `pdfjs-dist`'s worker logic always runs on the main thread in
 * Node.js via a "fake worker" that dynamically `import()`s the worker
 * module's `WorkerMessageHandler` at runtime with a webpack/vite-ignore
 * comment Next's bundler doesn't honour — pdfjs-dist's own documented
 * escape hatch is checking `globalThis.pdfjsWorker.WorkerMessageHandler`
 * FIRST and skipping that dynamic import entirely when it's already
 * set, which `ensurePdfjsWorker` below does. Both this and the main
 * `pdf.mjs` module are loaded lazily, inside `ensurePdfjsWorker`/
 * `extractPdfText` themselves, never at this module's own top level —
 * found live (production build only) that a static top-level import
 * here pulls the whole PDF toolchain into the module graph of any page
 * that merely imports this file transitively (e.g. the Company
 * Dashboard, via `import-service.ts`'s `listRecentImports`), crashing
 * SSR on a page that never calls PDF parsing at all.
 */
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

// pdf-parse's own defaults (`ParseParameters.ts`'s `setDefaultParseParameters`)
// — matched exactly so extracted text has the identical shape this
// codebase's parsers were built and tuned against.
const LINE_THRESHOLD = 4.6;
const CELL_THRESHOLD = 7;
const CELL_SEPARATOR = "\t";

// A minimal, self-contained structural type for the one shape this
// module actually reads off pdfjs-dist's `TextItem`/`PageViewport` —
// deliberately not importing pdfjs-dist's own type here, since its
// `TextItem` isn't re-exported from this deep module path.
type PdfjsTextItem = { str: string; transform: number[]; width: number; height: number; hasEOL: boolean };
type PdfjsViewport = { convertToViewportPoint(x: number, y: number): number[] };

/** Reimplements `pdf-parse`'s `PDFParse.getPageText` — same line-break
 * ("lineEnforce") and column-separator ("cellSeparator") heuristics,
 * same defaults, same item-joiner (none, i.e. `''`). See module
 * docstring for why this exists instead of calling `pdf-parse` itself. */
function joinPageText(items: PdfjsTextItem[], viewport: PdfjsViewport): string {
  const strBuf: string[] = [];
  let lastX: number | undefined;
  let lastY: number | undefined;
  let lineHeight = 0;

  for (const item of items) {
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);

    if (lastY !== undefined && Math.abs(lastY - y) > LINE_THRESHOLD) {
      const lastItem = strBuf.length ? strBuf[strBuf.length - 1] : undefined;
      const isCurrentItemHasNewLine = item.str.startsWith("\n") || (item.str.trim() === "" && item.hasEOL);
      if (lastItem?.endsWith("\n") === false && !isCurrentItemHasNewLine) {
        const ydiff = Math.abs(lastY - y);
        if (ydiff - 1 > lineHeight) {
          strBuf.push("\n");
          lineHeight = 0;
        }
      }
    }

    let str = item.str;
    if (lastY !== undefined && Math.abs(lastY - y) < LINE_THRESHOLD) {
      if (lastX !== undefined && Math.abs(lastX - x) > CELL_THRESHOLD) {
        str = `${CELL_SEPARATOR}${str}`;
      }
    }

    strBuf.push(str);
    lastX = x + item.width;
    lastY = y;
    lineHeight = Math.max(lineHeight, item.height);
    if (item.hasEOL) strBuf.push("\n");
    if (item.hasEOL || str.endsWith("\n")) lineHeight = 0;
  }

  return strBuf.join("");
}

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  await ensurePdfjsWorker();
  const { getDocument, VerbosityLevel } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // `getDocument` detaches the underlying `ArrayBuffer` it's handed (its
  // fake-worker transfer simulation) — real, confirmed bug: this
  // function is called twice per import request with the SAME buffer
  // (once for bank detection, once inside the resolved adapter's own
  // `parse()`), and the second call failed with "Cannot perform
  // Construct on a detached ArrayBuffer" once the first had already
  // consumed it. `.slice(0)` makes an independent copy from the
  // still-intact caller-owned buffer before handing it off, so the
  // caller's own `buffer` is never touched regardless of how many times
  // this function is called with it.
  let doc: Awaited<ReturnType<typeof getDocument>["promise"]>;
  try {
    doc = await getDocument({ data: new Uint8Array(buffer.slice(0)), verbosity: VerbosityLevel.ERRORS }).promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : String(error);
    if (name === "PasswordException" || /password|encrypt/i.test(message)) {
      throw new PdfExtractionError("encrypted", "This PDF is password protected and can't be read. Remove the password and upload it again.");
    }
    throw new PdfExtractionError("corrupted", "This PDF could not be read — the file may be corrupted or isn't a valid PDF.");
  }

  let fullText: string;
  try {
    const parts: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const items = textContent.items.filter((item) => "str" in item) as unknown as PdfjsTextItem[];
      const pageText = joinPageText(items, viewport);
      parts.push(`${pageText}\n-- ${pageNum} of ${doc.numPages} --\n\n`);
      page.cleanup();
    }
    fullText = parts.join("");
  } finally {
    await doc.destroy();
  }

  // A text-based statement always has far more than 20 characters of
  // real text; a scanned/image-only PDF has none at all (this only ever
  // reads an embedded text layer — it doesn't OCR).
  if (!fullText || fullText.trim().length < MIN_EXTRACTABLE_TEXT_LENGTH) {
    throw new PdfExtractionError(
      "scanned-image",
      "No extractable text was found in this PDF — it appears to be a scanned image rather than a text-based statement, which this importer can't read yet.",
    );
  }

  return fullText;
}
